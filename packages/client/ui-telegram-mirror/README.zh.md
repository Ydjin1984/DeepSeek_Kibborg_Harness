# @deepseek-ai/dsh-client-ui-telegram-mirror

[English](README.md) | 中文

输入框工具行中的 Telegram 镜像开关（`conversation.input.left` 条目 `telegram-mirror`，紧邻附件按钮）。点击一次即挂接当前会话的镜像（其事件随后流入已配置的 Telegram 聊天）；激活状态会让图标变绿并带光晕。

## 模型体验

无。该按钮只调用桥接 API；镜像会话的所有模型可见影响都由 telegram 桥接持有。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- 按钮状态在挂载时探测一次，之后由它自身的点击更新；从另一个标签页／会话挂接的镜像不会实时同步回这个按钮，直到它重新挂载。
- 镜像图标是手绘的 Telegram 字形，与 16px 图标集保持一致；`ui-primitives` 中不存在 `telegram` 字形。
