# dsh-empty-prompt

允许空提示词直接发送：触发一个**没有 user message** 的回合（`turn/start` + `turn/end`，不写 user input、不调模型）。

配套 Client patch 把空内容发送/回车接到 `POST /empty-prompt`；Trajectory 对空回合正常显示。

## 用法

安装后，在输入框为空时点「发送」或按回车即可发起一个空回合。回合会正常出现在历史里（`turnOutline` 的 `prompt`/`response` 为空字符串），但不调用任何模型。

## 布局

```
index.js           Host 半：注册 /empty-prompt 端点
cordis.patch.yml   bundle patch
package.json
```

## 说明

- 无 user input 的空回合由 Host 半直接生成，不经过 LLM。
- 宿主 patch 是升级易失项（`dsh-client-ui-chat/lib/client.js` 不属于本插件），升级 `@deepseek-ai/dsh` 后需重新应用，备份见 KB `proj-dsh-empty-prompt-send`。
