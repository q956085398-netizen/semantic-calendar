# Issue tracker：GitHub

本仓库的 Issue 与 Spec 都存放在 GitHub Issues 中。所有操作使用 `gh` CLI。

仓库：`q956085398-netizen/semantic-calendar`。在仓库内运行时 `gh` 会自动识别 remote，无需显式指定。

## 常用操作

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行 body 使用 heredoc。
- **读取 Issue**：`gh issue view <number> --comments`；需要标签或状态时加 `--json number,title,body,labels,state`。
- **列出 Issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合 `--label` / `--state` 过滤。
- **评论**：`gh issue comment <number> --body "..."`
- **加 / 去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

写入 Issue 的正文与评论使用中文，与本仓库既有文档一致。

## 本仓库的 Ticket 约定

以下约定来自 [docs/tickets.md](../tickets.md)，新建 Ticket 时必须遵守。

- **标题格式**：`SC-XXX [P?][Area] 简短动作描述`。
  例：`SC-022 [P1][Release] Windows 打包、应用图标、License 与第三方资产审查`。
- **ID 分配**：`SC-XXX` 连续递增，与 Issue 编号无关（SC-001 → #2，SC-022 → #23）。
  新 Ticket 取 `docs/tickets.md` 中最大的 SC 编号 + 1，并同步登记到该文件对应章节的表格。
- **父级**：v0.1 的所有 Ticket 都挂在 Epic [#1](https://github.com/q956085398-netizen/semantic-calendar/issues/1) 之下。
- **正文段落**：标题 / Parent / 目标 / 范围 / 验收 / 依赖 / Spec。
- **优先级**：P0 是完成垂直切片所必需；P1 是 v0.1 发布前必须完成。
- **完成定义**：见 `docs/tickets.md` §1，共 6 条，含「测试已增加或明确说明为什么不需要」「文档与实现一致」。
- **不要提前开工**：`docs/tickets.md` §9 列出的范围（Google OAuth 同步、CalDAV、AI 分类、插件市场等）在 v0.1 全部完成前默认不开工。

Ticket 应尽量保持为一个可独立 Review 的工作单元。

## PR 作为请求入口

**PR 作为请求入口：否。**（若本仓库开始把外部 PR 当作功能请求，把这里改成「是」，`/triage` 会读取该标记。）

设为「是」时，PR 与 Issue 走同一套标签与状态，改用 `gh pr` 等价命令：

- **读取 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待分诊的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，只保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR`、`NONE` 的条目。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`。

GitHub 的 Issue 与 PR 共用编号空间，裸写 `#42` 两种都可能：先 `gh pr view 42`，失败再 `gh issue view 42`。

## 当 skill 要求「发布到 issue tracker」

创建一个 GitHub Issue。

## 当 skill 要求「获取对应 ticket」

`gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用：**map** 是一个 Issue，**child** 是挂在它下面的 ticket。

- **Map**：单个 Issue，打 `wayfinder:map` 标签，正文放 Notes / Decisions-so-far / Fog。
  `gh issue create --label wayfinder:map`。
- **Child ticket**：作为 map 的 GitHub sub-issue 关联（`gh api` 的 sub-issues 接口）。若未开启 sub-issue，则把 child 加进 map 正文的任务列表，并在 child 正文顶部写 `Part of #<map>`。标签用 `wayfinder:<type>`（`research` / `prototype` / `grilling` / `task`）。被认领后指派给推进者。
- **阻塞**：优先使用 GitHub 原生 issue dependencies。用
  `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`
  添加边，其中 `<blocker-db-id>` 是阻塞 Issue 的数字**数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，不是 `#number`，也不是 `node_id`）。GitHub 用 `issue_dependencies_summary.blocked_by` 报告未关闭的阻塞，这是真实的门。接口不可用时退化为在 child 正文顶部写 `Blocked by: #<n>, #<n>`。所有阻塞关闭后 ticket 才解锁。
- **Frontier 查询**：列出 map 下未关闭的 child，剔除仍有未关闭阻塞或已有 assignee 的，取 map 顺序中的第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本会话的第一次写入。
- **解决**：`gh issue comment <n> --body "<答案>"`，然后 `gh issue close <n>`，再把上下文指针追加到 map 的 Decisions-so-far。
