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
  id: string
  match(event: CalendarEvent): MatchResult | null
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
- [ ] 解析本地 ICS 文件
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

最小前后端 IPC 链路由 React 调用 Tauri `greet` command 验证。
