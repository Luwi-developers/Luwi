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

/* ── 四、开发屏的三块 (2.8.1 #F11) ─────────────────────────────────── */

/**
 * 开发屏从「一个 `key: value` 大文本 + 一颗刷新钮」改成三块: 项目卡 / 状态卡 / 动作行
 *
 * 这一节只认能真的判死的东西 —— 每一条都把行为钉在源码的某个形状上, 不做"出现过这个词"那种假绿:
 * 档↔徽标是一一对应的六对、进度条取的是档位给的数且只在构建中上屏、三块卡片是**固定高**、
 * 一秒一眼那趟先比签名、`stateOf` 按 last-build / progress 的**新旧**定档 (失败优先、末步仍在跑)。
 * 真机那三张图 (空态 / 构建中 / 构建失败) 由编排侧截图, 这里的原话断言只是把徽标钉住
 */
const dev = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/DevConsoleActivity.kt')
const stringsEn = await read('app/src/main/res/values/strings.xml')
const stringsZh = await read('app/src/main/res/values-zh/strings.xml')

const DEV_STATES = [
  'dev_state_empty', 'dev_state_idle', 'dev_state_building',
  'dev_state_success', 'dev_state_failed', 'dev_state_no_access',
]
const STATE_KEY = /<string name="(dev_(?:state|action)_[a-z_]+)"/g
const stateKeys = (xml) => [...xml.matchAll(STATE_KEY)].map((m) => m[1])
const stateText = (xml, key) => (xml.match(new RegExp(`<string name="${key}">([^<]*)</string>`)) || [, ''])[1]
const count = (haystack, needle) => haystack.split(needle).length - 1

check(
  '六档徽标键中英两份都在, 两份键与顺序一致',
  [
    [stringsEn, stringsZh].reduce((sum, xml) => sum + DEV_STATES.filter((key) => xml.includes(`name="${key}"`)).length, 0),
    JSON.stringify(stateKeys(stringsZh)) === JSON.stringify(stateKeys(stringsEn)),
  ],
  [DEV_STATES.length * 2, true],
)
check(
  '三张图那三档的中文原话',
  ['dev_state_empty', 'dev_state_building', 'dev_state_failed'].map((key) => stateText(stringsZh, key)),
  ['没有项目', '正在构建', '构建失败'],
)
// 档 ↔ 徽标必须一一对应: 少一对就是某档画成别人的字 (失败与无权限长一样那种)
const PHASE_BADGE = [...dev.matchAll(/DevState\(\s*DevPhase\.(\w+),\s*R\.string\.(dev_state_\w+)/g)]
  .map((m) => `${m[1]}=${m[2]}`)
  .filter((pair, index, all) => all.indexOf(pair) === index)
  .sort()
check(
  '档 ↔ 徽标一一对应 (六对)',
  PHASE_BADGE,
  [
    'BUILDING=dev_state_building', 'EMPTY=dev_state_empty', 'FAILED=dev_state_failed',
    'IDLE=dev_state_idle', 'NO_ACCESS=dev_state_no_access', 'SUCCESS=dev_state_success',
  ],
)
check(
  '进度条取档位给的数, 且只在构建中上屏',
  [
    /import android\.widget\.ProgressBar/.test(dev),
    /stepBar\.max = state\.total/.test(dev) && /stepBar\.progress = state\.step/.test(dev),
    /stepBar\.visibility = if \(state\.phase == DevPhase\.BUILDING\) View\.VISIBLE else View\.INVISIBLE/.test(dev),
  ],
  [true, true, true],
)
// 等高只钉下限不算: 内容一变高还是会跳, 所以三块卡片是固定高 (且不再用 minimumHeight)
check(
  '三块卡片固定等高 (下限高不算)',
  [count(dev, 'dp(CARD_HEIGHT_DP)'), /minimumHeight/.test(dev)],
  [3, false],
)
check(
  'render() 不再整段写 body.text, 一秒一眼先比签名',
  [
    !/body\.text = lines\.joinToString/.test(dev) && !/lateinit var body: TextView/.test(dev),
    /if \(signature == lastSignature\) return/.test(dev),
  ],
  [true, true],
)
check(
  '空态那颗钮能按且落到 设置 → 开发',
  /DevPhase\.EMPTY, R\.string\.dev_state_empty, R\.string\.dev_action_open_settings\)/.test(dev)
    && /private fun openSettings\(\)/.test(dev)
    && /PortalAsk\.ask\(PortalAsk\.Target\.SETTINGS\)/.test(dev)
    && /primary\.setOnClickListener/.test(dev),
  true,
)

/** 取一个函数体 (从签名后第一个 `{` 起按大括号配平), 静态判"这一段里没有别的东西"用 */
function bodyOf(source, signature) {
  const start = source.indexOf(signature)
  if (start < 0) return ''
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] !== '}') continue
    depth -= 1
    if (depth === 0) return source.slice(source.indexOf('{', start), i + 1)
  }
  return ''
}

const stateBody = bodyOf(dev, 'fun stateOf(')
check(
  'stateOf 是纯函数, 且按 ok/at 定档 (失败优先 / progress 更新才算在跑 / 末步仍算在跑)',
  [
    stateBody.length > 0
      && !/findViewById|getString\(|\bFile\(|ForgeConsole|\bcontext\b/.test(stateBody),
    /build != null && !build\.ok && buildAt >= progressAt/.test(stateBody),
    /step != null && progressAt > buildAt/.test(stateBody),
    !/step\.index < step\.total/.test(stateBody),
  ],
  [true, true, true, true],
)
// 读数取的是 progress.json 里的总步数, 不是写死的数: 工坊那五步加上 badging / verify 一共 8 步
check(
  'step 读数取 progress.json 的总步数 (工坊 8 步, 不写死)',
  [
    stateText(stringsEn, 'dev_state_step'),
    stateText(stringsZh, 'dev_state_step'),
    /getString\(R\.string\.dev_state_step, state\.step, state\.total\)/.test(dev),
    ['compile', 'link', 'javac', 'dex', 'merge', 'sign', 'badging', 'verify']
      .filter((id) => plan.includes(`"${id}"`)).length,
  ],
  ['step %1$d/%2$d', 'step %1$d/%2$d', true, 8],
)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks}`)
process.exit(failures === 0 ? 0 : 1)
