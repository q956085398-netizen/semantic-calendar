# 第三方组件、数据与资产清单（SC-022 / app-spec §18）

本文回答一个发布前必须回答的问题：**这个安装包里装的每一部分，来源是什么、按什么许可分发。**
app-spec §20 的发布门槛里「第三方资产 / 数据来源完成发布前审查」以本文为准；
`apps/desktop/src/packaging.test.ts` 会要求仓库里的每一类图片资产都能在本文找到记录。

口径：

- **本仓库原创**：由本仓库的代码或脚本生成，或由维护者截图，随 [LICENSE](../LICENSE)（MIT）分发。
- **第三方依赖**：通过 npm / Cargo 引入，保留其原始许可，不修改、不再分发源码副本。
- **第三方商标与媒体**：不随应用分发（见 §3、§4）。

---

## 1. 应用图标与图片资产

| 资产 | 来源 | 许可 |
| --- | --- | --- |
| `apps/desktop/src-tauri/app-icon.png` | 本仓库原创：由 `apps/desktop/tools/render-app-icon.mjs` 用纯几何形状 + 项目调色板确定性生成 | 随本仓库 MIT |
| `apps/desktop/src-tauri/app-icon.svg` | 同上（同一脚本输出的可读设计稿） | 随本仓库 MIT |
| `apps/desktop/src-tauri/icons/` | 由 `npm run icon` 从 `app-icon.png` 派生（Tauri CLI 生成各平台尺寸与 `.ico` / `.icns`；移动端图标集不保留，见 `tools/prune-mobile-icons.mjs`） | 随本仓库 MIT |
| `docs/examples/ui/acceptance-2026-09-25/` | 本仓库原创：SC-021 / SC-023 人工验收时对本地构建产物的整屏截图 | 随本仓库 MIT |
| `docs/examples/ui/release-2026-09-25/` | 本仓库原创：SC-022 安装包验收时对已安装应用的截图（窗口置顶后按窗口矩形抓屏，只含应用自己的窗口） | 随本仓库 MIT |
| `docs/examples/ui/light-theme-reference-v1.png`、`docs/examples/ui/dark-theme-reference-v1.png` | **设计参考图，来源未记录**（见下方「待处理」） | 不随应用分发 |

重跑图标生成：

```bash
npm run icon          # = node tools/render-app-icon.mjs && tauri icon src-tauri/app-icon.png && node tools/prune-mobile-icons.mjs
```

图标因此不存在「素材来自哪里」的问题——它是脚本的产物，脚本在仓库里，改动可 Review、可回滚。

> **待处理（公开发布前）**：`docs/examples/ui/*-theme-reference-v1.png` 是 v0.1 设计阶段的参考图，
> 画面里含第三方商标（英超狮标、俱乐部队徽）与来源不明的照片。它们只出现在 `docs/` 文档中、
> 不会进入应用包（`bundle` 的 icon 与 resources 都不引用 `docs/`），但按开发原则 §10
> 「不因为开发方便就把来源不明的图片提交到仓库」，公开分发或开源发布前应当：
> 用自有截图或自有素材重绘的图替换，或在发布分支中移除并在 `docs/ui-design.md` §视觉参考处改指文字描述。
> 这条是 SC-022 明确留下的已知项，不是遗漏。

应用不携带任何字体、音视频或压缩包资源：界面字体走系统字体栈
（`index.css` 的 `Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui`），
提醒声音由系统通知承担，打包脚本也不内嵌压缩包（`packaging.test.ts` 断言仓库里没有这类文件）。

---

## 2. 运行期依赖（npm / Cargo）

只列直接依赖；传递依赖的许可由锁文件保证（见 §5 的核对方式）。

| 依赖 | 用途 | 许可 |
| --- | --- | --- |
| `react` / `react-dom` | 界面渲染 | MIT |
| `@tauri-apps/api` | 前端调用 Tauri 命令 | MIT 或 Apache-2.0 |
| `tauri` / `tauri-build` / `@tauri-apps/cli` | 桌面壳、打包 | MIT 或 Apache-2.0 |
| `tauri-plugin-single-instance` | 单实例（SC-002） | MIT 或 Apache-2.0 |
| `tauri-plugin-notification` | 系统通知（SC-017） | MIT 或 Apache-2.0 |
| `reqwest`（`default-features = false` + `native-tls`） | WebCal 抓取（SC-007） | MIT 或 Apache-2.0 |
| `serde` / `serde_json` | 命令与快照序列化 | MIT 或 Apache-2.0 |
| `vite` / `vitest` / `typescript` / `eslint` / `prettier` 等 | 仅开发期，不进安装包 | 各自 MIT（`@vitejs/*` 部分为 MIT） |

「MIT 或 Apache-2.0」是这些项目自身的双许可表述，使用时按 MIT 处理即可，
两种许可都与本仓库的 MIT 兼容。

---

## 3. 球队徽标、联赛 Logo 与商标（使用策略）

**v0.1 的决定：不随应用分发任何球队徽标或联赛 Logo 二进制。**

理由与做法：

- 英超狮标、「Premier League」名称、俱乐部队徽与名称是各自权利人的商标，
  代码仓库不是它们的许可分发渠道；
- 语义层与展示层因此分离（架构 §5 / `semantic/marks.ts`）：元数据只保存**逻辑引用**
  （如 `team.arsenal`、`competition.premier-league`），展示由资源包解析；
- 资源包缺失、未收录该引用、甚至资源包自身抛错时，一律确定性降级为 fallback
  （球队 3 字母代码 / 联赛短标签 + 主题色），因此**徽标缺失不会破坏界面**；
- 球队名称、所在城市、球队色属于事实性数据，可以在界面里作为文字出现；
  颜色是用于低透明度背景的近似值，不是官方色值。

如果将来接入第三方徽标资源包（现状：v0.1 不接入），接入动作必须同时满足：

1. 在本文登记资源名称、版本、来源地址、许可与取得日期；
2. 许可必须允许「随桌面应用分发」这一用途，且不要求应用整体换许可；
3. 资源包不进本仓库，由使用者自行放置（仓库继续只保存逻辑引用与解析规则）；
4. 保留 resource pack 缺失时的 fallback 路径——UI 不能因为少一张图而不可用。

---

## 4. 数据来源

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| 农历 1901–2099 | 香港天文台「公曆與農曆日期對照表」年表文本 | 政府公开资料；仓库只保存由 `tools/derive-lunar-table.mjs` 推导出的换算表，原始文本不随仓库分发（见该脚本头部注释） |
| 二十四节气 | 按天文算法推导（`tools/derive-solar-terms.mjs`），并与公开日期对照校验 | 算法与校验脚本在仓库内；不引入第三方数据包 |
| 中国传统节日 | 农历固定日期规则（`providers/china/festivals.ts`） | 规则而非数据表：春节、元宵、清明、端午、中秋等按农历日期定义 |
| 法定节假日与补班 | 国务院办公厅每年发布的节假日安排通知 | 仓库只登记通知里的日期、文号、发布日期与来源地址（`providers/china/holidays*.ts` 的 `versions`），不复制通知正文；未登记年份安静地不显示，不推算 |
| 英超球队 / 赛季名单 / 联赛元数据 | 公开赛程与名单整理（`providers/football/`） | 只保存名称、别名、代码、近似色与赛季名单等事实性数据；不含徽标与图片 |
| 用户自己的日历 | 用户导入的 ICS 文件或订阅地址 | 属于用户数据，保存在本机应用数据目录，不上传（app-spec §14） |

数据边界（已在 README 与各 Ticket 的「边界」一段写明，这里汇总）：赛季名单是维护动作，
`latestSeason()` 表示「已登记名单里最新的一季」；节假日数据覆盖 2024–2026，2027 年安排发布前不登记。

---

## 5. 复核方式

发布前按下面三条核对本文是否仍然成立：

```bash
npm run test -- packaging.test.ts          # 资产清单、图标、名称、版本、License 的一致性
git ls-files | grep -iE '\.(png|jpe?g|ico|icns|svg|ttf|woff2?|mp[34]|pdf|zip)$'   # 仓库里的二进制资产
cargo tree --prefix none                                   # 直接与传递依赖（在 apps/desktop/src-tauri 下运行）
```

- 新增图片 / 字体 / 音视频资产时：先在本文登记（或说明为什么不需要），再提交。
  `packaging.test.ts` 守住三条：仓库里出现的图片文件必须落在本文列出的位置里；
  `icons/` 目录只允许 `tauri icon` 会产出的那些文件名（闭集，多一个都不行）；
  `docs/examples/ui/` 下每一个目录或文件的名字都要在本文里出现（换一次验收记录就要登记一次）。
- 升级依赖时：确认仍然只有 MIT / Apache-2.0 一类宽松许可；若引入 GPL/AGPL 系依赖，
  需要先确认它与本仓库 MIT 的兼容性，并在这里记录结论。
