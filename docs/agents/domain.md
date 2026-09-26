# 领域文档

工程类 skill 在探索本仓库时，按这里的规则消费领域文档。

## 探索之前先读

- 仓库根目录的 **`CONTEXT.md`**；或
- 若存在根目录 **`CONTEXT-MAP.md`**，它指向每个 context 各自的 `CONTEXT.md`，只读与当前主题有关的那些。
- **`docs/adr/`**：读与即将改动的区域相关的 ADR。

这些文件目前都不存在。**缺了就静默跳过**：不要指出缺失，也不要提前建议创建。`/domain-modeling` skill（经由 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达）会在术语或决策真正被敲定时按需创建。

## 本仓库当前的领域文档

在 `CONTEXT.md` 出现之前，下列文件是领域知识的权威来源，动手前按需阅读：

| 文件 | 内容 |
| --- | --- |
| `docs/vision.md` | 要解决的问题、产品愿景、产品边界、长期方向 |
| `docs/app-spec.md` | 产品规格：信息架构、系统架构（§7）、核心数据模型（§8）、功能需求（CAL / THEME / SRC / ICS / SEM / CN / SPORT / NOTIFY / SETTINGS）、持久化、后台行为、错误与降级、隐私、性能、可访问性、测试策略、发布门槛（§20）、需求变更规则（§21） |
| `docs/architecture.md` | 架构草案：Calendar Sources、Source Adapters、Event Normalizer、Matcher Engine、Metadata Resolver、Calendar UI、Notifications、桌面壳与生命周期 |
| `docs/ui-design.md` | UI 规格：整体布局、月格语义渲染、中国法定节假日与连休、补班日、传统节日与节气、体育赛事日期格、Inspector、多语义冲突规则（§16）、颜色语义、可访问性、v0.1 月视图验收标准（§26） |
| `docs/development-principles.md` | 开发原则：垂直切片优先、不为未来过度设计、业务规则不进入 UI 等 |
| `docs/roadmap.md` | 分阶段路线，以及进入下一阶段的判断依据 |
| `docs/tickets.md` | v0.1 可执行工作清单、批次顺序、关键路径、Ticket 约定 |

## 文件结构

单 context 仓库（本仓库）：

```text
/
├── CONTEXT.md              ← 尚未创建，由 /domain-modeling 按需生成
├── docs/
│   ├── adr/                ← 尚未创建
│   ├── agents/             ← 本文件所在位置
│   └── *.md                ← 上表列出的现有规格文档
└── apps/
    └── desktop/            ← 唯一的 workspace：React + TypeScript 前端 + src-tauri Rust 壳
```

本仓库只有 `apps/desktop` 一个 workspace，因此不需要 `CONTEXT-MAP.md`，也不需要 per-context 的 `CONTEXT.md` 与 `docs/adr/`。

## 使用既有术语

当输出要命名一个领域概念（Issue 标题、重构提案、假设、测试名）时，使用本项目已有的术语，不要漂移到同义词。

- 架构层术语以 `docs/architecture.md` 与 `docs/app-spec.md` §7–§8 为准：Calendar Source、Source Adapter、Event Normalizer、Matcher、Metadata Resolver、语义日期格、Inspector、提醒调度器。
- 代码侧术语以 `apps/desktop/src/` 下的模块目录为准：`providers/`、`normalize/`、`semantic/`、`display/`、`layout/`、`calendar/`、`format/`、`ics/`、`ipc/`、`shell/`、`theme/`、`data/`。
- 中国日历的呈现术语以 `docs/ui-design.md` §7–§9 为准：休息使用「休」，补班使用「补」并配蓝色语义，连休形成连续视觉。
- 体育语义术语以 `docs/app-spec.md` SPORT 章节与 `docs/ui-design.md` §10、§13 为准：比赛月格、队标、Matchday Inspector。

若需要的概念尚未存在，那是一个信号：要么你在发明项目不使用的语言（重新考虑），要么这里存在真实缺口（记下来交给 `/domain-modeling`）。

## 标记 ADR 冲突

若输出与现有 ADR 冲突，显式指出，不要静默覆盖：

> _与 ADR-0007 冲突，但因为……值得重新打开。_

在 `docs/adr/` 出现之前，与 `docs/app-spec.md` 或 `docs/ui-design.md` 冲突时按同样方式处理。规格本身的变更规则见 `docs/app-spec.md` §21。
