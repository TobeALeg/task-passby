# Worket 项目协作约定

领域术语以 [CONTEXT.md](CONTEXT.md) 为准；产品与架构现状分别见 [docs/product.md](docs/product.md) 和 [docs/architecture.md](docs/architecture.md)。

## VPS 登录

访问 Worket VPS `124.223.223.215:22` 时，默认使用已验证的 `ubuntu` 账号与本机密钥（实际拼写为 `tecent`）：

```sh
ssh -i /Users/dandi/Desktop/idd_tecent_dstui.pem -o IdentitiesOnly=yes ubuntu@124.223.223.215
```

密钥留在本机，权限为 `600`；仓库只记录路径，不保存密钥内容。部署或排查服务器时，先读 [VPS 检查记录](docs/deployment/vps-readiness.md)，再核实实时资源与已有服务；保留现有 DeepSeek Harness 和 Caddy。2026-09-10 已验证登录与免密 sudo。

## 持续积累 BP 素材

在本项目讨论中，只要出现 Worket 相对其他产品的潜在优势、自身价值、对产品或组织设计的 insight，或值得在 BP 中表达和展示的点，就在本轮结束前主动更新 [BP 素材清单](docs/bp/benefits-and-insights.md)，无需用户再次提醒。

- 先查已有条目，同一主题补充到原条目；新主题使用稳定编号，记录日期、讨论起因、核心洞察、用户价值与可展示场景。
- 分别注明用户观点、已核实的外部事实、Worket 当前依据、助手提出的设计设想以及待验证事项。外部比较附来源和核实日期，当前能力附项目证据。
- 保留有价值但尚未验证的想法，并注明状态；BP 候选表述不得把设计方向写成已实现能力，也不得把竞品推论写成事实。
- 记录素材不代表批准实现功能或修改领域模型。设计落地后，再同步 product.md、architecture.md 和条目状态。
- 完成后简要告知本轮新增或更新的条目与路径。
