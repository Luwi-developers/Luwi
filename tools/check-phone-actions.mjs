/**
 * 手机直连那一条的判据表 (2.8.0 B3-c, `12-2` / `12-3`)
 *
 * 快应用有两种结局, 而且两种都不能建屏: 设备上注册了 runtime 就直接把 deep link 交给它; 没有就
 * 明确回 unsupported. 这一条链从提示词一路到桥, 任何一处写成"失败就建一块屏再试"都会把一个
 * 简单的能力问题变成长时间占着一块屏, 而真机上快应用 runtime 有就有、没有也没有 (模拟器上通常
 * 没有), 所以这些边界必须在不接设备的时候也量得到
 *
 * 这里量的是源码与工具定义, 不需要设备:
 *
 *   1. `QuickAppCapability.kt` 存在, 链接按官方三种写法拼, 包名不像包名就不发
 *   2. 那条路上**没有任何建屏调用** (⑫ 静态判据)
 *   3. 不可用时那句答案明确是 unsupported, 且点名建屏不会让快应用开起来 (⑩)
 *   4. action 表里 quick_app 只走 deep link, 失败原因是 unsupported, 从不含虚拟屏 (⑩)
 *   5. 桥上有 capabilities / quickapp 两条方法, quickapp 分支不读屏也不建屏
 *   6. 插件注册了 `lw_capabilities` 与 `lw_quickapp`, 参数里没有 displayId, 说明里写明不建屏
 *   7. `lw_quickapp` 的执行只调 quickapp 这一条桥方法 (⑫ 的另一半)
 *   8. phone.md 的固定优先级按 native -> intent / deep link -> 无障碍 -> 虚拟屏 -> unsupported
 *      的顺序写着, 且点名两条新工具 (⑪)
 *
 * 用法: node tools/check-phone-actions.mjs
 * 退出码: 0 = 每一条都成立; 1 = 有失败项 (逐条印出哪一条与它的判据)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const check = (() => {
  let failures = 0
  let checks = 0
  return {
    run(name, okay, detail = '') {
      checks += 1
      if (okay) {
        console.log(`ok   ${name}`)
      } else {
        failures += 1
        console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`)
      }
    },
    done() {
      console.log(`\n${checks - failures}/${checks} 条通过`)
      return failures === 0
    },
  }
})()

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** 一段源码里从 [from] 到 [to] 的那一截 (找不到端点就取到结尾) */
function between(text, from, to) {
  const start = text.indexOf(from)
  if (start < 0) return ''
  const end = text.indexOf(to, start + from.length)
  return text.slice(start, end < 0 ? text.length : end)
}

/* ── 一、快应用自己那一条路: 拼链接、认链接、不建屏 ─────────────────────── */

const quick = source('../app/src/main/java/io/github/yuloong07star/luwi/channel/QuickAppCapability.kt')

check.run(
  '快应用的能力实现在 QuickAppCapability.kt (probe 与 open 两档)',
  quick.includes('internal object QuickAppCapability')
    && quick.includes('fun probe(')
    && quick.includes('fun open('),
  '这一份是 12-2 / 12-3 的唯一落点, probe 只问不打开, open 才发链接',
)
check.run(
  '标准链接按官方三种写法: hap://app/ 与 http(s)://hapjs.org/app/',
  quick.includes('const val SCHEME = "hap"')
    && quick.includes('const val HOST = "app"')
    && quick.includes('const val WEB_HOST = "hapjs.org"')
    && quick.includes('const val WEB_PREFIX = "/app/"')
    && quick.includes('fun linkProblem(')
    && quick.includes('fun candidatesFor('),
  '快应用只认 hap://app/<package> 与 hapjs.org 那两条网页形态; 别的链接发出去会打开别的东西',
)
check.run(
  '包名不像包名时直接拒绝, 不拼一条会失败的链接',
  quick.includes('fun linkFor(')
    && quick.includes('if (!PACKAGE.matches(name)) return null')
    && quick.includes('is not a package name'),
  '拿中文名或网页地址进 runtime 只会得到"应用不存在", 看起来像设备不支持',
)
check.run(
  '快应用这一条不建屏: 源码里没有任何建屏调用 (⑫)',
  !/VirtualScreen|createDisplay|DISPLAY_CREATE|screenCreate|lw_screen_create/.test(quick),
  'QuickAppCapability 只许问 PackageManager 与发 Intent; 建屏调用一处都不许出现',
)
check.run(
  '不可用时的答案是 unsupported, 并且点名建屏没用 (⑩)',
  quick.includes('const val UNSUPPORTED = "unsupported"')
    && quick.includes('fun noRuntimeReason(')
    && quick.includes('a virtual screen cannot make a quick app open'),
  '没有 runtime 时不能只说"没打开": 要说清这不是换条路能解决的',
)
check.run(
  '探测与打开都只读一次包表 / 发 Intent, 不走特权通道',
  quick.includes('queryIntentActivities(')
    && quick.includes('context.startActivity(')
    && !quick.includes('PrivilegedChannel'),
  '快应用 runtime 是别的应用, 本应用只需要 ACTION_VIEW; 借特权 am 或建屏都是走错路',
)

/* ── 二、动作表: quick_app 只有 deep link, 终态是 unsupported ────────────── */

const registry = source('../app/src/main/java/io/github/yuloong07star/luwi/channel/DeviceActionRegistry.kt')
const brokerTest = source(
  '../app/src/test/java/io/github/yuloong07star/luwi/channel/DeviceActionBrokerTest.kt',
)
const quickAction = between(registry, 'name = "quick_app"', 'name = "calendar"')

check.run(
  'quick_app 的首选通道是 deep link, 权限与失败原因都写出来 (12-4)',
  quickAction.includes('via = DeviceRoute.DEEP_LINK')
    && quickAction.includes('permission = ')
    && quickAction.includes('failureReason = ')
    && quickAction.includes('fallbacks = listOf(DeviceRoute.UNSUPPORTED)'),
  'quick_app 这一条要能说清"走哪条路 / 要什么权限 / 不行时说什么"',
)
check.run(
  'quick_app 的通道表里没有虚拟屏 (⑩)',
  quickAction.length > 0 && !quickAction.includes('VIRTUAL_SCREEN'),
  '注册表里写进虚拟屏, 主屏那一条就迟早会为快应用建一块屏',
)
check.run(
  '路由测试钉住"快应用失败也不建屏"',
  brokerTest.includes('快应用只走 deep link, 失败也不建屏')
    && brokerTest.includes('DeviceRoute.VIRTUAL_SCREEN !in broker.routes("quick_app", 0)')
    && brokerTest.includes('DeviceRoute.VIRTUAL_SCREEN !in broker.routes("quick_app", 7)'),
  'DeviceActionBrokerTest 里那一条是行为层的判据, 不许删',
)

/* ── 三、桥: capabilities / quickapp 两条方法 ────────────────────────────── */

const bridge = source('../app/src/main/java/io/github/yuloong07star/luwi/channel/PrivilegedBridge.kt')
const quickBranch = between(bridge, '"quickapp" -> appContext', '// Start an app onto one screen')

check.run(
  '桥上有 capabilities 方法, 读的是动作表与路由, 不另存一份',
  bridge.includes('"capabilities" -> appContext')
    && bridge.includes('DeviceActionRegistry.actions.forEach')
    && bridge.includes('actions.routes(action, LwServiceProtocol.MAIN_DISPLAY)')
    && bridge.includes('put("failureReason", action.failureReason)'),
  'lw_capabilities 的每一行都要来自 DeviceActionRegistry / DeviceActionBroker',
)
check.run(
  '桥上有 quickapp 的 probe 与 open 两档, 只转给 QuickAppCapability',
  bridge.includes('"quickapp" -> appContext')
    && bridge.includes('QuickAppCapability.probe(context)')
    && bridge.includes('QuickAppCapability.open(')
    && /quickapp has to be probe or open/.test(bridge),
  '桥这一层不自己拼链接, 也不自己判断可用性',
)
check.run(
  'quickapp 分支不读屏、不建屏 (⑩)',
  quickBranch.length > 0
    && !/namedScreen|VirtualScreen|screen_create|createDisplay/.test(quickBranch),
  '这一条分支只许有 probe / open 两条路; 出现一个读屏或建屏的调用就说明走歪了',
)
check.run(
  'capabilities 是只读的: 不发 Intent, 不建屏',
  between(bridge, '"capabilities" -> appContext', '"quickapp" -> appContext').length > 0
    && !/startActivity|VirtualScreen|screen_create/.test(
      between(bridge, '"capabilities" -> appContext', '"quickapp" -> appContext'),
    ),
  '这一条是给模型"先看一眼"的, 不是一次动作',
)

/* ── 四、插件: 两个新工具与它们的参数 ────────────────────────────────────── */

const registered = []
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  },
  on() {},
}

const plugin = await import(pathToFileURL(resolve('host-plugin/index.mjs')).href)
plugin.apply(ctx)

const capabilities = registered.find((tool) => tool.name === 'lw_capabilities')
const quickApp = registered.find((tool) => tool.name === 'lw_quickapp')
const pluginSource = source('../host-plugin/index.mjs')
const quickToolSource = between(pluginSource, "name: 'lw_quickapp'", "name: 'lw_launch'")

check.run('插件: 有 lw_capabilities 与 lw_quickapp', capabilities !== undefined && quickApp !== undefined)
check.run(
  '插件: lw_capabilities 说明里念到 via / permission / risk / 失败原因, 且不建屏',
  typeof capabilities?.description === 'string'
    && /route/i.test(capabilities.description)
    && /permission/i.test(capabilities.description)
    && /risk/i.test(capabilities.description)
    && /when every route fails/i.test(capabilities.description)
    && /creates no virtual screen/i.test(capabilities.description),
  '模型得先知道这条动作走哪条路、要什么权限、不行时说什么, 才不会直接去建屏',
)
check.run(
  '插件: lw_capabilities 不是一条动作 (没有 displayId)',
  capabilities !== undefined
    && capabilities.parameters?.properties?.displayId === undefined,
  '能力是读出来的, 与哪块屏无关',
)
check.run(
  '插件: lw_quickapp 的 op 只有 probe / open',
  JSON.stringify(quickApp?.parameters?.properties?.op?.enum) === JSON.stringify(['probe', 'open']),
  `got ${JSON.stringify(quickApp?.parameters?.properties?.op?.enum)}`,
)
check.run(
  '插件: lw_quickapp 没有 displayId (快应用不落在虚拟屏上)',
  quickApp !== undefined && quickApp.parameters?.properties?.displayId === undefined,
  '给这条工具一个 displayId, 模型下一步就会拿它去建屏',
)
check.run(
  '插件: lw_quickapp 说明里写明 unsupported 与不建屏',
  typeof quickApp?.description === 'string'
    && /unsupported/i.test(quickApp.description)
    && /no virtual screen/i.test(quickApp.description),
  '说明里不写清, 模型遇到失败就会退到虚拟屏那一档',
)
check.run(
  '插件: lw_quickapp 的执行只调 quickapp 这一条桥方法 (⑫)',
  quickToolSource.includes("call('quickapp'")
    && !/call\('(?:screen|create|display|launch)'/.test(quickToolSource),
  '快应用这一条与建屏之间不该有任何代码路径',
)
check.run(
  '插件: 两条工具都有能念给模型的格式 (答出结果, 不是裸 JSON)',
  pluginSource.includes('function formatCapabilities')
    && pluginSource.includes('function formatQuickProbe')
    && pluginSource.includes('function formatQuickOpened')
    && pluginSource.includes("No virtual screen was created.")
    && pluginSource.includes('do not create a virtual screen'),
  'formatter 是把桥答案变成模型能执行的那句话的地方',
)

/* ── 五、提示词: 固定优先级 (⑪) ─────────────────────────────────────────── */

const phone = source('../app/src/main/assets/modes/phone.md')
/** 只看"十二、手机直连的固定优先级"那一节: 别处的行内工具清单不算优先级 */
const priority = phone.slice(phone.indexOf('十二、手机直连的固定优先级'))
const order = ['原生 API', 'Intent / deep link', '无障碍树', '虚拟屏', 'unsupported']
const positions = order.map((word) => priority.indexOf(word))

check.run(
  'phone.md 的固定优先级按 native -> intent / deep link -> 无障碍 -> 虚拟屏 -> unsupported 排',
  priority.length > 0
    && positions.every((at) => at >= 0)
    && positions.every((at, i) => i === 0 || at > positions[i - 1]),
  `positions ${JSON.stringify(positions)}`,
)
check.run(
  'phone.md 点名 lw_capabilities 与 lw_quickapp, 并写明快应用失败不建屏',
  phone.includes('lw_capabilities')
    && phone.includes('lw_quickapp')
    && /不为快应用建虚拟屏/.test(phone)
    && /不建屏/.test(phone),
  '提示词是最后一道拦"失败就建屏"的地方',
)
check.run(
  'phone.md 的主屏例外里没有"快应用要建屏"的说法',
  !/快应用[\s\S]{0,40}lw_screen_create/.test(phone),
  '建屏只留给"任务真的需要一块自己控制的屏"那一档',
)

if (!check.done()) process.exit(1)
