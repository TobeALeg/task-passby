# 执行者通用接口验收

日期：2026-09-09。WorkBuddy 5.5.3，macOS arm64。

## 已验证

- 完整本地回归 94/94 通过。三执行者共用来源、交接和回写接口；相同会话 ID 在不同执行者间隔离；没有用户选择的会话不入库。
- WorkBuddy 实际读取接口可列出 30 项历史；独立临时数据库直接导入一项会话的 192 条可见事件，包括用户消息、回复、工具调用和结果。无需发送新消息。
- 相同会话重复选择保持相同 WorkInstance；增量 externalId 去重；完成后停止记录。测试仅打印数量、类型和临时数据库路径，用户正文未提交到仓库。
- 打包应用的合成桌面验收：三个执行者的来源与交接按钮自动生成；WorkBuddy 历史分页；三个并行工作；取消未确认交接恢复原 WorkBuddy 来源。截图位于本机 `output/playwright/executors-*.png`。
- 打包应用基础验收：Worket 应用名、Dock、重复启动恢复窗口、桌宠阴影与尺寸、只读面板、无横向溢出。
- WorkBuddy 扩展已按明确的四项读取权限安装，声明 onStartup/resident。正常退出再打开后读取成功；resident 避免 Guardian 空闲回收读取进程。
- 旧 transcript 文本/资料事件在身份、内容和时间相符时保留原 externalId；重复文本按出现顺序配对，不压成一条。旧 waiting 工作不再自动凭任意下一条消息绑定，需重新选择来源。

## 验证边界

真实 Codex → WorkBuddy → Codex 模型执行、MCP 工作包读取及新回复回写尚未执行。本轮另行请求的合成任务发送授权未收到回复，因此没有发送合成或真实工作任务。双向工作身份和执行片段已通过替身集成测试；不以此冒充真实模型闭环。

Codex 接收端使用官方新聊天 Deep Link，只预填提示词，需用户在 Codex 确认发送。WorkBuddy 内部扩展没有对外兼容承诺，版本升级可能要求调整适配器；无法精确定位当前聊天时会打开会话选择。

## 复验

- `npm test`
- `npm run package:mac`，随后 `npm run qa:package`
- `node scripts/qa-parallel-recording.mjs`：打包应用、独立数据、合成执行者、禁止真实发送。
- `npm run qa:workbuddy-context`：真实 WorkBuddy 只读来源，独立数据、不调用模型。
- 获得具体任务发送授权后才运行真实桌面交接验收。
