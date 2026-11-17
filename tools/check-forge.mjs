/**
 * 手机应用工坊那一套的判据 (2.8.1)
 *
 * 三处必须一致, 一处漂了就是"模型以为能做, 实际调不通"或者"某一面绕开了闸":
 *
 *   1. `host-plugin` 的 `lw_forge` 工具 (参数与 op 表)
 *   2. 应用侧的 `tool/LwForge.kt` (dispatch 的 op 表) 与 `forge/ForgePlan.kt` (五步 argv 的形状)
 *   3. 文档 `23-2.8.1-开发台与工坊.md` 的那张 op 表
 *
 * 另外两条是硬规矩: **不许出现 shell 拼串** (`sh -c` / `Runtime.exec`), 以及**没有 zipalign**
 * (侧载不要求 4 字节对齐, 这一条是 2.8.1 拍的口径, 见 docs 20)
 *
 * 跑法: node tools/check-forge.mjs   (不需要设备)
 */

import { readFile, readdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

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

const OPS = [
  'init', 'meta', 'icon', 'status', 'logs', 'toolchain', 'create',
  'build', 'install', 'screen', 'preview', 'back',
]

const host = await read('host-plugin/index.mjs')
const forgeDispatch = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwForge.kt')
const plan = await read('app/src/main/java/io/github/yuloong07star/luwi/forge/ForgePlan.kt')
const build = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/LwForgeBuild.kt')
const exec = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/LwForgeExec.kt')
const bridge = await read('app/src/main/java/io/github/yuloong07star/luwi/channel/PrivilegedBridge.kt')
const path = await read('app/src/main/java/io/github/yuloong07star/luwi/forge/ProjectPath.kt')
const docs = await read('../docs/Luwi-2.8.x/23-2.8.1-开发台与工坊.md')

/* ── 一、host 那一侧 ─────────────────────────────────────────────────── */

check('host 有 lw_forge', /name: 'lw_forge'/.test(host), true)
const enumAt = host.indexOf("enum: ['init', 'meta', 'icon'")
check('host 的 op 枚举齐 11 个', enumAt > 0, true)
const enumBody = host.slice(enumAt, host.indexOf(']', enumAt))
check(
  'host 的 op 枚举逐个对得上',
  OPS.filter((op) => enumBody.includes(`'${op}'`)).length,
  OPS.length,
)
check(
  '主动场动作表把 lw_forge 的读面登记了',
  /\[ 'lw_forge', new Set\(\[ 'status', 'logs' \]\) \]/.test(host)
    || /\['lw_forge', new Set\(\['status', 'logs'\]\)\]/.test(host),
  true,
)

/* ── 二、应用那一侧 ─────────────────────────────────────────────────── */

check('桥上有 forge 这条方法', /"forge" -> appContext \{ LwForge\.dispatch/.test(bridge), true)
check(
  'LwForge.dispatch 认的 op 与 host 一致',
  OPS.filter((op) => forgeDispatch.includes(`"${op}" ->`)).length,
  OPS.length,
)
check('ForgePlan 里有五步的 id', ['compile', 'link', 'javac', 'dex', 'merge', 'sign', 'badging', 'verify']
  .filter((step) => plan.includes(`"${step}"`)).length, 8)
check('ForgePlan 里没有 zipalign', /"zipalign"/.test(plan), false)
check('ForgePlan 里没有 shell 拼串', /sh -c|Runtime\.exec|ProcessBuilder/.test(plan), false)
check('LwForgeBuild 处理三种本地步骤', ['dex-merge', 'jar', 'copy']
  .filter((kind) => build.includes(`"${kind}" ->`)).length, 3)
check('LwForgeBuild 的 argv[0] 只认工具链目录', /underRoot\(File\(binary\), File\(LwForgeExec\.TOOLCHAIN_DIRECTORY\)\)/.test(build), true)
check('LwForgeExec 的清单形状有白名单', /shapeProblem/.test(exec), true)
check('装不上时把包交给系统安装器', /CompanionApk\.install\(context, apk/.test(forgeDispatch), true)
check('项目根这一层叫 app-projects', /const val PARENT = "app-projects"/.test(path), true)

/* ── 三、文档与目录约定 ─────────────────────────────────────────────── */

check(
  'docs 23 的 op 表逐行在',
  OPS.filter((op) => docs.includes(`\`${op}\``)).length,
  OPS.length,
)
check('docs 23 说清了"对齐自己写"', /对齐自己写/.test(docs), true)
const aidl = []
for (const dir of ['app']) {
  const found = await readdir(new URL(`${dir}/src/main`, root), { recursive: true }).catch(() => [])
  found.filter((name) => String(name).endsWith('.aidl')).forEach((name) => aidl.push(`${dir}/${name}`))
}
check('仓库里没有 .aidl', aidl, [])

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks}`)
process.exit(failures === 0 ? 0 : 1)
