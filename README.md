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
- [x] 订阅 ICS / WebCal 地址
- [ ] 日历数据本地保存
- [ ] 中国法定节假日
- [ ] 中国传统节日
- [ ] 二十四节气
- [ ] 英超事件识别
- [x] 英超球队元数据
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

前后端 IPC 由 `data_store_read` / `data_store_write` / `data_store_rename` 三个数据命令与 `webcal_fetch` 一个网络命令承载（读取快照、原子写入、损坏隔离改名、订阅抓取）。

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
- 应用接线 `semantic/app-registry.ts` + `App.tsx`：启动与每次导入后执行匹配；Matcher / Resolver 抛错只降级自身并留一条不含事件正文的控制台告警（app-spec §14），事件不会消失；启动重建是同步 O(事件数 × Matcher 数) 单趟扫描（无后台轮询），耗时基线测量由 SC-020 提供；静态注册表当前含英超比赛标题 Matcher（SC-015），法定节假日 SC-011、传统节日与节气 SC-012 依次加入，未注册的语义按普通事件显示（SEM-003）；
- UI 通用增强显示：月格摘要与 Inspector 事件卡消费 `--event-accent`（语义色左缘条）与语义短标签，值全部来自 Metadata Resolver，UI 组件不含任何球队 / 节日标题判断（验收：UI 不包含领域判断）。

WebCal / ICS 订阅（SC-007）位于 `apps/desktop/src/data/webcal/` 与 `apps/desktop/src/data/net/`，把一次性导入扩展为可长期使用的网络来源（SRC-002 / SRC-003 / SRC-004）：

- 网络访问全部走 Rust 侧 `webcal_fetch` 命令（`src-tauri/src/webcal.rs`，reqwest + 系统 TLS）：webview 里的 fetch 受同源策略限制、绝大多数 ICS 服务端不发 CORS 头，且敏感 token 不应进入 webview 网络栈；请求带连接 / 总超时（10s / 30s）与 20MB 正文上限，非 2xx 不读正文、只回状态码；
- 端口抽象 `data/net/http-io.ts`（条件 GET）+ `tauri-http-io.ts`：刷新逻辑对网络层零依赖，测试用替身即可覆盖全部降级分支；
- 地址处理 `webcal/webcal-url.ts`：`webcal://` 按 `https://` 处理、缺协议补 `https://`、去 fragment；`sourceId` 由地址散列派生（同一地址重复添加命中同一来源，且 id 不含 token）；展示名与错误文案一律脱敏（`host + path`，查询串省略）；
- 刷新服务 `webcal/webcal-refresh.ts`：条件 GET（`If-None-Match` / `If-Modified-Since`）→ 304 复用缓存 / 200 解析 → 标准化 → 按（sourceId, UID, RECURRENCE-ID）求差集替换（消失的事件才删除，未变事件保留增强结果）→ 更新来源状态与校验值；服务端不再返回校验值时清掉旧值，避免用过期 ETag 永远拿不到新内容；同一来源的并发刷新合并为一次请求；
- 失败降级（§13）：网络 / 超时 / HTTP 错误 / 内容无法解析 / 空内容都只标记 `lastSyncStatus: "error"` 与脱敏后的 `lastSyncError`，**不删除已有事件**，`lastSyncAt` 保留上次成功时间；事件级解析错误按 ICS-005 隔离计数；空日历（合法但没有 VEVENT）在已有缓存时同样按失败处理并保留缓存——服务端维护页、中间代理的空壳与真正清空的订阅无法区分，而清空事件的代价高于保留一份可能过期的缓存（P-01 可靠性优先）；来源本就没有事件时，空日历按正常刷新处理；
- 抓取期间来源被删除时丢弃结果（不留无主事件记录）；
- 低频后台刷新 `webcal/refresh-scheduler.ts`：常规间隔 6 小时、失败后 30 分钟重试；只维护**一个** `setTimeout` 指向最近到期时刻（不用 `setInterval`，无到期订阅时不持有定时器，空闲零唤醒，§12），触发后串行刷新到期来源并重算下一次；应用启动、手动刷新、到达刷新时间三类触发之外没有轮询；
- 落盘串行化 `CalendarStore.save()`：低频刷新与手动操作可能同时写同一个临时文件，写入进入队列，快照在队列内序列化（最后一次写入反映最新状态）；
- UI（`layout/Sidebar.tsx`）：地址输入 + 添加、每行「刷新 / 停用·启用 / 删除」，行状态显示“刷新中… / 上次成功 … / 刷新失败：… / 已停用 / 尚未刷新”（SRC-003）；停用后事件立即从月视图消失但数据保留，删除会确认并级联删除该源事件；导入的本地 ICS 源仍是只读行，来源管理与设置入口由 SC-018 接线。

v0.1 已知限制：同一文件改名后再次导入会视为新来源（新增副本），本地来源的删除入口由 SC-018 提供；WebCal 抓取暂不读取系统代理（reqwest 默认 feature 关闭 `system-proxy`，以避免额外依赖），正文按 UTF-8 宽松解码；RRULE 的 BYSETPOS / BYWEEKNO 等高级部分按“降级为单次事件”处理，完整支持留给后续版本；语义色 token 为临时基线，完整语义色体系由 SC-013 定稿。

英超元数据 Provider（SC-014）位于 `apps/desktop/src/providers/football/`，把“识别这是什么”（Matcher）与“展示素材从哪来”（Metadata）分开（架构草案 §5 / SPORT-001）：

- 球队字典 `teams.ts`：20 支球队的稳定 ID（`arsenal` / `manchester-city`…）、中英文名、常见别名、3 字母代码、近似球队色与 `crestRef` 逻辑引用；有歧义的简称（裸 `city` / `united` 之类）刻意不收录——宁可不识别，也不误识别（P-03）；
- 联赛与赛季 `competitions.ts`：联赛 ID / 中文短标签（“英超”）/ 视觉基线色 / Logo 逻辑引用，以及赛季参赛名单（`SeasonRoster`）。名单是独立数据条目，新赛季只需追加一条，Matcher（SC-015）、Resolver 与 UI 都不用改；
- 目录装配 `football-catalog.ts`：装配期即校验坏数据——球队 id / 代码重复、别名跨队冲突或未规范化、赛季引用未知球队、颜色非法，都会在启动装配阶段直接抛错，而不是让 UI 在运行期渲染出半支球队。查询接口 `teamById` / `teamByAlias` / `competitionById` / `rosterOf` / `latestSeason` / `newestRosterContaining`（两队同属某季名单的查询，SC-015 用），以及识别词表 `teamAliasEntries` / `competitionAliasEntries`（别名 + 规范名，SC-015 的 Matcher 扫描标题用，与 `teamByAlias` 同源）；别名匹配复用 SC-008 的标题比较键（`titleKey`），所以 `MAN CITY`、`Ａｒｓｅｎａｌ`、`阿森纳` 都能命中；
- 队徽与联赛 Logo `crests.ts`：仓库不携带任何图片二进制（开发原则 §10 版权边界），元数据只保存逻辑引用；`resolveTeamCrest` / `resolveCompetitionLogo` 在资源包缺失、未收录该引用、甚至资源包自身抛错时都确定性降级为 fallback（球队 3 字母代码 / 联赛短标签 + 主题色），因此 Logo 缺失不会破坏 UI；
- Metadata Resolver `football-metadata-resolver.ts`：消费 `sport.fixture` 语义（`subtype` 为联赛 ID，`entities` 中 `type === "team"` 为参赛球队），产出联赛短标签与语义色、Logo 引用与双方展示载荷 `fixture`（中英文名、代码、队色、队徽引用；数组顺序即主客队顺序，由 SC-015 决定）。已注册进应用解析链并排在内置默认值之前，因此自带类型级默认值（语义色 + 赛前 30 分钟提醒），联赛自己的色值与短标签覆盖默认值——色值只有 `competitions.ts` 一处。联赛未登记、或可解析球队不足两支时返回 null，按普通增强事件显示（SEM-003）——“队标 VS 队标”少一侧不成立，个别球队缺元数据只跳过该队；
- 读取边界 `displayMetadataOf` 同步收窄嵌套的 `fixture` 载荷：磁盘 JSON 被改写时逐字段校验、畸形字段丢弃，两侧凑不齐时整块丢弃，UI 拿不到半张卡片；
- UI 不承载领域知识：`ui-boundary.test.ts` 把“UI 源码不出现任何球队名称 / 别名 / 稳定 ID，也不直接 import Provider 目录”变成可执行断言（扫描用排除法覆盖 `src/` 下所有 UI 目录），UI 只消费 Resolver 的输出。

SC-014 的数据边界：赛季名单是数据维护动作——当前登记的是 2025/26 已确认名单，`latestSeason()` 表示“已登记名单里最新的一季”，不等于“今天正在进行的一季”，2026/27 名单确认后追加条目即可；球队色是用于低透明度背景的近似值；队徽与联赛 Logo 资源不随仓库分发（版权），默认全部走 fallback，资源包接入与许可审查由 SC-022 处理。

英超比赛标题 Matcher（SC-015）位于 `apps/desktop/src/providers/football/football-matcher.ts`，把标题文本变成 `sport.fixture` 语义（SPORT-002 / SPORT-003）：

- 词表来自 SC-014 目录（`teamAliasEntries` / `competitionAliasEntries`：别名 + 规范名，装配期已校验唯一与规范化），Matcher 里不硬编码任何球队名；扫描是单趟非重叠、长写法优先（`Tottenham Hotspur vs Arsenal` 不会被 `tottenham` 抢先而数成三支球队），拉丁写法要求词边界（`Arsenals` / `xArsenal` 不算命中），中英混排（`Arsenal对曼城`）不受边界规则影响；标题 → 比较键的规则与词表同源（`normalize/title.ts` 的 `titleKey`）；
- 判定链：恰好两支可确定归属的球队 → 两队之间是已知对阵分隔符（`vs` / `vs.` / `v` / `v.` / `versus` / `-` / `–` / `—` / `@` / `对`）→ 标题除“两队 + 分隔符 + 联赛名 + 装饰”外没有别的单词 → 联赛可确定（标题写明已登记联赛，或两队同属某个已登记赛季名单，查询走目录的 `newestRosterContaining`）。任一步不成立就返回 null，事件按普通事件显示（SEM-003）；
- 不误伤（SPORT-002 验收）：第三条规定“两侧必须是球队名本身”。只靠“两个词表里的球队 + 分隔符”会把一次展览（`Kensington Palace - Chelsea Flower Show`）或一趟火车（`Brighton - Leeds train`）判成比赛——它们的两侧是包含球队名的短语。允许的装饰只有 `标签: ` 前缀（`Premier League: ` / `Matchday 12: ` / `英超：`）与联赛名本身；括号不构成豁免（括号里的词同样要能被解释），代价是标题带自由文本时会漏判（`… - Matchday 12`、`(Emirates Stadium)`）——刻意取舍，P-03。多于两支球队、同一支球队出现两次、比分、没有分隔符、对手不在字典里（`Arsenal vs Barcelona`）同样不增强；
- 主客队（SPORT-003）：`A @ B` 表示 A 客场作战（B 为主队），`A vs B` / `A - B` 按赛程列表惯例左侧为主队；顺序落在 `entities` 上（第 0 个主队），即 SC-014 Resolver 渲染 `fixture.teams` 的顺序；
- 可解释性：`reason` 写清依据（如「vs」左侧为主队；按 2025/26 名单推断联赛，引号里是标题里实际出现的分隔符），`confidence` 取两项证据里较弱的一项——联赛明示 1 / 名单推断 0.8，方向明示 `@` 1 / 赛程惯例 0.9，供 SC-019 做可解释状态；
- 接线：`semantic/app-registry.ts` 静态注册（priority 100，约定 0–99 留给按日期判定的语义），启动与每次导入后随 `reEnrichStore` 重跑；`semantic/app-registry.test.ts` 断言应用真正装配出来的那一套（Matcher 掉出注册表时不会静默退回普通事件），`ui-boundary.test.ts` 同时保证识别逻辑不进 UI。

SC-015 的边界：v0.1 只登记英超，因此“两队都在英超名单内”即认定为英超比赛——两支英超球队的杯赛（如足总杯）在 v0.1 也会标为英超；多联赛支持是 SPORT-001 的扩展点（登记新联赛与名单后判定链自动适用，标题写明联赛名时优先采信标题）。3 字母代码（`ARS` / `MCI`）刻意不进词表：`EVE` / `SUN` / `NEW` 这类代码在普通标题里会误命中（P-03）。

SC-015 之后仍未接线：比赛月格与 Matchday Inspector（SC-016）、关注球队与设置（SC-016 / SC-018）。
