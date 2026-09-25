<#
桌面侧性能测量（SC-020 / app-spec §15）。

量的是纯前端基线量不到的那几项：冷启动、空闲内存 / CPU、窗口隐藏后的资源。
方法与 SC-002 的人工验收一致，只是写成脚本以便重复：

  1. 冷启动：连续启动 N 次，量“进程创建 → 主窗口句柄可用”的毫秒数，报中位数；
  2. 空闲资源：窗口可见后先等 SettleSeconds 稳定（WebView 首帧、字体与懒加载
     都在这段时间里完成），再连续采两段 CPU 时间——第一段仍可能含启动尾巴，
     第二段才是稳态，两者都报出来，避免把启动开销当成空闲开销；
  3. 隐藏窗口：向主窗口发 WM_CLOSE（默认关闭行为是隐藏到托盘），用
     IsWindowVisible 确认窗口真的不可见，再同样采样一段。

用法（在仓库任意位置，脚本按自身位置找产物）：

  powershell -ExecutionPolicy Bypass -File apps/desktop/tools/measure-desktop.ps1
  powershell -ExecutionPolicy Bypass -File apps/desktop/tools/measure-desktop.ps1 -Runs 5 -SampleSeconds 30

前置：先构建 release 产物（`npm run tauri -- build --no-bundle`）。
#>

param(
  [int]$Runs = 5,
  [int]$SettleSeconds = 15,
  [int]$SampleSeconds = 30,
  [string]$Exe = "src-tauri\target\release\semantic-calendar.exe"
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

$WM_CLOSE = 0x0010
# 相对路径按脚本自身位置解析（脚本在 apps/desktop/tools 下），
# 因此在仓库根目录或 apps/desktop 下运行都得到同一个产物。
$AppRoot = Split-Path -Parent $PSScriptRoot

function Resolve-Exe([string]$path) {
  $candidate = if ([System.IO.Path]::IsPathRooted($path)) {
    $path
  } else {
    Join-Path $AppRoot $path
  }
  if (-not (Test-Path -LiteralPath $candidate)) {
    throw "找不到 release 产物：$candidate（先运行 npm run tauri -- build --no-bundle）"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Start-App([string]$exePath) {
  return Start-Process -FilePath $exePath -PassThru
}

function Wait-MainWindow($process, [int]$timeoutMs = 30000) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) { throw "进程在窗口出现前退出" }
    if ($process.MainWindowHandle -ne 0) { return $true }
    Start-Sleep -Milliseconds 20
  }
  return $false
}

function Stop-App($process) {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit(5000) | Out-Null
  }
}

function CpuSeconds($process) {
  $process.Refresh()
  return $process.TotalProcessorTime.TotalSeconds
}

function Format-CpuLine([string]$label, $process, [int]$seconds) {
  $start = CpuSeconds $process
  Start-Sleep -Seconds $seconds
  $delta = (CpuSeconds $process) - $start
  $process.Refresh()
  $ram = $process.WorkingSet64 / 1MB
  $private = $process.PrivateMemorySize64 / 1MB
  $percent = 100 * $delta / $seconds
  return ("{0}：工作集 {1:N0} MB，私有内存 {2:N0} MB，{3} 秒 CPU 增量 {4:N3} s（{5:N1}%）" -f $label, $ram, $private, $seconds, $delta, $percent)
}

$exePath = Resolve-Exe $Exe
Write-Output "产物：$exePath"
$cpu = (Get-CimInstance Win32_Processor).Name
$ramGb = [int]((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
Write-Output "机器：$cpu / $ramGb GB RAM"
Write-Output ""

# ---- 1. 冷启动 ----
$coldStarts = @()
for ($i = 1; $i -le $Runs; $i++) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $process = Start-App $exePath
  $ok = Wait-MainWindow $process
  $sw.Stop()
  if (-not $ok) { throw "第 $i 次启动在 30 秒内没有出现主窗口" }
  $coldStarts += $sw.Elapsed.TotalMilliseconds
  Stop-App $process
  Start-Sleep -Milliseconds 800
}
$sorted = $coldStarts | Sort-Object
$median = $sorted[[int][math]::Floor($sorted.Count / 2)]
Write-Output ("冷启动（进程创建 → 主窗口句柄可用，{0} 次）：中位 {1:N0} ms，最小 {2:N0} ms，最大 {3:N0} ms" -f $Runs, $median, $sorted[0], $sorted[-1])

# ---- 2. 可见空闲（两段采样）----
$process = Start-App $exePath
if (-not (Wait-MainWindow $process)) { Stop-App $process; throw "窗口未出现" }
Start-Sleep -Seconds $SettleSeconds
Write-Output (Format-CpuLine "可见空闲 · 第 1 段" $process $SampleSeconds)
Write-Output (Format-CpuLine "可见空闲 · 第 2 段" $process $SampleSeconds)

# ---- 3. 隐藏到托盘 ----
# 句柄必须在关闭请求之前取好：窗口隐藏后 Process.MainWindowHandle 会指向该
# 进程的另一个顶层窗口（WebView2 的辅助窗口），拿它判断可见性会得出反结论。
$handle = $process.MainWindowHandle
[Win32]::PostMessage($handle, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Start-Sleep -Seconds 2
$process.Refresh()
if ($process.HasExited) { throw "关闭请求把进程退出了（默认行为应为隐藏到托盘）" }
$stillVisible = [Win32]::IsWindowVisible($handle)
Write-Output (Format-CpuLine ("隐藏窗口 · 主窗口可见=" + $stillVisible) $process $SampleSeconds)
Stop-App $process
