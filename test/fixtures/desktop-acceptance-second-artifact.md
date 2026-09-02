# WorkPet 桌面验收资料

这是一份无敏感信息的第二输入资料，用于验证 WorkPet 是否能够：

- 从 Codex 可见历史中识别第二个独立文件；
- 只保存原路径、文件元数据和 SHA-256；
- 把资料记录为 `ArtifactRef`，而不是复制或修改原文件；
- 在 WorkBuddy 接力时仅传递当前需要的资料引用。

验收完成后，这个文件仍属于工作区；WorkPet 删除 WorkRecord 时不得删除它。
