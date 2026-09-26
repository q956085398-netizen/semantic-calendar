# Triage 标签

各 skill 用五个规范化的 triage 角色说话。本文件把这些角色映射到本仓库 issue tracker 中实际使用的标签字符串。

| 规范角色 | 本仓库标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 维护者需要评估 |
| `needs-info` | `needs-info` | 等待报告者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已完整说明，可以交给 AFK agent |
| `ready-for-human` | `ready-for-human` | 需要人工实现 |
| `wontfix` | `wontfix` | 不予处理 |

当某个 skill 提到一个角色（例如「打上 AFK-ready 的 triage 标签」），使用本表右列对应的标签字符串。

两个**分类**角色沿用 GitHub 默认标签，无需新建：`bug`、`enhancement`。每个分诊完成的 Issue 应同时带一个分类角色和一个状态角色。

## 现状

本仓库当前只有 GitHub 默认标签，五个状态标签尚未创建；`/triage` 首次使用时创建它们。若要改用既有标签名，直接编辑上表右列。
