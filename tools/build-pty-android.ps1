# 给安卓编 node-pty 的原生 addon (2026-11-07)
#
# 上游 node-pty 只发 win32 / darwin / linux 五套 prebuilds, 安卓什么都没有, 所以 dsh 的
# 终端页在真机上一直是 `terminal inspection is unsupported on platform android` (第一道闸在
# subprocess-local 的平台判定) 与 `Failed to load native module: pty.node` (第二道, 缺 .so)
#
# 这份脚本做第二道: 用 NDK 编 pty.cc, 产物落 jniLibs/arm64-v8a/liblwpty.so, 由
# tools/pack-host.mjs 改名成 node-pty 期望的 prebuilds/android-arm64/pty.node 塞进 host 树
#
# 三个已经定下来的选择:
# - **静态 libc++** (`-static-libstdc++`): 动态链 libc++_shared.so 会让 addon 在设备上找不到
#   依赖 (系统没有这个库), 静态后 NEEDED 只剩 libc/libm/libdl
# - **不编 spawn-helper**: pty.cc 只在 `__APPLE__` 分支用它, Linux/Android 走 forkpty + execvp.
#   安卓上 forkpty 在 bionic 里就有, 目标 shell 是 /system/bin/sh
# - **头文件从 koffi 的 vendor 里取**: 仓库里唯一自带 node_api.h 的地方 (node-addon-api 只有
#   wrapper, 没有 NAPI 本体), 免得另下一份 node headers
#
# 用法: pwsh -File tools\build-pty-android.ps1 [-Clean]

param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$dsh = Join-Path $repo 'third_party\deepseek-harness'
$out = Join-Path $repo 'app\src\main\jniLibs\arm64-v8a'
$work = Join-Path $repo 'build\pty-android'

$ndkRoot = Join-Path $env:ANDROID_HOME 'ndk'
if (-not (Test-Path $ndkRoot)) { throw "找不到 NDK: $ndkRoot (先跑 . D:\apk\env.ps1)" }
$ndkVersion = Get-ChildItem $ndkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
$bin = Join-Path $ndkVersion.FullName 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$clang = Join-Path $bin 'clang++.exe'
if (-not (Test-Path $clang)) { throw "找不到 clang++: $clang" }

$ptyPkg = Get-ChildItem (Join-Path $dsh 'node_modules\.pnpm') -Directory -Filter 'node-pty@*' |
    Select-Object -First 1
if (-not $ptyPkg) { throw "找不到 node-pty 的 pnpm 目录 (先 pnpm install)" }
$ptySrc = Join-Path $ptyPkg.FullName 'node_modules\node-pty\src\unix\pty.cc'
if (-not (Test-Path $ptySrc)) { throw "找不到 pty.cc: $ptySrc" }

$napi = Get-ChildItem (Join-Path $dsh 'node_modules\.pnpm') -Directory -Filter 'node-addon-api@*' |
    Select-Object -First 1
$napiInc = Join-Path $napi.FullName 'node_modules\node-addon-api'
if (-not (Test-Path (Join-Path $napiInc 'napi.h'))) { throw "找不到 node-addon-api 头: $napiInc" }

$koffi = Get-ChildItem (Join-Path $dsh 'node_modules\.pnpm') -Directory -Filter 'koffi@*' |
    Select-Object -First 1
$apiInc = Join-Path $koffi.FullName 'node_modules\koffi\vendor\node-api-headers\include'
if (-not (Test-Path (Join-Path $apiInc 'node_api.h'))) { throw "找不到 node_api.h: $apiInc" }

if ($Clean -and (Test-Path $work)) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work, (Join-Path $work 'tmp'), $out | Out-Null

# clang 的临时文件要落在可写目录, 默认 TEMP 在某些会话里被锁
$env:TMP = Join-Path $work 'tmp'
$env:TEMP = $env:TMP

$target = 'aarch64-linux-android33'
$lib = Join-Path $out 'liblwpty.so'
& $clang --target=$target -fPIC -shared -O2 -std=c++17 -static-libstdc++ `
    -DNODE_GYP_MODULE_NAME=pty -I $napiInc -I $apiInc `
    -o $lib $ptySrc
if ($LASTEXITCODE -ne 0) { throw "clang++ 失败 (退出码 $LASTEXITCODE)" }

$readelf = Join-Path $bin 'llvm-readelf.exe'
$hdr = (& $readelf -h $lib) -join "`n"
if ($hdr -notmatch 'AArch64') { throw "产物不是 AArch64: $hdr" }
$needed = (& $readelf -d $lib | Select-String 'NEEDED') -join '; '
if ($needed -match 'libc\+\+_shared') { throw "还是动态链着 libc++_shared: $needed" }

$size = [math]::Round((Get-Item $lib).Length / 1024)
Write-Output "ok   $lib  (${size} KB, $target, NEEDED=$needed)"
Write-Output "下一步: pwsh -File tools\pack-host.mjs (或 dev.ps1 build) 会把它塞进 host 树的 node-pty/prebuilds/android-arm64/pty.node"
