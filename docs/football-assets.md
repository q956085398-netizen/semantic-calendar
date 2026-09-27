# 英超本地图标验证

2026-09-27：为当前 **2026/27** 赛季建立 20 队 + 1 联赛图标的可重复下载映射。
名单核对自[英超官方赛季阵容名单](https://www.premierleague.com/en/news/4706139/see-all-the-202627-premier-league-squad-lists)；保留 2025/26 名单与历史球队条目。

## 资源与关联

- 队徽：`luukhopman/football-logos` 的 2026/27 `logos/England - Premier League`，固定提交 `2a3978f0b4730645c205d855a4bda54c161183e9`，透明 PNG，139 × 181。
- 联赛：API-Sports 的 `https://media.api-sports.io/football/leagues/39.png`，150 × 150 透明狮标。没有采用 football-data.org 的 `PL.png`，因为该图含完整文字，作为月格水印会干扰正文。
- 映射位于 `apps/desktop/tools/premier-league-assets.json`；键直接使用领域球队稳定 ID，文件名逐个核对，不使用运行时模糊匹配。
- 图片来源可访问不等于取得再分发权。当前为用户本地验证包，许可状态记为未核实，不提交图片、不随安装包分发。使用条件见 [API-Football 条款](https://www.api-football.com/terms)；GitHub 图片包未提供可用于队徽再分发的许可证据。

## 下载与本机安装

在 `apps/desktop` 目录执行 PowerShell：

```powershell
$assetOutput = Join-Path $env:APPDATA 'com.semanticcalendar.desktop/store/football-assets.json'
node tools/download-football-assets.mjs --output $assetOutput
```

这是用户主动执行的下载，不会在应用启动、切换月份或重绘时联网。下载器有超时、有限重试、1 MiB 单图上限、PNG 签名及尺寸检查，记录来源、校验值与获取日期；21 张全部成功后才替换整包，失败保留旧包。

本地包是含 PNG data URL 的 JSON（约 810 KiB），由已有桌面文件读取接口加载。`App` 将同一个 `assets` 传给月视图和详情栏。解析只接受本地 PNG，不接受远程 URL 或 SVG；缺图显示球队缩写／联赛短标签，损坏包显示回退状态。不会修改日历快照。

新代码需要运行开发构建或重新构建桌面应用；旧安装版本没有资源包接线，仅放入文件不会使其显示图片。修改资源包后重启应用读取。

## 验证范围

- 在线下载 20 队 + 联赛图标；PNG 尺寸与哈希逐个记录。
- 实际浏览器渲染生产月格与详情组件，10 组明确标注的模拟对阵覆盖本赛季 20 队，不代表真实赛程。
- 明暗主题检查：全部图片解码成功；图片地址全部为本地 data URL；联赛背景的父格 `overflow: hidden`。
- 自动测试覆盖名单与资源映射一致、资源加载、缺失与损坏回退、更新地址后恢复图片、现有月格和详情栏行为。
- 未重新安装正式桌面版本；未接入自动后台同步、账户密钥配置或节日／节气背景。
