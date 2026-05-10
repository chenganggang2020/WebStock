# WebStock 开发文档

本目录收纳面向开发和交付的设计资料。

- `WebStock_OpenAI_Codex_Deployment_Plan.md`：原始 OpenAI API 迁移、测试与部署设计文档。
- `WebStock_Portfolio_Codex_Development_Doc.md`：自选股、持仓、交易记录与组合统计功能设计文档。
- `../deployment.md`：整理后的部署操作文档，面向本地、PM2、Docker 和 Nginx 部署。

当前实现遵循原始设计中的低风险迁移路线：保留现有 Chat Completions 与 SSE 流式解析形态，默认使用 OpenAI 环境变量配置，并通过 Node 内置测试框架覆盖 AI 配置、payload、错误透传和 `/ai-status` 状态接口。
