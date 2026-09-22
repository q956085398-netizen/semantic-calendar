# Semantic Calendar App Spec

> 状态：v0.1 基线  
> 文档角色：产品 / 功能 / 技术验收的统一入口  
> 相关文档：[项目愿景](vision.md) · [架构草案](architecture.md) · [UI Spec](ui-design.md) · [开发原则](development-principles.md) · [Roadmap](roadmap.md)

---

## 1. 产品定义

Semantic Calendar（语义日历）是一款 **本地优先、轻量常驻、能够理解事件语义的桌面日历**。

它首先必须是一个可靠的日历，其次才是一个“语义增强”日历。

核心命题：

> 日历不仅知道“什么时候发生”，也尽量知道“发生的是什么”。

例如：

- `Arsenal vs Manchester City` 不只是文本，而是“英超比赛 + 两支球队 + 比赛时间 + 可提醒事件”；
- “中秋节”不只是全天事件，而是传统节日；
- 国庆假期应在月视图中表现为连续休假，而不是若干无关文本；
- 补班、节气、赛事在视觉上应有不同语义，但都不能破坏普通日历体验。

---

## 2. v0.1 成功标准

v0.1 完成时，用户应能：

1. 启动一个可长期常驻的桌面日历；
2. 在月视图浏览、切换和选择日期；
3. 导入本地 ICS，并订阅 ICS / WebCal；
4. 正确处理全天事件、重复事件、时区和 UID 去重；
5. 看到中国农历、法定节假日、调休 / 补班、传统节日和二十四节气；
6. 自动识别常见英超比赛标题；
7. 在月格看到联赛 / 球队语义视觉，在右侧查看完整比赛详情；
8. 关注一支球队并获得可配置的赛前提醒；
9. 在浅色 / 深色主题间切换；
10. 在离线或数据源失败时仍能浏览已缓存日历；
11. 在 Windows 上稳定打包运行；
12. 有可重复的性能基线和核心测试。

---

## 3. 明确不属于 v0.1

v0.1 不做：

- Google Calendar / Outlook 双向同步；
- CalDAV 完整同步；
- 团队协作；
- 邀请与会议室管理；
- Calendly 类预约排程；
- Todo / 项目管理系统；
- 新闻流、体育资讯流；
- AI 作为基础识别依赖；
- 账号系统优先的云端 SaaS；
- 插件商店；
- 多体育项目全面覆盖；
- 移动端；
- 复杂社交功能。

这些能力不能阻塞 v0.1 的核心垂直链路。

---

## 4. 目标用户与核心任务

### 4.1 目标用户

主要面向：

- 希望桌面日历长期常驻但不想承担高资源占用的个人用户；
- 使用 ICS / WebCal 订阅多个来源的用户；
- 希望中国日历信息自然融入月视图的用户；
- 希望体育赛程在普通日历中更好识别的用户。

### 4.2 核心任务

用户打开应用后最常做的事情应当是：

1. 看这个月；
2. 识别近期特殊日期；
3. 点击某一天查看详情；
4. 导入 / 订阅日历；
5. 查看关注球队比赛；
6. 接收提醒；
7. 切换主题和数据源。

---

## 5. 产品原则

### P-01 日历可靠性高于语义增强

Matcher 失败时必须回退为普通事件，不能让事件消失。

### P-02 本地优先

能在本地完成的解析、匹配、元数据解析和存储应默认本地完成。

### P-03 确定性优先

节假日、节气、球队和结构化比赛优先使用规则与结构化数据，不把 AI 作为必需依赖。

### P-04 语义与展示分离

“这是什么”与“怎么显示”必须分层。

### P-05 月历是主界面

v0.1 不增加 Dashboard 首页。

### P-06 可解释的网络行为

用户应知道某个网络数据源是否更新成功、何时刷新、失败原因是什么。

### P-07 轻量常驻

性能预算从第一版开始记录，不把性能推迟到发布前。

---

## 6. 信息架构

桌面主界面采用三栏：

```text
Sidebar | Calendar | Inspector
```

### Sidebar

负责：

- 小月历；
- 数据源显示开关；
- 关注球队；
- ICS 导入；
- 设置入口。

### Calendar

负责：

- 月 / 周 / 日入口；
- v0.1 重点实现月视图；
- 日期导航；
- 事件 / 特殊日期语义展示；
- 日期选择。

### Inspector

负责：

- 当前日期详情；
- 当前事件详情；
- 节日 / 节气详情；
- 体育比赛详情。

Inspector 不是固定“今日安排”面板。

完整视觉规范见 [ui-design.md](ui-design.md)。

---

## 7. 系统架构

主数据链路：

```text
Calendar Sources
  ↓
Source Adapters
  ↓
Event Normalizer
  ↓
Matcher Engine
  ↓
Semantic Event
  ↓
Metadata Resolver
  ↓
Persistence / Calendar UI / Notifications
```

### 7.1 Calendar Sources

v0.1：

- 本地 ICS 文件；
- ICS / WebCal URL；
- 中国日历内置 / 更新数据；
- 英超结构化数据或可替换 Provider。

### 7.2 Source Adapters

把来源不同的数据转换成统一 Raw Event。

### 7.3 Normalizer

处理：

- Unicode；
- 标题常见格式；
- 全天事件；
- 时区；
- UID；
- 重复事件；
- recurrence 展开 / 解释；
- 原始字段保留。

### 7.4 Matcher Engine

负责识别：

- 节假日；
- 传统节日；
- 节气；
- 足球比赛。

### 7.5 Metadata Resolver

负责：

- 本地化名称；
- 联赛 / 球队元数据；
- 图标 / Logo 资源引用；
- 语义颜色；
- 默认提醒策略。

### 7.6 UI

UI 不允许通过 `title.includes(...)` 自行判断业务语义。

---

## 8. 核心数据模型

实现阶段字段可调整，但语义边界应保持。

### 8.1 CalendarSource

```ts
type CalendarSource = {
  id: string
  type: 'local-ics' | 'webcal' | 'builtin' | 'provider'
  name: string
  enabled: boolean
  color?: string
  lastSyncAt?: string
  lastSyncStatus?: 'ok' | 'error' | 'never'
}
```

### 8.2 RawCalendarEvent

```ts
type RawCalendarEvent = {
  uid: string
  sourceId: string
  title: string
  description?: string
  location?: string
  start: string
  end?: string
  allDay: boolean
  recurrence?: unknown
  rawPayload?: string
}
```

### 8.3 NormalizedEvent

```ts
type NormalizedEvent = RawCalendarEvent & {
  normalizedTitle: string
  timezone?: string
  occurrenceId?: string
}
```

### 8.4 SemanticEvent

```ts
type SemanticEvent = {
  type:
    | 'calendar.event'
    | 'holiday'
    | 'makeup-workday'
    | 'festival'
    | 'solar-term'
    | 'sport.fixture'
  subtype?: string
  entities?: Array<{ type: string; id: string }>
  confidence?: number
  matcherId?: string
}
```

### 8.5 EnrichedEvent

```ts
type EnrichedEvent = NormalizedEvent & {
  semantic?: SemanticEvent
  metadata?: Record<string, unknown>
}
```

原始事件必须可以追溯。

---

## 9. 功能需求

## CAL — 日历基础

### CAL-001 月视图

必须支持：

- 当前月 6 行 × 7 列布局；
- 跨月日期；
- 公历日期；
- 农历简写；
- 今天状态；
- 选中状态；
- 日期点击。

### CAL-002 月份导航

支持：

- 上一月；
- 下一月；
- 回到今天；
- 小月历同步。

### CAL-003 Inspector

点击日期后，右侧栏必须根据日期语义展示对应详情。

普通日期允许留白。

### CAL-004 侧栏折叠

左侧 Sidebar 与右侧 Inspector 都需要可折叠。

窗口缩小时优先保证 Calendar 可用面积。

---

## THEME — 主题

### THEME-001 浅色主题

采用暖白 / 米灰体系。

### THEME-002 深色主题

采用炭灰 / 深蓝灰体系，不使用大面积纯黑。

### THEME-003 主题持久化

用户主题偏好重启后保持。

---

## SRC — 数据源

### SRC-001 本地 ICS

支持用户选择本地 `.ics` 文件并导入。

### SRC-002 WebCal / ICS URL

支持添加 URL、手动刷新与后台低频刷新。

### SRC-003 数据源状态

至少记录：

- 是否启用；
- 上次成功刷新；
- 上次错误；
- 来源类型。

### SRC-004 离线缓存

网络来源不可用时继续显示本地缓存结果。

---

## ICS — 解析可靠性

### ICS-001 UID

同一来源内按 UID / recurrence identity 避免重复导入。

### ICS-002 全天事件

全天事件不能因为时区转换漂移到前一天 / 后一天。

### ICS-003 时区

支持常见 TZID / UTC / 本地时间组合。

### ICS-004 重复事件

支持 v0.1 常见 RRULE，并能处理 EXDATE / RECURRENCE-ID 的基础场景。

### ICS-005 错误隔离

一个损坏事件不能导致整个日历源无法导入。

---

## SEM — 语义框架

### SEM-001 Matcher 注册

Matcher 必须可独立注册并有确定优先级。

### SEM-002 MatchResult

结果至少包含：

- semantic；
- matcherId；
- 可选 confidence；
- 可选 reason。

### SEM-003 回退

没有匹配时按普通事件显示。

### SEM-004 重新匹配

保留原数据，使 Matcher 更新后可重新计算语义，无需重新下载源数据。

---

## CN — 中国日历

### CN-001 农历

月格显示农历日；必要时显示月份边界。

### CN-002 法定节假日

显示法定休假。

### CN-003 调休 / 补班

显示补班，并与休假视觉明确区分。

### CN-004 连休

连续假期在 UI 上形成连续视觉。

### CN-005 传统节日

首批至少支持常见传统节日，如春节、中秋等。

### CN-006 二十四节气

显示节气名称与对应日期。

### CN-007 年份数据

节假日数据需要有年份版本与可更新策略。

---

## SPORT — 体育 / 英超

### SPORT-001 英超球队元数据

支持 20 支参赛球队的：

- 稳定 ID；
- 中英文名称；
- 常见别名；
- Logo 引用；
- 主题元数据。

赛季变化不能要求重写 Matcher。

### SPORT-002 比赛识别

识别常见标题：

- Arsenal vs Manchester City
- Arsenal - Manchester City
- Manchester City @ Arsenal
- 大小写 / 多余空格等变体

### SPORT-003 主客队

尽可能识别 home / away。

不确定时允许保持未知。

### SPORT-004 比赛月格

月格只显示：

```text
队标 VS 队标
```

以及被裁切在格内的联赛背景视觉。

### SPORT-005 比赛 Inspector

至少显示：

- 联赛；
- 两队；
- 队徽；
- 开赛时间；
- 场地（有数据时）；
- 天气（有可靠来源时）；
- 提醒。

### SPORT-006 关注球队

用户可选择关注球队。

关注球队状态需要持久化。

---

## NOTIFY — 提醒

### NOTIFY-001 本地通知

应用可以创建系统本地通知。

### NOTIFY-002 事件提醒

普通事件可按事件自身 alarm 或用户设置提醒。

### NOTIFY-003 比赛默认提醒

比赛可建议“赛前 30 分钟”，但用户设置优先。

### NOTIFY-004 去重

应用重启 / 数据刷新不得重复触发同一个提醒。

---

## SETTINGS — 设置

v0.1 设置至少覆盖：

- 主题；
- 数据源；
- WebCal 刷新；
- 关注球队；
- 通知开关；
- 默认比赛提醒；
- 基础语言 / 区域预留。

设置界面保持轻量，不做多层复杂后台。

---

## 10. UI 语义规则

完整规则以 [ui-design.md](ui-design.md) 为准。

必须保证：

- 连休背景连续；
- 假日使用大号低透明度“休”，不再重复小“休”徽标；
- 补班使用蓝色语义 + 大“补”；
- 特殊节日 / 节气可有受控背景图片；
- 比赛日联赛图形不得溢出日期格；
- 比赛格只显示队标 VS 队标；
- 多语义冲突遵循“一个主背景语义 + 多个状态语义”；
- 右栏为 Inspector；
- 浅色赛事 Inspector 与主界面自然融合；
- 深色主题保持相同信息架构。

---

## 11. 持久化需求

v0.1 推荐 SQLite 或等价轻量本地数据库。

需要持久化：

- CalendarSource；
- Raw event；
- Normalized / semantic 结果或可重建索引；
- 用户设置；
- 关注球队；
- 通知调度状态；
- Provider 数据版本；
- WebCal 缓存元数据。

原则：

- 原始数据与增强数据分离；
- schema migration 必须可控；
- 数据库损坏不应导致应用完全无法启动，应有恢复 / 重建策略。

---

## 12. 后台行为

避免高频轮询。

允许的后台触发：

- 应用启动；
- 用户手动刷新；
- WebCal 到达刷新时间；
- 下一条通知调度；
- 内置数据版本更新检查（低频）。

网络任务必须：

- 有超时；
- 可取消；
- 可失败重试；
- 不阻塞 UI；
- 暴露最近状态。

---

## 13. 错误与降级

### 网络失败

- 显示缓存；
- 标记刷新失败；
- 不删除旧数据。

### Matcher 失败

- 回退普通事件。

### Logo 缺失

- 使用文字缩写 / 通用图形；
- 不破坏布局。

### Provider 数据缺失

- 不伪造数据；
- 对未知值留空。

### 通知权限被禁用

- 在设置中显示状态；
- 日历本身继续可用。

---

## 14. 隐私与安全

v0.1 原则：

- 本地 ICS 不上传；
- WebCal 仅访问用户配置的 URL；
- 不默认遥测；
- 不建立云端账号依赖；
- 日历原始内容不发送给 AI 服务；
- 日志避免记录完整私密事件正文；
- URL 中的 token / secret 不应明文输出到普通日志。

未来若加入遥测，必须显式说明并允许关闭。

---

## 15. 性能需求

v0.1 先建立基线，再根据实测锁定硬指标。

必须测量：

- 冷启动时间；
- 空闲内存；
- 空闲 CPU；
- 窗口隐藏时资源；
- 1,000 事件导入；
- 10,000 事件导入；
- 月切换耗时；
- Matcher 批处理耗时；
- WebCal 增量刷新；
- Logo / 图片缓存效果。

目标原则：

- 空闲状态接近无 CPU 活动；
- 不采用高频定时轮询；
- 月视图切换应感知即时；
- 大量事件不应阻塞 UI 线程。

---

## 16. 可访问性

最低要求：

- 键盘可访问主要控件；
- 明确 focus 状态；
- selected / hover / focus 区分；
- 颜色不是唯一状态表达；
- Logo / 队徽有可访问名称；
- 背景图片不影响文字对比度；
- 支持系统缩放的基本可用性。

---

## 17. 测试策略

### 单元测试优先

重点覆盖：

- ICS parser；
- date / timezone；
- recurrence；
- UID 去重；
- Normalizer；
- Matcher；
- 节假日；
- 节气；
- 提醒时间计算。

### 集成测试

至少覆盖：

```text
ICS → Normalize → Match → Persist → Calendar View
```

以及：

```text
WebCal refresh → dedupe → update → reschedule notification
```

### UI 验收

对照 [ui-design.md](ui-design.md) 的 v0.1 验收清单。

---

## 18. 资源与版权

球队徽标、联赛 Logo、体育赛程数据需要与业务代码分离。

正式分发前必须确认：

- Logo / 商标使用策略；
- 数据来源许可；
- 第三方图片许可；
- 应用 License。

开发阶段不得因为方便而把来源不明资产当作可发布资源。

---

## 19. v0.1 垂直切片

优先完成一条完整链路：

```text
启动桌面应用
→ 月视图可用
→ 导入 ICS
→ 事件落库
→ Matcher 识别英超比赛
→ 月格显示队徽 VS 队徽
→ 点击显示比赛 Inspector
→ 设置赛前提醒
→ 收到本地通知
```

完成这条链路后，再扩大中国日历、WebCal、性能和其他边界。

---

## 20. 发布门槛

v0.1 Release Candidate 必须满足：

- [ ] Windows 安装 / 启动 / 卸载可用
- [ ] 月视图基础体验稳定
- [ ] 浅色 / 深色主题可用
- [ ] 本地 ICS 导入可靠
- [ ] WebCal 基础订阅可用
- [ ] 时区 / 全天 / 常见 recurrence 有测试
- [ ] 中国法定节假日、调休、农历、节气可用
- [ ] 英超比赛识别与 UI 可用
- [ ] 关注球队可持久化
- [ ] 本地通知可用且不会明显重复
- [ ] 网络失败有降级
- [ ] 性能基线已记录
- [ ] 核心自动化测试通过
- [ ] 第三方资产 / 数据来源完成发布前审查
- [ ] README 与真实实现同步

---

## 21. 需求变更规则

任何新增需求先判断：

1. 是否影响“日历本身可靠”；
2. 是否属于 v0.1；
3. 是否应该进入 Provider / Matcher，而不是 UI；
4. 是否引入后台常驻成本；
5. 是否破坏本地优先；
6. 是否已有更简单的确定性方案。

如果需求会扩大范围，但不帮助完成 v0.1 垂直切片，应默认延期到后续版本。
