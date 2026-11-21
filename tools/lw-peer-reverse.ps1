# tools/lw-peer-reverse.ps1 — 把手机上的「电脑地址」重新指到电脑**这一次**的 dsh 端口
#
# 为什么需要它: 手机里存的 `peer.url` 是 `http://127.0.0.1:63560/` (配对时写死的回环口),
# 这条链只有 `adb reverse tcp:63560 tcp:<电脑当前端口>` 撑着. 而电脑上的 dsh 桌面版
# **每次启动换一个随机端口** (62666 → 60878 → 55856 → 58717 …), adb 掉线重连之后 reverse
# 也会没. 两头任何一头动了, 手机上就是那屏「电脑没连上 … (fetch failed)」——
# 不是配对丢了, 是那根管子指着一个已经没人听的端口.
#
# 用法:
#   pwsh -File Luwi\tools\lw-peer-reverse.ps1                 # 自动挑真机 + 自动找电脑端口
#   pwsh -File Luwi\tools\lw-peer-reverse.ps1 -Serial XXX -Port 58717
#   pwsh -File Luwi\tools\lw-peer-reverse.ps1 -Show           # 只看, 不改
#
# 端口怎么找: 电脑上跑 dsh 的那个 Electron 主进程命令行里有 `dsh-desktop-host`,
# 它只监听一个回环端口 —— 那就是 Web GUI / 插件路由所在的口. 找不到就让人用 -Port 给.

[CmdletBinding()]
param(
  [string]$Serial = '',
  [int]$Port = 0,
  [string]$DevicePort = '63560',
  [switch]$Show
)

$ErrorActionPreference = 'Stop'
$adb = 'D:\apk\Sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) { throw "adb not found: $adb" }

function Resolve-Serial {
  param([string]$Wanted)
  $lines = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' } | ForEach-Object { ($_ -split '\s+')[0] }
  $phones = @($lines | Where-Object { $_ -notmatch '^emulator-' })
  if ($Wanted -ne '') { return $Wanted }
  if ($phones.Count -ge 1) { return $phones[0] }
  if ($lines.Count -ge 1) { return $lines[0] }
  throw 'no adb device online'
}

function Resolve-DshPort {
  $hosts = Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'dsh-desktop-host' }
  foreach ($proc in $hosts) {
    $listen = Get-NetTCPConnection -State Listen -OwningProcess $proc.ProcessId -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::1') }
    if ($null -ne $listen) {
      $port = ($listen | Sort-Object LocalPort | Select-Object -First 1).LocalPort
      if ($port -gt 0) { return [int]$port }
    }
  }
  return 0
}

$serial = Resolve-Serial -Wanted $Serial
if ($Port -le 0) { $Port = Resolve-DshPort }
if ($Port -le 0) { throw 'could not find the dsh port; pass -Port <the Web GUI port>' }

Write-Host "serial   : $serial"
Write-Host "device   : tcp:$DevicePort"
Write-Host "pc port  : $Port"
if ($Show) {
  & $adb -s $serial reverse --list
  return
}

# 先清掉同一条 (指向老端口的), 再建 —— adb reverse 同一条重复建会报 already exists
& $adb -s $serial reverse --remove "tcp:$DevicePort" 2>$null | Out-Null
$assigned = (& $adb -s $serial reverse "tcp:$DevicePort" "tcp:$Port") 2>&1
if ($LASTEXITCODE -ne 0) { throw "adb reverse failed: $assigned" }
Write-Host "reverse  : tcp:$DevicePort -> tcp:$Port"

# 回读一次: 这条管子真的在, 而且电脑那头真的是插件路由 (信息接口认令牌)
$token = ''
$config = Join-Path $env:USERPROFILE '.dsh\lw\session-sync.json'
if (Test-Path $config) {
  try { $token = (Get-Content $config -Raw | ConvertFrom-Json).peer.token } catch { $token = '' }
}
if ($token -ne '') {
  try {
    $answer = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Headers @{ authorization = "Bearer $token" } "http://127.0.0.1:$Port/luwi-sync/peer/info"
    Write-Host "peer/info: HTTP $($answer.StatusCode) ($($answer.Content.Length) bytes)"
  } catch {
    Write-Host "peer/info: FAILED — $($_.Exception.Message)"
    exit 1
  }
}

& $adb -s $serial reverse --list
