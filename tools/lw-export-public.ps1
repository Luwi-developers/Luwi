param(
    [string]$Source = 'split/tavern-private',
    [string]$Public = 'public/main',
    [string]$Base = '2c61255',
    [string]$Message
)

# 把私有分支的树导出成公开分支上的**一个**提交 (2026-10-29, 酒馆闭源 C 方案)
#
# 为什么不是直接推私有分支: 私有分支的祖先里有 `c6aa501`, 那个提交带着酒馆 85 个文件;
# 删掉只影响最新树, 不影响历史 —— 推上去照样翻得到。所以公开分支必须从 `2c61255` (v2.7.9)
# 起家, 每次用「当前无酒馆的树 + 公开分支当前 tip 作父」造一个提交, 历史里永远不出现酒馆
#
# 用法:
#   pwsh -File tools\lw-export-public.ps1                       # 用默认的源与公开分支
#   pwsh -File tools\lw-export-public.ps1 -Message "Luwi 2.7.11: 公开树"
#   pwsh -File tools\lw-export-public.ps1 -Source release/2.0.0
#
# 跑完: git switch public/main, 再走 lw-api-push.ps1 (先 dry run 再 -Apply)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Invoke-Git([string[]]$a) {
    $out = & git @a 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($a -join ' ') 失败:`n$($out -join "`n")" }
    return @($out)
}

# 源树里不能有酒馆实现; 公开侧的 stub (tavern-stub / LuwiTavernStub) 是允许的
$tavernPaths = @(
    'app/src/main/java/io/github/yuloong07star/luwi/tavern'
    'app/src/main/java/io/github/yuloong07star/luwi/ui/TavernChatScreen.kt'
    'app/src/main/java/io/github/yuloong07star/luwi/ui/TavernManageScreen.kt'
    'app/src/main/java/io/github/yuloong07star/luwi/ui/TavernSection.kt'
    'host-plugins/luwi-tavern'
    'presets/tavern'
)
$leak = @(Invoke-Git @('ls-tree', '-r', "$Source^{tree}", '--name-only') | Where-Object {
    $p = $_.ToString()
    ($p -match '(?i)tavern') -and ($p -notmatch '(?i)tavern-stub|LuwiTavernStub')
})
if ($leak.Count -gt 0) {
    throw "源树里还有酒馆文件, 不能导出:`n$($leak -join "`n")"
}

# 公开分支不存在就按 Base 建 (必须是远端当前 tip, 本机拿不到新提交时手动给 -Base)
$hasPublic = $true
try { Invoke-Git @('rev-parse', '--verify', "$Public^{commit}") | Out-Null } catch { $hasPublic = $false }
if (-not $hasPublic) {
    Invoke-Git @('rev-parse', '--verify', "$Base^{commit}") | Out-Null
    Invoke-Git @('branch', $Public, $Base) | Out-Null
    Write-Host "created $Public at $Base" -ForegroundColor Green
}

# 公开分支的历史里不能有酒馆 (c6aa501 那条链)
$badHistory = @(Invoke-Git (@('rev-list', $Public, '--') + $tavernPaths))
if ($badHistory.Count -gt 0) {
    throw "公开分支 $Public 的历史里有酒馆 ($($badHistory.Count) 个提交) —— 这个分支不能再用, 换一个从 $Base 新建的分支"
}

$tree = @(Invoke-Git @('rev-parse', "$Source^{tree}"))[0]
$parent = @(Invoke-Git @('rev-parse', "$Public"))[0]
$msg = if ($Message) { $Message } else { "公开导出: $Source 的无酒馆树" }
$commit = @(Invoke-Git @('commit-tree', $tree, '-p', $parent, '-m', $msg))[0]
Invoke-Git @('update-ref', "refs/heads/$Public", $commit) | Out-Null

Write-Host "exported $($commit.Substring(0,7)) -> $Public (parent $($parent.Substring(0,7)))" -ForegroundColor Green
Invoke-Git @('log', '--oneline', '-2', $Public) | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "下一步: git switch $Public; 再跑 tools\lw-api-push.ps1 先 dry run" -ForegroundColor Yellow
Write-Host "日常开发仍在 $Source (别在 $Public 上改代码, 下次导出会把树覆盖回去)" -ForegroundColor Yellow
