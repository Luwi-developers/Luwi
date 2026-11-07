/**
 * 游离分支的闸: `agent/*` 做完却没进 main 的那些, 收口 / 发版前必须有人看过
 *
 * 为什么要有这一条 (2026-11-07 的教训): `agent/2.8.0-ready-models` 的三个提交 (引导卡四件 +
 * 两个模型下载 + 居中对话框 + 去掉虚拟屏) 在 11-04 20:26 就做完并推了远端, 但**既没开 PR,
 * 落实表里也没这一条**。2.8.0 收口按 PR 与表核对, 就把这一支漏在外面 —— 真机上看到的是旧的三件
 * 内嵌卡, 谁也没发现, 一直到 11-07 装机才暴露出来
 *
 * 判据只有一句:
 *
 *   > **发版 tag 之后新建的分支, 如果 tip 还没进 main, 就必须在 `branch-drift-allow.json` 里
 *   > 写明理由。**
 *
 * 为什么不用"内容差"判: 分支与 main 各自往前走了几十个提交之后, 文件差异只能说明"两边都改过",
 * 判不出"这一支的改动进了没有" (实测这样判会给 47 个分支里挑出 42 个, 全是假红)。而流程闭环
 * (这一支 → 合入 main) 是能判准的, 漏的也正是这一环
 *
 * 为什么要 `--since`: 仓库里有一批 10 月就停住的实验分支与公开树导出分支, 它们既不进 main 也
 * 不该管; 只盯**这次发版周期里新起的**分支, 红的人才看得懂它在说什么
 *
 * 用法:
 *   node tools/check-branch-drift.mjs                   # 看发版 tag 之后的
 *   node tools/check-branch-drift.mjs --since v2.7.10   # 点名从哪个 tag 之后算 (缺省: 最新 tag)
 *   node tools/check-branch-drift.mjs --bootstrap       # 把当前这些写进 allow 表 (初始化用)
 *   node tools/check-branch-drift.mjs --all             # 不看 tag, 全仓扫 (诊断用, 会很红)
 *
 * 退出码: 0 干净 / 1 有游离分支
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const allowPath = join(here, 'branch-drift-allow.json')

/** 主仓远端名: 上游 `origin` (Miuzarte/LittleWhale) 的分支不该进这张表 */
const MAIN_REMOTE = 'luwi'

const args = process.argv.slice(2)
const bootstrap = args.includes('--bootstrap')
const all = args.includes('--all')
const sinceArg = (() => {
  const at = args.indexOf('--since')
  return at >= 0 ? args[at + 1] : null
})()

const git = (argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8' }).trim()

/** 一条命令的结果可能是空 (没有 tag / 没有匹配), 失败也不算错 */
const gitOr = (argv, fallback = '') => {
  try {
    return execFileSync('git', argv, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return fallback
  }
}

/** `ref` 是不是 `main` 的祖先 —— 是就说明这一支的内容已经在主线上了 */
const isMerged = (ref) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ref, 'main'], { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/* ── 一、从哪个点往后算 ──────────────────────────────────────────────── */

const since = all ? null : (sinceArg ?? gitOr(['describe', '--tags', '--abbrev=0', 'main'])) || 'main'

/* ── 二、白名单 ──────────────────────────────────────────────────────── */

const allow = existsSync(allowPath)
  ? JSON.parse(readFileSync(allowPath, 'utf8'))
  : { branches: [] }
const allowed = new Map((allow.branches ?? []).map((one) => [one.name, one]))

/* ── 三、逐个分支判 ──────────────────────────────────────────────────── */

const refs = gitOr([
  'for-each-ref',
  '--format=%(refname)%09%(refname:short)%09%(committerdate:short)%09%(objectname)',
  'refs/heads',
  `refs/remotes/${MAIN_REMOTE}`,
])
  .split('\n')
  .map((line) => line.split('\t'))
  .filter(([full]) => Boolean(full))

/** 只认本地分支与主仓远端分支; 远端那一份去掉前缀后与本地同名, 合并成一条 */
const seen = new Map()
for (const [full, name, date, oid] of refs) {
  if (name === 'main' || name === `${MAIN_REMOTE}/main` || name.endsWith('/HEAD')) continue
  if (name.startsWith('origin/')) continue
  const bare = name.startsWith(`${MAIN_REMOTE}/`) ? name.slice(MAIN_REMOTE.length + 1) : name
  const remote = name.startsWith(`${MAIN_REMOTE}/`)
  const current = seen.get(bare)
  // 同一条分支两边都有: 留本地那一份的读数 (远端那份只是镜像), 但记下"远端也有"。
  // 本地没有、只有远端的那种 (公开树导出分支) 也得有一条 —— 它的 ref 是 `refs/remotes/...`,
  // 直接拿短名去喂 git 会因为"本地没有这个名字"解析成路径而报歧义
  if (!current || (current.remote && !remote)) {
    seen.set(bare, { name: bare, ref: full, date, oid, remote })
  } else if (remote) {
    current.remoteAlso = true
  }
}

const failures = []
const now = new Date()
for (const branch of seen.values()) {
  if (allowed.has(branch.name)) continue

  // 已经进 main 的: 不管它叫什么
  if (isMerged(branch.ref)) continue

  // 这个发版周期里有没有它的提交
  if (since) {
    const ahead = Number(gitOr(['rev-list', '--count', `${since}..${branch.ref}`], '0'))
    if (!Number.isFinite(ahead) || ahead === 0) continue
  }

  const subject = gitOr(['log', '-1', '--format=%s', branch.ref])
  const aheadOfMain = Number(gitOr(['rev-list', '--count', `main..${branch.ref}`], '0'))
  const ageDays = Math.max(
    0,
    Math.round((now - new Date(`${branch.date}T00:00:00`)) / 86_400_000),
  )
  failures.push({ ...branch, subject, ahead: aheadOfMain, ageDays })
}

/* ── 四、报 ──────────────────────────────────────────────────────────── */

failures.sort((a, b) => (a.date < b.date ? 1 : -1))

if (bootstrap) {
  /**
   * 登记时先按分支名给一句大致的理由, 人再逐条改真话
   *
   * 为什么要猜: 这个仓库里有一批分支天生就不该进 main (公开树导出 / 长期保留的分支名 / sa 工作
   * 分支), 它们与"做完忘了合"在 git 看来一模一样; 一律写"待补"会让人对着三十多条无从下手
   */
  const guessWhy = (name) => {
    if (/(^|\/)(feat|split|release|backup)\//u.test(name)) {
      return '长期保留的分支名 (不是某个任务的 agent 分支), 不进 main'
    }
    if (/(-pub|-r2)$/u.test(name)) {
      return '公开树导出 (只读镜像, 内容随 PR 走, 本身不进 main)'
    }
    if (/-main-sync$/u.test(name)) {
      return '同步用的临时分支 (把 main 的改动带回来用, 用完即弃)'
    }
    if (/^agent\/sa-/u.test(name)) {
      return 'superagent 工作分支, 成果已由 PR 的 merge 提交进 main'
    }
    return '已合 (PR squash 或按文件精搬), 分支留作对照'
  }
  const rows = [
    ...(allow.branches ?? []),
    ...failures
      .filter((one) => !allowed.has(one.name))
      .map((one) => ({
        name: one.name,
        why: guessWhy(one.name),
        since: since ?? 'all',
      })),
  ]
  writeFileSync(
    allowPath,
    `${JSON.stringify({ ...allow, branches: rows }, null, 2)}\n`,
    'utf8',
  )
  console.log(`已把 ${failures.length} 条写进 tools/branch-drift-allow.json`)
  console.log('下一步: 逐条看一眼 why 是不是真话 —— 尤其是"已合"那一条, 合没合得上 git 说了不算, 表说了算')
  process.exit(0)
}

console.log(`游离分支检查 (从 ${since ?? '全仓'} 之后算)`)
console.log('')

if (failures.length === 0) {
  console.log(`ok   ${since ?? '全仓'} 之后新起的分支都进 main 了`)
  console.log(`\n1 / 1 条判据通过`)
  process.exit(0)
}

for (const one of failures) {
  console.log(`FAIL ${one.name}  领先 main ${one.ahead} 个提交, 最后一条 ${one.date} (${one.ageDays} 天前)`)
  console.log(`     ${one.subject}`)
}
console.log('')
console.log(`${failures.length} 条分支没进 main, 也不在 tools/branch-drift-allow.json 里`)
console.log('两条路, 选一条:')
console.log('  1. 合进 main (开 PR 或按文件精搬), 合完这一条自己就消失')
console.log('  2. 真的不打算合 (撤了 / 换成别的分支进的 / 只留作对照): 在 allow 表里写一条 why')
process.exit(1)
