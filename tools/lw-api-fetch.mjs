#!/usr/bin/env node
/**
 * 用 GitHub API 把某个 ref 的对象补进本地对象库 (2026-11-14)
 *
 * **为什么要这个**: 本机 `github.com:443` 的 TLS 通道被挡, `git fetch` 与 `git push` 都不通
 * (`Recv failure` / `curl 28`), 只有 `api.github.com` 通 (tools/lw-api-push.ps1 就是这条路的反向:
 * 把本地提交推上去)。于是本地的 `refs/remotes/luwi/main` 会落后于远端, 而
 * `lw-api-push.ps1` 的 base 取 `git rev-parse $RemoteRef` —— 落后的 base 会把别人的提交重放一遍。
 *
 * 这个脚本把"缺的那几个对象"从 API 拉回本地: commit 由 API 的元数据逐字节重建 (GitHub 给的
 * `verification.payload` 就是 commit 原文, 拿它最稳), tree 缺就按目录一层层重建, blob 缺就
 * 按 base64 写回去。**每一个对象都与期望 SHA 比对**, 全对才动 ref; 有一个不对就中止, 本地一个字节不改。
 *
 * 用法:
 *   node tools/lw-api-fetch.mjs                    # dry run: 只报告缺哪些对象, 不动 ref
 *   node tools/lw-api-fetch.mjs --apply            # 全对之后把本地 ref 指过去
 *   node tools/lw-api-fetch.mjs --ref heads/main --local luwi/main
 *   node tools/lw-api-fetch.mjs --sha <sha>        # 直接指定目标 (不查 ref)
 *   node tools/lw-api-fetch.mjs --limit 50         # 安全阀: 最多补 50 个提交就停
 *
 * 退出码: 0 = 全部对上 (dry run 也算) / 1 = 有对象对不上或 API 出错
 */

import { execFileSync } from 'node:child_process'

const DEFAULT_GH = 'D:\\Codex\\gh-cli\\gh.exe'

/** 解析 `--key value` / `--flag` 那种命令行 (与仓库里其它 .mjs 同一个手写风格) */
function parseArgs(argv) {
  const out = { apply: false, repo: 'Luwi-developers/Luwi', ref: 'heads/main', local: '', sha: '', limit: 0, gh: DEFAULT_GH, repoRoot: process.cwd() }
  for (let i = 0; i < argv.length; i += 1) {
    const one = argv[i]
    if (one === '--apply') out.apply = true
    else if (one === '--repo') out.repo = argv[++i]
    else if (one === '--ref') out.ref = argv[++i]
    else if (one === '--local') out.local = argv[++i]
    else if (one === '--sha') out.sha = argv[++i]
    else if (one === '--limit') out.limit = Number(argv[++i]) || 0
    else if (one === '--gh') out.gh = argv[++i]
    else if (one === '--repo-root') out.repoRoot = argv[++i]
    else if (one === '--help' || one === '-h') out.help = true
    else throw new Error(`unknown argument: ${one}`)
  }
  // **默认写全名** (2026-11-14): 短名 `luwi/main` 在仓库里同时命中 `refs/heads/luwi/main`
  // 与 `refs/remotes/luwi/main`, git 取前者 —— 于是"对齐"完 ref, `git rev-parse luwi/main`
  // 仍旧回那条陈旧分支, 推送脚本的 base 也跟着错
  if (out.local === '') out.local = out.ref.replace(/^heads\//u, 'refs/remotes/luwi/')
  if (!out.local.startsWith('refs/')) out.local = `refs/remotes/${out.local}`
  return out
}

/** 跑一次 gh api, 返回解析好的 JSON (非 JSON 就原样回字符串) */
function ghApi(path, gh) {
  const raw = execFileSync(gh, ['api', path], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  try {
    return JSON.parse(raw)
  } catch (_notJson) {
    return raw
  }
}

/** 本地有没有这个对象 (任何类型) */
function hasObject(sha, cwd) {
  if (!/^[0-9a-f]{40}$/u.test(sha)) return true // 只认 SHA; 别的形态一律当"有", 不在这里挡
  try {
    execFileSync('git', ['cat-file', '-e', sha], { cwd, stdio: 'ignore' })
    return true
  } catch (_missing) {
    return false
  }
}

/** 本地这个对象是哪种类型 (没有就回空串) */
function objectType(sha, cwd) {
  try {
    return execFileSync('git', ['cat-file', '-t', sha], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (_missing) {
    return ''
  }
}

/**
 * 写一个 blob, 返回本地算出的 SHA
 * @param raw base64 内容 (API 给的就是 base64)
 */
function writeBlob(raw, cwd) {
  const buf = Buffer.from(String(raw).replace(/\n/gu, ''), 'base64')
  return execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd, input: buf, encoding: 'utf8' }).trim()
}

/**
 * 写一个 commit 对象, 返回本地算出的 SHA
 *
 * 两个来源各试一遍:
 * - `verification.payload`: GitHub 算签名时用的 commit **原文** (最稳), 但它**不带 `gpgsig` 头**
 *   —— 签名不能签自己; 而 SHA 是把 gpgsig 也算进去的, 所以带签名的提交要把 `verification.signature`
 *   按 git 的 `gpgsig` 缩进规则插回 committer 行之后 (空行写成一个空格)
 * - 自己拼: 拿 API 的 tree / parents / author / committer / message 拼一份, 给没有 payload 的老提交兜底
 *
 * 每种再试"带尾换行"与"不带" —— commit 体最后那个换行不是所有工具都写
 */
function writeCommit(meta, cwd) {
  const signature = typeof meta.verification?.signature === 'string' ? meta.verification.signature.replace(/\r\n/gu, '\n') : ''
  const payload = typeof meta.verification?.payload === 'string' && meta.verification.payload !== ''
    ? meta.verification.payload
    : ''
  const lines = [`tree ${meta.tree.sha}`]
  for (const parent of meta.parents ?? []) lines.push(`parent ${parent.sha}`)
  lines.push(`author ${signatureOf(meta.author)}`)
  lines.push(`committer ${signatureOf(meta.committer)}`)
  const built = `${lines.join('\n')}\n\n${meta.message}`
  const bases = payload === '' ? [built] : [payload, built]
  // 签名值的两种收尾 (git 存的是"不带尾换行"; 也有工具把最后那个换行写成一行空格)
  const sigVariants = signature === ''
    ? ['']
    : [signature.replace(/\n+$/u, ''), `${signature.replace(/\n+$/u, '')}\n`]
  const candidates = []
  for (const base of bases) {
    candidates.push(base)
    for (const sigText of sigVariants) {
      if (sigText !== '') candidates.push(withGpgSig(base, sigText))
    }
  }
  const seen = new Set()
  for (const base of candidates) {
    for (const text of [base, `${base}\n`]) {
      if (seen.has(text)) continue
      seen.add(text)
      const made = execFileSync('git', ['hash-object', '-w', '-t', 'commit', '--stdin'], { cwd, input: text, encoding: 'utf8' }).trim()
      if (made === meta.sha) return made
    }
  }
  return ''
}

/**
 * 把 API 给的签名按 git 的 `gpgsig` 头插回 commit 文本 (committer 行之后)
 *
 * git 的规矩: 第一行写 `gpgsig <第一行>`, 其余每行前面补一个空格 —— 签名里的空行就变成"一个空格".
 * **不像素级裁剪签名本身**: 末尾那个换行要不要留由调用方给定的变体决定 (实测 GitHub 的 merge
 * 提交, 签名值**带**尾换行才对得上 SHA), 这里只负责缩进
 */
function withGpgSig(text, signature) {
  const split = text.indexOf('\n\n')
  const head = split < 0 ? text : text.slice(0, split)
  const rest = split < 0 ? '' : text.slice(split)
  const lines = String(signature).split('\n')
  const block = [`gpgsig ${lines[0]}`, ...lines.slice(1).map((one) => ` ${one}`)].join('\n')
  return `${head}\n${block}${rest}`
}

/** `<名字> <邮箱> <unix 秒> <±HHMM>` */
function signatureOf(who) {
  const date = new Date(String(who.date))
  const seconds = Math.floor(date.getTime() / 1000)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${who.name} <${who.email}> ${String(seconds)} ${sign}${hh}${mm}`
}

/** 把 `git mktree` 的输入写成一个 tree 对象, 返回 SHA */
function writeTree(entries, cwd) {
  if (entries.length === 0) return ''
  const input = entries
    .map((one) => `${one.mode} ${one.type} ${one.sha}\t${one.name}\n`)
    .join('')
  return execFileSync('git', ['mktree'], { cwd, input, encoding: 'utf8' }).trim()
}

/**
 * 确保一个 tree 在本地 (缺了就按目录一层层重建), 返回是否成功
 *
 * 逐层 `GET /git/trees/<sha>` 而不是 `?recursive=1`: 大仓库的递归列表会 truncate, 而这里只在
 * "本地真缺这个 tree" 时才走 (合并提交那种情形, 树通常本地已经有了)
 */
const treeCache = new Map()
function ensureTree(sha, ctx) {
  if (treeCache.has(sha)) return treeCache.get(sha)
  if (objectType(sha, ctx.cwd) === 'tree') {
    treeCache.set(sha, true)
    return true
  }
  const page = ghApi(`repos/${ctx.repo}/git/trees/${sha}`, ctx.gh)
  if (!Array.isArray(page.tree)) throw new Error(`tree ${sha}: API gave no entries`)
  const entries = []
  for (const item of page.tree) {
    if (item.type === 'blob') {
      if (objectType(item.sha, ctx.cwd) !== 'blob') {
        const blob = ghApi(`repos/${ctx.repo}/git/blobs/${item.sha}`, ctx.gh)
        const made = writeBlob(blob.content, ctx.cwd)
        if (made !== item.sha) throw new Error(`blob mismatch at ${item.path}: api=${item.sha} local=${made}`)
        ctx.blobs += 1
      }
      entries.push({ mode: item.mode, type: 'blob', sha: item.sha, name: item.path.split('/').pop() })
    } else if (item.type === 'tree') {
      ensureTree(item.sha, ctx)
      entries.push({ mode: '040000', type: 'tree', sha: item.sha, name: item.path.split('/').pop() })
    } else if (item.type === 'commit') {
      // 子模块: 只用指针, 不拉内容
      entries.push({ mode: item.mode || '160000', type: 'commit', sha: item.sha, name: item.path.split('/').pop() })
    }
  }
  const made = writeTree(entries, ctx.cwd)
  if (made !== sha) throw new Error(`tree mismatch: api=${sha} local=${made}`)
  ctx.trees += 1
  treeCache.set(sha, true)
  return true
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('usage: node tools/lw-api-fetch.mjs [--apply] [--ref heads/main] [--local luwi/main] [--sha <sha>] [--limit N]')
    return 0
  }
  const ctx = { cwd: args.repoRoot, repo: args.repo, gh: args.gh, commits: 0, trees: 0, blobs: 0 }

  const target = args.sha !== ''
    ? args.sha
    : String(ghApi(`repos/${args.repo}/git/ref/${args.ref}`, args.gh).object?.sha ?? '')
  if (!/^[0-9a-f]{40}$/u.test(target)) throw new Error(`could not resolve ${args.ref} to a sha`)
  console.log(`repo: ${args.repo}`)
  console.log(`target ${args.ref} = ${target}`)

  const before = (() => {
    try {
      return execFileSync('git', ['rev-parse', args.local], { cwd: ctx.cwd, encoding: 'utf8' }).trim()
    } catch (_noRef) {
      return ''
    }
  })()
  console.log(`local ${args.local} = ${before === '' ? '(missing)' : before}`)
  if (before === target) {
    console.log('already at the target: nothing to fetch')
    return 0
  }

  // 从目标往回走: 本地已有的提交就剪枝 (它就是"接上"的那一点)
  const queue = [target]
  const visited = new Set()
  const missing = []
  while (queue.length > 0) {
    const sha = queue.shift()
    if (visited.has(sha)) continue
    visited.add(sha)
    if (hasObject(sha, ctx.cwd) && objectType(sha, ctx.cwd) === 'commit') continue
    const meta = ghApi(`repos/${args.repo}/git/commits/${sha}`, ctx.gh)
    if (meta.sha !== sha) throw new Error(`commit lookup mismatch: ${sha} -> ${meta.sha}`)
    missing.push(meta)
    for (const parent of meta.parents ?? []) queue.push(parent.sha)
    if (args.limit > 0 && missing.length > args.limit) {
      throw new Error(`more than ${String(args.limit)} commits missing — raise --limit if that is expected`)
    }
  }
  console.log(`missing commits: ${String(missing.length)}`)

  // 由旧到新写对象 (父先于子), 于是每个 commit 的 parent 一定已经在本地
  missing.sort((a, b) => 0)
  const written = []
  for (let round = 0; round < missing.length; round += 1) {
    const ready = missing.filter((one) => !written.includes(one.sha)
      && (one.parents ?? []).every((parent) => written.includes(parent.sha) || hasObject(parent.sha, ctx.cwd)))
    if (ready.length === 0) throw new Error('commit graph could not be ordered — bailing out')
    for (const meta of ready) {
      ensureTree(meta.tree.sha, ctx)
      const made = writeCommit(meta, ctx.cwd)
      if (made !== meta.sha) throw new Error(`commit mismatch at ${meta.sha.slice(0, 7)}: local=${made === '' ? '(no candidate matched)' : made}`)
      ctx.commits += 1
      written.push(meta.sha)
      if (!args.apply) continue
    }
    if (written.length === missing.length) break
  }

  const localTree = execFileSync('git', ['rev-parse', `${target}^{tree}`], { cwd: ctx.cwd, encoding: 'utf8' }).trim()
  const apiTree = String(ghApi(`repos/${args.repo}/git/commits/${target}`, args.gh).tree?.sha ?? '')
  if (localTree !== apiTree) throw new Error(`target tree differs: api=${apiTree} local=${localTree}`)
  console.log(`wrote ${String(ctx.commits)} commit(s), ${String(ctx.trees)} tree(s), ${String(ctx.blobs)} blob(s); target tree ${localTree} matches the API`)

  if (!args.apply) {
    console.log('dry run: the ref was NOT moved (rerun with --apply to move it)')
    return 0
  }
  execFileSync('git', ['update-ref', args.local, target], { cwd: ctx.cwd })
  const after = execFileSync('git', ['rev-parse', args.local], { cwd: ctx.cwd, encoding: 'utf8' }).trim()
  if (after !== target) throw new Error(`ref update returned ${after}, wanted ${target}`)
  console.log(`${args.local} is now ${after}`)
  return 0
}

let code = 0
try {
  code = main()
} catch (error) {
  console.error(`lw-api-fetch: ${error?.message ?? String(error)}`)
  code = 1
}
process.exit(code)
