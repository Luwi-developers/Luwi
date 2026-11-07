<#
.SYNOPSIS
  Luwi 发布前的总闸: 设备读数 + 验签

.DESCRIPTION
  用法: pwsh -File tools\lw-release-check.ps1 [-Apk <apk>] [-EvidenceFile <设备读数证据.md>] [-AnyName]
  发版只认 :app:assembleDebug 出来的 app-debug.apk, 而且上传前必须先过这几道:
    - 设备读数: 证据文件 (默认 docs\device-evidence.md) 里每一项都有可用读数, 由 tools\check-device-evidence.mjs 判
    - 文件名必须是 app-debug.apk (release 变体不进发布流程)
    - apksigner verify 必须通过 (v2 / v3 签名在)
    - 证书必须是项目那把固定的 debug key (D:\apk\.android\debug.keystore)
  最后打一张汇总: FAIL 的那一项连同它缺的东西一起点名; 有 FAIL 就以非零退出码结束,
  发布 / 上传那一步看见非零就不许传

.PARAMETER Apk
  要验的包, 默认 app\build\outputs\apk\debug\app-debug.apk

.PARAMETER EvidenceFile
  设备读数证据, 默认 docs\device-evidence.md (格式见 tools\check-device-evidence.mjs 开头)

.PARAMETER AnyName
  只做诊断时用: 跳过文件名检查 (仍然验签与核对证书), 例如验一份归档包

.EXAMPLE
  pwsh -File tools\lw-release-check.ps1

.EXAMPLE
  pwsh -File tools\lw-release-check.ps1 -Apk D:\apk\archive\releases\Luwi-2.7.7.apk -AnyName

.EXAMPLE
  pwsh -File tools\lw-release-check.ps1 -EvidenceFile tools\fixtures\device-evidence\missing.md
#>
param(
    [string]$Apk = (Join-Path $PSScriptRoot '..\app\build\outputs\apk\debug\app-debug.apk'),
    [string]$EvidenceFile = (Join-Path $PSScriptRoot '..\docs\device-evidence.md'),
    [switch]$AnyName
)

$ErrorActionPreference = 'Stop'

# 项目固定的那把 key, 换 key = 所有人卸载重装 (理由见 app/build.gradle.kts 里那段注释)
$ExpectedCertSha256 = '652084a902c50f95bf71e6ce6cd0bad8fa5a9b231a146f99016bc17265c97359'

$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [string]$Status, [string]$Detail) {
    $checks.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
}

$script:toolchainBroken = $false
$script:evidenceMissing = @()
$script:evidenceReasons = @()

# 0. 分支漂移: 这次发版周期里新起的 agent 分支, tip 还没进 main 的都必须登记过
#
# 2026-11-07 的教训: agent/2.8.0-ready-models 那三提交 (引导卡四件 + 两个模型下载 + 撤掉虚拟屏)
# 11-04 就做完并推了远端, 但没开 PR、落实表也没这一条, 收口按 PR 与表核对就把整支漏在外面 ——
# 真机上看到的还是旧的三件内嵌卡, 一直到装机才暴露。判据与理由见 tools/check-branch-drift.mjs
$driftScript = Join-Path $PSScriptRoot 'check-branch-drift.mjs'
if (-not (Test-Path -LiteralPath $driftScript)) {
    Add-Check '分支漂移' 'FAIL' "找不到检查器 $driftScript"
} elseif (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Add-Check '分支漂移' 'FAIL' 'PATH 里找不到 node, 跑不了分支检查'
} else {
    $driftOut = & node $driftScript 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        Add-Check '分支漂移' 'PASS' '这一版新起的分支都进 main 了'
    } else {
        $names = ($driftOut -split "`r?`n" |
            Where-Object { $_ -match '^FAIL ' } |
            ForEach-Object { ($_ -split '\s+')[1] }) -join ', '
        Add-Check '分支漂移' 'FAIL' "这些分支没进 main 也没登记: $names (合进去, 或在 tools/branch-drift-allow.json 写一条 why)"
    }
}

# 1. 设备读数: 缺真机 / 模拟器读数就不许发
$evidenceScript = Join-Path $PSScriptRoot 'check-device-evidence.mjs'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath $evidenceScript)) {
    Add-Check '设备读数' 'FAIL' "找不到检查器 $evidenceScript"
} elseif ($null -eq $node) {
    Add-Check '设备读数' 'FAIL' 'PATH 里找不到 node, 跑不了设备读数检查'
} elseif (-not (Test-Path -LiteralPath $EvidenceFile)) {
    Add-Check '设备读数' 'FAIL' "找不到证据文件 $EvidenceFile (用 -EvidenceFile 指一份)"
} else {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $raw = & node $evidenceScript $EvidenceFile --json 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    $text = ($raw | Out-String).Trim()
    $doc = $null
    if ($text.StartsWith('{')) {
        try { $doc = $text | ConvertFrom-Json } catch { $doc = $null }
    }
    if ($code -eq 0 -and $null -ne $doc) {
        Add-Check '设备读数' 'PASS' ("{0} 项 / 读数 {1} 条" -f @($doc.items).Count, $doc.readings)
    } elseif ($code -eq 3 -and $null -ne $doc) {
        $bad = @($doc.items | Where-Object { @($_.problems).Count -gt 0 })
        if ($bad.Count -gt 0) {
            $script:evidenceMissing = @($bad | ForEach-Object { $_.name })
            $script:evidenceReasons = @($bad | ForEach-Object {
                "  $($_.name): $((@($_.problems)) -join '; ')"
            })
            Add-Check '设备读数' 'FAIL' ("缺 {0} 项: {1}" -f $bad.Count, ($script:evidenceMissing -join ', '))
        } else {
            $script:evidenceReasons = @(@($doc.problems) | ForEach-Object { "  $_" })
            Add-Check '设备读数' 'FAIL' ("证据文件不合格: {0}" -f ((@($doc.problems)) -join '; '))
        }
    } else {
        Add-Check '设备读数' 'FAIL' "检查器没跑起来 (退出 $code): $text"
    }
}

# 2..4 文件名 / 验签 / 证书
$v2 = $false
$v3 = $false
$schemes = @()
$certSha = ''
if (-not (Test-Path -LiteralPath $Apk)) {
    Add-Check '文件名' 'FAIL' "找不到 APK: $Apk (用 -Apk 指一个路径)"
    Add-Check '验签' 'SKIP' '没有 APK'
    Add-Check '证书' 'SKIP' '没有 APK'
} else {
    $Apk = (Resolve-Path -LiteralPath $Apk).Path
    $item = Get-Item -LiteralPath $Apk

    if (-not $AnyName -and $item.Name -ne 'app-debug.apk') {
        Add-Check '文件名' 'FAIL' "只发 app-debug.apk, 这个是 $($item.Name) (release 变体不进发布流程)"
    } else {
        Add-Check '文件名' 'PASS' $item.Name
    }

    # apksigner 要 JAVA_HOME, 没设就先激活工作区环境
    if (-not $env:JAVA_HOME) {
        $envScript = 'D:\apk\env.ps1'
        if (Test-Path $envScript) { . $envScript | Out-Null }
    }
    $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\apk\Sdk' }
    $buildToolsDir = Join-Path $sdk 'build-tools'
    $apksigner = $null
    if (-not (Test-Path $buildToolsDir)) {
        Add-Check '验签' 'FAIL' "找不到 build-tools: $buildToolsDir"
        $script:toolchainBroken = $true
    } else {
        $buildTools = Get-ChildItem $buildToolsDir -Directory |
            Sort-Object { [version]$_.Name } -Descending |
            Select-Object -First 1
        $apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
        if (-not (Test-Path $apksigner)) {
            Add-Check '验签' 'FAIL' "找不到 apksigner: $apksigner"
            $apksigner = $null
            $script:toolchainBroken = $true
        }
    }

    if ($null -eq $apksigner) {
        Add-Check '证书' 'SKIP' '没有 apksigner'
    } else {
        $output = & $apksigner verify --verbose --print-certs $Apk 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            Add-Check '验签' 'FAIL' 'apksigner 验签不通过, 这个包不能发'
            Add-Check '证书' 'SKIP' '验签没过'
            Write-Host $output
        } else {
            $v2 = $output -match 'APK Signature Scheme v2\): true'
            $v3 = $output -match 'APK Signature Scheme v3\): true'
            if (-not ($v2 -or $v3)) {
                Add-Check '验签' 'FAIL' 'v2 / v3 签名都没有'
            } else {
                if ($v2) { $schemes += 'v2' }
                if ($v3) { $schemes += 'v3' }
                Add-Check '验签' 'PASS' ($schemes -join '/')
            }

            $certLine = ($output -split "`r?`n" |
                Where-Object { $_ -match 'certificate SHA-256 digest:' } |
                Select-Object -First 1)
            if (-not $certLine) {
                Add-Check '证书' 'FAIL' '证书里没有 SHA-256 摘要'
            } else {
                $certSha = ($certLine -replace '.*certificate SHA-256 digest:\s*', '').Trim().ToLowerInvariant()
                if ($certSha -ne $ExpectedCertSha256) {
                    Add-Check '证书' 'FAIL' "证书不是项目那把 debug key: $certSha (应为 $ExpectedCertSha256; 换 key 等于所有人卸载重装)"
                } else {
                    Add-Check '证书' 'PASS' "固定 debug key $($certSha.Substring(0, 8))…"
                }
            }
        }
    }
}

# 5. 汇总: 每一项一行, FAIL 的那一项连同缺的东西一起点名
Write-Host ''
Write-Host '汇总'
foreach ($check in $checks) {
    $color = switch ($check.Status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        default { 'DarkGray' }
    }
    Write-Host ("  {0,-4} {1,-8} {2}" -f $check.Status, $check.Name, $check.Detail) -ForegroundColor $color
}

$failed = @($checks | Where-Object { $_.Status -eq 'FAIL' })
if ($failed.Count -gt 0) {
    Write-Host ''
    Write-Host "FAIL  不可发: $($failed.Count) 项不过" -ForegroundColor Red
    if ($script:evidenceReasons.Count -gt 0) {
        Write-Host '  设备读数缺项:' -ForegroundColor Red
        foreach ($reason in $script:evidenceReasons) { Write-Host $reason -ForegroundColor Red }
    }
    exit $(if ($script:toolchainBroken) { 2 } else { 1 })
}

$sha256 = (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ''
Write-Host 'PASS  可以发' -ForegroundColor Green
Write-Host "  APK      $Apk"
Write-Host ("  大小     {0:N0} 字节 ({1:N1} MiB)" -f $item.Length, ($item.Length / 1MB))
Write-Host "  SHA-256  $sha256"
Write-Host "  签名     固定 debug key $($certSha.Substring(0, 8))… ($($schemes -join '/'))"
exit 0
