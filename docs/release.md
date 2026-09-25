# v0.1 发布门槛与 Windows 安装包验收（SC-022）

> [app-spec.md](app-spec.md) §20 的逐项检查、Windows 安装 / 启动 / 卸载的人工验收记录，
> 以及 v0.1 的升级策略。资产与许可见 [third-party-assets.md](third-party-assets.md)，
> UI 逐项验收见 [ui-acceptance.md](ui-acceptance.md)，性能见 [performance.md](performance.md)。

## 1. 交付物

| 产物 | 路径（构建产出，不随仓库分发） | 说明 |
| --- | --- | --- |
| NSIS 安装包 | `apps/desktop/src-tauri/target/release/bundle/nsis/Semantic Calendar_0.1.0_x64-setup.exe` | 约 2.43 MB；当前用户安装，不需要管理员。NSIS 产物含构建时间戳，两次构建的字节数会有小幅差异（2,427,644 / 2,427,719），因此这里记量级而不是指纹 |
| 可执行文件 | `apps/desktop/src-tauri/target/release/semantic-calendar.exe` | 10,706,432 字节；前端资源已内嵌 |
| 前端资源 | `apps/desktop/dist/` | 由 `beforeBuildCommand` 生成后打进可执行文件 |
| 图标源 | `apps/desktop/src-tauri/app-icon.svg`、`app-icon.png` | 由 `tools/render-app-icon.mjs` 生成（原创资产） |
| 应用图标集 | `apps/desktop/src-tauri/icons/` | 由 `npm run icon` 从图标源派生 |

构建命令：

```bash
npm run tauri build        # 仓库根目录；Windows 上产出 NSIS 安装包
```

## 2. app-spec §20 逐项检查

| 门槛项 | 证据 | 结果 |
| --- | --- | --- |
| Windows 安装 / 启动 / 卸载可用 | 本文 §3（实机验收记录 + 截图） | 通过 |
| 月视图基础体验稳定 | [ui-acceptance.md](ui-acceptance.md) §4 第 1–6、14–16 项；`calendar/MonthView.test.tsx`、`calendar/month-grid.test.ts` | 通过 |
| 浅色 / 深色主题可用 | ui-acceptance.md §4 第 17–18 项（浅色 / 深色各一遍）；`theme/theme.test.ts` | 通过 |
| 本地 ICS 导入可靠 | `ics/parse-ics.test.ts`、`data/import/import-local-ics.test.ts`；ui-acceptance.md §4 第 7–8 项 | 通过 |
| WebCal 基础订阅可用 | `data/webcal/webcal-refresh.test.ts`、`data/webcal/refresh-scheduler.test.ts` | 通过 |
| 时区 / 全天 / 常见 recurrence 有测试 | `normalize/timezone.test.ts`、`normalize/rrule.test.ts`、`normalize/occurrences.test.ts`、`normalize/normalizer.test.ts` | 通过 |
| 中国法定节假日、调休、农历、节气可用 | `providers/china/holidays.test.ts`、`lunar.test.ts`、`solar-terms.test.ts`、`festivals.test.ts`；ui-acceptance.md §4 第 9–13 项 | 通过 |
| 英超比赛识别与 UI 可用 | `providers/football/football-matcher.test.ts`、`football-metadata-resolver.test.ts`、`calendar/MatchCell.tsx` 相关用例（ui-acceptance.md §4 第 12 项，SC-023 修复后复检通过） | 通过 |
| 关注球队可持久化 | `providers/football/followed-teams.test.ts`、`App.test.tsx` 的「关注球队」一组 | 通过 |
| 本地通知可用且不会明显重复 | `notifications/reminder-plan.test.ts`、`notification-scheduler.test.ts`、`fired-reminders.test.ts` | 通过 |
| 网络失败有降级 | `data/webcal/webcal-refresh.test.ts`（失败保留旧事件）、`reliability/redact.test.ts`（日志脱敏）、`App.test.tsx` 的「错误降级与可解释状态（SC-019 / app-spec §13–14）」一组 | 通过 |
| 性能基线已记录 | [performance.md](performance.md)：冷启动中位 282 ms、空闲 CPU 0.0–0.1%、10,000 条月切换 152 ms 等 | 通过 |
| 核心自动化测试通过 | `npm test`：80 个测试文件 / 911 条用例全绿（2026-09-25；其中 4 个文件、30 条用例来自 SC-020 的读取路径分片、提醒计划分片与事件集合版本号，另有 4 个文件、38 条用例来自 SC-024 的导入链路分片，1 个文件、8 条用例来自 SC-022 的发布文档守卫，2 条用例来自 SC-021 的默认窗口尺寸契约（`layout/window-size-contract.test.ts` 新增的两条），5 条用例来自 SC-010 的新文件 `calendar/lunar-cell-fit-contract.test.ts`、另有 1 条公众日历样例加在既有的 `providers/china/lunar.test.ts` 里，4 条用例来自 SC-011 的通知口径样例（加在既有的 `providers/china/holidays.test.ts` 里，同文件另有 1 条没有判据的修订号断言被换成版本清单锁定，1 换 1）——前面几批同样含既有测试文件里新增的用例） | 通过 |
| 第三方资产 / 数据来源完成发布前审查 | [third-party-assets.md](third-party-assets.md)（含一条留待公开分发前处理的参考图问题） | 通过（带已知项） |
| README 与真实实现同步 | README「MVP：v0.1」的功能清单逐条对应到 Ticket、「关键实现位置」按模块给出文件与边界、「开发环境」给出可复制命令；跨文件的引用与命令由 `release-docs.test.ts` 守住（见 §7） | 通过 |

## 3. Windows 安装 / 启动 / 卸载验收

验收环境：

| 项 | 取值 |
| --- | --- |
| 日期 | 2026-09-25 |
| 系统 | Windows 11 专业版 10.0.26200，64 位 |
| 工具链 | Node v25.2.1、rustc 1.98.1、tauri-cli 2.11.5 |
| 安装包 | `Semantic Calendar_0.1.0_x64-setup.exe`。安装 / 启动 / 卸载按下面的步骤跑了完整两遍：第一遍用的是评审前的构建产物，第二遍用的是评审修改后的产物（同时补拍窗口截图）；之后图标流水线只做了「清掉移动端图标集」这一处收敛，Windows 侧用到的 `.ico` 与 PNG 未变 |
| 方式 | 安装 / 卸载走静默参数（`/S`），启动后取进程与主窗口，再关闭进程 |

逐步记录：

| 步骤 | 命令 / 观察点 | 观察结果 |
| --- | --- | --- |
| 安装前 | 安装目录、卸载注册表项、开始菜单与桌面快捷方式 | 均不存在（干净环境） |
| 安装 | `"Semantic Calendar_0.1.0_x64-setup.exe" /S` | 退出码 0；`%LOCALAPPDATA%\Semantic Calendar\` 出现 `semantic-calendar.exe`（10,706,432 字节，两次构建相同）与 `uninstall.exe`（约 82 KB） |
| 安装后 | 卸载项 | `HKCU\...\Uninstall\Semantic Calendar`：DisplayName「Semantic Calendar」、DisplayVersion 0.1.0、Publisher「Semantic Calendar contributors」、InstallLocation、UninstallString、DisplayIcon 均正确 |
| 安装后 | 快捷方式 | 开始菜单与桌面各一个 `Semantic Calendar.lnk`（英文名，符合名称策略） |
| 启动 | 主窗口标题 | 「语义日历」；工作集 20.8 MB；窗口外框 2089×1394 物理像素（系统 DPI 168 / 175%，即 1194×797 逻辑像素——配置的 1180×760 内容区加边框） |
| 启动 | 界面 | 三栏月视图完整渲染：侧栏（数据源、导入 / 订阅入口、设置）、月格（农历、9 月 7 日「白露」、9 月 23 日「秋分」、中秋节假期与「休」「补」）、详情栏（9 月 25 日 · 农历八月十五 · 中秋节），见 `docs/examples/ui/release-2026-09-25/installed-app-launch.png`（窗口置顶后按窗口矩形抓屏，含标题栏） |
| 启动 | 应用数据 | 读取既有快照并更新 `app.lastOpenedAt`（写入成功，说明 store 路径与权限正常） |
| 卸载 | `"uninstall.exe" /S` | 安装目录、卸载注册表项、开始菜单与桌面快捷方式全部清除，无残留进程 |
| 卸载 | 用户数据 | `%APPDATA%\com.semanticcalendar.desktop\store\calendar-store.json` 保留——卸载不删除用户数据（与「数据源启停不删除用户数据」同一条原则） |

未覆盖的部分，如实记录：

- **安装器界面本身**只验证到「出现了 NSIS 的语言选择对话框」这一步。语言选择页之后的安装向导页面
  （License 页、安装位置页）需要人工点选，本次没有自动截图（`PrintWindow` 抓不到 NSIS 自绘控件的内容）。
  静默安装走的是同一条安装逻辑，产物与注册表结果已在上面逐项核对。
- **托盘交互**（左键恢复、右键菜单退出）仍需人工点击，SC-002 已记录过该限制。

## 4. 名称、版本与图标

三个名字各自只出现在约定的场合。前端源码里中文名只有 `apps/desktop/src/settings/app-info.ts` 一处字面量，其余 TS / TSX 都引用这个常量（`packaging.test.ts` 会挡住又抄一份的写法）；窗口标题、`index.html` 标题与 托盘提示在 JSON / HTML / Rust 里，由同一条测试分别断言：

| 名字 | 场合 |
| --- | --- |
| 语义日历 | 窗口标题、侧栏品牌、托盘提示、`index.html` 标题（浏览器预览）、通知权限被拒时的说明文案 |
| Semantic Calendar | 安装包文件名、安装目录、开始菜单与桌面快捷方式、卸载项、文件属性与安装器属性 |
| semantic-calendar.exe | 可执行文件名（来自 Cargo 包名，保持 ASCII，脚本与日志引用它） |

版本号只有一个来源（`apps/desktop/package.json`），构建时注入界面，其余三处由测试要求一致：

| 位置 | 取值 | 证据 |
| --- | --- | --- |
| `package.json`（仓库根与 `apps/desktop`） | 0.1.0 | `packaging.test.ts` |
| `src-tauri/Cargo.toml` | 0.1.0 | 同上 |
| `src-tauri/tauri.conf.json` | 0.1.0 | 同上 |
| 可执行文件 VERSIONINFO | FileVersion / ProductVersion 0.1.0，ProductName「Semantic Calendar」，CompanyName「Semantic Calendar contributors」，LegalCopyright 与 LICENSE 一致 | 见下 |

```powershell
(Get-Item 'apps\desktop\src-tauri\target\release\semantic-calendar.exe').VersionInfo
```

图标：`app-icon.svg` / `app-icon.png` 由 `tools/render-app-icon.mjs` 用项目调色板画出（页眉 + 六格月历，
其中一格是语义 accent），`npm run icon` 再派生各平台尺寸与 `.ico` / `.icns`（移动端图标集由
`tools/prune-mobile-icons.mjs` 清掉——本仓库只做桌面端）。重跑是稳定的：PNG 与 `.ico` 逐字节相同（脚本确定性生成），`icon.icns` 由 Tauri CLI 生成、两次的字节可能不同（Windows 打包不使用它，换图标时一起提交即可）。图标因此是可 Review、可回滚的
构建产物，不是来源不明的素材；16–128px 的清晰度可用脚本的 `--preview` 对照图复核。

设置的「关于」一节把名称、版本与 License 摆在用户能看到的地方（README 的「关键实现位置」有接线说明）。

> 通知的系统来源名由 Windows 决定（取自安装后的产品名 `Semantic Calendar`，不是应用内文案），
> 因此部署后看到的是英文名——这也符合「系统集成用英文名」的策略。

## 5. 升级策略（v0.1 的预留）

v0.1 **不做自动更新**，策略明确如下：

- **就地升级**：同一个 `identifier` 与同一个安装器 → 再次运行新版安装包即覆盖安装，
  不需要先卸载。用户数据在 `%APPDATA%`，不随安装目录一起被动。
- **不允许降级**：`bundle.windows.allowDowngrades = false`。快照只有向前迁移
  （`data/store/migrations.ts` 按 `schemaVersion` 顺序推进），旧版读新版数据没有保证，
  因此宁可挡住降级也不要让用户装回旧版之后看到一个读不动的快照。
- **不产出自动更新工件**：`bundle.createUpdaterArtifacts = false`。v0.1 的升级方式是
  「下载新安装包再跑一次」。将来要接自动更新，需要的是：签名密钥与公钥进配置、
  提供 manifest 端点、加 `tauri-plugin-updater`，以及一条「升级后快照仍可读」的回归——
  这些都不在本单范围，但配置项已经显式写死，不会被误当成默认值。
- **只产出 NSIS**：`bundle.targets = ["nsis"]`。v0.1 的 Windows RC 只分发一个安装包，
  避免出现「两个产物里有一个没人验收」；企业分发需要 MSI 时再单独开单（改回
  `["nsis", "msi"]` 即可）。
- **卸载保留用户数据**：见 §3 最后一行。

## 6. 已知限制与待处理

| 项 | 说明 | 处理 |
| --- | --- | --- |
| 安装包未签名 | 没有代码签名证书，Windows 会显示「未知发布者」，SmartScreen 可能拦一次 | 自用 / 内部验收可接受；公开分发前需要签名证书 |
| WebView2 依赖 | `webviewInstallMode` 为默认的 `downloadBootstrapper`：系统缺少 WebView2 时，安装过程需要联网下载 | 保持默认；离线分发包（内嵌固定版本）不在 v0.1 范围 |
| 设计参考图来源未记录 | `docs/examples/ui/*-theme-reference-v1.png` 含第三方商标与来源不明的照片 | 已登记在 [third-party-assets.md](third-party-assets.md) §1 的「待处理」：公开分发前替换或移除 |
| 照片型节日 / 节气背景 | 仓库不分发图片资源，专属背景只具备能力、默认走文字降级 | 资源接入需要先有许可（同上一行的口径） |
| 球队徽标 / 联赛 Logo | 策略为不随应用分发，界面用 3 字母代码 / 联赛短标签兜底 | [third-party-assets.md](third-party-assets.md) §3 |
| 安装器自身文件属性缺 CompanyName | Tauri NSIS 模板行为；安装包元数据、卸载项与可执行文件属性里的发布者都正确 | 记录备查，不为此引入自定义模板 |
| 安装向导页面未逐页人工验收 | 见 §3「未覆盖的部分」 | 静默安装覆盖同一条逻辑；需要逐页截图时人工跑一次 |

## 7. 怎么重跑这些检查

```bash
# 1. 回归与守卫（打包配置、名称、版本、License、资产清单、发布文档引用都在这条里）
npm test

# 2. 静态检查
npm run lint && npm run format && npm run build

# 3. 图标（改了图标源之后再跑；会自动重新生成 app-icon.svg / .png 与 icons/）
npm run icon

# 4. 安装包
npm run tauri build
# 产物：apps/desktop/src-tauri/target/release/bundle/nsis/

# 5. 实机装一遍（静默；先确认干净环境，装完记得卸载）
#    "%LOCALAPPDATA%\Semantic Calendar\uninstall.exe" /S
```

§2 的每条门槛项都指向具体的测试文件或人工记录；改动任一领域后，先让对应的那一行重新变绿，
再按 §7 的顺序跑一遍。

> 文档与实现的一致性也在这条链上：`apps/desktop/src/release-docs.test.ts` 要求 README 与
> docs/ 里引用的测试文件、用例名、相对链接、`npm run` 命令与 `SC-0NN` 编号都真实存在，
> 且 `docs/tickets.md` 里的每个 Ticket 都能在 README 的「MVP：v0.1」清单里找到落点。
> 改名字、拆文件、调脚本时漏改一半，它会红——发布门槛里「README 与真实实现一致」这一行
> 因此不靠人记得。
