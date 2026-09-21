# 架构草案

> 本文描述的是当前阶段的架构方向，不是不可修改的最终设计。

## 总体原则

Semantic Calendar 采用“数据输入 → 标准化 → 语义识别 → 元数据解析 → 展示”的分层方式。

```text
Calendar Sources
      │
      ▼
Source Adapters
      │
      ▼
Event Normalizer
      │
      ▼
Matcher Engine
      │
      ▼
Semantic Event
      │
      ▼
Metadata Resolver
      │
      ▼
Calendar View / Notifications
```

每一层尽量只负责一类问题。

---

## 1. Calendar Sources

负责提供原始事件。

可能的数据源包括：

- 本地 ICS 文件
- ICS / WebCal URL
- 内置节假日数据
- 未来的 CalDAV
- 未来的 Google Calendar
- 未来的 Microsoft 365 / Outlook

数据源本身不应该承担 UI 逻辑。

---

## 2. Source Adapters

不同来源的数据格式不同，因此先转换为统一事件模型。

例如：

```ts
interface RawCalendarEvent {
  uid: string
  title: string
  description?: string
  location?: string
  start: Date
  end?: Date
  allDay: boolean
  sourceId: string
}
```

具体字段会在实现阶段调整。

---

## 3. Event Normalizer

Normalizer 做与领域无关的标准化，例如：

- 统一时间与时区
- 清理常见标题格式
- 标准化 Unicode
- 提取常见分隔符
- 处理全天事件
- 处理重复事件
- 保留原始字段

Normalizer 不应该知道“阿森纳是谁”或“春节是什么”。

---

## 4. Matcher Engine

Matcher 负责识别事件的语义类别。

例如：

```ts
interface EventMatcher {
  id: string
  priority: number
  match(event: NormalizedEvent): MatchResult | null
}
```

可能存在：

```text
matchers/
├── holidays/
├── festivals/
├── solar-terms/
└── football/
```

Matcher 输出语义，不直接决定 UI 长什么样。

例如：

```json
{
  "type": "sport.fixture",
  "sport": "football",
  "competition": "premier-league",
  "entities": [
    { "type": "team", "id": "arsenal" },
    { "type": "team", "id": "chelsea" }
  ]
}
```

---

## 5. Metadata Resolver

Metadata Resolver 根据语义信息解析展示所需数据。

例如：

- 球队徽标
- 联赛图标
- 节日图标
- 本地化名称
- 推荐颜色
- 默认提醒策略

这层和 Matcher 分离的原因是：

> “识别出这是阿森纳比赛”和“阿森纳徽标文件在哪里”是两个不同问题。

这样未来更换图标包、主题或语言时，不需要修改识别逻辑。

---

## 6. Calendar UI

UI 只消费统一后的事件和展示元数据。

UI 不应该包含类似：

```ts
if (title.includes("Arsenal")) ...
```

这类领域判断。

所有领域知识应该进入 Matcher 或 Provider。

---

## 7. Notifications

提醒系统和事件识别保持解耦。

事件可以提供默认提醒建议，例如：

```text
football match → 30 分钟前
holiday        → 当天早晨
festival       → 前一天
```

但最终应由用户设置覆盖。

---

## 建议目录

早期建议保持结构清晰，但不要过度拆包：

```text
semantic-calendar/
├── apps/
│   └── desktop/
├── packages/
│   ├── calendar-core/
│   ├── event-model/
│   ├── ics/
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
└── docs/
```

如果早期项目规模较小，可以先在单一 workspace 中实现，等模块边界稳定后再拆分。

---

## 技术方向

当前建议：

- Tauri：桌面壳和系统集成
- Rust：性能敏感、本地能力、通知、持久化或后台任务
- React + TypeScript：UI
- SQLite 或其他轻量本地存储：视原型结果决定

选择技术时优先考虑：

1. 空闲资源占用；
2. 调试和维护成本；
3. Windows 上的稳定性；
4. 跨平台能力；
5. 第三方生态成熟度；
6. 构建与发布复杂度。

不要因为“理论上更优雅”引入不必要的基础设施。
