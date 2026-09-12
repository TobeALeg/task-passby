# Worket Windows x64 构建验收

日期：2026-09-12。版本：0.1.3。环境：Windows x64。

## 产物

- 便携目录：`release/Worket-win32-x64/`
- 用户下载包：`release/Worket-0.1.3-win32-x64.zip`
- 校验文件：`release/Worket-0.1.3-win32-x64.zip.sha256`
- SHA256：最终发布构建后记录。

当前 Windows 包未代码签名，不是安装器。用户应解压整个目录并运行其中的 `Worket.exe`；公开下载可能出现 Windows SmartScreen 来源提示。

## 已通过

- `npm test`：122 项测试全部通过，包含 Windows 更新附件选择、通用 Codex 窗口标题与 Windows 文件权限语义。
- `npm run package:win`：生成 Windows x64 Electron 包，主程序产品名与文件说明为 Worket，包含 ICO、PNG 与独立 Win32 前台窗口 Helper。
- `npm run qa:package`：打包后真实 `Worket.exe` 启动通过；桌宠与面板完整，二次启动恢复面板，桌宠四种状态、阴影安全区、面板尺寸和只读约束通过。最终发布脚本会从 ZIP 重新解压并再次执行该验收。
- `node scripts/qa-updates.mjs`：Windows x64 附件选择、用户确认、流式下载、大小与 SHA256 校验、重复下载复用和手动替换文案通过。
- 从 `C:\Users\Dandi\AppData\Local\Programs\Worket\Worket.exe` 启动的真实 Codex 测试通过：Windows 主窗口只提供通用 `ChatGPT` 标题时进入明确的会话选择，随后从 App Server 读取真实历史、创建本地工作、完成工作并通过桌宠重新打开面板。测试使用临时数据库、关闭接入安装与后台同步，不修改原对话或上传内容。

## Windows 适配范围

- Win32 前台进程与窗口标题识别；Worket 位于前台时按 Z-order 找回后方受支持工作窗口。
- Windows Codex App Server 候选路径与缺失 `HOME` 时的用户目录兼容。
- WorkBuddy 本地读取桥改用按用户目录哈希隔离的 Windows 命名管道；文件资料接受 Windows 绝对路径。
- Windows 托盘、应用图标、单实例恢复和任务栏避让。
- GitHub Release 使用严格的 `Worket-<version>-win32-x64.zip` 与 `.sha256` 文件名。

## 尚未通过的真实验收

Windows Codex 的会话选择与真实历史导入已通过；主窗口只暴露通用 `ChatGPT` 标题时无法精确自动定位当前任务，产品按既有安全规则要求用户选择，不猜测某条历史。尚未在 Windows WorkBuddy 上验证内部扩展、真实历史导入、双向交接与重启续录。Windows DPAPI、高 DPI / 多屏 / 非底部任务栏、休眠恢复及 SmartScreen 安装体验也需在普通用户会话中补验。
