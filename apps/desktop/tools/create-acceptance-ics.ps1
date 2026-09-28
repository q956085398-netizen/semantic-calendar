# 在验收前运行；仅生成专用测试日历，不读写应用数据。
param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\..\.scratch\acceptance'),
  [ValidateRange(16, 1440)][int]$MatchDelayMinutes = 16
)
$ErrorActionPreference = 'Stop'
$now = Get-Date
$id = [Guid]::NewGuid().ToString('N')
$ordinary = $now.AddMinutes(8)
$match = $now.AddMinutes($MatchDelayMinutes)
function IcsTime([DateTime]$date) { return $date.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'") }
$ics = @(
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Semantic Calendar//SC025 QA//EN',
  'BEGIN:VEVENT', "UID:qa-ordinary-$id", 'SUMMARY:SC025 普通通知验收',
  "DTSTART:$(IcsTime $ordinary)", "DTEND:$(IcsTime $ordinary.AddMinutes(30))",
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:SC025 普通通知验收', 'TRIGGER:-PT5M',
  'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', "UID:qa-match-$id", 'SUMMARY:Arsenal vs Manchester City',
  "DTSTART:$(IcsTime $match)", "DTEND:$(IcsTime $match.AddHours(2))",
  'END:VEVENT', 'END:VCALENDAR'
) -join "`r`n"
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$file = Join-Path $OutputDirectory "sc025-$id.ics"
[IO.File]::WriteAllText($file, $ics + "`r`n", [Text.UTF8Encoding]::new($false))
Write-Output "测试日历：$([IO.Path]::GetFullPath($file))"
Write-Output "立即导入并开启日历提醒，把比赛提醒设为提前 10 分钟。"
Write-Output "普通通知应在 $($now.AddMinutes(3).ToString('yyyy-MM-dd HH:mm:ss')) 出现。"
Write-Output "比赛通知应在 $($match.AddMinutes(-10).ToString('yyyy-MM-dd HH:mm:ss')) 出现。"
Write-Output '去重测试请刷新/重启同一来源；重新生成日历会创建新 UID，属于新事件。'
