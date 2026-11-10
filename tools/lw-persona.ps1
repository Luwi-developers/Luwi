# 2026-11-10 Luwi 人格卡的落位脚本 ---- 把 presets\luwi\persona\xiaojingyu.md 推到设备上的
# $DSH_HOME/lw/persona/xiaojingyu.md。**日常不用跑它**: 宿主每步都读那份文件, 在 Luwi 里让她
# `lw_persona op=write` 改就生效; 这个脚本只是开发机上"整份手推"的入口 (改坏了 `op=reset` 也能回去)。
#
# 为什么走 adb run-as 而不是 files 桥: 目标在 app 沙盒里 (`filesDir/dsh-home/lw/persona`),
# 只有 app 自己的 uid 写得进去; debug 包的 run-as 就是同一个 uid。中文按 base64 传, 免得
# adb shell 的代码页把正文写歪 (Windows 上踩过)。
#
# 用法:
#   pwsh -File D:\apk\Luwi\tools\lw-persona.ps1                 # 自己挑设备
#   pwsh -File D:\apk\Luwi\tools\lw-persona.ps1 -Serial emulator-5554
param(
    [string]$Serial = '',
    [string]$Package = 'io.github.yuloong07star.luwi',
    [string]$Source = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if ($Source -eq '') { $Source = Join-Path $root 'presets\luwi\persona\xiaojingyu.md' }
if (-not (Test-Path $Source)) { throw "找不到人格卡正文: $Source" }

$adb = 'D:\apk\Sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) { throw "找不到 adb: $adb" }

if ($Serial -eq '') {
    $lines = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\tdevice$' }
    $real = $lines | Where-Object { $_ -notmatch '^emulator-' }
    $pick = if ($real.Count -gt 0) { $real[0] } elseif ($lines.Count -gt 0) { $lines[0] } else { '' }
    if ($pick -eq '') { throw '没有在线设备 (adb devices 是空的)' }
    $Serial = ($pick -split '\t')[0]
}

$target = 'files/dsh-home/lw/persona/xiaojingyu.md'
$body = [IO.File]::ReadAllText($Source, [Text.Encoding]::UTF8)
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body))

& $adb -s $Serial shell "run-as $Package mkdir -p files/dsh-home/lw/persona"
if ($LASTEXITCODE -ne 0) { throw "mkdir 失败 (debug 包才有 run-as): $LASTEXITCODE" }
& $adb -s $Serial shell "run-as $Package sh -c 'echo $b64 | base64 -d > $target'"
if ($LASTEXITCODE -ne 0) { throw "写 $target 失败: $LASTEXITCODE" }

$size = (& $adb -s $Serial shell "run-as $Package sh -c 'wc -c < $target'").Trim()
$head = (& $adb -s $Serial shell "run-as $Package sh -c 'head -1 $target'").Trim()
"设备      : $Serial"
"目标      : $target"
"本地字节  : $([Text.Encoding]::UTF8.GetByteCount($body))"
"设备字节  : $size"
"首行      : $head"
if ("$size" -ne "$([Text.Encoding]::UTF8.GetByteCount($body))") {
    throw '字节数对不上 —— 正文可能被写歪了 (检查代码页 / base64 那一段)'
}
'就位: 下一次模型请求就按这份卡说话 (宿主每步都读它, 不用重启也不用重装)'
