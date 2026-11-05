# lw-pr.ps1 -- 用 GitHub API 管理 PR (本机 github.com:443 被挡, 只有 api.github.com 通)
#
# 三个动作:
#   open   建 PR: -Head <分支> -Base main -Title "..." [-BodyFile <文件>]
#   list   列开放 PR (JSON: number/title/head/base/mergeable/state)
#   merge  合并 PR: -Number N [-Method merge|squash|rebase] (默认 merge commit, 保留工单提交)
#
# 用法:
#   pwsh -File lw-pr.ps1 -Action open -Head agent/2.8.0-16 -Title "agent/2.8.0-16: ..." -BodyFile D:\apk\.lwtmp\pr-body.md
#   pwsh -File lw-pr.ps1 -Action list
#   pwsh -File lw-pr.ps1 -Action merge -Number 12
#
# 纪律:
#   - 只走 gh api (REST), 不碰 git push (github.com 直连不通)
#   - merge 前必须确认 mergeable == true 且 state == open; 合并时带 sha=<head sha> 防并发漂移
#   - 不允许 force / 不允许顺带改 base; 红的不合
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('open', 'list', 'merge')]
    [string]$Action,
    [string]$Repo = 'Luwi-developers/Luwi',
    [string]$Gh = 'D:\Codex\gh-cli\gh.exe',
    [string]$Head = '',
    [string]$Base = 'main',
    [string]$Title = '',
    [string]$BodyFile = '',
    [int]$Number = 0,
    [ValidateSet('merge', 'squash', 'rebase')]
    [string]$Method = 'merge',
    [switch]$Draft
)

$ErrorActionPreference = 'Stop'
# 2026-11-05: 从 bash/cron 这类非控制台宿主调用（stdout 被管道接走）时，[Console]::OutputEncoding
# 不是 UTF-8 而是 OEM 码页，gh 吐出的 UTF-8 中文标题会被按 ANSI 再解一遍，ConvertFrom-Json 当场报
# "unexpected character ... Path '[0].title'"（中文标题被拆成非法字节）。交互式控制台里一直是好的，
# 所以之前那次「修中文解码」看着是通的。这里进程级钉死 UTF-8，两种宿主都成立。
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}
$tmp = 'D:\apk\.lwtmp\pr'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$jsonFile = Join-Path $tmp 'body.json'
# GitHub 的 JSON 解析器对 BOM 直接报 "Problems parsing JSON"
$utf8 = New-Object System.Text.UTF8Encoding($false)

function ApiJson([string[]]$argv) {
    $out = & $Gh api @argv
    if ($LASTEXITCODE -ne 0) { throw "gh api failed: $($argv -join ' ')" }
    return $out
}

function Get-Pull([int]$n) {
    return (ApiJson @("repos/$Repo/pulls/$n")) | ConvertFrom-Json
}

switch ($Action) {
    'list' {
        $rows = @(ApiJson @("repos/$Repo/pulls?state=open&per_page=50")) | ConvertFrom-Json
        $items = @($rows | ForEach-Object {
                [pscustomobject]@{
                    number    = $_.number
                    title     = $_.title
                    head      = $_.head.ref
                    headSha   = $_.head.sha
                    base      = $_.base.ref
                    mergeable = $_.mergeable
                    state     = $_.state
                    url       = $_.html_url
                }
            })
        [pscustomobject]@{ ok = $true; action = 'list'; repo = $Repo; count = $items.Count; items = $items } | ConvertTo-Json -Depth 6
    }
    'open' {
        if (-not $Head) { throw 'open 需要 -Head <分支名>' }
        if (-not $Title) { throw 'open 需要 -Title "<标题>"' }
        $bodyText = if ($BodyFile -and (Test-Path $BodyFile)) { [IO.File]::ReadAllText($BodyFile, [Text.Encoding]::UTF8) } else { '' }
        $body = @{
            title = $Title
            head  = $Head
            base  = $Base
            body  = $bodyText
            draft = [bool]$Draft
        } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($jsonFile, $body, $utf8)
        $pr = (ApiJson @('-X', 'POST', "repos/$Repo/pulls", '--input', $jsonFile)) | ConvertFrom-Json
        [pscustomobject]@{
            ok     = $true
            action = 'open'
            number = $pr.number
            url    = $pr.html_url
            state  = $pr.state
            head   = $pr.head.ref
            base   = $pr.base.ref
        } | ConvertTo-Json -Depth 5
    }
    'merge' {
        if ($Number -le 0) { throw 'merge 需要 -Number <PR 号>' }
        # mergeable 在刚创建时可能为 null (GitHub 还在算), 最多等 30 秒
        $pr = $null
        for ($i = 0; $i -lt 10; $i++) {
            $pr = Get-Pull $Number
            if ($null -ne $pr.mergeable) { break }
            Start-Sleep -Seconds 3
        }
        if ($pr.state -ne 'open') {
            [pscustomobject]@{
                ok     = $false
                action = 'merge'
                number = $Number
                state  = $pr.state
                reason = "PR 状态是 $($pr.state)，不是 open"
            } | ConvertTo-Json -Depth 5
            exit 2
        }
        if ($pr.mergeable -ne $true) {
            [pscustomobject]@{
                ok         = $false
                action     = 'merge'
                number     = $Number
                state      = $pr.state
                mergeable  = $pr.mergeable
                reason     = 'mergeable != true（冲突 / 还在算 / 被保护规则挡住）'
                mergeState = $pr.mergeable_state
            } | ConvertTo-Json -Depth 5
            exit 2
        }
        $headSha = $pr.head.sha
        $body = @{
            merge_method = $Method
            sha          = $headSha
        } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($jsonFile, $body, $utf8)
        $merged = $false
        $result = $null
        try {
            $result = (ApiJson @('-X', 'PUT', "repos/$Repo/pulls/$Number/merge", '--input', $jsonFile)) | ConvertFrom-Json
            $merged = [bool]$result.merged
        } catch {
            # 409 = head 不再匹配 (有人在合并前推了新提交), 这种情况必须停手让人看
            $after = Get-Pull $Number
            [pscustomobject]@{
                ok       = $false
                action   = 'merge'
                number   = $Number
                error    = $_.Exception.Message
                state    = $after.state
                headSha  = $after.head.sha
                expected = $headSha
            } | ConvertTo-Json -Depth 5
            exit 2
        }
        $after = Get-Pull $Number
        [pscustomobject]@{
            ok          = $merged
            action      = 'merge'
            number      = $Number
            merged      = $merged
            state       = $after.state
            mergeCommit = if ($result) { $result.sha } else { $null }
            message     = if ($result) { $result.message } else { $null }
            headSha     = $headSha
        } | ConvertTo-Json -Depth 5
        if (-not $merged) { exit 2 }
    }
}
