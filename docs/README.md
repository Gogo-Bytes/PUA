# 项目文档索引

文档按用途维护。当前实现、测试和 Git 状态优先于历史记录；历史材料只用于了解决策来源，不作为新的实现要求。

## 当前实现与约束

- [现行架构](architecture.md)：当前代码的进程边界、模块所有权、依赖方向和已完成迁移。
- [目标架构](target-architecture.md)：后续结构演进的约束和未完成目标。它不是当前实现的替代品。
- [原生对话技术设计](native-chat-design.md)：Pi RPC、PTY 兼容入口、消息流和安全边界。
- [Desktop Client 契约](desktop-client-contract.md)：preload、IPC、DesktopResult 和 renderer client 的 wire 约束。
- [Task Workspace 架构](task-workspace-architecture.md)：Project、Task、Session、Run 和 Inspector 的术语及所有权。
- [Pi 能力审计](pi-capability-audit.md)：已接入、待验证和明确不暴露的 Pi 能力。
- [验证记录](validation.md)：源码、测试、构建、smoke 和跨平台验证证据。

## 产品与 UI 参考

- [Codex Desktop 对照研究](codex-desktop-study.md)：外部产品研究，只记录可迁移的交互原则。
- [Codex 交互对齐清单](codex-interaction-parity.md)：产品目标和能力差异矩阵；当前状态以现行架构和代码为准。
- [UI 迁移计划](ui-migration-plan.md)：已完成或仍需核对的通用 UI 迁移边界。
- [研究材料](research/README.md)：具体 diff viewer、UI library 选择依据。

## 后续工作

- [架构后续问题](architecture-followups.md)：本次代码分析记录的问题、证据和实施顺序。本文只记录工作，不授权立即重构。

## 历史材料

早期设计提案、工作台实施流水和一次性 agent 交接记录已从当前文档入口移除。它们与现行代码存在较多时间漂移，重新需要时应从 Git 历史恢复，而不是作为当前要求继续维护。
