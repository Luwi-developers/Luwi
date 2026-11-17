#requires -Version 7.0
<#
  用法: pwsh -File tools\make-toolchain.ps1 -FromTermux        (或 -JdkArchive … -Aapt2 …)

.SYNOPSIS
  备一份「安卓开发工具」用的工具链到 <repo>\toolchain\ (2.8.1)

.DESCRIPTION
  这一份是**开发机**上的脚本, 不进设备也不进 APK。它做三件事:

    1. 把 aarch64 的 JDK 解到 toolchain\jdk\ (Termux 的 openjdk-21, 或本地给一份压缩包)
    2. 把 aapt2 与三个纯 Java 件 (d8.jar / apksigner.jar / android.jar) 摆进固定落点
    3. 逐文件算 sha256, 写出 toolchain\toolchain.json —— 伴侣那一侧与特权那一侧都按它复核

  两条来路: `-FromTermux` 直接从 packages.termux.dev 拉两个 .deb (实测可达); 或者用
  `-JdkArchive` / `-Aapt2` 各给一份本地文件。都没有就报错退出 (2), 不编假路径。
  来源与许可见 toolchain\NOTICE-toolchain.md。

.EXAMPLE
  pwsh -File tools\make-toolchain.ps1 -FromTermux
#>
param(
    [switch]$FromTermux,
    [string]$JdkArchive = '',
    [string]$Aapt2 = '',
    [string]$BuildTools = '37.0.0',
    [string]$SdkRoot = 'D:\apk\Sdk',
    [string]$Out = '',
    [string]$Version = '',
    [string]$TermuxRoot = 'https://packages.termux.dev/apt/termux-main',
    [string]$TermuxJdk = 'pool/main/o/openjdk-21/openjdk-21_21.0.13-2_aarch64.deb',
    [string]$TermuxAapt2 = 'pool/main/a/aapt2/aapt2_16.0.0.4-4_aarch64.deb',
    [string]$DebCache = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Fail([string]$message) {
    Write-Host "FAIL $message" -ForegroundColor Red
    exit 2
}

function Hash256([string]$path) {
    $stream = [System.IO.File]::OpenRead($path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLowerInvariant()
        } finally { $sha.Dispose() }
    } finally { $stream.Dispose() }
}

<#
  .deb 是 ar 归档: 自己读头, 只取 data.tar.*
  (Windows 上不一定有 ar / 7z, 而格式只有 60 字节头这么点东西)
#>
function Expand-Deb([string]$deb, [string]$destination) {
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $stream = [System.IO.File]::OpenRead($deb)
    try {
        $reader = [System.IO.BinaryReader]::new($stream)
        $magic = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(8))
        if ($magic -ne "!<arch>`n") { Fail "$deb 不是 ar 归档" }
        while ($stream.Position + 60 -le $stream.Length) {
            $header = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(60))
            $name = $header.Substring(0, 16).Trim().TrimEnd('/')
            $size = [int]$header.Substring(48, 10).Trim()
            if ($name -like 'data.tar*') {
                $bytes = $reader.ReadBytes($size)
                $target = Join-Path $destination $name
                [System.IO.File]::WriteAllBytes($target, $bytes)
                return $target
            }
            $stream.Seek($size + ($size % 2), [System.IO.SeekOrigin]::Current) | Out-Null
        }
    } finally { $stream.Dispose() }
    Fail "$deb 里没有 data.tar.*"
}

function Expand-Tar([string]$archive, [string]$destination) {
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    # Windows 上 bsdtar 建不了符号链接/硬链接, 会以非零退出但**普通文件是解出来的**: 只要落了文件就
    # 按成功算 (JDK 里那批 legal/cacerts 的链接我们不需要); 一个文件都没落才算真失败
    & tar -xf $archive -C $destination 2>$null
    $extracted = Get-ChildItem $destination -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $extracted -or $LASTEXITCODE -ne 0) {
        $seven = 'C:\Program Files\7-Zip\7z.exe'
        if (Test-Path $seven) {
            & $seven x -y "-o$destination" $archive | Out-Null
            $extracted = Get-ChildItem $destination -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        }
    }
    if (-not $extracted) { Fail "tar 解不动 $archive" }
}

function Get-TermuxDeb([string]$relative) {
    # 缓存放工作区的 .lwtmp (与仓库分开): 仓库里只留说明与 .gitignore
    if (-not $DebCache) {
        $DebCache = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.lwtmp\termux'
    }
    New-Item -ItemType Directory -Force -Path $DebCache | Out-Null
    $name = Split-Path $relative -Leaf
    $target = Join-Path $DebCache $name
    if (-not (Test-Path $target)) {
        Write-Host "下 $TermuxRoot/$relative"
        Invoke-WebRequest -Uri "$TermuxRoot/$relative" -OutFile $target -TimeoutSec 1800
    }
    return $target
}

function Find-JdkRoot([string]$stage) {
    # Termux 的 openjdk 落在 .../files/usr/lib/jvm/java-21-openjdk; 本地压缩包可能是一层 <jdk-21>/
    $candidates = Get-ChildItem $stage -Recurse -Directory -Filter 'java-*-openjdk' -ErrorAction SilentlyContinue
    foreach ($dir in $candidates) {
        if (Test-Path (Join-Path $dir.FullName 'bin/java')) { return $dir.FullName }
    }
    $java = Get-ChildItem $stage -Recurse -File -Filter 'java' -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -like '*bin' } |
        Sort-Object Length -Descending | Select-Object -First 1
    if ($java) { return (Split-Path -Parent (Split-Path -Parent $java.FullName)) }
    return $null
}

<#
  .so 这一层: Termux 的 JDK 与 aapt2 都链着 PREFIX/lib 里那一套, 系统的 linker 命名空间里没有它们。
  把依赖包的 .so 全摊进 toolchain\lib, 并按 `libX.so.N` 补一份别名 (Termux 里那是符号链接, Windows 解不出来)
#>
function Add-TermuxLibs([string[]]$packages, [string]$lib) {
    $seen = @{}
    foreach ($package in $packages) {
        if ($seen.ContainsKey($package)) { continue }
        $seen[$package] = $true
        $deb = Get-TermuxDeb (Get-TermuxFilename $package)
        $stage = Join-Path $staging "lib-$package"
        $tar = Expand-Deb $deb $stage
        Expand-Tar $tar $stage
        $soFiles = Get-ChildItem $stage -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*.so*' }
        foreach ($file in $soFiles) {
            Copy-Item $file.FullName (Join-Path $lib $file.Name) -Force
            if ($file.Name -match '^(lib.+\.so)\.(\d+)\.\d+') {
                $alias = "$($Matches[1]).$($Matches[2])"
                Copy-Item $file.FullName (Join-Path $lib $alias) -Force
            }
        }
    }
}

function Get-TermuxFilename([string]$package) {
    $index = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.lwtmp\termux-Packages'
    if (-not (Test-Path $index)) {
        Invoke-WebRequest -Uri "$TermuxRoot/dists/stable/main/binary-aarch64/Packages" -OutFile $index -TimeoutSec 600
    }
    $lines = Get-Content $index
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -eq "Package: $package") {
            for ($j = $i; $j -le [Math]::Min($i + 20, $lines.Count - 1); $j++) {
                if ($lines[$j] -match '^Filename: (.+)$') { return $Matches[1] }
                if ($lines[$j] -eq '' -and $j -gt $i) { break }
            }
        }
    }
    Fail "索引里没有 $package"
}

$repo = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path $repo 'toolchain' }
if (-not $Version) { $Version = "lwforge-jdk21-termux-bt$BuildTools" }

$btLib = Join-Path $SdkRoot "build-tools\$BuildTools\lib"
foreach ($jar in @('d8.jar', 'apksigner.jar')) {
    if (-not (Test-Path (Join-Path $btLib $jar))) { Fail "本机 SDK 里缺 $btLib\$jar (换 -BuildTools)" }
}
$platforms = Get-ChildItem (Join-Path $SdkRoot 'platforms') -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'android.jar') } |
    Sort-Object Name -Descending
if (-not $platforms) { Fail "$SdkRoot\platforms 下没有带 android.jar 的平台" }
$androidJar = Join-Path $platforms[0].FullName 'android.jar'

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$staging = Join-Path $Out '.staging'
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$jdkDir = Join-Path $Out 'jdk'
if ((Test-Path $jdkDir) -and $Force) { Remove-Item -Recurse -Force $jdkDir }

if (-not (Test-Path $jdkDir)) {
    if ($JdkArchive) {
        if (-not (Test-Path $JdkArchive)) { Fail "-JdkArchive 指向的文件不存在: $JdkArchive" }
        $jdkStage = Join-Path $staging 'jdk'
        if ($JdkArchive -match '\.(deb)$') {
            $tar = Expand-Deb $JdkArchive $jdkStage
            Expand-Tar $tar $jdkStage
        } elseif ($JdkArchive -match '\.zip$') {
            Expand-Archive -Path $JdkArchive -DestinationPath $jdkStage -Force
        } else {
            Expand-Tar $JdkArchive $jdkStage
        }
    } elseif ($FromTermux) {
        $deb = Get-TermuxDeb $TermuxJdk
        $jdkStage = Join-Path $staging 'jdk'
        $tar = Expand-Deb $deb $jdkStage
        Expand-Tar $tar $jdkStage
    } else {
        Fail '要么 -FromTermux, 要么给 -JdkArchive 与 -Aapt2 (见 toolchain\NOTICE-toolchain.md)'
    }
    $root = Find-JdkRoot $jdkStage
    if (-not $root) { Fail "解开之后找不到 JDK 的根 (bin/java)" }
    New-Item -ItemType Directory -Force -Path $jdkDir | Out-Null
    # 只要跑构建的那几部分: jmods / demo / man / include 与 src.zip 是几个 G 的纯装饰
    foreach ($part in @('bin', 'lib', 'conf', 'release', 'legal')) {
        $source = Join-Path $root $part
        if (Test-Path $source) { Copy-Item -Recurse -Force $source (Join-Path $jdkDir $part) }
    }
    Remove-Item (Join-Path $jdkDir 'lib/src.zip') -Force -ErrorAction SilentlyContinue
}

$aapt2Source = $Aapt2
if (-not $aapt2Source -and $FromTermux) {
    $deb = Get-TermuxDeb $TermuxAapt2
    $aaptStage = Join-Path $staging 'aapt'
    $tar = Expand-Deb $deb $aaptStage
    Expand-Tar $tar $aaptStage
    $found = Get-ChildItem $aaptStage -Recurse -File -Filter 'aapt2' -ErrorAction SilentlyContinue |
        Sort-Object Length -Descending | Select-Object -First 1
    if (-not $found) { Fail 'aapt2 的 deb 里没有 aapt2 这个文件' }
    $aapt2Source = $found.FullName
}
if (-not $aapt2Source) { Fail '要么 -FromTermux, 要么给 -Aapt2' }
if (-not (Test-Path $aapt2Source)) { Fail "-Aapt2 指向的文件不存在: $aapt2Source" }

foreach ($bin in @('jdk/bin/java', 'jdk/bin/javac', 'jdk/bin/keytool')) {
    if (-not (Test-Path (Join-Path $Out $bin))) { Fail "JDK 里没有 $bin —— 这一份的目录形状不对" }
}

$buildToolsDir = Join-Path $Out 'build-tools'
$libDir = Join-Path $buildToolsDir 'lib'
$sdkOut = Join-Path $Out 'sdk'
New-Item -ItemType Directory -Force -Path $libDir, $sdkOut | Out-Null

Copy-Item $aapt2Source (Join-Path $buildToolsDir 'aapt2') -Force
Copy-Item (Join-Path $btLib 'd8.jar') $libDir -Force
Copy-Item (Join-Path $btLib 'apksigner.jar') $libDir -Force
Copy-Item $androidJar (Join-Path $sdkOut 'android.jar') -Force

if ($FromTermux) {
    # 这几件是 JDK 与 aapt2 的运行时依赖 (真机实测缺一个就 "library ... not found")
    Add-TermuxLibs -packages @(
        'zlib', 'libc++', 'libandroid-support', 'libiconv', 'libandroid-shmem', 'libandroid-spawn',
        'fmt', 'libpng', 'libexpat', 'libprotobuf', 'abseil-cpp', 'libzopfli'
    ) -lib $libDir
}
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue

$files = Get-ChildItem $Out -Recurse -File |
    Where-Object { $_.Name -notin @('.gitignore', 'NOTICE-toolchain.md', 'README.md', 'toolchain.json') } |
    ForEach-Object {
        [pscustomobject]@{
            path   = $_.FullName.Substring($Out.Length + 1).Replace('\', '/')
            sha256 = Hash256 $_.FullName
            bytes  = $_.Length
        }
    }

if ($files.Count -eq 0) { Fail '一份文件都没备出来' }

$manifest = [pscustomobject]@{
    v       = 1
    version = $Version
    abi     = 'arm64-v8a'
    files   = @($files)
} | ConvertTo-Json -Depth 5

$target = Join-Path $Out 'toolchain.json'
[System.IO.File]::WriteAllText($target, $manifest, (New-Object System.Text.UTF8Encoding($false)))

$totalMb = [math]::Round((($files | Measure-Object -Property bytes -Sum).Sum / 1MB), 1)
Write-Host "ok $Version · $($files.Count) 个文件 · $totalMb MB · $target"
Write-Host '下一步: pwsh -File D:\apk\dev.ps1 gradle -Task :devtools:assembleDebug'
exit 0
