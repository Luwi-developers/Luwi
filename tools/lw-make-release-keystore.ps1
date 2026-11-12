<#
.SYNOPSIS
  Luwi 2.9.0 换签名用的那把 release keystore: 生成 / 体检 / 打印证书摘要

.DESCRIPTION
  **2.8.0 还没用上这把 key** —— 那一版仍用旧 debug key 签 (CN=Android Debug), 因为换 key 会让
  2.7.10 装不上 2.8.0, 只能卸载重装, files/dsh-home (会话 / 凭据 / 设置) 跟着丢

  换 key 推到 2.9.0, 而且必须走 APK Signature Scheme v3 的签名轮换 (lineage: 用旧 key 签字授权
  新 key, 每版都带同一份 lineage), 那一版才既换掉 key 又保住"覆盖安装不丢数据"
  这个脚本只管那把新 key 本身 (生成 / 体检), lineage 那一步在签包时用 apksigner 做

  **keystore 与口令都不进仓库**: 公开仓里放一把 release key 等于把签名权发给所有人
  默认落点 `D:\apk\.android\luwi-release.jks`, 口令写同目录的 `luwi-release.properties`
  (storePassword / keyAlias / keyPassword, 认 utf8 无 BOM)

  没有 -Check 时: keystore 不在就按下面的 DN 生成一份, 再把摘要打出来 (2.9.0 启用的那天, 把它
  钉进 tools\lw-release-check.ps1 的 ExpectedCertSha256); keystore 已在就只体检, **不覆盖** ——
  换 key = 所有人卸载重装, 那是一次有意的决定, 不交给脚本

  用法:
    pwsh -File tools\lw-make-release-keystore.ps1                 # 生成 (已存在就体检)
    pwsh -File tools\lw-make-release-keystore.ps1 -Check          # 只读体检, 打印 DN / 摘要 / 有效期
    pwsh -File tools\lw-make-release-keystore.ps1 -Keystore D:\apk\.android\other.jks

.PARAMETER Keystore
  keystore 路径, 默认 `D:\apk\.android\luwi-release.jks` (或 LW_RELEASE_KEYSTORE)

.PARAMETER Check
  只读: 不动文件, 只打印 DN / SHA-256 / 有效期

.EXAMPLE
  pwsh -File tools\lw-make-release-keystore.ps1 -Check
#>
param(
    [string]$Keystore = $(if ($env:LW_RELEASE_KEYSTORE) { $env:LW_RELEASE_KEYSTORE } else { 'D:\apk\.android\luwi-release.jks' }),
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

# 与 app/build.gradle.kts 里那条默认一致: 证书主体只有这一种写法, apksigner --print-certs 要打 CN=Luwi Release
$DName = 'CN=Luwi Release, OU=Luwi, O=Luwi, C=CN'
$Alias = 'luwi-release'
$KeySize = 4096
# 100 年: Play 要求 25 年以上, 这里按"发了就不动"给足
$Validity = 36500

$keystorePath = [System.IO.Path]::GetFullPath($Keystore)
$propsPath = Join-Path (Split-Path -Parent $keystorePath) 'luwi-release.properties'

function Find-KeyTool {
    $candidates = @(
        (Join-Path $env:JAVA_HOME 'bin\keytool.exe'),
        'D:\apk\tools\jdk-21\bin\keytool.exe',
        'D:\apk\tools\jdk-25\bin\keytool.exe'
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    $onPath = Get-Command keytool -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    throw '找不到 keytool: 先 . D:\apk\env.ps1, 或用 -Keystore 之外的 JAVA_HOME 指一个 JDK'
}

function Read-KeyPass([string]$file, [string]$name) {
    if (-not (Test-Path -LiteralPath $file)) { return '' }
    foreach ($line in Get-Content -LiteralPath $file -Encoding utf8) {
        if ($line -match "^\s*$([regex]::Escape($name))\s*=\s*(.+?)\s*$") { return $Matches[1] }
    }
    return ''
}

$keytool = Find-KeyTool

if (-not (Test-Path -LiteralPath $keystorePath)) {
    if ($Check) { throw "keystore 不在: $keystorePath (去掉 -Check 生成一份)" }
    $parent = Split-Path -Parent $keystorePath
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    # 口令只落在 keystore 旁边那份 properties 里, 不进仓库; 字母数字 32 位, 免得引号 / 转义在 gradle 与 keytool 之间出岔
    $alphabet = ([char[]](48..57 + 65..90 + 97..122))
    $password = -join (1..32 | ForEach-Object { $alphabet | Get-Random })
    # keytool 的输出跟着 JDK 的语言包走 (本机默认中文, 控制台再转一次就成了乱码); 钉成英文,
    # 下面那两条正则只认 `Owner:` / `Valid from:` / `SHA256:` 这几个英文标签
    & $keytool '-J-Duser.language=en' '-J-Duser.country=US' -genkeypair -keystore $keystorePath `
        -storetype PKCS12 -alias $Alias -keyalg RSA -keysize $KeySize -validity $Validity -dname $DName `
        -storepass $password -keypass $password 2>&1 | Out-String | Write-Host
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $keystorePath)) {
        throw "keytool 没生成出 keystore (退出 $LASTEXITCODE): $keystorePath"
    }
    $lines = @(
        '# Luwi release keystore 的口令 (不进仓库): app/build.gradle.kts 与 tools/lw-release-check.ps1 从这里读',
        "storePassword=$password",
        "keyAlias=$Alias",
        "keyPassword=$password"
    )
    Set-Content -LiteralPath $propsPath -Value $lines -Encoding utf8NoBOM
    Write-Host "已生成 $keystorePath (口令写在 $propsPath)"
}

# 体检: DN / 摘要 / 有效期都从证书本身读, 不信脚本里的常量
$storePass = Read-KeyPass $propsPath 'storePassword'
if (-not $storePass) { throw "读不到 storePassword: $propsPath (keystore 在, 口令丢了就只能重建 = 换 key)" }
$list = & $keytool '-J-Duser.language=en' '-J-Duser.country=US' -list -v -keystore $keystorePath -storepass $storePass -alias $Alias 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "keytool -list 失败: $list" }

$dn = ([regex]::Match($list, 'Owner:\s*(.+)')).Groups[1].Value.Trim()
$sha = ([regex]::Match($list, 'SHA256:\s*([0-9A-Fa-f:]+)')).Groups[1].Value.Trim().ToUpperInvariant()
$shaFlat = ($sha -replace ':', '').ToLowerInvariant()
$valid = ([regex]::Match($list, 'Valid from:\s*(.+)')).Groups[1].Value.Trim()

Write-Host ''
Write-Host 'release keystore 体检'
Write-Host "  文件     $keystorePath"
Write-Host "  别名     $Alias"
Write-Host "  主体     $dn"
Write-Host "  摘要     $shaFlat"
Write-Host "  有效期   $valid"

if ($dn -notmatch 'CN=Luwi Release') {
    Write-Host "  FAIL     主体里没有 CN=Luwi Release, 2.9.0 那条判据过不了" -ForegroundColor Red
    exit 1
}

# 2.8.0 的发布闸钉的还是旧 debug key, 所以这里不与它比 (比了必然红); 2.9.0 启用这把 key 的那天,
# 把摘要与主体钉进 tools\lw-release-check.ps1, 再让这条比较回来
Write-Host ''
Write-Host "  下一步   2.9.0 用它签时: 把 $shaFlat 钉进 tools\lw-release-check.ps1, 并用 apksigner 的 --lineage 签"

exit 0
