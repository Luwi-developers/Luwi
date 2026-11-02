# 亮屏 + 解锁: **多方式轮换**, 一种不行就锁屏 -> 亮屏重来, 换下一种
#
# 用法:
#   pwsh -File D:\apk\Luwi\tools\lw-unlock.ps1
#   pwsh -File D:\apk\Luwi\tools\lw-unlock.ps1 -Serial OJZD5D6TMNSKFYHM -Tries 2
#   pwsh -File D:\apk\Luwi\tools\lw-unlock.ps1 -Only swipe      # 只跑某一种 (调试用)
#   pwsh -File D:\apk\Luwi\tools\lw-unlock.ps1 -LockOnly        # 只锁不接 (测试收尾)
#   $env:LW_UNLOCK_PIN='<口令>'; pwsh -File D:\apk\Luwi\tools\lw-unlock.ps1
#       # 口令不写死在脚本里 (脚本要进公开仓库): -Pin 优先, 其次 $env:LW_UNLOCK_PIN
#       # 推荐把 $env:LW_UNLOCK_PIN 写进 D:\apk\env.ps1 (它不在任何 git 仓库里)
#
# 三条硬约束 (2026-11-01 主人):
#   1. **密码输入页是黑屏** (secure 窗): 截图与 uiautomator 都看不出它停在哪一页, 所以脚本只认
#      `dumpsys window` 的 `isKeyguardShowing`, 不拿截图判断
#   2. **一种方式失败后先锁屏再亮屏**, 不要在原来的界面上接着操作 —— 那很可能正停在密码页,
#      在密码页上再划一下等于把它收掉, 后面每一步都打在空气上
#   3. **脚本里放多种方式**, 一种不行换下一种 (上滑+口令 -> 底部上滑+口令 -> 键盘点按+ENTER)
#
# 注入那条 (`lw_lock op=unlock`) 2026-11-01 已从本脚本删掉: 这台上的已录序列是坏的
# (跑几步就 `the replay ran out of time`), 留着只会白等两轮; 要恢复注入, 先在
# Luwi -> 设置 -> 锁屏 里重录一遍, 再单独用 `lw.ps1 -Method lock -Params '{"op":"unlock"}'` 调
#
# 每种方式都单独读数, 最后打一张表; 退出码 0 = 亮着且解开了

param(
    [string]$Serial,                        # 不填: $env:ANDROID_SERIAL -> 唯一在线设备 (真机优先)
    [string]$Pin = '',                      # 锁屏口令 (只在内存里用, 不落盘; 空则读 $env:LW_UNLOCK_PIN)
    [ValidateRange(1, 4)][int]$Tries = 2,   # 每种方式最多试几轮 (每轮前都会锁屏->亮屏重来)
    [ValidateSet('auto', 'swipe', 'swipeLow', 'keypad')]
    [string]$Only = 'auto',                 # 只跑某一种方式 (默认按顺序轮换)
    [switch]$StayAwake,                     # 顺带 `svc power stayon true` (收尾记得写回 false)
    [switch]$LockOnly,                      # 只锁不接: 测试收尾用
    [switch]$LockAfter                      # 解开 -> 干活 -> 收尾锁回
)

$ErrorActionPreference = 'Stop'
if (Test-Path variable:PSNativeCommandUseActionPreference) {
    $PSNativeCommandUseActionPreference = $false
}

# 口令不写死在脚本里 (它要进公开仓库): 优先 -Pin, 其次 $env:LW_UNLOCK_PIN
# -LockOnly 只用 `input keyevent` 锁屏, 不需要口令, 所以那一路放过
if (-not $Pin) { $Pin = $env:LW_UNLOCK_PIN }
if (-not $Pin -and -not $LockOnly) {
    throw '锁屏口令未提供: 用 -Pin 传入, 或设 $env:LW_UNLOCK_PIN (建议写进 D:\apk\env.ps1)'
}

function Find-Adb {
    $candidates = @()
    if ($env:ANDROID_HOME) { $candidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
    $candidates += 'D:\apk\Sdk\platform-tools\adb.exe'
    foreach ($one in $candidates) { if (Test-Path $one) { return $one } }
    $onPath = Get-Command adb -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    throw '找不到 adb: 设 $env:ANDROID_HOME, 或确认 D:\apk\Sdk\platform-tools\adb.exe 在'
}
$adb = Find-Adb

function Resolve-Serial {
    $picked = $null
    if ($Serial) { $picked = $Serial }
    elseif ($env:ANDROID_SERIAL) { $picked = $env:ANDROID_SERIAL }
    else {
        $devs = @(
            & $adb devices 2>$null |
                Select-Object -Skip 1 |
                Where-Object { $_ -match '^\S+\s+device' } |
                ForEach-Object { ($_ -split '\s+')[0] }
        )
        if ($devs.Count -eq 0) { throw '没有在线设备: 先 adb connect <ip>:5555, 或用 dev.ps1 emu 起模拟器' }
        $real = @($devs | Where-Object { $_ -notlike 'emulator-*' })
        $picked = if ($real.Count -ge 1) { $real[0] } else { $devs[0] }
        if ($devs.Count -gt 1) {
            Write-Host "多台在线 ($($devs -join ', ')): 用 -Serial 指定; 这次按「真机优先」挑 $picked" -ForegroundColor DarkYellow
        }
    }
    $state = (& $adb -s $picked get-state 2>&1 | Out-String).Trim()
    if ($state -ne 'device') { throw "设备 $picked 不在线: $state" }
    return $picked
}

function Get-Wakefulness {
    param([string]$Device)
    $out = (& $adb -s $Device shell 'dumpsys power' 2>&1 | Out-String)
    if ($out -match 'mWakefulness=(\w+)') { return $Matches[1] }
    return 'unknown'
}

# 只认这一条 (密码页是黑屏, 截图看不出东西)
function Get-Keyguard {
    param([string]$Device)
    foreach ($service in @('window', 'window policy')) {
        $out = (& $adb -s $Device shell "dumpsys $service" 2>&1 | Out-String)
        if ($out -match 'isKeyguardShowing=(\w+)') { return ($Matches[1] -eq 'true') }
        if ($out -match 'KeyguardShowing=(\w+)') { return ($Matches[1] -eq 'true') }
    }
    return $null
}

function Get-ScreenSize {
    param([string]$Device)
    $out = (& $adb -s $Device shell 'wm size' 2>&1 | Out-String)
    if ($out -match 'Override size:\s*(\d+)x(\d+)') { return @([int]$Matches[1], [int]$Matches[2]) }
    if ($out -match 'Physical size:\s*(\d+)x(\d+)') { return @([int]$Matches[1], [int]$Matches[2]) }
    return @(1080, 2460)
}

# ── "把设备弄回已知状态" 用的 ──────────────────────────────────────────────

function Lock-Screen {
    param([string]$Device)
    if ((Get-Wakefulness -Device $Device) -eq 'Awake') {
        & $adb -s $Device shell 'input keyevent 26' 2>&1 | Out-Null
        Start-Sleep -Milliseconds 900
    }
}

function Wake-Screen {
    param([string]$Device)
    # WAKEUP 时灵时不灵, 所以两条都试; 屏已亮时不再按 26 (那是关屏)
    & $adb -s $Device shell 'input keyevent 224' 2>&1 | Out-Null
    Start-Sleep -Milliseconds 800
    if ((Get-Wakefulness -Device $Device) -ne 'Awake') {
        & $adb -s $Device shell 'input keyevent 26' 2>&1 | Out-Null
        Start-Sleep -Milliseconds 900
    }
    return (Get-Wakefulness -Device $Device)
}

# 主人第 2 条: 一种方式失败后**锁屏再亮屏**, 不留在可能正停在密码页的那个界面上
function Reset-Screen {
    param([string]$Device)
    Lock-Screen -Device $Device
    $wake = Wake-Screen -Device $Device
    # 通知层挂着时先收掉, 否则第一下上滑只是在收通知
    & $adb -s $Device shell 'cmd statusbar collapse' 2>&1 | Out-Null
    Start-Sleep -Milliseconds 250
    return $wake
}

# ── 各方式: 都返回 @{ ok = bool; detail = string } ─────────────────────────

$SIZE = $null

function Invoke-SwipeChain {
    param([string]$Device, [double]$From, [double]$To)
    $w = $SIZE[0]; $h = $SIZE[1]
    $x = [int]($w / 2)
    $y1 = [int]($h * $From)
    $y2 = [int]($h * $To)
    $chain = "wm dismiss-keyguard; sleep 0.6; input swipe $x $y1 $x $y2 300; sleep 1.3; input text $Pin; sleep 0.7; input keyevent 66"
    & $adb -s $Device shell $chain 2>&1 | Out-Null
    Start-Sleep -Milliseconds 1700
    $locked = Get-Keyguard -Device $Device
    return @{ ok = ($locked -eq $false); detail = "swipe $x $y1 -> $x $y2, 口令 + ENTER; isKeyguardShowing=$locked" }
}

function Invoke-KeypadChain {
    param([string]$Device)
    # 键盘坐标按 1080x2460 的比例换算过去; 点完再 ENTER (这台 PIN 输完不自动提交)
    $w = $SIZE[0]; $h = $SIZE[1]
    $fx = $w / 1080.0
    $fy = $h / 2460.0
    $points = @{
        '0' = @(539, 2007); '1' = @(255, 1495); '2' = @(539, 1495); '3' = @(823, 1495)
        '4' = @(255, 1665); '5' = @(539, 1665); '6' = @(823, 1665)
        '7' = @(255, 1836); '8' = @(539, 1836); '9' = @(823, 1836)
    }
    & $adb -s $Device shell 'wm dismiss-keyguard' 2>&1 | Out-Null
    Start-Sleep -Milliseconds 900
    foreach ($digit in $Pin.ToCharArray()) {
        $pt = $points[[string]$digit]
        if ($null -eq $pt) { continue }
        & $adb -s $Device shell ("input tap {0} {1}" -f [int]($pt[0] * $fx), [int]($pt[1] * $fy)) 2>&1 | Out-Null
        Start-Sleep -Milliseconds 120
    }
    & $adb -s $Device shell 'input keyevent 66' 2>&1 | Out-Null
    Start-Sleep -Milliseconds 1700
    $locked = Get-Keyguard -Device $Device
    return @{ ok = ($locked -eq $false); detail = "键盘点按 ($($Pin.Length) 位) + ENTER; isKeyguardShowing=$locked" }
}

# ── 主流程 ────────────────────────────────────────────────────────────────

$started = Get-Date
$device = Resolve-Serial
$SIZE = Get-ScreenSize -Device $device
$wakeBefore = Get-Wakefulness -Device $device
$lockedBefore = Get-Keyguard -Device $device
Write-Host "设备: $device  (adb: $adb, 屏 $($SIZE[0])x$($SIZE[1]))"
Write-Host "开始时: mWakefulness=$wakeBefore, isKeyguardShowing=$lockedBefore"

if ($LockOnly) {
    Lock-Screen -Device $device
    $wakeNow = Get-Wakefulness -Device $device
    $lockedNow = Get-Keyguard -Device $device
    Write-Host "锁屏后: mWakefulness=$wakeNow, isKeyguardShowing=$lockedNow"
    if ($lockedNow -eq $false) { Write-Host '结果: 还没锁上' -ForegroundColor Red; exit 1 }
    Write-Host '结果: 已锁屏' -ForegroundColor Green
    exit 0
}

$strategies = switch ($Only) {
    'swipe'    { @('swipe') }
    'swipeLow' { @('swipeLow') }
    'keypad'   { @('keypad') }
    default    { @('swipe', 'swipeLow', 'keypad') }
}

$results = New-Object System.Collections.ArrayList
$unlocked = $false

foreach ($name in $strategies) {
    if ($unlocked) { break }
    for ($round = 1; $round -le $Tries -and -not $unlocked; $round++) {
        if ((Get-Keyguard -Device $device) -eq $false) { $unlocked = $true; break }
        # 主人第 2 条: 换方式 / 重试之前都先锁屏再亮屏, 不留在"可能是密码页"的界面上
        $wake = Reset-Screen -Device $device
        if ($wake -ne 'Awake') {
            [void]$results.Add([pscustomobject]@{ 方式 = $name; 轮次 = $round; 结果 = '屏幕没亮'; 读数 = "mWakefulness=$wake" })
            continue
        }
        $r = $null
        try {
            switch ($name) {
                'swipe'    { $r = Invoke-SwipeChain -Device $device -From 0.73 -To 0.20 }
                'swipeLow' { $r = Invoke-SwipeChain -Device $device -From 0.85 -To 0.15 }
                'keypad'   { $r = Invoke-KeypadChain -Device $device }
            }
        } catch {
            $r = @{ ok = $false; detail = "抛异常: $($_.Exception.Message)" }
        }
        $unlocked = [bool]$r.ok
        [void]$results.Add([pscustomobject]@{ 方式 = $name; 轮次 = $round; 结果 = $(if ($r.ok) { '解开' } else { '没解开' }); 读数 = $r.detail })
        Write-Host ("[{0} 第 {1} 轮] {2} —— {3}" -f $name, $round, $(if ($r.ok) { '解开' } else { '没解开' }), $r.detail)
    }
}

$wakeAfter = Get-Wakefulness -Device $device
$lockedAfter = Get-Keyguard -Device $device
if ($StayAwake -and -not $LockAfter) {
    & $adb -s $device shell 'svc power stayon true' 2>&1 | Out-Null
    Write-Host '保持常亮: svc power stayon true (收尾要写回 false)'
}
$spent = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
Write-Host ''
Write-Host '--- 各方式读数 ---'
$results | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "解锁后: mWakefulness=$wakeAfter, isKeyguardShowing=$lockedAfter, 用时 ${spent}s"
if (-not $unlocked -or $lockedAfter -ne $false) {
    Write-Host '结果: 所有方式都没解开 —— 看上面那张表; 用 -Only <方式> 单独重试' -ForegroundColor Red
    exit 1
}
Write-Host '结果: 亮着且解开了' -ForegroundColor Green
if ($LockAfter) {
    Lock-Screen -Device $device
    Write-Host "收尾锁屏: mWakefulness=$(Get-Wakefulness -Device $device), isKeyguardShowing=$(Get-Keyguard -Device $device)"
}
exit 0
