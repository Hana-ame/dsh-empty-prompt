/**
 * dsh-empty-prompt — 允许空提示词直接发送。
 *
 * 目标：触发一个「没有任何 user input」的回合，而不是发送一条
 * `{ role: "user", content: [] }` 的空消息。实现方式：
 *
 * 1. `POST /empty-prompt {sessionId}`：找到 live agent，往 inbox 塞一条
 *    **标记过的空消息**（id 前缀 `empty-prompt:`）并 followup 唤醒 driver。
 * 2. 插件在 `agent/pre-step` waterfall 里把这种标记消息从 `messages` 中滤掉
 *    （返回 `{ kind: "enter", messages: [] }`）。AgentLoop 的 turn() 对
 *    「step 0 且 decision.messages 为空」的判定是直接 `turnEnds = completed`
 *    并结束轮次，于是会话里只会落 `turn/start` + `turn/end(completed)`：
 *    **没有 user/message 事件、没有 step、不调模型**。
 * 3. 标记消息在 claim 时已从 inbox 移除，不会残留到下一轮。
 *
 * 为什么不用「空 content 的 user message」：那会写出一条空的 user/message
 * 事件（用户明确要求不要这个东西）。这里靠 waterfall 在写事件之前滤掉。
 */

import { randomUUID } from 'node:crypto';

export const name = 'dsh-empty-prompt';

/** Host services used: live agent registry, the browser HTTP carrier, and its auth gate. */
export const inject = ['agents', 'webServer', 'connection'];

/** Marker that identifies a pending message as「空提示唤醒」, never a real user input. */
const EMPTY_ID_PREFIX = 'empty-prompt:';

/** Inert source kind: satisfies `message.source.kind` readers without looking like a real user turn. */
const EMPTY_SOURCE_KIND = 'empty-prompt';

function respond(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return {};
  return JSON.parse(raw);
}

/**
 * Register the empty-turn route and the pre-step filter.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  // 不滤掉标记消息：让它正常进入 AgentLoop → 写入一条 user/message（content: []）
  // → 调模型，agent 基于上下文继续干活。之前滤成 messages:[] 会被 AgentLoop
  // 判成 step 0 无输入 → turnEnds=completed，回合瞬间结束（没意义）。

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/empty-prompt',
        handler: async (request, response) => {
          const rejection = ctx.connection.requestRejection?.(request);
          if (rejection !== undefined) {
            respond(response, rejection, { error: `auth rejected (HTTP ${String(rejection)})` });
            return;
          }
          if (request.method !== 'POST') {
            respond(response, 405, { error: 'POST required' });
            return;
          }
          let payload;
          try {
            payload = await readJsonBody(request);
          } catch (error) {
            respond(response, 400, { error: `invalid JSON: ${String(error)}` });
            return;
          }
          const sessionId = payload?.sessionId;
          if (typeof sessionId !== 'string' || sessionId.length === 0) {
            respond(response, 400, { error: 'sessionId required' });
            return;
          }
          const agent = ctx.agents.get(sessionId);
          if (agent === undefined) {
            respond(response, 404, { error: `session "${sessionId}" is not live` });
            return;
          }
          if (agent.status !== 'idle') {
            respond(response, 409, { error: `session "${sessionId}" is ${agent.status === 'running' ? 'running' : 'busy'}` });
            return;
          }
          // source.kind 用 'user'：让 agent 当正常用户输入处理（agent-instructions
          // 等监听器按 user 附加上下文），这样空 content 的消息也能正常走完
          // pre-step → 写入 user/message → 调模型，agent 基于上下文继续干活。
          agent.followup({
            role: 'user',
            id: `${EMPTY_ID_PREFIX}${randomUUID()}`,
            content: [{ type: 'text', text: ' ' }],
            source: { kind: 'user' },
          });
          respond(response, 200, { ok: true });
        },
      }),
    'empty-prompt: route',
  );
}