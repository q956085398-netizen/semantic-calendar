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

- [x] 桌面应用基础框架（SC-001 / SC-002：窗口、托盘、单实例、关闭行为）
- [x] 现代化月视图（SC-004 / SC-013）
- [x] 基本日期导航（SC-005）
- [x] 解析本地 ICS 文件
- [x] 订阅 ICS / WebCal 地址
- [x] 日历数据本地保存（SC-003）
- [x] 农历显示（SC-010，1901–2099）
- [x] 中国法定节假日（SC-011：放假 / 补班数据、连休分组、年份数据版本；月格底色与大字见 SC-013）
- [x] 中国传统节日（SC-012：春节、元宵、龙抬头、清明、端午、七夕、中元、中秋、重阳、腊八、除夕）
- [x] 二十四节气（SC-012：1901–2100；月格标签、详情栏与背景引用接口，专属背景渲染见 SC-013）
- [x] 英超事件识别
- [x] 英超球队元数据
- [x] 球队徽标展示（fallback 口径，资源包由 SC-022 接入）
- [x] 主队识别（SC-015）与关注球队设置（SC-016）
- [x] 事件提醒（SC-017：系统通知权限、事件 alarm、比赛默认提醒、用户覆盖、去重与重启恢复）
- [x] 明暗主题（SC-004 / THEME-001–003）
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

前后端 IPC 由 `data_store_read` / `data_store_write` / `data_store_rename` 三个数据命令、`webcal_fetch` 一个网络命令与 `shell_set_close_behavior` 一个窗口行为命令承载（读取快照、原子写入、损坏隔离改名、订阅抓取、关闭语义下发）。

桌面壳与窗口生命周期（SC-002）位于 `apps/desktop/src-tauri/src/shell.rs` 与 `apps/desktop/src/shell/`：

- 关闭语义：设置项 `app.closeBehavior`（`hide-to-tray` 默认 / `quit`）由侧栏“关闭窗口时”分段控件写入快照，并在启动与切换时推给 Rust；Rust 在收到关闭请求时决定隐藏窗口还是放行退出。设置是权威来源，Rust 只保存运行时镜像，不自己读快照文件；
- 托盘：左键单击恢复主窗口，右键菜单提供“显示主窗口 / 退出”；托盘图标复用 bundle 里的应用图标，不额外引入图片资源；
- 降级：托盘创建失败（例如缺少图标）时，`hide-to-tray` 自动退化为退出——宁可退出，也不把窗口藏起来而没有恢复入口。设置命令会把「实际生效的行为 + 托盘是否可用」一起返回，侧栏据此显示真实行为而不是继续声称应用会常驻托盘；
- 单实例：`tauri-plugin-single-instance` 让第二次启动不再产生新进程，而是恢复已有窗口；
- 资源占用：Rust 侧没有任何定时器或轮询，隐藏窗口后不产生新的唤醒源；后台唤醒仍只有 WebCal 调度器的单次 `setTimeout`（app-spec §12）；
- 窗口尺寸：最小 820×560，小于左右栏的自动折叠阈值（1080 / 880），因此缩到最小尺寸时两侧面板都已收起、月历主体独占整宽，折叠栏以悬浮按钮提供临时展开（ui-design §23）。这条跨文件的尺寸契约由 `src/layout/window-size-contract.test.ts` 守住；
- 边界：只拦截关闭请求。最小化按钮保持系统默认（最小化到任务栏），因此 UI 文案写“隐藏到托盘”而不是“最小化到托盘”；窗口恢复路径（显示 → 取消最小化 → 聚焦）由托盘左键、托盘菜单与第二实例启动共用；
- 已知竞态：关闭语义由前端在数据层加载完成后推送，启动瞬间（约 1 秒内）关闭窗口会按默认的隐藏到托盘处理，而不是用户设置的退出。这是“设置只有一个权威来源（快照）”的代价，推送完成后即自愈；
- 设置入口仍会随设置页（SC-018）整理，当前先放在侧栏底部与主题切换相邻。

人工验收记录（Windows，2026-09-24，`cargo build` 产物 + 真实前端）：默认设置下发送窗口关闭请求后进程存活、窗口不可见（隐藏到托盘）；快照写入 `app.closeBehavior: "quit"` 后同样操作进程退出；隐藏状态 30 秒内进程 CPU 时间增量 0s（可见空闲状态同样为 0s）；窗口隐藏时启动第二实例，第二实例立即退出、进程数保持 1、原窗口恢复可见（走与托盘相同的恢复函数）。托盘图标点击本身需人工交互，不在自动化覆盖范围内。

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
- 月格语义视觉（SC-013）：主背景由 `calendar/cell-backdrop.ts` 裁决，一个格子只有一个——节日 / 节气专属视觉（`display/DayBackdrop.tsx`：图片整格铺满、被格子裁切、文字区带遮罩，深色主题再压暗）＞ 联赛视觉 ＞ 假期 / 补班（语义色混进主题底板的底色 + 半透明、被格子裁切的「休」「补」大字）＞ 普通背景。假期视觉是候选之一而不是叠加层，被节日或比赛拿走主背景的日子整体让位（ui-design 参考图 10 月 4 日 / 10 月 6 日）；比赛对阵块与事件摘要照常叠加，右上角小徽标按 §7.3 不再出现。裁切、层级与两套主题的取值由 `calendar/cell-visual-contract.test.ts` 对 `index.css` 断言（jsdom 看不到布局）；
- 侧栏数据源：SC-006 起显示已导入的本地 ICS 来源；节假日（SC-011）与英超（SC-014–016）数据已接入，节气（SC-012）待接入；内置行仍是静态占位，显示开关由 SC-018 接线。

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
- 队徽与联赛 Logo 解析 `semantic/marks.ts`（SC-016 从 Provider 移到核心）：仓库不携带任何图片二进制（开发原则 §10 版权边界），元数据只保存逻辑引用；`resolveTeamMark` / `resolveCompetitionMark` 在资源包缺失、未收录该引用、甚至资源包自身抛错时都确定性降级为 fallback（球队 3 字母代码 / 联赛短标签 + 主题色），因此 Logo 缺失不会破坏 UI。放在核心是因为解析规则针对的是核心展示契约（`FixtureDisplay`），且 UI 不能 import Provider 目录（`ui-boundary.test.ts`）——月格与 Inspector 都要渲染标记，核心是唯一同时满足这两条的位置；
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

关注球队、比赛月格与 Matchday Inspector（SC-016）把语义结果接进 UI（SPORT-004 / SPORT-005 / SPORT-006）：

- 关注球队规则 `providers/football/followed-teams.ts`：关注状态是“稳定球队 id 列表”，不保存任何展示字段——球队改名 / 换色 / 换队徽不需要迁移；读取边界 `readFollowedTeamIds` 只接受目录认识的 id，坏值（非数组、数字、未登记球队、带空白的写法）一律丢弃，不猜成某支球队（P-03）；列表统一规范化到最新赛季名单顺序，因此同一组关注只对应一种快照写法；
- 关注球队接线 `semantic/app-followed-teams.ts`：Provider 与 UI 之间唯一的门（UI 不 import Provider 目录），把规则绑定到应用目录后以展示载荷暴露；设置键 `football.followedTeams` 由 `App` 写入本地数据层，重启后由启动读取恢复（浏览器预览模式与主题切换一致：可切换、不持久化）；
- 侧栏 `layout/FollowedTeamsPicker.tsx`：可折叠的关注球队列表（20 支球队，来自元数据层，UI 不做球队名匹配），摘要显示关注数量，勾选即落盘；
- 比赛月格 `calendar/MatchCell.tsx`（SPORT-004 / ui-design §10）：格内只显示“队标 VS 队标”，队名、开赛时间、球场、天气、提醒都不进格子（§10.2，队名与开赛时间只出现在 `title` / `aria-label` 这类辅助信息里，§18.1）；联赛背景是日期格的直接子元素，由格子的 `overflow: hidden` 裁切（§10.1 不溢出到相邻格），一天多场比赛时每格只画一次；单格最多两场，其余折叠为计数；有比赛时普通摘要从 3 条减到 2 条——格子是裁切的，溢出等于丢信息；比赛事件不再重复出现在普通摘要里，同日普通事件照常显示（多语义不互相吞掉）；
- 队徽渲染 `display/Mark.tsx` + `semantic/marks.ts`：固定容器 + `object-fit` + 按需加载（§22 布局决定 Logo 如何显示），资源缺失降级为球队代码 / 联赛短标签 + 主题色，容器色来自球队 / 联赛色而文字取主题前景色（深浅主题都可读）；地址能解析但图片加载失败时，`display/mark-asset.ts` 的 `onError` 会换成同一个 fallback——解析层看不到加载结果，因此 fallback 随解析结果一起交给渲染层，界面不会出现破图；联赛背景 / 水印由 `display/CompetitionBackdrop.tsx` 统一渲染，月格与详情栏共用同一份降级口径；
- Matchday Inspector `layout/MatchdayInspector.tsx`（SPORT-005 / ui-design §13–15）：一级信息是日期、对阵双方与队徽，二级是联赛与开赛时间，三级是场地与提醒；缺字段就不渲染该行——**天气在 v0.1 没有可靠来源，因此这一行从不出现**（§13 不伪造数据）；场地取自来源事件的 `LOCATION`，用“场地”而不是“主场”表述（`LOCATION` 是事件地点，未必等于主队球场）；提醒文案由 Resolver 的提醒策略翻译（`format/reminder.ts`，SC-017 复用同一策略），标题写成“建议提醒”——NOTIFY-003 说的是“比赛可建议赛前 30 分钟”，它是策略建议而不是事件数据；当日其余事件作为状态语义留在下方，普通日期结构与留白不变（§12）；
- 浅色主题的赛事详情栏用降低饱和度的蓝灰渐变 + 左缘柔和过渡（§14 “它是主界面的一部分”），深色主题用深蓝渐变与联赛字形水印（§15.4），信息架构与浅色完全一致；主题差异全部由 `--bg-matchday-*` 变量承担；
- 关注状态的可见效果：比赛详情里对应球队带“关注”标记。月格不因关注改变（§10.2 只显示队标 VS 队标），赛前提醒由 SC-017 消费同一份关注状态；设置页入口（含关注球队）由 SC-018 接线。

SC-016 的边界：赛季名单更新时，已经不在名单内的球队会同时从可关注集合与关注列表消失——这是名单登记的显式后果（只在登记新赛季时发生），而不是运行期静默丢数据；球队徽标 / 联赛 Logo 二进制仍不随仓库分发，默认全部走 fallback，资源包接入由 SC-022 处理；比赛日详情中的天气字段等可靠来源接入后再显示。

仍未接线：设置页（SC-018）——内置数据源的显示开关、本地来源删除入口与通知 / 关注球队等设置会集中到那里。

农历（SC-010）位于 `apps/desktop/src/providers/china/`，为月格与详情栏提供农历日期（CN-001）：

- 换算 `providers/china/lunar.ts`：公历 → 农历年月日（含闰月），运行期只查表推进，不做天文计算；天数差一律用 UTC 计算——农历是东八区民用历，用本地时间构造 `Date` 会在夏令时地区把格子算偏一天；
- 年数据 `providers/china/lunar-data.ts`：农历 1901–2099 年的大小月与闰月，每年一条 17 位编码（bit16 闰月天数、bit15–bit4 正月…十二月大小月、bit3–bit0 闰月号）。数据由 `tools/derive-lunar-table.mjs` 从香港天文台「公曆與農曆日期對照表」官方年表逐日推导（1932 年中文表在服务端被截断，改用同站英文表补齐该年月份边界；年表文本与第三方实现都不随仓库分发，重跑需要自行下载年表）；
- 数据校验（开发期一次性，脚本未入库）：推导结果对全部 73,049 天与官方年表逐日回环一致；另与表驱动实现 `lunardate` 和天文计算实现 `lunar-javascript` 交叉比对，分歧只有四处，都以官方数据为准——1933 / 1954 / 1978 年（旧版农历表在这三年偏差一天）与 2057 年九月月首（天文实现偏差一天）。这四处连同春节、闰月月首、范围两端共 29 个日期固定为测试样例，官方数据一旦被改动测试会立刻报错；
- 文本 `providers/china/lunar-labels.ts`：日名（初一…三十）与月名（正月…十二月、闰X月）；月格在初一写月名——这一天就是农历月份边界，写「八月」比写「初一」多给一个信息，闰月也不会退化成普通月份；其余日期写日名，一格一行；
- 接线 `semantic/app-lunar.ts`：与 app-followed-teams.ts 同一个角色——UI 不 import Provider 目录（ui-boundary.test.ts），农历在这里绑成「日期键 → { 月格文本, 详情文本 }」交给月视图与详情栏；输入只取日期键（月格的稳定标识），不重复传年月日，避免同一格出现两套互相矛盾的日期表达；范围外（1901-02-19 之前、2100-02-08 之后）的日期不进载荷，月格少一行农历，而不是显示不可靠的换算；
- UI：月格在日期数字下加一行农历（ui-design §5.2），用 `--text-secondary` 而不是更淡的 `--text-muted`（§24 对比度，层级靠 15px/600 的数字与 11px 的农历表达），跨月格同样显示、随跨月样式弱化；详情栏按 §12 的次序排在公历日期与年份之后（「9月24日 / 2026 / 农历八月十四」）。两处都只渲染注入的文本，组件里没有任何农历判断。

SC-010 的边界：数据只覆盖农历 1901–2099 年，超出范围安静地不显示，不向更早或更晚推算；节气与传统节日由 SC-012 提供，干支 / 生肖不在 v0.1 范围内；侧栏小月历只承担导航，不显示农历。

法定节假日（SC-011）与农历同目录，位于 `apps/desktop/src/providers/china/`，提供放假 / 补班语义（CN-002–004、CN-007）：

- 数据 `providers/china/holidays-data.ts`：逐年登记国务院办公厅通知里的放假区间、补班日与文号（2024 国办发明电〔2023〕7 号、2025 〔2024〕12 号、2026 〔2025〕7 号，来源地址随数据一起保存）。这是手工维护的事实，不是推导结果——放假安排没有公式，只有发文；`year` 是通知年份而不是日期的公历年，元旦与上一年 12 月的周末连休时跨公历年（2024 年安排含 2023-12-30/31）；
- 查询与连休分组 `providers/china/holidays.ts`：`chinaHolidayOfKey(dateKey)` 给出 `{ kind: "rest" | "makeup", names, run?, version }`。休假与补班是两种语义（CN-003），因此用判别联合而不是布尔标志表达：只有休假带连休区段 `run`（`id` 取区段首日，`index` 从 0 起），相邻日期格拿到同一个 id 就知道它们属于同一次假期，可以直接画成连续背景（ui-design §7.1），UI 不需要自己扫相邻格；
- 装配期校验（沿用“坏数据要么拒绝、要么确定降级”）：日期区间反向、同一天既放假又补班、条目之间日期重叠、连休被拆到两条安排里、日期不在安排年份范围内（只允许上一年 12 月，用于元旦跨年）、缺名重名、来源不是 https、发布日期不在上一年到当年，都在装配阶段直接抛错——宁可启动即失败，也不要在月历上画出一天休一天补；
- 文本 `providers/china/holiday-labels.ts`：大字「休 / 补」（§7.2 / §8.2）、假期名连接（「国庆节、中秋节」）、连休位置（「第 3 天 / 共 7 天」；单日假期与补班日不写位置）；
- 接线 `semantic/app-china-days.ts`：与 app-lunar.ts 同一个角色——UI 不 import Provider 目录（ui-boundary.test.ts），这里绑成「日期键 → { 类别, 大字, 语义色, 主文案, 连休位置, 区段 }」交给 UI，未登记安排的日期不进载荷；语义色取自 `metadata-resolver.ts` 的类型级默认值（`semanticTypeDefaults`）——日级语义不走事件解析链，但色值仍然只有一处，日级展示不会长出第二套色板；
- UI：月格挂上 `data-china-day`（休 / 补）与 `data-china-run`（连休区段 id）——相邻格共享同一个区段 id，连休在 DOM 里就是连续区段（CN-004 的可识别口径），连续背景与被格子裁切的大字由 SC-013 消费同一份载荷实现；详情栏在农历行之后补一行语义（§11.1 状态类型「节假日」）——大字 + 「国庆节假期」+「第 3 天 / 共 7 天」，补班日写「国庆节补班日」，语义色用载荷注入的 CSS 变量（UI 不接触具体色值），文字本身可读（§24）；
- 日级语义不进事件 Matcher Engine：节假日不是某条事件的属性，而是日期本身的属性（同一天可以有任意多事件，也可以一个都没有），而引擎的输入是事件，装不下「这一天是假期」。因此它与农历一样以日期键为入口，`semantic/app-registry.ts` 记录了同一条边界。

SC-011 的边界：月格的休假视觉（连续背景、被格子裁切的「休」「补」大字、多语义冲突规则）由 SC-013 实现，本 Ticket 只交付数据、连休分组、格子挂钩与文字层；数据覆盖 2024–2026，2027 年安排（通常于 2026 年 11 月发布）尚未发文，因此未登记，未登记年份安静地不显示休 / 补，不推算（P-03）；2024 年除夕当年只是「鼓励」休假、不是法定假日，因此 2024-02-09 不在数据里（2025 年起除夕为法定假日）；`revision` 用于标记数据修正（只改数据不改年份时递增），已登记的通知文号 / 发布日期 / 来源地址由 `versions` 暴露，供追溯（CN-007）。

本地通知与提醒调度（SC-017）位于 `apps/desktop/src/notifications/` 与 `apps/desktop/src-tauri/src/notify.rs`，把“什么时候该弹”与“怎么弹”分开（NOTIFY-001–004、app-spec §12）：

- 系统能力留在 Rust 侧 `src-tauri/src/notify.rs`：插件 `tauri-plugin-notification` 只被用来回答“权限状态 / 请求权限 / 发送一条通知”三个命令（`notification_status` / `notification_request_permission` / `notification_send`），webview 不直接接触通知 API——与 WebCal 抓取、快照读写同一条边界。桌面端没有运行时授权对话框，权限恒为已允许，是否真正弹出由系统通知设置决定，因此发送失败同样作为结构化原因回传（`kind = "send-failed"`），界面据此解释而不是假装送达；
- 端口 `notifications/notification-bridge.ts`：Tauri 实现 + 没有桌面壳时的 unsupported 实现（浏览器预览下发送不假装成功）；权限取值在读取边界收窄（未知按“需要询问”，不猜成已授权），失败原因映射成用户可读文案（§13）；
- 提醒计划 `notifications/reminder-plan.ts` 是纯函数（不读时钟、不发送、不落盘），一条提醒的来源按 **用户设置 ＞ 事件自带 VALARM ＞ Resolver 默认建议** 取（NOTIFY-002 / NOTIFY-003）：
  - 触发时刻：提前 N 分钟 = 开始 − N；「当天上午 / 前一天晚上」= 事件开始日当天 09:00 / 前一天 20:00（v0.1 固定锚点，见边界）；
  - 时间解释与月格同口径：全天事件按观察者本地日（开始 00:00、结束次日 00:00、DTEND 排他）、`Z` 结尾按绝对瞬时、浮动 / TZID 墙钟按本地时间；无法解释的时间不猜，直接没有提醒（P-03）；
  - 按固定时刻锚定的策略在事件已经结束后不再提醒（早上 9 点的提醒不为 07:00 的会议弹出）；相对事件的提醒（提前 N 分钟、事件自带 alarm）按来源给出的时间执行，不做这层裁剪；
  - 计划窗口 30 天；晚于容忍窗口（2 小时）的提醒记为已错过、不补发——应用整天没开之后再弹一串旧提醒不是用户想要的；
- 去重 `notifications/fired-reminders.ts`：提醒的稳定键 = 事件持久化身份 + 提醒依据 + 触发时刻（NOTIFY-004）。订阅刷新与重启都会重建出完全相同的键，因此不会重复弹；事件改期后触发时刻变化，是一条新提醒——这正是需要的语义。日志存在快照 settings（`notifications.firedReminders`，即 app-spec §11 的「通知调度状态」），保留 30 天、最多 500 条，读取时逐条收窄，坏值丢弃；
- 调度 `notifications/notification-scheduler.ts` 与 WebCal 刷新同一形状：任何时刻只维护一个 `setTimeout`（§12 的「下一条通知调度」，没有轮询）。定时器指向两者中更早的一个——下一条提醒，或下一个本地零点：跨天那次不只是唤醒，还会**重算计划**，因为计划窗口是「当前日期起 30 天」，常驻数天的会话不能一直用启动那天的窗口（窗口每次计算都读实时时钟，见 `buildReminderPlan`）。触发时先把错过的标记掉、再发到期的；发送失败同样记为已处理（同一提醒不反复弹，失败原因交给界面解释），会话内另有一层内存去重，落盘失败也不会在同一会话里重复弹；
- ICS VALARM（NOTIFY-002）：`ics/parse-ics.ts` 现在解释事件自带的提醒，`RawCalendarEvent.alarms` 记录相对偏移、方向与基准（`TRIGGER:-PT30M` → 提前 30 分钟；`TRIGGER;RELATED=END:-PT15M` → 结束前 15 分钟；`TRIGGER:+PT5M` → 开始后 5 分钟）。只接收相对时间的 TRIGGER 与 `ACTION:DISPLAY`（或未声明 ACTION）：绝对时间 TRIGGER 与 EMAIL / AUDIO 动作不产生本地提醒——宁可不提醒，也不按错误的时间弹窗；
- 设置：`notifications.enabled`（默认开启）与 `notifications.matchReminderMinutes`（未设置 = 跟随 Resolver 建议；数字 = 用户提前量；`null` = 不提醒）。侧栏“跟随默认建议（赛前 30 分钟）”里的数字来自 Metadata Resolver 的类型级默认值，界面里刻意没有再抄一份默认值；
- UI（`layout/Sidebar.tsx` / `layout/MatchdayInspector.tsx`）：侧栏「通知」组给出开关、比赛提醒提前量与一句状态（权限 / 下一条提醒 / 最近一次失败），权限待确认或被拒绝时提供「请求系统授权」入口；权限只在开启通知或用户显式点击时请求一次，不在后台反复询问。比赛详情栏的提醒行与调度同口径——默认建议写「建议提醒：赛前 30 分钟」（与 SC-016 相同），用户设置或事件自带写「提醒：…（用户设置 / 事件自带）」，关掉时写「已关闭（用户设置）」，因此界面上的说法不会和真正会发生的事矛盾。

SC-017 的边界：调度器活在 webview 里，窗口隐藏时 Chromium 会节流后台定时器，提醒可能晚到不到一分钟（到期后 2 小时内仍会补发，见容忍窗口）；应用退出后仍能提醒的常驻调度不在 v0.1；「当天上午 / 前一天晚上」两个锚点固定为 09:00 / 20:00，不做用户可配置；普通事件只按事件自带的 VALARM 提醒（NOTIFY-002 的「事件自身 alarm」），v0.1 没有“所有事件统一提前 N 分钟”的全局设置——那会给没写 alarm 的日历凭空造出提醒；日级语义（法定节假日 / 传统节日 / 节气）不带提醒——它们不是事件，v0.1 只在月格与详情栏呈现；桌面端通知权限恒为已允许，被系统通知设置拦下的情形以发送失败的形式解释（`permission-denied` 那条分支服务于移动端与曾拒绝过的平台）；通知正文只写事件标题与开始时间 + 提醒依据，不含描述、地点与订阅地址（§14）；完整设置页仍由 SC-018 接线，届时这组设置会搬过去。
