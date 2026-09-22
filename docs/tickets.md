# Semantic Calendar v0.1 Tickets

> 本文是 v0.1 的可执行工作清单。  
> GitHub Epic：[#1 Semantic Calendar v0.1](https://github.com/q956085398-netizen/semantic-calendar/issues/1)  
> 产品规格：[app-spec.md](app-spec.md)  
> UI 规格：[ui-design.md](ui-design.md)

---

## 1. 工作方式

### 优先级

- **P0**：完成第一条可运行垂直切片所必需。
- **P1**：v0.1 发布前必须完成，但可以在 P0 骨架稳定后推进。
- 后续版本需求不要混入 v0.1 Ticket。

### Ticket 完成定义

一个 Ticket 只有在以下条件满足时才算完成：

1. 验收项全部通过；
2. 相关测试已增加或明确说明为什么不需要；
3. 文档与实现一致；
4. 没有把临时业务判断塞进 UI；
5. 没有引入无法解释的常驻后台轮询；
6. 代码可以独立 Review 和回滚。

---

## 2. P0 — 垂直切片

| ID | Issue | 内容 | 主要依赖 |
| --- | --- | --- | --- |
| SC-001 | [#2](https://github.com/q956085398-netizen/semantic-calendar/issues/2) | Tauri + React + TypeScript 工作区 | — |
| SC-002 | [#3](https://github.com/q956085398-netizen/semantic-calendar/issues/3) | 桌面窗口、托盘、生命周期 | SC-001 |
| SC-003 | [#4](https://github.com/q956085398-netizen/semantic-calendar/issues/4) | 统一事件模型与本地持久化 | SC-001 |
| SC-004 | [#5](https://github.com/q956085398-netizen/semantic-calendar/issues/5) | 三栏月视图与明暗主题 | SC-001 |
| SC-005 | [#6](https://github.com/q956085398-netizen/semantic-calendar/issues/6) | 月份导航、日期选择、Inspector | SC-004 |
| SC-006 | [#7](https://github.com/q956085398-netizen/semantic-calendar/issues/7) | 本地 ICS 导入与解析 | SC-003 |
| SC-007 | [#8](https://github.com/q956085398-netizen/semantic-calendar/issues/8) | ICS/WebCal 订阅、刷新、缓存 | SC-003, SC-006 |
| SC-008 | [#9](https://github.com/q956085398-netizen/semantic-calendar/issues/9) | Normalizer、时区、全天、recurrence、去重 | SC-003, SC-006 |
| SC-009 | [#10](https://github.com/q956085398-netizen/semantic-calendar/issues/10) | Matcher Engine + Metadata Resolver | SC-008 |

### P0 Exit Criteria

P0 结束时，必须存在一条真实链路：

```text
启动应用
→ 月视图
→ 导入 ICS
→ 事件落库
→ 事件标准化
→ Matcher 执行
→ UI 显示普通或增强事件
→ 点击日期进入 Inspector
```

即使中国日历和英超数据尚未完整，架构链路必须已经真实运行。

---

## 3. P1 — 中国日历

| ID | Issue | 内容 | 主要依赖 |
| --- | --- | --- | --- |
| SC-010 | [#11](https://github.com/q956085398-netizen/semantic-calendar/issues/11) | 农历计算与月格显示 | SC-005 |
| SC-011 | [#12](https://github.com/q956085398-netizen/semantic-calendar/issues/12) | 法定节假日、连休、补班 Provider | SC-009 |
| SC-012 | [#13](https://github.com/q956085398-netizen/semantic-calendar/issues/13) | 传统节日与二十四节气 Provider | SC-009, SC-010 |
| SC-013 | [#14](https://github.com/q956085398-netizen/semantic-calendar/issues/14) | 语义日期格渲染与冲突规则 | SC-004, SC-011, SC-012 |

### 中国日历 Exit Criteria

- 农历日期正确；
- 国庆连续假期形成连续视觉；
- 休假使用大“休”，不重复显示小标签；
- 补班使用蓝色语义 + 大“补”；
- 中秋、寒露、霜降等可在月格和 Inspector 中表达；
- 同日多语义遵循 UI Spec 的冲突规则。

---

## 4. P1 — 英超语义增强

| ID | Issue | 内容 | 主要依赖 |
| --- | --- | --- | --- |
| SC-014 | [#15](https://github.com/q956085398-netizen/semantic-calendar/issues/15) | 英超球队 / 联赛元数据 Provider | SC-009 |
| SC-015 | [#16](https://github.com/q956085398-netizen/semantic-calendar/issues/16) | 比赛标题 Matcher 与主客队识别 | SC-009, SC-014 |
| SC-016 | [#17](https://github.com/q956085398-netizen/semantic-calendar/issues/17) | 关注球队、比赛月格、Matchday Inspector | SC-005, SC-013, SC-015 |

### 英超 Exit Criteria

真实或测试 ICS：

```text
Arsenal vs Manchester City
```

应能够：

1. 识别为英超比赛；
2. 识别两队；
3. 月格显示队标 VS 队标；
4. 显示受控的联赛背景；
5. 点击后打开 Matchday Inspector；
6. 显示开赛时间等可用数据；
7. 关注球队设置可持久化。

---

## 5. P1 — 提醒、设置与可靠性

| ID | Issue | 内容 | 主要依赖 |
| --- | --- | --- | --- |
| SC-017 | [#18](https://github.com/q956085398-netizen/semantic-calendar/issues/18) | 本地通知与提醒调度器 | SC-003, SC-008 |
| SC-018 | [#19](https://github.com/q956085398-netizen/semantic-calendar/issues/19) | 数据源、主题、球队、通知设置 | SC-004, SC-007, SC-016, SC-017 |
| SC-019 | [#20](https://github.com/q956085398-netizen/semantic-calendar/issues/20) | 错误处理、离线降级、可解释状态 | SC-006, SC-007, SC-009 |

### 可靠性 Exit Criteria

- 网络断开时仍能查看缓存；
- WebCal 刷新失败不会删除旧事件；
- Matcher 失败回退普通事件；
- Logo 缺失不会破坏 UI；
- 通知权限不可用时有明确状态；
- 日志不泄露完整事件正文或 URL token。

---

## 6. P1 — 性能、QA 与发布

| ID | Issue | 内容 | 主要依赖 |
| --- | --- | --- | --- |
| SC-020 | [#21](https://github.com/q956085398-netizen/semantic-calendar/issues/21) | 性能基线、缓存、后台唤醒 | SC-002, SC-003, SC-007 |
| SC-021 | [#22](https://github.com/q956085398-netizen/semantic-calendar/issues/22) | 核心单测、集成测试、UI 验收 | 全程 |
| SC-022 | [#23](https://github.com/q956085398-netizen/semantic-calendar/issues/23) | Windows 打包、图标、License、资产审查 | 其余 v0.1 Ticket |

### Release Exit Criteria

必须满足 [app-spec.md](app-spec.md) §20 的发布门槛。

---

## 7. 推荐 Sprint / 批次

这不是时间承诺，只表示依赖关系和最佳施工顺序。

### Batch A — 可启动

- SC-001
- SC-002
- SC-004

结果：有一个真实桌面壳和正式 UI 骨架。

### Batch B — 日历数据基础

- SC-003
- SC-005
- SC-006
- SC-008

结果：本地 ICS 能进入月视图。

### Batch C — 语义框架

- SC-009
- SC-014
- SC-015

结果：一条英超比赛可以被结构化识别。

### Batch D — 产品特色

- SC-010
- SC-011
- SC-012
- SC-013
- SC-016

结果：中国日历与英超视觉体验达到 UI Spec。

### Batch E — 常驻可用

- SC-007
- SC-017
- SC-018
- SC-019

结果：网络订阅、提醒、设置、离线行为完整。

### Batch F — RC

- SC-020
- SC-021
- SC-022

结果：性能、测试、资产与 Windows 发布就绪。

---

## 8. 关键路径

最短核心路径：

```text
SC-001
→ SC-003
→ SC-006
→ SC-008
→ SC-009
→ SC-014
→ SC-015
→ SC-016
→ SC-017
→ SC-021
→ SC-022
```

UI 路径：

```text
SC-001
→ SC-004
→ SC-005
→ SC-013
→ SC-016
```

中国日历路径：

```text
SC-009
→ SC-010 / SC-011 / SC-012
→ SC-013
```

---

## 9. 不要提前做的工作

在 v0.1 Ticket 全部完成前，默认不要开以下工作：

- Google Calendar OAuth / Sync；
- Outlook / Microsoft 365；
- 完整 CalDAV；
- F1 / NBA / 多联赛；
- 插件市场；
- AI 事件分类；
- 云端账号；
- 协作日历；
- 移动端；
- Dashboard；
- Todo。

除非它们直接解决当前 Ticket 的阻塞问题。

---

## 10. 新 Ticket 规则

后续新增 Ticket 应包含：

```text
标题：
SC-XXX [P?][Area] 简短动作描述

Parent:
#1

目标：
为什么做

范围：
做什么 / 不做什么

验收：
- [ ] 可验证结果
- [ ] 测试要求
- [ ] 失败 / 降级行为

依赖：
SC-XXX

Spec：
docs/app-spec.md 对应章节
```

Ticket 应尽量保持为一个可独立 Review 的工作单元。
