/**
 * fork 的安卓补丁存在性判据 (2026-11-10)
 *
 * 0.2.2 换基座那次 (`d528918285`, 树来自 GitHub tag 归档) 把 fork 的本地补丁**整批**换回上游内容;
 * 之后的本地提交只补回了一部分, 而 `patch.md` 还写着"有"。症状是 2.8.0 上 `bash` 工具直接报
 * `spawn bash EACCES` —— 安卓没有 bash, 而 dsh 那一侧不读 app 早就指好的 `DSH_BASH`。
 *
 * 这个脚本把 `patch.md` 第 5/6/7/8 组钉成判据: 源码层按标记查 (缺哪组报哪组), 产物层 (`--tree`)
 * 真 import 打好的库跑一次 —— 于是"源码补了、树没重建"也红。
 *
 * 跑法:
 *   node tools/check-host-patches.mjs                          # 源码层
 *   node tools/check-host-patches.mjs --tree app/build/host-tree
 *   node tools/check-host-patches.mjs --dsh <checkout>         # 换一份 checkout
 *
 * 退出码 0 = 四组都在; 1 = 至少一组丢了, 或产物层的行为对不上。
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))

const { values } = parseArgs({
  options: {
    dsh: { type: 'string' },
    tree: { type: 'string' },
  },
  allowPositionals: false,
})

const dsh = resolve(root, values.dsh ?? 'third_party/deepseek-harness')
const tree = values.tree === undefined ? '' : resolve(root, values.tree)

let checks = 0
let failures = 0

/**
 * 一条判据: 名字 / 文件 / 必须出现的标记 (字符串或正则)
 *
 * 标记写的是**补丁的核心实现**, 不是注释里的句子: 补丁被换掉时它们必然一起消失。
 */
function check(name, file, patterns) {
  checks += 1
  const path = join(dsh, file)
  if (!existsSync(path)) {
    failures += 1
    console.log(`FAIL ${name}\n     ${file} 不存在`)
    return
  }
  return readFile(path, 'utf8').then((text) => {
    const missing = patterns.filter((pattern) => (
      typeof pattern === 'string' ? !text.includes(pattern) : !pattern.test(text)
    ))
    if (missing.length === 0) {
      console.log(`ok   ${name}`)
      return
    }
    failures += 1
    console.log(`FAIL ${name}\n     ${file} 里找不到: ${missing.map(String).join(' / ')}`)
  })
}

/* ── 源码层: patch.md 第 5/6/7/8 组 ─────────────────────────────────── */

const sourceChecks = [
  // 6. 部署方指定 bash 与 ripgrep
  check('6 bash-local 读 DSH_BASH 并用它拼 argv', 'packages/shell/bash-local/src/index.ts', [
    'process.env.DSH_BASH',
    /\[shellExecutable\(\), '-c', spec\.command\]/u,
  ]),
  check('6 tool-fs-search 先认 DSH_RG_PATH', 'packages/fs/tool-fs-search/src/search-core.ts', [
    'process.env.DSH_RG_PATH',
    /return configured/u,
  ]),

  // 5. 硬链接被平台拒绝时退化成独占拷贝
  check('5 fs-local 新建文件退成独占拷贝', 'packages/fs/fs-local/src/fsio.ts', [
    'function isLinkUnavailable(',
    /copyFile\(tempPath, absolutePath, fsConstants\.COPYFILE_EXCL\)/u,
  ]),
  check('5 会话 generation 退成独占拷贝', 'packages/session/session-persistence-jsonl/src/generation.ts', [
    'function isLinkUnavailable(',
    /copyFile\(staged, currentPath, fsConstants\.COPYFILE_EXCL\)/u,
  ]),
  check('5 会话日志 materialize 退成独占拷贝', 'packages/session/session-persistence-jsonl/src/index.ts', [
    /copyFile\(tmp, finalPath, fsConstants\.COPYFILE_EXCL\)/u,
  ]),
  check('5 附件两处发布退成独占拷贝', 'packages/attachment/attachment-local/src/store.ts', [
    'function publishExclusive(',
    /copyFile\(source, target, constants\.COPYFILE_EXCL\)/u,
  ]),

  // 8. 祖先 fsync 撞到打不开的目录时跳过
  check('8 附件祖先 fsync 遇 EACCES/EPERM 跳过', 'packages/attachment/attachment-local/src/store.ts', [
    /if \(code === 'EACCES' \|\| code === 'EPERM'\) return/u,
  ]),

  // 7. 全接口绑定改成显式开关
  check('7 web-app 有 --allow-lan 且通配地址要它', 'packages/bundle/web-app/src/startup.ts', [
    ".option('--allow-lan'",
    /options\.allowLan !== true/u,
  ]),
]

await Promise.all(sourceChecks)

/* ── 产物层: 打好的树真的按这两条接缝走 ─────────────────────────────── */

/** 一个只记账、不真起进程的 subprocess; 断言的是 argv[0] 用的是谁 */
function fakeSubprocess(calls) {
  return {
    spawn(spec) {
      calls.push(spec)
      const reader = () => ({ readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }) })
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: reader(), stderr: reader() },
        terminate() {},
      }
    },
  }
}

/**
 * 用打好的 bash-local 跑两次 `execute` (设了 / 没设 `DSH_BASH`), 读 argv[0]
 * @param treeDir host 树根。
 * @returns `{ configured, bare }` 两次的 argv[0]。
 */
async function bashArgv0(treeDir) {
  const module = await import(pathToFileURL(
    join(treeDir, 'node_modules', '@deepseek-ai', 'dsh-bash-local', 'lib', 'index.js'),
  ).href)
  const calls = []
  const ctx = { reflect: { provide() {} }, subprocess: fakeSubprocess(calls) }
  const config = {
    cwd: { get: () => root },
    timeoutMs: { get: () => 1_000 },
    maxTimeoutMs: { get: () => 1_000 },
    maxOutputBytes: { get: () => 1_024 },
    maxSpillBytes: { get: () => 1_024 },
    graceMs: { get: () => 1_000 },
  }
  const executor = new module.LocalBashExecutor(ctx, config)
  const spec = {
    command: 'true',
    workdir: root,
    timeoutMs: 1_000,
    onExpiry: 'kill',
    stdoutMaxBytes: 1_024,
  }
  const run = async () => {
    const execution = await executor.execute(spec)
    await execution.result()
    return calls.at(-1)?.argv?.[0]
  }
  const previous = process.env.DSH_BASH
  process.env.DSH_BASH = '/tmp/lw-fake-bash'
  let configured
  try {
    configured = await run()
  } finally {
    if (previous === undefined) delete process.env.DSH_BASH
    else process.env.DSH_BASH = previous
  }
  const bare = await run()
  return { configured, bare }
}

if (tree !== '') {
  checks += 1
  if (!existsSync(join(tree, 'node_modules', '@deepseek-ai', 'dsh-bash-local', 'lib', 'index.js'))) {
    failures += 1
    console.log(`FAIL 产物层: ${tree} 不是一棵 host 树`)
  } else {
    const argv = await bashArgv0(tree)
    const good = argv.configured === '/tmp/lw-fake-bash' && argv.bare === 'bash'
    if (!good) failures += 1
    console.log(
      `${good ? 'ok  ' : 'FAIL'} 产物层 bash-local 认 DSH_BASH`
        + (good ? '' : `\n     got  ${JSON.stringify(argv)}\n     want {"configured":"/tmp/lw-fake-bash","bare":"bash"}`),
    )
  }

  checks += 1
  const previousRg = process.env.DSH_RG_PATH
  process.env.DSH_RG_PATH = '/tmp/lw-fake-rg'
  let resolved
  let rgError = ''
  try {
    const rg = await import(pathToFileURL(
      join(tree, 'node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js'),
    ).href)
    resolved = await rg.resolveRgPath()
  } catch (error) {
    // 没补丁时会走到 @vscode/ripgrep 的 import, 而它在没有对应平台的机器上直接抛
    rgError = error instanceof Error ? error.message : String(error)
  } finally {
    if (previousRg === undefined) delete process.env.DSH_RG_PATH
    else process.env.DSH_RG_PATH = previousRg
  }
  const rgGood = resolved === '/tmp/lw-fake-rg'
  if (!rgGood) failures += 1
  console.log(
    `${rgGood ? 'ok  ' : 'FAIL'} 产物层 tool-fs-search 认 DSH_RG_PATH`
      + (rgGood ? '' : `\n     got  ${JSON.stringify(resolved)}${rgError === '' ? '' : ` (${rgError})`}\n     want "/tmp/lw-fake-rg"`),
  )
}

console.log('')
if (failures > 0) {
  console.log(`host-patches: ${failures}/${checks} 条判据不过 —— patch.md 第 5/6/7/8 组被换基座冲掉了?`)
  process.exit(1)
}
console.log(`host-patches: ${checks} 条判据全过 (patch.md 第 5/6/7/8 组都在)`)
