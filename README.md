# Semantic Calendar

> **一个能理解日程内容的轻量级日历。**

Semantic Calendar 是一个面向桌面的现代日历项目。它不仅显示日历事件，还会尝试理解事件代表的含义，并为节假日、传统节日、二十四节气、体育赛事等内容补充图标、徽标、分类与提醒信息。

例如，导入普通 ICS 事件：

```text
Arsenal vs Manchester City
```

程序可以识别它是一场足球比赛，并进一步解析联赛、主客队和用户关注的球队，在日历中显示对应的球队徽标或赛事图标。

## 项目目标

- **简洁现代**：界面清爽，避免臃肿 Dashboard 和无意义视觉元素。
- **轻量常驻**：低空闲 CPU、低内存占用，适合全天后台运行。
- **本地优先**：能在本地完成的日历解析与事件识别，不上传到外部服务。
- **易于维护**：日历 UI、数据源、事件识别、元数据和通知模块彼此解耦。
- **方便扩展**：增加新的国家节假日、联赛或事件类型时，不需要修改核心 UI。
- **确定性优先**：节假日、体育赛程等结构化内容优先使用规则和数据匹配，不把 AI 作为基础依赖。

## 核心能力

### 日历与导入

- 月 / 周 / 日视图
- 多日历
- 导入本地 `.ics` 文件
- 订阅 ICS / WebCal 地址
- 本地持久化
- 系统通知与事件提醒
- 明暗主题
- 时区支持

### 中国日历信息

首批计划支持：

- 中国法定节假日
- 调休 / 补班
- 传统节日
- 二十四节气
- 农历信息

后续架构允许独立增加日本、英国、美国等国家或地区的数据提供器。

### 体育赛事

第一阶段以足球为主，首先支持英超。

例如：

```text
Arsenal vs Chelsea
```

可以解析为类似：

```json
{
  "type": "sport.fixture",
  "sport": "football",
  "competition": "premier-league",
  "homeTeam": "arsenal",
  "awayTeam": "chelsea"
}
```

随后 UI 可以显示：

- 主队 / 客队徽标
- 英超赛事标识
- 用户主队徽标优先展示
- 开赛时间
- 赛前提醒

未来可扩展到欧冠、西甲、德甲、意甲、F1、NBA 等。

## 核心设计：事件语义增强

传统日历通常只把 ICS 当成文本：

```text
SUMMARY:Arsenal - Manchester City
DTSTART:...
```

Semantic Calendar 会在导入之后增加一层事件识别：

```text
日历数据源
    ↓
ICS Parser
    ↓
Event Normalizer
    ↓
Event Matcher
    ↓
Metadata Resolver
    ↓
Enriched Event
    ↓
Calendar UI
```

普通事件：

```json
{
  "title": "Arsenal vs Manchester City",
  "start": "2026-10-18T16:30:00Z"
}
```

经过识别后可以补充：

```json
{
  "title": "Arsenal vs Manchester City",
  "start": "2026-10-18T16:30:00Z",
  "semantic": {
    "type": "sport.fixture",
    "sport": "football",
    "competition": "premier-league",
    "entities": [
      { "type": "team", "id": "arsenal" },
      { "type": "team", "id": "manchester-city" }
    ]
  }
}
```

语义信息和显示信息分离。球队名称、联赛归属等属于语义层；徽标、图标、颜色等属于展示层。

## Matcher 与 Provider

Matcher 负责判断“这个事件是什么”。

```ts
interface EventMatcher {
  id: string;
  match(event: CalendarEvent): MatchResult | null;
}
```

未来可以按领域拆分：

```text
matchers/
├── holidays/
├── festivals/
├── solar-terms/
└── football/
```

Provider 负责提供结构化数据，例如：

- HolidayProvider
- FestivalProvider
- SolarTermProvider
- FootballProvider

数据来源可以是项目内置数据、外部 API、ICS / WebCal 或定期下载的数据文件。

## 技术方向

当前优先考虑：

- **桌面壳**：Tauri
- **核心能力**：Rust
- **前端 UI**：TypeScript + React
- **本地数据**：轻量本地存储，具体方案在原型阶段确定

之所以优先考虑 Tauri，而不是 Electron，是因为本项目明确要求：

- 适合长期常驻
- 尽量降低空闲内存占用
- 减少不必要的后台进程
- 使用系统 WebView，避免重复打包完整 Chromium

技术栈在第一个可运行原型完成前仍可调整，最终以实际性能测试结果为准。

## 初步目录

```text
semantic-calendar/
├── apps/
│   └── desktop/
├── packages/
│   ├── calendar-core/
│   ├── ics/
│   ├── event-model/
│   ├── matcher-engine/
│   ├── metadata/
│   ├── notifications/
│   └── ui/
├── providers/
│   ├── holidays/
│   ├── festivals/
│   ├── solar-terms/
│   └── sports/
├── matchers/
│   ├── holidays/
│   ├── festivals/
│   └── football/
├── assets/
├── docs/
└── README.md
```

目录会随着第一版实现逐步收敛，不追求为了“架构完整”而过度拆分。

## MVP：v0.1

- [ ] 桌面应用基础框架
- [ ] 现代化月视图
- [ ] 基本日期导航
- [x] 解析本地 ICS 文件
- [ ] 订阅 ICS / WebCal 地址
- [ ] 日历数据本地保存
- [ ] 中国法定节假日
- [ ] 中国传统节日
- [ ] 二十四节气
- [ ] 英超事件识别
- [ ] 英超球队元数据
- [ ] 球队徽标展示
- [ ] 主队 / 关注球队设置
- [ ] 事件提醒
- [ ] 明暗主题
- [ ] 基础性能测试

## v0.1 暂不考虑

为了避免第一版失控，以下内容暂不作为 v0.1 目标：

- 完整替代 Google Calendar
- 团队协作
- Calendly 类预约排程
- 重型云端后端
- AI 优先的事件分类
- 项目管理功能
- 一次性支持大量体育项目和联赛

第一版先把 **日历基础 + ICS + 事件识别 + 节假日 + 英超** 做扎实。

## 性能原则

性能不是后期优化项，而是项目的基础要求。

重点关注：

- 空闲 CPU 占用
- 空闲内存占用
- 后台唤醒频率
- 避免不必要的轮询
- 增量更新日历事件
- 图标和徽标按需加载
- 元数据缓存
- 网络请求缓存与去重

具体数值目标会在第一个可运行原型完成后，通过实测确定。

## 隐私原则

日历可能包含高度私密的信息，因此默认遵循：

- 尽量本地解析事件
- 不无必要上传事件内容
- 网络数据源必须明确可见
- 本地基础功能不要求登录账号
- 如果以后加入遥测，必须可关闭

## Roadmap

### Phase 1 — 日历基础

建立轻量桌面应用和基础日历 UI。

### Phase 2 — 事件语义层

完成统一事件模型、Normalizer、Matcher 和 Metadata Resolver。

### Phase 3 — 中国日历

加入法定节假日、传统节日、二十四节气和农历信息。

### Phase 4 — 英超

加入球队识别、比赛事件识别、徽标展示和赛前提醒。

### Phase 5 — Provider / Matcher 扩展机制

让新数据源和新识别规则能够独立增加。

### Phase 6 — 同步

再评估 CalDAV、Google Calendar、Microsoft Outlook / Microsoft 365 等同步方式。

## 设计与开发文档

- [App Spec](docs/app-spec.md)：v0.1 产品、功能、数据、可靠性、性能、测试与发布的统一规格入口。
- [UI Spec](docs/ui-design.md)：月视图、明暗主题、节假日 / 节气 / 比赛日与 Inspector 的视觉与交互规范。
- [Tickets](docs/tickets.md)：v0.1 工作单、依赖关系、批次和关键路径。
- [项目愿景](docs/vision.md)：说明我们想解决什么问题、产品边界和长期方向。
- [架构草案](docs/architecture.md)：描述数据源、标准化、Matcher、元数据和 UI 的分层关系。
- [开发原则与建议做法](docs/development-principles.md)：约束早期开发方式，避免过度设计和资源浪费。
- [开发路线草案](docs/roadmap.md)：按阶段描述验证技术栈、日历基础、语义层、中国日历和英超等方向。
- [v0.1 Epic](https://github.com/q956085398-netizen/semantic-calendar/issues/1)：GitHub 上的总进度入口。

文档以真实实现为准。实现过程中如果发现更合理的方案，应同步更新 Spec 与 Ticket，而不是为了保持旧文档不变而限制代码演进。

## 项目状态

🚧 **早期设计与开发阶段**

当前 API、目录结构和技术方案均可能调整。

## License

暂未决定。在首次公开发布前确定。

## 开发环境

桌面端位于 `apps/desktop`，使用 Tauri + React + TypeScript。

前置环境：

- Node.js 20+
- npm 10+
- Rust stable
- Windows 开发时需安装 Tauri 官方要求的 WebView2 / C++ 构建工具

在仓库根目录执行：

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run dev       # 启动 Vite 前端开发服务器
npm run tauri -- dev
npm run build     # TypeScript 检查 + Vite 生产构建
npm run test      # Vitest
npm run lint      # ESLint
npm run format    # Prettier 格式检查
npm run tauri -- build
```

前后端 IPC 由 `data_store_read` / `data_store_write` / `data_store_rename` 三个 Tauri 命令承载（读取快照、原子写入、损坏隔离改名）。

本地数据层（SC-003）位于 `apps/desktop/src/data/`：

- 事件模型：`CalendarSource` / `RawCalendarEvent` / `NormalizedEvent` / `SemanticEvent` / `EnrichedEvent`（见 [app-spec.md](docs/app-spec.md) §8）；
- 持久化：版本化 JSON 快照（schema v1，带迁移链与损坏隔离恢复），存于系统应用数据目录的 `store/calendar-store.json`，原子写；
- 桌面壳通过 Tauri 命令 `data_store_read` / `data_store_write` / `data_store_rename` 访问该目录，文件名白名单校验；
- 存储接口按未来可替换 SQLite 适配器的形状设计（`FileIO` 端口 + 仓储方法）。

桌面 UI（SC-004 / SC-005）位于 `apps/desktop/src/`：

- 三栏骨架 `layout/AppShell.tsx`：Sidebar | Calendar | Inspector，左右栏可独立折叠（CAL-004），折叠后月历占满主区域；
- 月视图 `calendar/month-grid.ts`（纯函数：6×7 网格、周一起始、跨月日期、今天标记、月份步进 / 日期键解析 / 按天步进）与 `calendar/MonthView.tsx`（年月标题 + 上一月 / 下一月 / 今天导航 + 视图切换占位 + 日期选择）；
- 月份导航与选择（SC-005）：点击与方向键（±1 / ±7 天）移动选中日期，跨出当前月自动切换视图；WAI-ARIA grid 模式（roving tabindex + `aria-selected`），键盘导航后焦点跟随选中格；
- 小月历 `calendar/MiniMonth.tsx`：与主视图共用同一份网格计算（CAL-002 联动），点击日期 / 步进月份双向同步；
- Inspector `layout/InspectorPanel.tsx`：由选中日期驱动的极简日期详情（CAL-003），普通日期留白；
- 主题 `theme/theme.ts` + `index.css`：浅色暖白 / 深色炭灰同一套 CSS 变量，偏好经 `app.theme` 设置持久化（THEME-003）；selected / hover / focus 三态视觉区分（ui-design §17 / §24）；
- 侧栏数据源：SC-006 起显示已导入的本地 ICS 来源；节假日 / 节气 / 英超为内置占位（SC-011 / SC-012 / SC-016 接入），显示开关由 SC-018 接线。

本地 ICS 导入（SC-006）位于 `apps/desktop/src/ics/` 与 `apps/desktop/src/data/import/`：

- 解析器 `ics/parse-ics.ts`（纯函数、零依赖）：行折叠、VEVENT 提取、TEXT 转义、VALARM 嵌套跳过；映射 UID / SUMMARY / DESCRIPTION / LOCATION / DTSTART / DTEND / DURATION / RECURRENCE-ID / RRULE / EXDATE（含 TZID / VALUE=DATE 参数）与 STATUS:CANCELLED，完整原始片段保留在 `rawPayload`；
- 错误按事件隔离（ICS-005）：坏事件进入导入报告，不阻塞其余事件；文件级失败不创建数据源；
- 全天事件原样保留日期、不做时区换算（ICS-002 不漂移）；UTC 时间转 ISO UTC；浮动 / TZID 本地时间暂存为无偏移墙钟 ISO，TZID 参数原文保留在 `startTzid` / `endTzid`，精确换算由 SC-008 Normalizer 完成；
- 导入服务 `data/import/import-local-ics.ts`：sourceId 由文件名稳定派生，同一文件重复导入按（sourceId, UID, RECURRENCE-ID）upsert 去重（ICS-001），并更新来源同步状态（SRC-003）；入库前经 `normalize/normalizer.ts` 标准化（附加 `normalizedTitle` / `timezone`，原始字段原样保留）；
- 事件按日期分桶（`calendar/event-buckets.ts`）：全天含跨天（DTEND 独占语义）、时间事件跨天铺满开始日至结束日（结束恰为 00:00 视为独占边界）、UTC 事件按本地日期落格；
- UI：侧栏「导入 ICS 文件…」入口、月格事件摘要（最多 3 条 + 计数折叠，ui-design §6）、Inspector 当日事件列表（仅在实际存在时展示，§12.2）。

标准化与重复展开（SC-008）位于 `apps/desktop/src/normalize/`：

- 标题规范化 `normalize/title.ts`：NFKC（全角→半角）、不可见字符剔除、空白折叠，供 Matcher 使用，不含业务判断；
- 时区换算 `normalize/timezone.ts`：基于 Intl/IANA tzdata 的墙钟→UTC 两遍偏移探测（含夏令时切换边界），非法时区名抛错、调用方降级为浮动时间（app-spec §13）；
- RRULE 解析 `normalize/rrule.ts`：DAILY / WEEKLY / MONTHLY / YEARLY 与 INTERVAL / COUNT / UNTIL / BYDAY（含 ±序数）/ BYMONTHDAY；含 BYSETPOS 等无法精确兑现部分的规则返回 undefined，降级为单次事件（P-01：宁可不展开也不展示错误的重复）；
- Occurrence 展开 `normalize/occurrences.ts`：读取路径按月视图窗口展开——墙钟空间生成保证“每天几点”跨夏令时不漂移、TZID 实例换算为 UTC 瞬时、EXDATE 排除（墙钟 / UTC / 日期三形态匹配）、RECURRENCE-ID 例外替换与 STATUS:CANCELLED 取消、生成实例带稳定 occurrenceId（同一 occurrence 不重复，ICS-001）；迭代上限防御病态规则（app-spec §15）。

语义框架（SC-009）位于 `apps/desktop/src/semantic/`，完成“识别是什么”与“怎么展示”的分层（app-spec §7.4 / §7.5）：

- Matcher Engine `semantic/matcher-engine.ts`：`EventMatcher`（id / priority / match）静态注册，执行顺序完全确定（priority 升序、同级按 id 字典序，SEM-001）；`MatchResult` 含 semantic / matcherId / confidence / reason（SEM-002），matcherId 由引擎盖戳、实现方无法冒名；单个 Matcher 抛错只降级自身，事件继续后续判定，绝不消失（app-spec §6）；
- Metadata Resolver `semantic/metadata-resolver.ts`：组合器按注册顺序取第一个非 null，可整体替换（换图标包 / 主题 / 语言不动识别逻辑）；内置类型级默认值给出语义色 token、中文短标签与默认提醒策略（SC-017 消费）；`displayMetadataOf` 是 UI 读取边界，对磁盘 JSON 防御性收窄；
- 增强管线 `semantic/enrich.ts`：`reEnrichStore` 是唯一重建入口——清空增强分区后用当前 Matcher 集合重跑（SEM-004：Matcher 更新后语义随之重算，无需重新导入源数据）；未命中不写记录、读取侧自动按普通事件显示（SEM-003）；只写 enrichments 分区，原始事件分区分毫不动；
- 应用接线 `semantic/app-registry.ts` + `App.tsx`：启动与每次导入后执行匹配；Matcher / Resolver 抛错只降级自身并留一条不含事件正文的控制台告警（app-spec §14），事件不会消失；启动重建是同步 O(事件数 × Matcher 数) 单趟扫描（无后台轮询），耗时基线测量由 SC-020 提供；v0.1 静态注册表尚无领域 Matcher（法定节假日 SC-011、传统节日与节气 SC-012、英超 SC-015 依次加入），链路已真实运行，全部事件按普通事件显示；
- UI 通用增强显示：月格摘要与 Inspector 事件卡消费 `--event-accent`（语义色左缘条）与语义短标签，值全部来自 Metadata Resolver，UI 组件不含任何球队 / 节日标题判断（验收：UI 不包含领域判断）。

v0.1 已知限制：同一文件改名后再次导入会视为新来源（新增副本），来源删除入口由 SC-018 提供；RRULE 的 BYSETPOS / BYWEEKNO 等高级部分按“降级为单次事件”处理，完整支持留给后续版本；语义色 token 为临时基线，完整语义色体系由 SC-013 定稿。
