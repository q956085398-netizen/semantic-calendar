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
- [x] 球队徽标展示（fallback 口径：仓库不分发徽标二进制，见 [third-party-assets.md](docs/third-party-assets.md) §3）
- [x] 主队识别（SC-015）与关注球队设置（SC-016）
- [x] 事件提醒（SC-017：系统通知权限、事件 alarm、比赛默认提醒、用户覆盖、去重与重启恢复）
- [x] 设置页（SC-018：外观、区域预留、内置来源显示开关、来源管理与删除、WebCal 刷新间隔、关注球队、通知、窗口行为、关于）
- [x] 明暗主题（SC-004 / THEME-001–003）
- [x] 基础性能测试（SC-020，基线与缓存策略见 [performance.md](docs/performance.md)）
- [x] 导入链路的分片（SC-024：解析 / 标准化 / 落库 / 读取 / 落盘拆成短任务，10,000 条导入的最长任务 10.4 ms）
- [x] Windows 安装包与发布检查（SC-022：NSIS 安装包、正式图标、MIT License、资产与许可清单、发布门槛逐项核对）
- [x] 测试与人工验收（SC-021 / SC-023，见 [ui-acceptance.md](docs/ui-acceptance.md)）

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
- [性能基线与缓存策略](docs/performance.md)：v0.1 首个性能基线（可重复的测量方法与实测数字）、缓存失效清单、后台唤醒约束（SC-020），以及导入链路分片的实测与代价（SC-024）。
- [UI 验收记录](docs/ui-acceptance.md)：ui-design.md §26 的逐项验收清单、自动证据与人工验收记录（SC-021）。
- [发布门槛与安装包验收](docs/release.md)：app-spec §20 的逐项核对、Windows 安装 / 启动 / 卸载记录、升级策略（SC-022）。
- [第三方组件、数据与资产清单](docs/third-party-assets.md)：依赖许可、数据来源、球队徽标与图片的使用策略（SC-022）。
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

本项目以 [MIT License](LICENSE) 分发：`bundle.license` 是 SPDX 标识（`MIT`），安装包里的 License 页取自 `bundle.licenseFile` 指向的同一份 `LICENSE` 文件。

第三方组件、数据与商标不在 MIT 的覆盖范围内：依赖许可、数据来源、球队徽标与联赛 Logo 的使用策略
逐项记在 [docs/third-party-assets.md](docs/third-party-assets.md)。

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
npm run bench     # 性能基线（vitest bench，见 docs/performance.md）
npm run lint      # ESLint
npm run format    # Prettier 格式检查
npm run tauri -- build
```

改动一条链路时不必每次跑全量：在 `apps/desktop` 下用 `npx vitest run <文件>` 只跑相关文件
（例如 `npx vitest run src/ics/parse-ics.test.ts`），改动完成后在仓库根目录跑一次
`npm run test` 与 `npm run lint`。当前全量是 78 个文件、886 个用例，本机约 35–50 秒
（波动主要在 `App.test.tsx` 一组：它是界面接线的集成层，单文件先跑它最省时间）。

测试与人工验收的分工写在 [docs/ui-acceptance.md](docs/ui-acceptance.md)：哪些 §26 验收项
由测试判定、哪些必须在真实渲染里看，以及可复现的验收步骤。`src-tauri/gen/`（Tauri 生成的
ACL / schema）与 `dist/`、`src-tauri/target/` 一样被 Prettier 跳过，因此 `npm run format`
的结论就是源码的结论。

构建与发布（SC-022）：

- 安装包：`npm run tauri build` 产出 `apps/desktop/src-tauri/target/release/bundle/nsis/Semantic Calendar_0.1.0_x64-setup.exe`（当前用户安装，不需要管理员）。安装 / 启动 / 卸载的实机验收记录与发布门槛逐项核对在 [docs/release.md](docs/release.md)；
- 只产出 NSIS：`bundle.targets = ["nsis"]`。v0.1 只分发一个经过验收的安装包，需要 MSI 的企业场景再单独开单；
- 升级：同 `identifier` 的安装包再次运行即就地覆盖，`allowDowngrades = false` 挡住降级；`createUpdaterArtifacts = false`，v0.1 不做自动更新（接入自动更新需要什么，见 release.md §5）；
- 名称：界面用中文名「语义日历」（窗口标题、侧栏品牌、托盘提示），系统集成用英文名「Semantic Calendar」（安装包、安装目录、开始菜单与桌面快捷方式、卸载项），可执行文件保持 ASCII 的 `semantic-calendar.exe`；
- 版本：只有一个来源 `apps/desktop/package.json`，构建时注入界面（设置页「关于」显示它），Cargo.toml 与 tauri.conf.json 的版本由 `src/packaging.test.ts` 要求一致；
- 图标：`apps/desktop/src-tauri/app-icon.svg`（设计稿）与 `app-icon.png` 由 `apps/desktop/tools/render-app-icon.mjs` 生成，`npm run icon` 从图标源派生 `icons/` 下的各平台尺寸与 `.ico` / `.icns`；Tauri CLI 顺带产出的 `android/` 与 `ios/` 由 `tools/prune-mobile-icons.mjs` 清掉（本仓库只做桌面端），因此重跑不会在仓库里留下未登记的图片。重跑是稳定的：PNG 与 `.ico` 逐字节相同（脚本确定性生成），`icon.icns` 由 Tauri CLI 生成、两次的字节可能不同（Windows 打包不使用它，换图标时一起提交即可）。图标是脚本产物而不是外来素材，因此仓库里的图片资产只剩自有产物——`packaging.test.ts` 守住这条；
- 资产与许可：[docs/third-party-assets.md](docs/third-party-assets.md) 记录依赖许可、数据来源与球队徽标 / 联赛 Logo 的使用策略（v0.1 的决定是不随应用分发任何徽标二进制，界面走 fallback）。

前后端 IPC 由 `data_store_read` / `data_store_write` / `data_store_rename` 三个数据命令、`webcal_fetch` 一个网络命令与 `shell_set_close_behavior` 一个窗口行为命令承载（读取快照、原子写入、损坏隔离改名、订阅抓取、关闭语义下发）。

桌面壳与窗口生命周期（SC-002）位于 `apps/desktop/src-tauri/src/shell.rs` 与 `apps/desktop/src/shell/`：

- 关闭语义：设置项 `app.closeBehavior`（`hide-to-tray` 默认 / `quit`）由设置页「关闭窗口时」分段控件写入快照，并在启动与切换时推给 Rust；Rust 在收到关闭请求时决定隐藏窗口还是放行退出。设置是权威来源，Rust 只保存运行时镜像，不自己读快照文件；
- 托盘：左键单击恢复主窗口，右键菜单提供“显示主窗口 / 退出”；托盘图标复用 bundle 里的应用图标，不额外引入图片资源；
- 降级：托盘创建失败（例如缺少图标）时，`hide-to-tray` 自动退化为退出——宁可退出，也不把窗口藏起来而没有恢复入口。设置命令会把「实际生效的行为 + 托盘是否可用」一起返回，设置页「关闭窗口时」据此显示真实行为而不是继续声称应用会常驻托盘；
- 单实例：`tauri-plugin-single-instance` 让第二次启动不再产生新进程，而是恢复已有窗口；
- 资源占用：Rust 侧没有任何定时器或轮询，隐藏窗口后不产生新的唤醒源；后台唤醒仍只有 WebCal 调度器的单次 `setTimeout`（app-spec §12）；
- 窗口尺寸：最小 820×560，小于左右栏的自动折叠阈值（1080 / 880），因此缩到最小尺寸时两侧面板都已收起、月历主体独占整宽，折叠栏以悬浮按钮提供临时展开（ui-design §23）。这条跨文件的尺寸契约由 `src/layout/window-size-contract.test.ts` 守住；
- 边界：只拦截关闭请求。最小化按钮保持系统默认（最小化到任务栏），因此 UI 文案写“隐藏到托盘”而不是“最小化到托盘”；窗口恢复路径（显示 → 取消最小化 → 聚焦）由托盘左键、托盘菜单与第二实例启动共用；
- 已知竞态：关闭语义由前端在数据层加载完成后推送，启动瞬间（约 1 秒内）关闭窗口会按默认的隐藏到托盘处理，而不是用户设置的退出。这是“设置只有一个权威来源（快照）”的代价，推送完成后即自愈；
- 设置入口：SC-018 起侧栏底部是「设置」按钮（打开状态不持久化），关闭行为的控件在设置页的「关闭窗口时」一节。

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
- 侧栏数据源：SC-006 起显示已导入的本地 ICS 来源，SC-007 起显示 WebCal 订阅；每行的勾选框就是该来源的显示开关（SC-018 / ui-design §4 第 2 项），行内仍写明“刷新中 / 已停用 / 刷新失败 / 上次成功 / 尚未刷新”的事实（SRC-003）；内置四行（我的日历 / 中国节假日 / 二十四节气 / 英超赛程）是内置来源开关，与设置页同一份设置；删除来源等需要确认的管理动作在设置页。

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
- 刷新服务 `webcal/webcal-refresh.ts`：条件 GET（`If-None-Match` / `If-Modified-Since`）→ 304 复用缓存 / 200 解析 → 标准化 → 按（sourceId, UID, RECURRENCE-ID）求差集替换（只有批次里消失的事件才删除，仍在的保持同一个持久化身份、不产生副本）→ 更新来源状态与校验值；重新入库的事件按“内容可能已变”处理，旧增强结果失效并由刷新后的重建恢复（SC-021 的链路测试覆盖）→ 服务端不再返回校验值时清掉旧值，避免用过期 ETag 永远拿不到新内容；同一来源的并发刷新合并为一次请求；
- 失败降级（§13）：网络 / 超时 / HTTP 错误 / 内容无法解析 / 空内容都只标记 `lastSyncStatus: "error"` 与脱敏后的 `lastSyncError`，**不删除已有事件**，`lastSyncAt` 保留上次成功时间；事件级解析错误按 ICS-005 隔离计数；空日历（合法但没有 VEVENT）在已有缓存时同样按失败处理并保留缓存——服务端维护页、中间代理的空壳与真正清空的订阅无法区分，而清空事件的代价高于保留一份可能过期的缓存（P-01 可靠性优先）；来源本就没有事件时，空日历按正常刷新处理；
- 抓取期间来源被删除时丢弃结果（不留无主事件记录）；
- 低频后台刷新 `webcal/refresh-scheduler.ts`：常规间隔是设置项（`webcal.refreshIntervalMinutes`，默认 6 小时，SC-018），失败后固定 30 分钟重试；只维护**一个** `setTimeout` 指向最近到期时刻（不用 `setInterval`，无到期订阅时不持有定时器，空闲零唤醒，§12），触发后串行刷新到期来源并重算下一次；应用启动、手动刷新、到达刷新时间三类触发之外没有轮询；间隔以供应商（`intervalMs`）注入，设置改动只要 `reschedule()` 就立即生效，不需要重建调度器；
- 落盘串行化 `CalendarStore.save()`：低频刷新与手动操作可能同时写同一个临时文件，写入进入队列，快照在队列内序列化（最后一次写入反映最新状态）；
- UI（`layout/Sidebar.tsx` / `layout/SettingsView.tsx`）：侧栏是订阅入口（地址输入 + 添加）与来源列表——每行勾选框即显示开关、行内「刷新」、状态显示“刷新中… / 上次成功 … / 刷新失败：… / 已停用 / 尚未刷新”（SRC-003）；设置页列出同一批来源（最近刷新状态 + 删除），删除前确认并级联删除该来源的事件。停用（取消勾选）后事件立即从月视图消失但数据保留。

v0.1 已知限制：同一文件改名后再次导入会视为新来源（新增副本），删除入口在设置页的数据源一节（SC-018）；WebCal 抓取暂不读取系统代理（reqwest 默认 feature 关闭 `system-proxy`，以避免额外依赖），正文按 UTF-8 宽松解码；RRULE 的 BYSETPOS / BYWEEKNO 等高级部分按“降级为单次事件”处理，完整支持留给后续版本；语义色 token 为临时基线，完整语义色体系由 SC-013 定稿。

英超元数据 Provider（SC-014）位于 `apps/desktop/src/providers/football/`，把“识别这是什么”（Matcher）与“展示素材从哪来”（Metadata）分开（架构草案 §5 / SPORT-001）：

- 球队字典 `teams.ts`：20 支球队的稳定 ID（`arsenal` / `manchester-city`…）、中英文名、常见别名、3 字母代码、近似球队色与 `crestRef` 逻辑引用；有歧义的简称（裸 `city` / `united` 之类）刻意不收录——宁可不识别，也不误识别（P-03）；
- 联赛与赛季 `competitions.ts`：联赛 ID / 中文短标签（“英超”）/ 视觉基线色 / Logo 逻辑引用，以及赛季参赛名单（`SeasonRoster`）。名单是独立数据条目，新赛季只需追加一条，Matcher（SC-015）、Resolver 与 UI 都不用改；
- 目录装配 `football-catalog.ts`：装配期即校验坏数据——球队 id / 代码重复、别名跨队冲突或未规范化、赛季引用未知球队、颜色非法，都会在启动装配阶段直接抛错，而不是让 UI 在运行期渲染出半支球队。查询接口 `teamById` / `teamByAlias` / `competitionById` / `rosterOf` / `latestSeason` / `newestRosterContaining`（两队同属某季名单的查询，SC-015 用），以及识别词表 `teamAliasEntries` / `competitionAliasEntries`（别名 + 规范名，SC-015 的 Matcher 扫描标题用，与 `teamByAlias` 同源）；别名匹配复用 SC-008 的标题比较键（`titleKey`），所以 `MAN CITY`、`Ａｒｓｅｎａｌ`、`阿森纳` 都能命中；
- 队徽与联赛 Logo 解析 `semantic/marks.ts`（SC-016 从 Provider 移到核心）：仓库不携带任何图片二进制（开发原则 §10 版权边界），元数据只保存逻辑引用；`resolveTeamMark` / `resolveCompetitionMark` 在资源包缺失、未收录该引用、甚至资源包自身抛错时都确定性降级为 fallback（球队 3 字母代码 / 联赛短标签 + 主题色），因此 Logo 缺失不会破坏 UI。放在核心是因为解析规则针对的是核心展示契约（`FixtureDisplay`），且 UI 不能 import Provider 目录（`ui-boundary.test.ts`）——月格与 Inspector 都要渲染标记，核心是唯一同时满足这两条的位置；
- Metadata Resolver `football-metadata-resolver.ts`：消费 `sport.fixture` 语义（`subtype` 为联赛 ID，`entities` 中 `type === "team"` 为参赛球队），产出联赛短标签与语义色、Logo 引用与双方展示载荷 `fixture`（中英文名、代码、队色、队徽引用；数组顺序即主客队顺序，由 SC-015 决定）。已注册进应用解析链并排在内置默认值之前，因此自带类型级默认值（语义色 + 赛前 30 分钟提醒），联赛自己的色值与短标签覆盖默认值——色值只有 `competitions.ts` 一处。联赛未登记、或可解析球队不足两支时返回 null，按普通增强事件显示（SEM-003）——“队标 VS 队标”少一侧不成立，个别球队缺元数据只跳过该队；
- 读取边界 `displayMetadataOf` 同步收窄嵌套的 `fixture` 载荷：磁盘 JSON 被改写时逐字段校验、畸形字段丢弃，两侧凑不齐时整块丢弃，UI 拿不到半张卡片；
- UI 不承载领域知识：`ui-boundary.test.ts` 把“UI 源码不出现任何球队名称 / 别名 / 稳定 ID，也不直接 import Provider 目录”变成可执行断言（扫描用排除法覆盖 `src/` 下所有 UI 目录），UI 只消费 Resolver 的输出。

SC-014 的数据边界：赛季名单是数据维护动作——当前登记的是 2025/26 已确认名单，`latestSeason()` 表示“已登记名单里最新的一季”，不等于“今天正在进行的一季”，2026/27 名单确认后追加条目即可；球队色是用于低透明度背景的近似值；队徽与联赛 Logo 资源不随仓库分发（版权），默认全部走 fallback；这是 SC-022 定下的 v0.1 口径——策略与将来接入资源包时必须满足的条件见 [docs/third-party-assets.md](docs/third-party-assets.md) §3。

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
- 关注状态的可见效果：比赛详情里对应球队带“关注”标记。月格不因关注改变（§10.2 只显示队标 VS 队标），赛前提醒由 SC-017 消费同一份关注状态；关注球队的入口在侧栏（ui-design §4 第 3 项）与设置页两处，同一个组件、同一份状态。

SC-016 的边界：赛季名单更新时，已经不在名单内的球队会同时从可关注集合与关注列表消失——这是名单登记的显式后果（只在登记新赛季时发生），而不是运行期静默丢数据；球队徽标 / 联赛 Logo 二进制仍不随仓库分发（v0.1 口径，见 [docs/third-party-assets.md](docs/third-party-assets.md) §3），默认全部走 fallback；比赛日详情中的天气字段等可靠来源接入后再显示。

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
- 设置：`notifications.enabled`（默认开启）与 `notifications.matchReminderMinutes`（未设置 = 跟随 Resolver 建议；数字 = 用户提前量；`null` = 不提醒）。控件在设置页「通知」一节（SC-018），“跟随默认建议（赛前 30 分钟）”里的数字来自 Metadata Resolver 的类型级默认值，界面里刻意没有再抄一份默认值；
- UI（`layout/SettingsView.tsx` / `layout/MatchdayInspector.tsx`）：设置页「通知」组给出开关、比赛提醒提前量与一句状态（权限 / 下一条提醒 / 最近一次失败），权限待确认或被拒绝时提供「请求系统授权」入口；权限只在开启通知或用户显式点击时请求一次，不在后台反复询问。比赛详情栏的提醒行与调度同口径——默认建议写「建议提醒：赛前 30 分钟」（与 SC-016 相同），用户设置或事件自带写「提醒：…（用户设置 / 事件自带）」，关掉时写「已关闭（用户设置）」，因此界面上的说法不会和真正会发生的事矛盾。

SC-017 的边界：调度器活在 webview 里，窗口隐藏时 Chromium 会节流后台定时器，提醒可能晚到不到一分钟（到期后 2 小时内仍会补发，见容忍窗口）；应用退出后仍能提醒的常驻调度不在 v0.1；「当天上午 / 前一天晚上」两个锚点固定为 09:00 / 20:00，不做用户可配置；普通事件只按事件自带的 VALARM 提醒（NOTIFY-002 的「事件自身 alarm」），v0.1 没有“所有事件统一提前 N 分钟”的全局设置——那会给没写 alarm 的日历凭空造出提醒；日级语义（法定节假日 / 传统节日 / 节气）不带提醒——它们不是事件，v0.1 只在月格与详情栏呈现；桌面端通知权限恒为已允许，被系统通知设置拦下的情形以发送失败的形式解释（`permission-denied` 那条分支服务于移动端与曾拒绝过的平台）；通知正文只写事件标题与开始时间 + 提醒依据，不含描述、地点与订阅地址（§14）。这组设置的控件由 SC-018 搬进设置页，取值与行为不变。

设置页与内置来源开关（SC-018）位于 `apps/desktop/src/settings/`、`apps/desktop/src/layout/SettingsView.tsx` 与 `apps/desktop/src/semantic/app-builtin-sources.ts`：

- 页面形状：设置是月历主区域上的一个临时页面（侧栏底部「设置」按钮打开，顶部「返回月视图」关闭），三栏结构不变，打开状态不持久化——月历是主界面（P-05），设置页不是新的首页；一节一个主题（外观 / 区域 / 数据源 / 关注球队 / 通知 / 关闭窗口时），没有统计、推荐或嵌套后台；
- 偏好与键：`app.theme`（浅色 / 深色分段控件，选中即生效）、`app.closeBehavior`、`notifications.enabled`、`notifications.matchReminderMinutes`、`sources.builtinHidden`、`webcal.refreshIntervalMinutes`。全部即时生效，没有需要重启的选项，因此界面也不写“需要重启”；没有桌面壳时页面顶部直接说明“改动不写入本地设置”；
- 设置域模块 `settings/`：`builtin-sources.ts`（四个内置来源的目录 + 隐藏列表的读取边界：非数组 / 未知 id / 重复项一律丢弃）、`webcal-interval.ts`（选项与规范化：表外的分钟数按默认处理，不猜）、`region.ts`（区域预留：只陈述当前固定取值，**不定义任何设置键**——写一个没有读取方的值只会让快照出现假状态）；
- 显示开关的效果 `semantic/app-builtin-sources.ts`：关闭不删数据——事件、识别结果与设置都留在数据层（验收：启停不删除用户数据）。过滤的是**视图**：月格、详情栏与提醒计划读的是同一份过滤结果，所以界面上的说法与真正会发生的事一致。「我的日历」关闭后用户事件不进视图（组开关，优先于其余开关：没有事件时“比赛按普通事件显示”自然无从谈起）；「英超赛程」关闭后比赛事件摘掉 `semantic` 与展示元数据，按普通事件进入月格、详情栏与提醒计划（与 SEM-003 同一条口径）——连 `semantic` 一起摘是因为提醒计划先看 `semantic.type` 再回落到事件自带 VALARM，只摘展示元数据的话用户设置过的“比赛提醒”仍会弹。摘掉的是视图字段而不是存储：识别结果仍在快照的增强分区里，重新打开立即恢复、不需要重新匹配；日级语义（节假日 / 节日节气）不挂事件，由 App 按同一个开关取空载荷注入月格与详情栏，UI 组件不需要知道开关存在；
- 一处状态、两个入口：四个内置来源的勾选框在侧栏数据源列表（ui-design §4.3）与设置页数据源一节同时出现，关注球队选择器同样两处共用——同一份 App 状态与同一份读取边界，不是两套逻辑；
- 数据源管理：设置页列出导入 / 订阅来源，显示与侧栏同源的“最近刷新状态”（SRC-003），并提供删除（确认后级联删除该来源的事件）；本地 ICS 来源的删除入口就是这里（SC-006 的遗留项）；
- WebCal 刷新间隔：`intervalMs` 以供应商注入调度器，改设置后 `reschedule()` 立即按新间隔重排（不需要重建调度器、不需要重启）；失败重试固定 30 分钟，与这条设置无关；
- 测试：取值域与读取边界有单测（`settings/builtin-sources.test.ts`、`settings/webcal-interval.test.ts`），视图过滤含「关掉英超后提醒计划不再当比赛」的反例（`semantic/app-builtin-sources.test.ts`），调度器的间隔注入在 `data/webcal/refresh-scheduler.test.ts`，端到端接线（开关真的改变月格 / 详情栏、刷新间隔真的改变唤醒时刻、来源删除与持久化、区域与预览提示这类常量文案）在 `App.test.tsx` 的「设置页（SC-018）」一组里，画面与两套主题另经浏览器人工验收。

SC-018 的边界：设置页没有自己的存储——读写全走 `CalendarStore` 的 settings 分区（原样 JSON，加键不需要迁移）；区域一节在 v0.1 保持只读，语言 / 时区接入时再定义键与读取边界；「我的日历」是对用户事件来源（本地导入 + 订阅）的组开关，单个来源的显示开关仍在各自的来源行里；内置来源的开关不改变语义识别的注册表（Matcher / Resolver 仍按事件跑一遍），快照里的增强分区不会因为关掉某个来源而变小——识别结果与显示开关分开存储，因此重新打开是即时的。刷新间隔的最短选项是 1 小时：调度形状仍是“一个指向到期时刻的定时器”，不是轮询（app-spec §12 允许的后台触发只有启动、手动刷新、到达刷新时间），这条设置改的是“刷新时间什么时候到”，不是唤醒方式。

错误降级与可解释状态（SC-019）位于 `apps/desktop/src/reliability/`、`apps/desktop/src/layout/data-layer-status.ts` 与 `apps/desktop/src/data/store/schema.ts`：

- 脱敏原语 `reliability/redact.ts`：地址保留**原文协议**（`webcal://` 不会被改写成 `https://`——脱敏不该改变读者对“这是什么地址”的认识）/ 主机 / 路径，省略查询串与账号信息；`token=…` 这类没被识别成 URL 的裸凭据按一份保守的参数名白名单抹掉值（`redactCredentials`）；事件正文（标题 / 标准化标题 / 描述 / 地点）替换为 `〔事件正文〕`；文案折叠空白并截断到 300 字符。地址的展示形态只有这一处实现，`data/webcal/webcal-url.ts` 的 `redactWebcalUrl` 是它的语境包装（换占位词）；同一模块的 `redactSensitiveText` 管的是另一件事——把**已知地址**的裸查询串也抹掉，两者互不重复。`describeSafeError` / `describeEventError` 把上述步骤合成一句可直接打印的文案，调用方不必各自记得走一遍；需要判据时用 `errorNameOf`，需要正文时用 `sanitizeMessage`。**顺序是契约**：正文替换必须在折叠空白与截断之前（折过之后标题里的连续空白就匹配不上，截断之后超长标题会留下没被替换的前缀），`describeEventError` 因此按「原文替换 → 折叠 → 再替换一遍 → 清洗」四步走；
- 语义失败隔离的结构性保证（§14）：`MatcherErrorReport` / `ResolverErrorReport` 不再携带原始 `error` 对象，只带 `errorName` + 已洗过的 `message`。脱敏发生在报告生成处——引擎与解析链是唯一同时持有异常与事件的地方，因此“日志侧取错字段”这条通道被移除；曾经那条“报告不含事件正文”的测试只能证明 `JSON.stringify(new Error())` 不打印 message（Error 的 message 不可枚举），换成抛出 `无法解析「<标题>」：<带 token 的地址>` 的实现就漏了，现在的用例直接这么抛；
- 数据层状态 `layout/data-layer-status.ts`：`loading` / `ready` / `preview` / `unavailable` 四态，**没有桌面壳**与**桌面壳在但快照打不开**（磁盘错误、权限、迁移链缺失）分开说——后者的状态行给原因与后果（「本地数据层不可用（<脱敏原因>）：日历可浏览，导入与订阅不可用，设置更改不会保存」），导入 / 订阅动作各自回答“这次动作会不会保存”，设置页顶部同样说明改动不写盘。状态是**一个联合类型**（原因只在不可用时有意义），因此“已就绪却还带着上次的失败原因”这种组合写不出来；此前这条路径只有一句“本地数据层初始化失败”，而后续动作会拿预览模式的文案回答用户（说不一致），现在说的是“无法导入 / 无法添加订阅”——动作被直接拒绝，没有“发生了但没保存”这回事；
- 落盘失败不静默（§13 数据库异常提示）：App 的写路径统一经过一个 `saveStore(label)` 出口——内存里的更改照常生效（界面按新状态显示），同时给出「<动作>未能写入本地文件：<原因>（界面已按新状态显示，重启后可能丢失）」，侧栏底部与设置页顶部各显示一次；任何一次成功写入即清除该提示，所以它陈述的是最近一次写入的结果而不是一段历史。此前 `store.save()` 在多数写路径上不接错误，写盘失败会变成无人处理的 rejection（订阅 / 导入那条还会把“已写入内存”的成功说成失败）；
- 快照坏记录隔离（验收：单个坏事件被隔离）：`data/store/schema.ts` 的 `narrowStoredEvent` / `narrowStoredSource` 在读取边界逐条收窄。快照是本地 JSON 文件，可能被手工编辑或被同步工具改坏，而结构级校验只看到“events 是数组”——一条缺 `start` 的记录会一路进到月格展开（`occurrences.ts` 的 `localDayKey` 读 `iso.endsWith`），把整个日历打掉（实测：白屏）。现在必需字段（uid / sourceId / title / start / allDay，日期只要求 `YYYY-MM-DD` 形态）不合格的事件整条隔离，可选字段（描述 / 地点 / EXDATE / VALARM 条目）类型不对只丢该字段，缺地址的订阅来源整条丢弃——它的事件保留在数据层（不删用户数据），只是暂时不可达。被隔离记录的**原文另存**为 `<快照名>.rejected-<时间戳>`（与整份快照损坏时的 `.corrupt-` 同一口径：数据留在磁盘上供人工检查，写备份失败也不阻断启动），条数报给界面（「已跳过 N 个无法读取的事件」）——只报条数不报名字，因为被隔离的记录字段本身就不可信，从里面取名字展示等于把坏数据放进界面；主文件在下一次落盘时重新变干净；
- 其余验收项由既有链条与既有测试提供（本次只在同一份说明里对齐，没有重复补测试）：网络失败只标记来源状态、保留旧事件与上次成功时间（SC-007，`data/webcal/webcal-refresh.ts`）；Matcher / Resolver 抛错只降级自身、事件按普通事件继续显示（SC-009）；队徽 / Logo 缺失降级为球队代码 / 联赛短标签，图片加载失败同样换 fallback（SC-016 / `semantic/marks.ts`）；ICS 事件级解析错误进导入报告而不阻塞其余事件（SC-006 / ICS-005）；网络超时、连接失败、重定向与响应体读取失败在 Rust 侧就翻译成中文原因，且错误文案不含请求地址与 token（`src-tauri/src/webcal.rs`，含一条“连接失败不泄露地址”的 Rust 测试）；Provider 数据缺失按 §13 处理——识别不出就是普通事件、未收录的队徽 / 联赛 Logo 走 fallback、v0.1 没有可靠来源的天气不显示，而不是补一个看起来合理的值（`semantic/marks.test.ts`、`metadata-resolver.test.ts`，以及 App 集成里“比赛详情不含天气”的断言）；
- 测试：脱敏规则与边界在 `reliability/redact.test.ts`，状态文案在 `layout/data-layer-status.test.ts`，坏记录收窄规则在 `data/store/schema.test.ts`（逐字段），落盘与读取的端到端效果在 `data/store/calendar-store.test.ts`（坏记录不影响其余记录、坏记录不再写回文件）；语义报告不泄露正文在 `matcher-engine.test.ts` / `metadata-resolver.test.ts` / `notification-bridge.test.ts`；端到端接线在 `App.test.tsx` 的「错误降级与可解释状态（SC-019）」一组——快照打不开时不冒充预览模式且月视图可用、落盘失败时“界面已生效 + 没写进磁盘”两件事同时说清且恢复后自动清除、落盘失败的状态行与日志都不含订阅 token、快照里的坏记录被隔离后月视图照常并说明少了几条。

SC-019 的边界：v0.1 不加全局离线横幅或网络状态探测——§13 要求的“显示缓存 + 标记刷新失败 + 不删除旧数据”按来源行陈述（SRC-003），启动时不做连通性检查（那会引入一个常驻探测）；失败后的重试仍是调度器的固定 30 分钟，没有手动的“立即重试全部”（每行的「刷新」就是单点重试）；坏记录隔离只覆盖存储边界，导入 / 订阅进来的事件由解析器与标准化保证字段齐全，因此那里不需要第二道收窄；被隔离的记录另存为备份文件后就不再回到主快照（不做“保留一份读不出来的记录”的旁路分区——那会让每次启动都重新隔离同一批记录，后续 schema 变更还得一直背着它们），备份文件与 `.corrupt-` 一样是给人看的，应用不再读它。Provider 装配期的唯一性校验仍按“宁可启动即失败”处理：那是发布前就该被测试拦下的数据错误，不是用户数据。

性能基线与缓存策略（SC-020）位于 `apps/desktop/src/bench/`、`apps/desktop/src/scheduling/` 与 `apps/desktop/src/normalize/occurrences.ts`，数字与方法汇总在 [docs/performance.md](docs/performance.md)：

- 可重复的基线：`npm run bench`（vitest bench，跑在 Node 环境、每条固定迭代次数）覆盖纯计算与磁盘 I/O；`tools/measure-desktop.ps1` 覆盖窗口与进程（冷启动 N 次取中位数、可见空闲连续两段 CPU 采样、向主窗口发 WM_CLOSE 后用 `IsWindowVisible` 确认真的隐藏）。工作负载 `src/bench/fixtures.ts` 全部由下标算术推导——不用随机数、不读时钟、不依赖运行机器的时区；英超对阵从真实目录的赛季名单成对取队，名单变化时夹具自动跟随，不会退化成「一条都匹配不上」的空转；
- 首个基线（2026-09-25，Ryzen 7 5700X / 64 GB / Windows 10.0.26200，release 产物）：冷启动中位 282 ms；空闲内存 26 MB 工作集 / 5 MB 私有；可见空闲与隐藏窗口的 30 秒 CPU 增量 0.000–0.031 s（隐藏后主窗口不可见）；10,000 条事件月切换 152 ms（1,000 条 16.2 ms）；10,000 条导入的解析 + 落库 83 ms、应用侧一次导入总时长 320 ms；Matcher 批处理 57.7 ms；WebCal 304 命中缓存无可测量的解析开销，200 全量替换 86.6 ms；
- 月切换 597 → 152 ms 的三处改动（语义不变，`normalize/occurrences.ts` + `format/time.ts`）：窗口之前的候选只计数不物化（长序列里九成候选如此）、`UNTIL` 边界快路径（候选日 + 1 天仍早于边界时无需换算）、`Intl.DateTimeFormat` 按用途缓存（构造约 50 µs，比 `format` 贵两个数量级，原先 6 处调用点各自 new）。第三处同时消掉分桶与月格摘要的同款开销，并把「Z 形态换算 / 墙钟形态切片」收进一个 `localTimeOfDayLabel`；
- 语义增强分片：`reEnrichStoreYielding` 每 500 条一片（单片约 3 ms），片间用 `scheduling/yield-to-main.ts` 让出主线程——用 MessageChannel 任务而不是 `setTimeout`，因为 Chromium 对隐藏页面会把定时器节流到每秒甚至每分钟一次，那会把一次后台刷新拖成几十秒。同步入口 `reEnrichStore` 与它共用同一份生成器实现，结果逐字节相同；启动重建、订阅刷新、导入三条路径都走分片入口。分片带来一个新的重叠风险：两次重建可能交错，而重建是「先整体清空再重建」，交错会让分区里混进旧快照的产物（孤儿记录），因此同一次存储上的重建排队执行，最后一次完成的结果是权威的；
- 提醒计划重建分片（SC-020 收尾，`notifications/reminder-plan-load.ts`）：提醒计划的输入是「今天起 30 天」窗口里展开好的 occurrence，展开与月切换共用同一个函数。改动前展开（10,000 条约 154 ms）与计划（4.6 ms）都在调度器那一次调用里同步完成。现在**调度器接口不动**——`plan` / `replan` 仍是同步回调，App 持有一份「最近一次算完的计划」供它们读，重建在后台分片进行、完成后让调度器重排；未就绪前计划为空（宁可让提醒晚几百毫秒，仍在 2 小时容忍窗口内，也不按旧数据弹一条已删除的事件）；已处理提醒改在**读取侧**过滤（弹一条、重启恢复去重日志都不再触发重建）。提醒时间、去重键与迟到容忍的语义一处没动，`App.test.tsx` 的「大数据量下提醒仍按计划触发」用 1,500 条事件 + 一场时间已知的比赛验证到点仍按原时间弹出；
- 月切换读取分片（SC-020 收尾，`calendar/month-occurrences.ts` + `calendar/use-month-occurrences.ts`）：展开本身在三处改动之后仍是渲染路径上的一次同步计算（10,000 条约 164 ms 不让出主线程）。现在按**让出阈值**（`MONTH_YIELD_AFTER_MS = 5 ms`，软阈值：一次任务还会多跑一片 128 条事件，末次多一次分桶）驱动 `normalize/occurrences.ts` 的分片生成器，任务之间用同一个 `yieldToMain` 让出；同步入口就是生成器的一次排空，两条路径不可能各自演化出不同语义（`occurrences.test.ts`「分片展开」一组逐条对照两者结果）。第一个任务在渲染期跑：**约 200 条以下**（实测 200 条 3/3 次、300 条 0/3 次）就此算完、首帧即完整月格，不会「先空一下再填上」；更大的日历进入整理状态，期间**不发布半份结果**（月格为空 + 表头状态行说明工作量，`monthOccurrencePendingText`），算完一次性给出完整月格。实测：单次任务 6.3–6.6 ms（10,000 条；最坏一次约 14 ms，仍在一帧内），让出约 3 µs 一次，整段墙钟与同步路径同量级（总时长的对照差值落在测量抖动里，所以文档只引用稳定的单次任务耗时）。缓存键是「事件数组身份 + 窗口日期」：窗口没变而事件换了（导入 / 刷新 / 设置开关）必须重算，两者都没变的重渲染（主题、选中日期、侧栏折叠）不重算；**事件集合没变的后台刷新不重读事件**——存储用 `eventsRevision()` 报告「集合是否真的变过」（304 与失败刷新不推进），否则每次刷新都会白克隆一遍事件（10,000 条 37 ms）并让月格闪一次「整理中」；
- 后台唤醒守卫 `scheduling/no-polling.test.ts`：扫描 `src/`（除测试）不允许 `setInterval`，扫描 `src-tauri/src/` 不允许周期定时器或睡眠循环。调度器本身「空闲零唤醒、只持一个定时器」由各自的单测覆盖（`refresh-scheduler.test.ts`、`notification-scheduler.test.ts`）；
- 缓存失效清单写在 performance.md §4：WebCal 校验值（200 整体替换、304 只推进时间）、WebCal 事件集（键差集替换，失败一律不动旧数据）、增强结果（按事件失效 / 重建清空 / 级联删除）、已处理提醒日志（30 天 500 条裁剪）、本地导入（增量 upsert）各有规则与覆盖测试；队徽 / 联赛 Logo **没有**应用内缓存——仓库不分发图片，解析无状态，接入资源包后由 WebView 自己的图片缓存负责，应用不再叠一层需要失效策略的缓存；
- 测试：格式化器缓存与降级在 `format/time.test.ts`，让出主线程、分片执行器与无轮询守卫在 `scheduling/`，提醒计划的分片等价性在 `notifications/reminder-plan-load.test.ts`，分片与同步入口结果一致、以及「重叠重建不留旧快照产物」在 `semantic/enrich.test.ts`（去掉队列这条用例会失败），三条新展开用例（跨窗口 `COUNT`、`UNTIL` 快路径、改期例外指向窗口前实例）与分片展开的等价性在 `normalize/occurrences.test.ts`；读取路径的分片口径（预算、粒度、与同步路径逐条相同）在 `calendar/month-occurrences.test.ts`，React 接线（首帧即完整、整理状态、切月不串数据、同一份输入不重算）在 `calendar/use-month-occurrences.test.tsx`，表头状态行在 `calendar/MonthView.test.tsx`，大数据量导入后的端到端表现在 `App.test.tsx` 的「月切换的分片读取（SC-020）」一组。

SC-020 的边界：提醒计划的重建（展开 30 天窗口 + 计划，10,000 条约 138 ms）仍是同步段，但它不在渲染路径上，只在启动 / 数据变化 / 跨天 / 到点各发生一次，数字记在 `src/bench/reminder.bench.ts` 备用；月切换读取已分片，代价是 1,000 条规模会拆成 2–3 个任务、整理状态行出现约 2 帧，以及整理期间月格为空（不给半份结果）。导入链路留下的同步段已由 SC-024 补上（见下）。这些剩余的不中断时长都在 performance.md §6 如实记录，没有假装整条链路都是非阻塞的。性能门槛也没有在这一单里写死：§15 的顺序是「先建立基线，再根据实测锁定硬指标」，本单交付的是前半句。

导入链路分片（SC-024，`ics/parse-ics.ts` + `normalize/normalizer.ts` + `data/store/calendar-store.ts` + `data/store/snapshot-json.ts`）补齐「点一次导入」这条动作里剩下的同步段。SC-020 收尾时把读取路径（月切换展开 + 分桶、提醒计划重建）拆成了短任务，导入链路本身留下三段一次跑完：解析（10,000 条约 100 ms，逐行展开 → 切 VEVENT 块 → 逐块解析）、标准化 + 落库（约 20 ms）、落盘（逐条克隆 + `JSON.stringify`，约 60 ms）。当时给解析留下的理由是「要让它不占主线程得把管线搬进 Web Worker」——SC-024 发现按块 / 条分片就够了，不必改架构：

- 每个阶段都是一个**每 chunk 个元素 `yield` 一次**的生成器，同步入口 = 生成器的一次排空（`scheduling/drain.ts`，七处同步入口共用），因此语义只有一份：解析按 128 个 VEVENT 块（逐行扫描按 1024 行）、标准化 / 落库 / 读取按 128 条、序列化按 128 项，边界规则统一在 `scheduling/chunk-boundary.ts`。等价性各自有用例逐条对照同步入口（`parse-ics.test.ts`、`normalizer.test.ts`、`calendar-store.test.ts`、`import-slices.test.ts`），去重（ICS-001）与坏事件隔离（ICS-005）语义不变；
- **驱动只有一处**：`scheduling/run-yielding.ts` 把「按 5 ms 阈值跑一个任务 → 让出主线程 → 再跑」收成一个函数，导入、订阅刷新（`webcal-refresh.ts` 的 200 分支走同一组分片原语，空响应的“要不要保留缓存”判定改用 `hasEvents()`——只判有无，不再整份读事件）、落盘与界面的事件读取共用它。App 侧的事件读取 `data/store/enriched-events-load.ts` 读完一次性发布，读取期间界面继续显示上一份集合（不会先空一下再填上），并用代次号保证「更晚发起的读取获胜」；
- **落盘不再克隆**：快照是给磁盘的文本，落盘路径没有「把快照交出去」这一步，逐条克隆（10,000 条约 43 ms）因此是多余的；序列化改为逐项 `JSON.stringify` 后按缩进拼接，输出与 `JSON.stringify(snapshot, null, 2)` **逐字节相同**（`snapshot-json.test.ts` 用富夹具逐字节对照，`calendar-store.test.ts` 再用真实存储对照一次）。同一会话对照：快照落盘 62.5 → 40.9 ms，读取模型 55.1 → 37.5 ms（10,000 条）；
- **切片落库的版本号推两次**：让出主线程后，读取方可能在半途读到事件集合并把当时的版本号记成「已读过」；结束值必须与半途值不同，否则读取方会跳过重读、界面停在半份事件上（`calendar-store.test.ts` 有两条用例：半途读到后仍会重读，以及同步入口不切片时只推一次）。判据是调用方的分片粒度而不是「生成器有没有 yield 过」，所以同步入口与改动前完全一致；
- 实测（10,000 条，导入 → 增强 → 落盘 → 读取，五轮连续采集，每个任务的时长都在任务之间测量、含末次任务）：全局最长 11.7 ms（进程刚起的首轮出现过 14.1 ms，仍在一帧以内），整条动作 137–148 个任务（改动前是 5 个），总时长 257–360 ms（Node 环境，不含落盘的异步 I/O）。验收项「导入 10,000 条事件时主线程上没有超过一帧的任务」由此成立；代价与剩下的不可分片段（整段文本切分 4 ms、落盘的异步 I/O 60–75 ms、引擎 GC 暂停）记在 performance.md §3.5 与 §6。

SC-024 的边界：不把管线搬进 Web Worker——分片已经能把最长任务压到一帧以内，而 Worker 会改变存储与增强的线程模型（数据要先搬过去再搬回来，快照与增强分区的单一写入方假设都要重做），换来的是「连 4 ms 的文本切分也不占主线程」，不值这个复杂度；导入期间不加进度百分比——界面已有「导入中…」状态行与禁用的按钮，整段动作仍在秒级以内且全程可绘制，等实测需要再加（§13 的可解释性由状态行满足）；序列化的分片改写只覆盖落盘路径，`toSnapshot()` 仍是「克隆出来的独立值」（另有读取方需要它），两条路径由字节等价用例钉在一起。

测试与人工验收（SC-021）把各单的测试对齐成一处可检查的清单，并补上三处真实缺口。验收清单与记录在 [docs/ui-acceptance.md](docs/ui-acceptance.md)：§26 的 18 条逐项给出判据、自动证据（测试文件与用例名）与人工记录，附 4 张整屏截图（浅色 / 深色 / 国庆连休 / 最小窗口），SC-021 的六条验收项也在同一份文档里对齐：

- 垂直链路集成 `semantic/vertical-slice.test.ts` 覆盖 app-spec §17 要求的两条链——`ICS → Normalize → Match → Persist → 月格` 与 `WebCal refresh → dedupe → update → 重新匹配 → 重排提醒`（第二条把刷新前后的提醒计划摆在一起对照：改期那场不再按比赛提醒、新增那场按新时间提醒、消失的那场没有残留）。它跑的是 `createAppSemanticStack()` 装配出来的那一套 Matcher / Resolver，不是测试自建的替身：注册表掉一个 Matcher、Matcher 与 Resolver 的接口对不上、增强分区写不进快照，都会在这里失败。展示载荷经 `displayMetadataOf` 取值（UI 的真实读取边界），断言停在该边界交给月格的数据形态；真正渲染那一段由 `App.test.tsx` 承担。与 `normalize/pipeline.test.ts` 不重叠——后者到 Matcher 之前为止（SC-008 的范围），且带一条「快照往返后展开结果一致」的持久化断言；
- 存储层差集语义 `data/store/calendar-store.test.ts`「replaceSourceEvents 删掉消失事件的增强记录，重新入库的那份等待重建」：`replaceSourceEvents` 只删批次里消失的事件（连同其增强记录），仍在的事件保持同一个持久化身份、不产生副本。这条口径此前写在 `replaceSourceEvents` 的注释里但**与实现不符**（注释说「未变事件保留增强结果」，实际 `upsertEvents` 会把重新入库的每一条的增强记录删掉）：按实现改正注释与本文 WebCal 一段。差别不是行为缺陷——重建是确定性的，刷新链路紧随其后就会重跑匹配，用户看到的语义与刷新前一致；改的是说法；
- 浏览器预览判据 `ipc/tauri-ipc.ts` + `ipc/tauri-ipc.test.ts`：这条判据决定用户看到的是「浏览器预览模式」还是「本地数据层不可用（原因）」（app-spec §13 要求两者分开说）。原先只认文案里带 `__TAURI_INTERNALS__` 的错误，而 `@tauri-apps/api` 2.11 的 `invoke` 在 Chromium 上抛的是 `Cannot read properties of undefined (reading 'invoke')`——真实浏览器里的预览模式因此被判成「数据层不可用」，并把内部报错原文显示给用户。现在判据是「环境里确实没有桌面壳」（能力事实，桌面壳会在页面脚本之前注入 `__TAURI_INTERNALS__`）**且**「错误形状符合缺失 IPC」两条同时成立，因此只看文案会把「桌面壳在、失败恰好提到 invoke」读成预览的漏洞也不成立。这是本单唯一的生产行为改动，理由是它挡在人工验收的路径上（不改它，按 §6 打开的浏览器会显示内部报错而不是预览模式），而判据本身要写成什么样在 app-spec §13 里已经定死了；两个方向都有用例：真实故障（EACCES、JSON 解析失败、桌面壳在时的同款 TypeError）都不算预览；
- 人工验收发现一条不通过：默认窗口尺寸（1180×760）且左右栏展开时，比赛格的「队标 VS 队标」放不下（可用 62px / 内容需要 81px），第二个队标被格子裁掉一截。jsdom 没有布局，`MonthView.test.tsx` 只能断言「格子里只有队标与 VS」，而 `cell-visual-contract.test.ts` 断言的正是「格子必须裁切」（§10.1 对狮标的要求）——裁切恰好是这里把队标切掉的原因，因此只有真实渲染能看出来。另一条只能算部分通过：中秋 / 寒露 / 霜降的照片型背景在本次画面里不存在（仓库不分发图片资源，渲染走文字降级），能力由 `DayBackdrop.test.tsx` 覆盖；SC-022 的口径是 v0.1 不接入照片资源（无可用许可），这一条按「能力成立、默认走文字降级」收尾，见 `docs/ui-acceptance.md` §5.2。两条的现象、量化与建议方向记在 `docs/ui-acceptance.md` §5，前者另行开单修复，不计入本单完成。

SC-021 的边界：不引入浏览器驱动的截图回归——§26 里必须用眼睛看的只有布局、观感与整屏构图（4 项），其余 14 项在 jsdom 与 CSS 契约层面就能判定，多一层截图基线要维护的是渲染噪音而不是产品行为；截图是人工验收的记录，不是回归门。测试数量本身不是目标，本案只补链路、差集与预览判据这三处真实缺口，其余验收项用既有测试对齐（各单记录的「测试」一段就是索引）。覆盖不到的仍然是「观感」这一类判断：字重、留白、渐变是否舒服，靠人看，不靠断言。图片型背景（中秋 / 寒露 / 霜降的照片层）的能力由 `display/DayBackdrop.test.tsx` 覆盖，但仓库不分发图片资源，默认渲染走文字降级——v0.1 按此口径收尾（SC-022 的决定，见 [docs/third-party-assets.md](docs/third-party-assets.md) §1、§3）。
