#!/usr/bin/env node
/**
 * 预演 mneme 补丁: 某个版本还能不能打上、打完行为对不对
 *
 * 升级 mneme 之前先跑这条 —— 它是"以后更新补丁还能用吗"的可重跑答案:
 *
 * ```
 * node tools/check-mneme-patches.mjs --from npm --version 0.13.0
 * node tools/check-mneme-patches.mjs --dir <已解开的 mneme 包目录>
 * ```
 *
 * 两条都会把目标**复制到临时目录**再打补丁, 传入的目录不会被改动. 判据三件:
 *   1. 每处锚点恰好命中一次 (或该处已经打过了)
 *   2. 打完补丁能 import 起来
 *   3. 热记忆的行为对: "还没回答的当前轮"不进块, "答过的轮次"照常进
 *
 * 不碰设备、不碰 host 树; 需要的只有 npm registry (或一个已经解开的包目录)
 *
 * 用法: node tools/check-mneme-patches.mjs (--from npm --version <v> | --dir <包目录>)
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { applyMnemePatches, verifyHotMemory } from './pack-mneme-patches.mjs'

const workspace = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const scratch = join(workspace, '.lwtmp', 'mneme-patch-check')

/** Windows 上 npm 是 `npm.cmd`; 直接 exec 会被 Node 24 拒成 EINVAL, 走 cmd.exe 那一层 (同 pack-host) */
function runNpm(args, cwd) {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd, stdio: 'pipe' })
    return
  }
  execFileSync('npm', args, { cwd, stdio: 'pipe' })
}

/**
 * 从 npm 取一个版本, 解到临时目录
 *
 * `--cache` 指到工作区: 这台机器的默认 npm cache 在 C 盘用户目录, 沙箱里写不动
 * (EPERM), 而这不该让预演失败
 */
function packFromNpm(version) {
  const stage = join(scratch, 'stage')
  mkdirSync(stage, { recursive: true })
  const registry = process.env.LW_NPM_REGISTRY ?? 'https://registry.npmmirror.com'
  runNpm(
    [
      'pack',
      `@modusensus/dsh-mneme@${version}`,
      '--registry', registry,
      '--cache', join(scratch, 'npm-cache'),
      '--pack-destination', stage,
    ],
    stage,
  )
  const tarball = readdirSync(stage).find((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error(`npm pack produced no tarball for ${version}`)
  execFileSync('tar', ['-xzf', join(stage, tarball), '-C', stage], { stdio: 'pipe' })
  return join(stage, 'package')
}

/** 把一份包目录复制到临时目录, 返回副本根 */
function copyInto(source) {
  const copy = join(scratch, 'copy')
  cpSync(source, copy, { recursive: true })
  return copy
}

let result = 0
try {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      version: { type: 'string' },
      dir: { type: 'string' },
    },
  })

  let source
  if (values.from === 'npm') {
    if (typeof values.version !== 'string' || values.version === '') {
      throw new Error('--from npm needs --version, for example --version 0.13.0')
    }
    rmSync(scratch, { recursive: true, force: true })
    mkdirSync(scratch, { recursive: true })
    source = packFromNpm(values.version)
    console.log(`check-mneme-patches: packed @modusensus/dsh-mneme@${values.version} from npm`)
  } else if (typeof values.dir === 'string') {
    source = resolve(values.dir)
    if (!existsSync(join(source, 'package.json')) || !existsSync(join(source, 'lib'))) {
      throw new Error(`${source} is not a dsh-mneme package directory (package.json + lib/)`)
    }
    rmSync(scratch, { recursive: true, force: true })
    mkdirSync(scratch, { recursive: true })
  } else {
    throw new Error('usage: node tools/check-mneme-patches.mjs (--from npm --version <v> | --dir <package dir>)')
  }

  const packageRoot = copyInto(source)
  const patched = applyMnemePatches(packageRoot)
  for (const id of patched.applied) console.log(`  applied  ${id}`)
  for (const id of patched.already) console.log(`  already  ${id}`)
  for (const failure of patched.failures) console.log(`  FAILED   ${failure.id}: ${failure.reason}`)

  let hot = null
  let hotError = ''
  try {
    hot = await verifyHotMemory(packageRoot)
  } catch (error) {
    hotError = error?.message ?? String(error)
    console.log(`  FAILED   hot-memory behaviour: ${hotError}`)
  }

  if (patched.failures.length > 0 || hot === null) {
    result = 1
    console.log(
      `\ncheck-mneme-patches: FAIL (applied ${String(patched.applied.length)},`
        + ` already ${String(patched.already.length)}, failed ${String(patched.failures.length)})`,
    )
  } else {
    console.log(
      `\ncheck-mneme-patches: PASS (applied ${String(patched.applied.length)},`
        + ` already ${String(patched.already.length)}, failed 0,`
        + ` hot-memory ${String(hot.answered)} answered / ${String(hot.unanswered)} unanswered)`,
    )
  }
} catch (error) {
  result = 1
  console.log(`check-mneme-patches: FAIL (${error?.message ?? String(error)})`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

process.exit(result)
