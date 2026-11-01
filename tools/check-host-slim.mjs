/**
 * host 树逐文件裁剪的判据 (2026-10-29)
 *
 * `tools/pack-host.mjs` 末尾那一段裁剪把 host 树从 ~99 MB 砍到 ~62 MB, 依据是"安卓上到底有没有人
 * 读": win32/darwin 预编译、.pdb/.exe、.map、.d.ts、README 那类 .md、测试目录与测试文件。它裁掉的
 * 都是**运行时不读**的东西, 但"不读"这个判断错了不会报错 —— 只会在设备上变成某个插件静默坏掉。
 *
 * 所以这份脚本做两件事:
 *
 *   1. 源码形状: 六条规则一条都不许被删 (防将来的"顺手清理"); 保留项 (LICENSE / linux prebuild /
 *      wasm) 不许被写进规则里
 *   2. 真树实况: `build/host-tree` 在的时候, 按同一套规则重新扫一遍, 数它还剩几个该裁的文件;
 *      树不在就明说跳过 (不假装通过)
 *
 * 跑法: node tools/check-host-slim.mjs
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packer = await readFile(join(root, 'tools', 'pack-host.mjs'), 'utf8')

let failures = 0
let checks = 0
function check(name, got, want) {
  checks += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  if (!same) failures += 1
  console.log(
    `${same ? 'ok  ' : 'FAIL'} ${name}`
      + (same ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
  )
}

/* ── 一、六条规则与保留项 ─────────────────────────────────────────────── */

check('平台预编译按四个 Windows 与 darwin 前缀剔', [
  /const SLIM_PLATFORM_DROP = \['win32-x64', 'win32-arm64', 'win10-x64', 'win10-arm64', 'darwin-'\]/u.test(packer),
], [true])

check('四类后缀规则都在', [
  /name\.endsWith\('\.pdb'\) \|\| name\.endsWith\('\.exe'\)/u.test(packer),
  /name\.endsWith\('\.map'\)/u.test(packer),
  /name\.endsWith\('\.d\.ts'\)/u.test(packer),
  /name\.endsWith\('\.md'\) && !name\.includes\('LICENSE'\)/u.test(packer),
], [true, true, true, true])

check('测试目录与测试文件都收', [
  /const SLIM_TEST_DIR = \/\(\^\|\\\/\)\(test\|tests\|__tests__\)/u.test(packer),
  /const SLIM_TEST_FILE = \/\\\.\(test\|spec\)/u.test(packer),
], [true, true])

check('linux prebuild 不在剔除名单里 (sharp 的 wasm 同理)', [
  packer.includes("'linux-x64'"),
  packer.includes("'linux-arm64'"),
], [false, false])

check('裁剪真的挂在流程末尾 (所有拷贝之后)', [
  /const beforeSlim = measure\(out\)/u.test(packer),
  /const slimmed = slim\(out\)/u.test(packer),
], [true, true])

/* ── 二、真树实况 ─────────────────────────────────────────────────────── */

const treeCandidates = [
  join(root, 'app', 'build', 'host-tree'),
  join(root, 'build', 'host-tree'),
]
const tree = treeCandidates.find((candidate) => existsSync(candidate)) ?? treeCandidates[0]
const PLATFORM_DROP = ['win32-x64', 'win32-arm64', 'win10-x64', 'win10-arm64', 'darwin-']
const TEST_DIR = /(^|\/)(test|tests|__tests__)(\/|$)/
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]s$/

/** 与 pack-host.mjs 同一套判据, 这里独立写一份: 判据不能拿被测实现来验自己 */
function shouldHaveBeenDropped(name) {
  if (PLATFORM_DROP.some((mark) => name.includes(mark))) return true
  if (name.endsWith('.pdb') || name.endsWith('.exe')) return true
  if (name.endsWith('.map')) return true
  if (name.endsWith('.d.ts')) return true
  if (name.endsWith('.md') && !name.includes('LICENSE')) return true
  if (TEST_DIR.test(name)) return true
  if (TEST_FILE.test(name)) return true
  return false
}

let leftover = 0
let leftovers = []
let wasm = 0
let licenses = 0
if (!existsSync(tree)) {
  console.log('skip  build/host-tree 不存在, 真树那一段没跑 (先跑 pack-host 再来)')
} else {
  const walk = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path, name)
      } else {
        if (shouldHaveBeenDropped(name)) {
          leftover += 1
          if (leftovers.length < 10) leftovers.push(name)
        }
        if (name.endsWith('.wasm')) wasm += 1
        if (name.includes('LICENSE')) licenses += 1
      }
    }
  }
  await walk(tree, '')
  check('树上没有该裁掉却还留着的文件', [leftover, leftovers], [0, []])
  check('保留项还在 (wasm 与 LICENSE 都有)', [wasm > 0, licenses > 0], [true, true])
}

/* ── 收尾 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exitCode = failures === 0 ? 0 : 1
