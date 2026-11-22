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

import { existsSync, readFileSync } from 'node:fs'
import { register } from 'node:module'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 让 `@deepseek-ai/dsh-tools` 解得开 —— 插件模块一被 import 就要它
 *
 * 第六节要真跑 `lw_tap` 的执行体, 所以这一次不再只对源码做静态断言. 三种情形按顺序:
 * ① 普通安装 (node_modules 里有) 就用真的; ② 工位里通常只有 fork 检出那一份 (junction), 从
 * `third_party/deepseek-harness/node_modules` 取真的; ③ 都没有时补一个最小影子 —— 只补
 * `defineTool` 在这里唯一要做的两件事 (参数表收成 `{type:'object', properties}`, 定义原样交回),
 * 于是插件走的还是它自己那条执行路径, 而第四节对 `parameters.properties.*` 的断言两种情形都成立
 */
const vendoredDshTools = resolve('third_party/deepseek-harness/node_modules/@deepseek-ai/dsh-tools/lib/index.js')

const loadable = async (url) => {
  if (!url) return null
  try {
    const module = await import(url)
    return typeof module.defineTool === 'function' ? url : null
  } catch {
    return null
  }
}

let realDshTools = await loadable((() => {
  try {
    return import.meta.resolve('@deepseek-ai/dsh-tools')
  } catch {
    return null
  }
})()) ?? await loadable(existsSync(vendoredDshTools) ? pathToFileURL(vendoredDshTools).href : null)

if (!realDshTools) {
  realDshTools = 'data:text/javascript;base64,' + Buffer.from(`
export function defineTool(definition) {
  const table = definition.parameters ?? {}
  const properties = {}
  for (const [key, spec] of Object.entries(table)) {
    const { required: _required, ...rest } = spec ?? {}
    properties[key] = rest
  }
  return {
    ...definition,
    parameters: Object.keys(properties).length > 0 ? { type: 'object', properties } : {},
  }
}
`).toString('base64')
}

/** 插件里的裸名一律走上面那一份: 真包与影子都从同一个入口进, 不各写一条路 */
register('data:text/javascript;base64,' + Buffer.from(`
export async function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    return { url: ${JSON.stringify(realDshTools)}, shortCircuit: true }
  }
  return next(specifier, context)
}
`).toString('base64'))

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
/**
 * 只看"手机直连的固定优先级"那一节: 别处的行内工具清单不算优先级
 *
 * 锚点只认那半句标题, **不认前面的序号** —— 2026-11-17 插进「手机应用工坊」之后它从十二变成
 * 十三, 认序号的写法当场把这一条判红而正文一个字没动
 */
const priority = phone.slice(phone.indexOf('手机直连的固定优先级'))
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

/* ── 六、点按找不到名字: 回三个最像的候选 (#27) ─────────────────────────── */

/**
 * 一棵没有"设置"这个名字的树, 加一份三行读屏
 *
 * 三行都与输入顺序、分数都岔开: 一眼看得出候选是真的排过序, 而不是把读到的原样倒回去
 */
const treeSaysNothing = {
  outcome: 'none',
  clicked: false,
  via: 'a11y',
  displayId: 0,
  holdMs: 0,
  long: false,
  error: 'nothing on this screen says that',
  matches: [],
}
const readLines = [
  { text: '蓝牙', score: 0.95, box: [100, 300, 300, 360], center: [200, 330] },
  { text: '位置信息', score: 0.80, box: [100, 500, 420, 560], center: [260, 530] },
  { text: '设备连接', score: 0.90, box: [100, 700, 460, 760], center: [280, 730] },
]

/** 一台只回答 tapText / ocr 的假设备: 一条连接一请求一行 JSON, 与真桥同一套协议 */
const answerFor = (request) => (request.method === 'tapText'
  ? treeSaysNothing
  : { displayId: 0, screen: 'on', lines: readLines, backend: 'cpu', engine: 'local' })

const channel = createServer((socket) => {
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk
    const end = buffer.indexOf('\n')
    if (end < 0) return
    const request = JSON.parse(buffer.slice(0, end))
    socket.write(`${JSON.stringify({ ok: true, result: answerFor(request) })}\n`)
  })
})
await new Promise((listening) => channel.listen(0, '127.0.0.1', listening))
process.env.LW_CHANNEL_ENDPOINT = `127.0.0.1:${channel.address().port}`
process.env.LW_CHANNEL_TOKEN = 'check-phone-actions'

const tapTool = registered.find((tool) => tool.name === 'lw_tap')
const logged = []
const realLog = console.log
let tapAnswer = ''
try {
  console.log = (...parts) => { logged.push(parts.join(' ')) }
  tapAnswer = await tapTool.execute({ text: '设置', displayId: 0, note: 'check-phone-actions' })
} finally {
  console.log = realLog
  channel.close()
  delete process.env.LW_CHANNEL_ENDPOINT
  delete process.env.LW_CHANNEL_TOKEN
}

/** 答案尾巴上那段机器可读的 JSON, 与 lw_ocr 一样放在人读的那几句后面 */
const tapReply = (() => {
  const start = tapAnswer.indexOf('\n{\n')
  return start < 0 ? {} : JSON.parse(tapAnswer.slice(start + 1))
})()
const candidates = Array.isArray(tapReply.candidates) ? tapReply.candidates : []

check.run(
  'lw_tap 找不到名字时回三个候选, 每项带 text / score / bbox (树里没有 + 读屏也没有)',
  candidates.length === 3
    && candidates.every((item) => typeof item.text === 'string' && item.text.length > 0
      && typeof item.score === 'number'
      && Array.isArray(item.bbox) && item.bbox.length === 4
      && item.bbox.every((value) => typeof value === 'number')),
  `got ${JSON.stringify(candidates)}`,
)
check.run(
  'lw_tap 的候选按 score 降序, 而不是把读到的顺序原样倒回去',
  candidates.length === 3
    && candidates.every((item, index) => index === 0 || item.score <= candidates[index - 1].score)
    && candidates.map((item) => item.text).join('|') !== readLines.map((line) => line.text).join('|'),
  `order ${candidates.map((item) => `${item.text}=${item.score}`).join(', ')}`,
)
check.run(
  'lw_tap 的答案把「没找到」换成「最像的这几个」, 并说清一个都没按',
  /closest lines on the screen/.test(tapAnswer)
    && /nothing was pressed/.test(tapAnswer)
    && /lw_tap\(x=\.\.\., y=\.\.\.\)/.test(tapAnswer),
  tapAnswer.split('\n').slice(0, 3).join(' / '),
)
check.run(
  'lw_tap 把候选条数写进日志 (真机 logcat 认这一行)',
  logged.some((line) => line.includes('lw_tap: candidates=3')),
  `logged ${JSON.stringify(logged.slice(-3))}`,
)
check.run(
  'lw_tap 的说明里写明找不到名字会给最像的几行 (#27 的 op 描述)',
  typeof tapTool?.description === 'string'
    && /closest/i.test(tapTool.description)
    && /three/i.test(tapTool.description)
    && /score/i.test(tapTool.description),
  '说明里不写, 模型下一次还是只会重读整屏',
)

/* ── 七、按完这一下先验一次 (2.8.1 落实表 #32) ───────────────────────────── */

/**
 * 这一节量的是 `lw_tap` 的**动作效果核对**: 按下前后各读一次树, 比文本集合与目标那一格的位置
 *
 * 三条真值三种性格, 都要在不接设备的时候量得到:
 *   ① 树一动不动 → `effect=unchanged` 且带三个候选 (刚按过的那一格排掉)
 *   ② 树多了一行   → `effect=changed`, 差额里就是那一行
 *   ③ `verify:"off"` → 与今天**逐字相同** (一个字都不多, 也没有 effect 那一段)
 * 外加那一脚刹车: 同一屏连着两下没变之后, 第三下**不发出去** (设备的 tapText 调用数不涨)
 */

/** 一块"设置"屏: 四行字, 按的是第一行 */
const SETTINGS_SCREEN = [
  { className: 'android.widget.TextView', text: '设置', bounds: [40, 300, 900, 380], clickable: true },
  { className: 'android.widget.TextView', text: '蓝牙', bounds: [40, 400, 900, 480], clickable: true },
  { className: 'android.widget.TextView', text: '位置信息', bounds: [40, 500, 900, 580], clickable: true },
  { className: 'android.widget.TextView', text: '设备连接', bounds: [40, 600, 900, 680], clickable: true },
]

/** 假设备的屏: 这一节按顺序改它, 改完再按一次就是那几种结局 */
let effectScreen = SETTINGS_SCREEN
let effectTaps = 0

/** 按下那一拍屏幕会变成什么 (null = 一动不动): 只有"按下之后才变"才算 changed */
let onPress = null

const effectAnswer = (request) => {
  if (request.method === 'tapText') {
    effectTaps += 1
    const hit = effectScreen.find((node) => node.text === request.text)
    const answer = {
      clicked: true,
      outcome: 'clicked',
      via: 'a11y',
      displayId: 0,
      holdMs: request.holdMs ?? 0,
      long: false,
      matches: hit === undefined ? [] : [{ ...hit, target: hit.bounds }],
    }
    const change = onPress
    onPress = null
    if (typeof change === 'function') change()
    return answer
  }
  if (request.method === 'ui') {
    return {
      enabled: true,
      displayId: 0,
      label: 'Settings',
      package: 'com.android.settings',
      width: 1080,
      height: 2400,
      nodes: effectScreen.map((node, depth) => ({ ...node, target: node.bounds, depth })),
    }
  }
  return { displayId: 0, screen: 'on', lines: [] }
}

const effectChannel = createServer((socket) => {
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk
    const end = buffer.indexOf('\n')
    if (end < 0) return
    const request = JSON.parse(buffer.slice(0, end))
    socket.write(`${JSON.stringify({ ok: true, result: effectAnswer(request) })}\n`)
  })
})
await new Promise((listening) => effectChannel.listen(0, '127.0.0.1', listening))
process.env.LW_CHANNEL_ENDPOINT = `127.0.0.1:${effectChannel.address().port}`
process.env.LW_CHANNEL_TOKEN = 'check-phone-actions'

/**
 * 按一下, 顺手把这一次的 stdout 收下来 (读数那一行认它)
 *
 * 给了 `session` 就以那一场会话的身份按: 效果那本账按场次分开记, 那一脚刹车只数同一场里连着没
 * 变的那几下, 于是各节各条互不串账
 */
async function press(args, options = {}) {
  const lines = []
  const keep = console.log
  const context = options.session === undefined ? undefined : { agent: { id: options.session } }
  try {
    console.log = (...parts) => { lines.push(parts.join(' ')) }
    const answer = await tapTool.execute({ note: 'check-phone-actions', ...args }, context)
    return { answer, logged: lines }
  } finally {
    console.log = keep
  }
}

/** 答案里 `effect=` 那一段之后的三行候选 (中心可有可无: #37 起一律带上, 旧的写法也认) */
const candidatesOf = (answer) => answer.split('\n')
  .map((line) => /^- "(.+)" at \[(-?\d+,-?\d+,-?\d+,-?\d+)\](?: centre (\d+),(\d+))? score (\d+\.\d+)$/u.exec(line))
  .filter((hit) => hit !== null)
  .map((hit) => ({
    text: hit[1],
    bbox: hit[2],
    score: Number(hit[5]),
    centre: hit[3] === undefined ? null : { x: Number(hit[3]), y: Number(hit[4]) },
  }))

/**
 * 候选的中心必须是它自己 bbox 的中心 (值断言): 只断言"是有限数"时, 中心算错一格照样绿 ——
 * 而回执里那句"下一次按这个点"靠的就是这个数
 */
const centresMatchBoxes = (answer) => {
  const list = candidatesOf(answer)
  return list.length > 0 && list.every((item) => {
    if (item.centre === null) return false
    const [left, top, right, bottom] = item.bbox.split(',').map(Number)
    return Math.abs(item.centre.x - Math.round((left + right) / 2)) <= 1
      && Math.abs(item.centre.y - Math.round((top + bottom) / 2)) <= 1
  })
}

check.run(
  '插件: lw_tap 有 verify 参数, 只有 auto / off 两档 (缺省 auto)',
  JSON.stringify(tapTool?.parameters?.properties?.verify?.enum) === JSON.stringify(['auto', 'off']),
  `got ${JSON.stringify(tapTool?.parameters?.properties?.verify?.enum)}`,
)
check.run(
  '插件: lw_tap 的说明里念到 effect=unchanged 与那一脚刹车 (两件都不许静默)',
  typeof tapTool?.description === 'string'
    && /effect=unchanged/u.test(tapTool.description)
    && /effect=changed/u.test(tapTool.description)
    && /reason=effect-missing/u.test(tapTool.description),
  '说明里不写, 模型读到 unchanged 也不知道该换一条路',
)

// ① 树一动不动: 按出去的那一刻与回读那一刻屏幕一样
const still = await press({ text: '设置', displayId: 0 })
check.run(
  'lw_tap: 树不变 → effect=unchanged, 并且说了"别按同一个地方"',
  /effect=unchanged/u.test(still.answer) && /exactly as it was/u.test(still.answer),
  still.answer.split('\n').slice(-4).join(' / '),
)
check.run(
  'lw_tap: unchanged 时带三个候选, 每项 text / score / bbox, 按分数降序',
  candidatesOf(still.answer).length === 3
    && candidatesOf(still.answer).every((item, index) => index === 0
      || item.score <= candidatesOf(still.answer)[index - 1].score)
    && candidatesOf(still.answer).every((item) => item.bbox.split(',').length === 4),
  `got ${JSON.stringify(candidatesOf(still.answer))}`,
)
check.run(
  'lw_tap: 候选里没有刚按过的那一格 (再按同一个地方正是要治的病)',
  candidatesOf(still.answer).every((item) => item.text !== '设置'),
  `got ${JSON.stringify(candidatesOf(still.answer).map((item) => item.text))}`,
)
check.run(
  'lw_tap: unchanged 与刹车那两处的候选也带中心 (值断言: 中心 = 自己 bbox 的中心, backlog)',
  candidatesOf(still.answer).length === 3 && centresMatchBoxes(still.answer),
  `got ${JSON.stringify(candidatesOf(still.answer))}`,
)
check.run(
  'lw_tap 把核对结果写进日志 (真机 stdout 认这一行)',
  still.logged.some((line) => line.includes('lw_tap: effect=unchanged candidates=3')),
  `logged ${JSON.stringify(still.logged)}`,
)

// ② 树多了一行: 差额里出现的就是那一行 (变化发生在按下那一拍, 不是按之前)
effectScreen = SETTINGS_SCREEN
onPress = () => {
  effectScreen = [...SETTINGS_SCREEN, {
    className: 'android.widget.TextView', text: '已连接', bounds: [40, 700, 900, 780], clickable: false,
  }]
}
const moved = await press({ text: '设置', displayId: 0 })
check.run(
  'lw_tap: 树变一行 → effect=changed, 差额里就是那一行',
  /effect=changed/u.test(moved.answer)
    && moved.answer.split('\n').filter((line) => /^ {2}\+ /u.test(line)).length === 1
    && /^ {2}\+ "已连接"$/mu.test(moved.answer),
  moved.answer.split('\n').slice(-3).join(' / '),
)

// ③ verify=off: 与今天逐字相同 (回执一个 effect 字都没有)
effectScreen = SETTINGS_SCREEN
const plain = await press({ text: '设置', displayId: 0, verify: 'off' })
check.run(
  'lw_tap: verify=off 与今天逐字相同 (一个字都不多)',
  plain.answer === 'pressed android.widget.TextView "设置" on displayId 0 by its own click action'
    + ' - "check-phone-actions"',
  `got ${JSON.stringify(plain.answer)}`,
)
check.run(
  'lw_tap: verify=off 不记那一笔账 (日志里没有 effect=)',
  plain.logged.every((line) => !line.includes('lw_tap: effect=')),
  `logged ${JSON.stringify(plain.logged)}`,
)

// ④ 那一脚刹车: 同一屏连着两下没变, 第三下不发出去
effectScreen = SETTINGS_SCREEN
onPress = null
const tapsBefore = effectTaps
const first = await press({ text: '设置', displayId: 0 })
const second = await press({ text: '设置', displayId: 0 })
const third = await press({ text: '设置', displayId: 0 })
check.run(
  'lw_tap: 连着两下 unchanged 之后第三下不发 (设备那一侧 tapText 调用数只涨 2)',
  effectTaps - tapsBefore === 2
    && /effect=unchanged/u.test(first.answer)
    && /effect=unchanged/u.test(second.answer),
  `got ${effectTaps - tapsBefore} press(es)`,
)
check.run(
  'lw_tap: 第三下回 reason=effect-missing, 并给出换一条路的那三个候选',
  /reason=effect-missing/u.test(third.answer)
    && /not pressed/u.test(third.answer)
    && candidatesOf(third.answer).length === 3,
  third.answer.split('\n').slice(0, 2).join(' / '),
)
check.run(
  'lw_tap: 刹车那三个候选也带中心 (与 unchanged 那一路同一个格式, backlog)',
  candidatesOf(third.answer).length === 3 && centresMatchBoxes(third.answer),
  `got ${JSON.stringify(candidatesOf(third.answer))}`,
)
check.run(
  'lw_tap: 屏真的变了就放行 (刹车不会把一场探索关死)',
  await (async () => {
    // 屏幕先换一屏 (应用自己更新了), 再按下时又变了一次
    effectScreen = [...SETTINGS_SCREEN, {
      className: 'android.widget.TextView', text: '好了', bounds: [40, 800, 900, 880], clickable: true,
    }]
    onPress = () => {
      effectScreen = [...effectScreen, {
        className: 'android.widget.TextView', text: '已同步', bounds: [40, 900, 900, 980], clickable: false,
      }]
    }
    const answer = await press({ text: '设置', displayId: 0 })
    return /effect=changed/u.test(answer.answer) && !/reason=effect-missing/u.test(answer.answer)
  })(),
  '屏幕换了一屏之后, 下一次按就照常发出去并核对',
)

effectChannel.close()
delete process.env.LW_CHANNEL_ENDPOINT
delete process.env.LW_CHANNEL_TOKEN

/* ── 八、按下去之前先证明按的是对的那个 (2.8.1 落实表 #37) ─────────────────── */

/**
 * 这一节量的是 `lw_tap` 的**动作前置校验**与**定点恢复**, 一条都不需要设备
 *
 * 六条真值:
 *   ① 按点按带 expect, 点上却是别的控件 → 一次触摸都不发 (anchor-mismatch + 实测标签 + 最近控件的中心)
 *   ② 同一个点 expect 对得上 → 恰好一次触摸, 回 anchor=confirmed
 *   ③ `verify:"off"` → 即使 expect 对不上也照发 (与 #32 那档"逐字退回"同一条)
 *   ④ 按名字同名分不开 → 回候选, 一次触摸都不发 (skip=ambiguous)
 *   ⑤ 命中区短边 < 48px → skip=small; 被别的控件盖住 → skip=occluded, 两次都不发触摸
 *   ⑥ 失败后的三档恢复: `recover=reread|reanchor|giveup` 各一行读数, 而且**只按过一次**
 */

/** 一棵树 (只有这几格有名字, 都画在 1080x2400 上); `target` 是"按下去落在哪一格", 缺省就是它自己 */
const treeOf = (rows) => rows.map((row) => ({
  className: 'android.widget.TextView',
  text: row.text,
  bounds: row.bounds,
  clickable: row.clickable !== false,
  ...(Array.isArray(row.target) ? { target: row.target } : {}),
}))

const SETTINGS_ROWS = [
  { text: '设置', bounds: [40, 300, 900, 380] },
  { text: '蓝牙', bounds: [40, 400, 900, 480] },
  { text: '位置信息', bounds: [40, 500, 900, 580] },
]

/** 假设备的屏: 这一节按顺序改它 */
let preRows = SETTINGS_ROWS
let preLines = []
/** 树读不回来那一档 (恢复的 giveup 用) */
let preTreeReadable = true
/** 设备的触摸次数: `tap` 一定算, `tapText` 只有真的按下去 (clicked) 才算 */
let preTouches = 0
/** 按下那一拍设备会顺手做的事 (改屏 / 约一个晚到的变化) */
let preOnPress = null

const preAnswer = (request) => {
  if (request.method === 'ui') {
    if (!preTreeReadable) return { enabled: false, error: 'the accessibility service went away' }
    return {
      enabled: true,
      displayId: 0,
      label: 'Settings',
      width: 1080,
      height: 2400,
      nodes: treeOf(preRows).map((node, depth) => ({ ...node, target: node.target ?? node.bounds, depth })),
    }
  }
  if (request.method === 'ocr') {
    return { displayId: 0, screen: 'on', lines: preLines, backend: 'cpu', engine: 'local' }
  }
  const runPress = () => {
    const change = preOnPress
    preOnPress = null
    if (typeof change === 'function') change()
  }
  if (request.method === 'tapText') {
    const hit = preRows.find((row) => row.text === request.text)
    if (hit === undefined) {
      runPress()
      return { clicked: false, outcome: 'none', via: 'a11y', displayId: 0, matches: [] }
    }
    preTouches += 1
    runPress()
    return {
      clicked: true,
      outcome: 'clicked',
      via: 'a11y',
      displayId: 0,
      holdMs: request.holdMs ?? 0,
      long: false,
      matches: [{ ...hit, target: hit.target ?? hit.bounds }],
    }
  }
  if (request.method === 'tap') {
    preTouches += 1
    runPress()
    return { tapped: true, displayId: 0, x: request.x, y: request.y, screen: 'on' }
  }
  return { displayId: 0, screen: 'on', lines: [] }
}

const preChannel = createServer((socket) => {
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk
    const end = buffer.indexOf('\n')
    if (end < 0) return
    const request = JSON.parse(buffer.slice(0, end))
    socket.write(`${JSON.stringify({ ok: true, result: preAnswer(request) })}\n`)
  })
})
await new Promise((listening) => preChannel.listen(0, '127.0.0.1', listening))
process.env.LW_CHANNEL_ENDPOINT = `127.0.0.1:${preChannel.address().port}`
process.env.LW_CHANNEL_TOKEN = 'check-phone-actions'

/** 答案尾巴上那段机器可读的 JSON (与前面几节同一个认法) */
const replyOf = (answer) => {
  const start = answer.indexOf('\n{\n')
  if (start < 0) return {}
  try {
    return JSON.parse(answer.slice(start + 1))
  } catch {
    return {}
  }
}

// ① 按点按带 expect, 点上却是"设置"
preRows = SETTINGS_ROWS
preLines = []
preTouches = 0
const mismatch = await press({ displayId: 0, x: 500, y: 340, expect: '蓝牙' }, { session: 'pre-mismatch' })
check.run(
  '前置校验: 按点按带 expect 而点上是别的控件 → 一次触摸都不发',
  preTouches === 0,
  `got ${preTouches} touch(es) for ${JSON.stringify(mismatch.answer.split('\n')[0])}`,
)
check.run(
  '前置校验: 对不上时报 reason=anchor-mismatch, 并说清点上实际是什么',
  /reason=anchor-mismatch/u.test(mismatch.answer) && /"设置"/u.test(mismatch.answer),
  mismatch.answer.split('\n').slice(0, 2).join(' / '),
)
check.run(
  '前置校验: 答案带最近控件的 bbox 中心 (下一次按落在那里), JSON 里也有一份',
  /centre 470,440/u.test(mismatch.answer)
    && replyOf(mismatch.answer).reason === 'anchor-mismatch'
    && replyOf(mismatch.answer).found === '设置'
    && JSON.stringify(replyOf(mismatch.answer).closest?.center) === JSON.stringify({ x: 470, y: 440 }),
  `json ${JSON.stringify(replyOf(mismatch.answer).closest ?? null)}`,
)

// ② 同一个点, expect 对得上
preTouches = 0
const confirmed = await press({ displayId: 0, x: 500, y: 340, expect: '设置' }, { session: 'pre-confirmed' })
check.run(
  '前置校验: expect 对得上时恰好一次触摸, 回 anchor=confirmed',
  preTouches === 1 && /anchor=confirmed/u.test(confirmed.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(confirmed.answer.split('\n')[0])}`,
)

// ③ verify=off: 与今天逐字相同的那条路, expect 不参与
preTouches = 0
const off = await press({ displayId: 0, x: 500, y: 340, expect: '蓝牙', verify: 'off' }, { session: 'pre-off' })
check.run(
  '前置校验: verify=off 时 expect 对不上也照发 (逐字退回 #32 之前那条路)',
  preTouches === 1 && !/anchor=/u.test(off.answer) && !/reason=anchor-mismatch/u.test(off.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(off.answer.split('\n')[0])}`,
)

// ④ 按名字: 同名三行、分数分不开 → 回候选, 不点
preRows = []
preLines = [
  { text: '设置', score: 0.90, box: [100, 300, 460, 360], center: [280, 330] },
  { text: '设置', score: 0.88, box: [100, 500, 460, 560], center: [280, 530] },
  { text: '设置', score: 0.86, box: [100, 700, 460, 760], center: [280, 730] },
]
preTouches = 0
const ambiguous = await press({ source: 'ocr', text: '设置', displayId: 0 }, { session: 'pre-ambiguous' })
check.run(
  '前置校验: 同名分不开时一次触摸都不发, 答案说清 skip=ambiguous',
  preTouches === 0 && /skip=ambiguous/u.test(ambiguous.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(ambiguous.answer.split('\n')[0])}`,
)
check.run(
  '前置校验: 分不开时按 #27 的三候选格式回三条, 每项 text / score / bbox / center',
  (() => {
    const candidates = replyOf(ambiguous.answer).candidates ?? []
    return candidates.length === 3 && candidates.every((one) => typeof one.text === 'string'
      && typeof one.score === 'number'
      && Array.isArray(one.bbox) && one.bbox.length === 4
      && typeof one.center?.x === 'number' && typeof one.center?.y === 'number')
  })(),
  `got ${JSON.stringify(replyOf(ambiguous.answer).candidates ?? null)}`,
)

// ⑤ 命中区短边 < 48 → skip=small (小图标那一档); 被别的控件盖住 → skip=occluded
preRows = [{ text: '设置', bounds: [40, 300, 80, 340] }]
preLines = []
preTouches = 0
const small = await press({ text: '设置', displayId: 0 }, { session: 'pre-small' })
check.run(
  '前置校验: 命中区 40x40 < TAP_MIN_SIDE → skip=small, 不发触摸',
  preTouches === 0 && /skip=small/u.test(small.answer) && replyOf(small.answer).skip === 'small',
  `got ${preTouches} touch(es), ${JSON.stringify(small.answer.split('\n')[0])}`,
)

preRows = [...SETTINGS_ROWS, { text: '广告弹窗', bounds: [200, 320, 600, 360] }]
preLines = []
preTouches = 0
const covered = await press({ text: '设置', displayId: 0 }, { session: 'pre-covered' })
check.run(
  '前置校验: 要按的那一点上盖着别的控件 → skip=occluded, 不发触摸',
  preTouches === 0 && /skip=occluded/u.test(covered.answer)
    && /"广告弹窗"/u.test(covered.answer)
    && replyOf(covered.answer).skip === 'occluded',
  `got ${preTouches} touch(es), ${JSON.stringify(covered.answer.split('\n')[0])}`,
)

// ⑥ 失败后的三档恢复: reread / reanchor / giveup, 每档一行 `LwTap: recover=`, 而且只按过一次
preRows = SETTINGS_ROWS
preLines = []
preTreeReadable = true
preTouches = 0
preOnPress = () => {
  // 晚到的一拍: 按下 300ms 那一刻还没变, 恢复的重读 (600ms) 才看得见
  setTimeout(() => { preRows = [...SETTINGS_ROWS, { text: '已连接', bounds: [40, 700, 900, 780] }] }, 400)
}
const reread = await press({ text: '设置', displayId: 0 }, { session: 'pre-reread' })
check.run(
  '恢复 ①: 慢一拍的界面 → recover=reread (再看一眼就认了), 没有第二次触摸',
  /recover=reread/u.test(reread.answer)
    && reread.logged.some((line) => line.includes('LwTap: recover=reread'))
    && preTouches === 1,
  `got ${preTouches} touch(es), ${JSON.stringify(reread.logged.slice(-3))}`,
)

// backlog (第三轮): recover=reread 是"慢一拍的成功", 账上必须记成 changed —— 点按层的 streak 与
// lw_explore 的停判看的是同一个 effect。没这一格时, 前一下 reread + 一下 really-unchanged 就凑够 2,
// 第三下会被刹车拦掉 (这一条在修复前必红: preTouches 只到 2)
preRows = SETTINGS_ROWS
preOnPress = () => {
  setTimeout(() => { preRows = [...SETTINGS_ROWS, { text: '已连接', bounds: [40, 700, 900, 780] }] }, 400)
  setTimeout(() => { preRows = SETTINGS_ROWS }, 1300)
}
preTouches = 0
const lateFirst = await press({ text: '设置', displayId: 0 }, { session: 'pre-reread-account' })
await new Promise((resume) => setTimeout(resume, 1100))
const plainSecond = await press({ text: '设置', displayId: 0 }, { session: 'pre-reread-account' })
const plainThird = await press({ text: '设置', displayId: 0 }, { session: 'pre-reread-account' })
check.run(
  'backlog: 前一下是 recover=reread 不算「没变」—— 再来一下 unchanged, 第三下照发',
  /recover=reread/u.test(lateFirst.answer)
    && /effect=unchanged/u.test(plainSecond.answer)
    && preTouches === 3
    && !/reason=effect-missing/u.test(plainThird.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(plainThird.answer.split('\n')[0])}`,
)
preOnPress = null
preRows = SETTINGS_ROWS

preRows = SETTINGS_ROWS
preOnPress = null
preTouches = 0
const reanchor = await press({ text: '设置', displayId: 0 }, { session: 'pre-reanchor' })
check.run(
  '恢复 ②: 屏没变但目标还在 → recover=reanchor, 交回它现在的中心, 不重放',
  /recover=reanchor/u.test(reanchor.answer)
    && /centre 470,340/u.test(reanchor.answer)
    && reanchor.logged.some((line) => line.includes('LwTap: recover=reanchor'))
    && preTouches === 1,
  `got ${preTouches} touch(es), ${JSON.stringify(reanchor.logged.slice(-3))}`,
)

preRows = SETTINGS_ROWS
preOnPress = null
preTouches = 0
const giveup = await press({ displayId: 0, x: 540, y: 1600 }, { session: 'pre-giveup' })
check.run(
  '恢复 ③: 空白处按了一下、屏没变也没有可重锚的目标 → recover=giveup',
  /recover=giveup/u.test(giveup.answer)
    && giveup.logged.some((line) => line.includes('LwTap: recover=giveup'))
    && preTouches === 1,
  `got ${preTouches} touch(es), ${JSON.stringify(giveup.logged.slice(-3))}`,
)

/* ── 八之二、轮内审查那几条必修的端到端读数 (2.8.1 #37 重派) ───────────────── */

/**
 * 上一轮审查判 request-changes, 七条 major + 一条 minor; 这一节钉其中能在假设备上量的那几条:
 *   必修 1: expect 对得上就不许被短边闸拦掉 (一行 14sp 的字短边只有 40px)
 *   必修 2: 同名两处时重锚交回"按过的那一处"
 *   必修 3: 树读不回来 (effect=unknown) 不跑恢复, 也不出 `LwTap: recover=`
 *   必修 5: verify=off 同名多行仍是 0 次触摸, 文案逐字照旧
 *   必修 6: 分数差看 closenessScore, 不是 OCR 置信
 *   必修 7: 点在行内子文本上而 expect 是整行名字 → 对得上
 *   归档: 回执里不写 displayId undefined
 *   契约闭环: anchor-mismatch 交回的最近控件中心再按一次 → anchor=confirmed
 */

// 必修 1: 命中区短边 40px < 48, 但 expect 对得上 → 照按一次
preRows = [{ text: '设置', bounds: [40, 300, 900, 340] }]
preLines = []
preTouches = 0
const thin = await press({ displayId: 0, x: 500, y: 320, expect: '设置' }, { session: 'pre-thin' })
check.run(
  '必修 1: expect 对得上而那一格只有 40px 高 → 照按一次 (按点按不量短边)',
  preTouches === 1 && /anchor=confirmed/u.test(thin.answer) && !/skip=small/u.test(thin.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(thin.answer.split('\n')[0])}`,
)

// 必修 5: verify=off 同名多行 —— 副作用与文案都逐字退回 #37 之前
preRows = []
preLines = [
  { text: '设置', score: 0.90, box: [100, 300, 460, 360] },
  { text: '设置', score: 0.88, box: [100, 500, 460, 560] },
]
preTouches = 0
const offRows = await press({ source: 'ocr', text: '设置', displayId: 0, verify: 'off' }, { session: 'pre-off-rows' })
check.run(
  '必修 5: verify=off 时同名多行 0 次触摸, 文案逐字照旧 (没有 skip=ambiguous 这一档)',
  preTouches === 0
    && !/skip=/u.test(offRows.answer)
    && offRows.answer.startsWith('2 lines on the screen say that, so nothing was pressed: "设置"'
      + ' at [100,300,460,360], "设置" at [100,500,460,560]. Press the one you meant with'
      + ' lw_tap(x=..., y=...) at its centre.'),
  `got ${preTouches} touch(es), ${JSON.stringify(offRows.answer.slice(0, 80))}`,
)

// 必修 6: 一行糊的与一行清楚的都含这个名字 —— 分数差量的是像不像, 不是识别置信
preRows = []
preLines = [
  { text: '已连接', score: 0.40, box: [100, 300, 460, 360] },
  { text: '连接 与共享', score: 0.95, box: [100, 500, 460, 560] },
]
preTouches = 0
const blurred = await press({ source: 'ocr', text: '连接', displayId: 0 }, { session: 'pre-blurred' })
check.run(
  '必修 6: 置信差 0.55 但两行都只是"含这个名字" → 分不开, 0 次触摸 (不按最清楚那行猜)',
  preTouches === 0 && /skip=ambiguous/u.test(blurred.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(blurred.answer.split('\n')[0])}`,
)

// 必修 3: 树读不回来 —— effect=unknown 既不判停也不跑恢复
preRows = SETTINGS_ROWS
preLines = []
preTreeReadable = false
preTouches = 0
const unread = await press({ displayId: 0, x: 540, y: 1600 }, { session: 'pre-unread' })
check.run(
  '必修 3: 树读不回来 → effect=unknown, 不跑恢复 (没有 recover= 那一行), 只按过一次',
  preTouches === 1
    && /effect=unknown/u.test(unread.answer)
    && !/recover=/u.test(unread.answer)
    && unread.logged.every((line) => !line.includes('LwTap: recover=')),
  `got ${preTouches} touch(es), ${JSON.stringify(unread.logged.slice(-3))}`,
)
preTreeReadable = true

// 必修 2: 屏上两处同名, 按的是下面那一处 → 重锚要交回下面那一处的中心
preRows = [
  { text: '设置', bounds: [40, 300, 900, 380] },
  { text: '设置', bounds: [40, 1200, 900, 1280] },
]
preLines = []
preTouches = 0
const lower = await press({ displayId: 0, x: 500, y: 1240 }, { session: 'pre-lower' })
check.run(
  '必修 2: 同名两处按的是下面那处 → recover=reanchor 交回 470,1240 (不是最上面那处)',
  preTouches === 1
    && /recover=reanchor/u.test(lower.answer)
    && /centre 470,1240/u.test(lower.answer)
    && lower.logged.some((line) => line.includes('LwTap: recover=reanchor anchor=470,1240')),
  `got ${preTouches} touch(es), ${JSON.stringify(lower.logged.slice(-3))}`,
)

// 必修 7: 点在一行里的子文本上, expect 给的是整行名字 (行名的文字框比命中区窄 —— 真机列表行就是这样)
preRows = [
  { text: '蓝牙', bounds: [40, 400, 460, 480], target: [40, 400, 900, 480] },
  { text: '已连接', bounds: [700, 410, 880, 470], target: [40, 400, 900, 480] },
]
preLines = []
preTouches = 0
const inline = await press({ displayId: 0, x: 750, y: 440, expect: '蓝牙' }, { session: 'pre-inline' })
check.run(
  '必修 7: 点在行内子文本上而 expect 是整行名字 → anchor=confirmed, 照按一次',
  preTouches === 1 && /anchor=confirmed/u.test(inline.answer) && !/anchor-mismatch/u.test(inline.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(inline.answer.split('\n')[0])}`,
)

// 归档: 回执里不写 displayId undefined (调用方省掉 displayId 那条路)
preRows = [{ text: '设置', bounds: [40, 300, 80, 340] }]
preLines = []
preTouches = 0
const bare = await press({ text: '设置' }, { session: 'pre-bare' })
check.run(
  '归档: 回执里那块屏写成读数 (displayId 0), 不是 undefined',
  preTouches === 0 && /displayId 0/u.test(bare.answer) && !/undefined/u.test(bare.answer),
  `got ${JSON.stringify(bare.answer.split('\n')[0])}`,
)

// 契约闭环: 把 anchor-mismatch 交回的最像控件中心再传回 lw_tap 一次, 读出 anchor=confirmed
preRows = SETTINGS_ROWS
preLines = []
preTouches = 0
const again = await press({ displayId: 0, x: 500, y: 340, expect: '蓝牙' }, { session: 'pre-loop-1' })
const loopCentre = replyOf(again.answer).closest?.center ?? null
preTouches = 0
const looped = await press({
  displayId: 0, x: loopCentre?.x, y: loopCentre?.y, expect: '蓝牙',
}, { session: 'pre-loop-2' })
check.run(
  '契约闭环: mismatch 交回的 centre 再按一次 → anchor=confirmed (0→1 次触摸)',
  replyOf(again.answer).reason === 'anchor-mismatch'
    && JSON.stringify(loopCentre) === JSON.stringify({ x: 470, y: 440 })
    && preTouches === 1
    && /anchor=confirmed/u.test(looped.answer),
  `centre ${JSON.stringify(loopCentre)}, got ${preTouches} touch(es),`
    + ` ${JSON.stringify(looped.answer.split('\n')[0])}`,
)

// 第二轮必修 B: 两行文本逐字相同、置信 0.15 vs 0.95 → 仍分不开 (gap 只比"像不像")
preRows = []
preLines = [
  { text: '设置', score: 0.15, box: [100, 300, 460, 360] },
  { text: '设置', score: 0.95, box: [100, 500, 460, 560] },
]
preTouches = 0
const sameText = await press({ source: 'ocr', text: '设置', displayId: 0 }, { session: 'pre-same-text' })
check.run(
  '必修 B: 同名两行文本相同时, 置信 0.15 vs 0.95 也 0 次触摸 (gap 只比像不像)',
  preTouches === 0 && /skip=ambiguous/u.test(sameText.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(sameText.answer.split('\n')[0])}`,
)

// 第二轮必修 C: 容器的 target 盖住子按钮, expect 写容器名 → 不按
preRows = [
  { text: '更多设置', bounds: [0, 100, 1080, 200], target: [0, 100, 1080, 200] },
  { text: '更多', bounds: [880, 110, 1060, 190], target: [880, 110, 1060, 190] },
]
preLines = []
preTouches = 0
const coveredExpect = await press({ displayId: 0, x: 950, y: 150, expect: '更多设置' }, { session: 'pre-more' })
check.run(
  '必修 C: 容器 target 盖住子按钮时 expect 写容器名 → anchor-mismatch, 0 次触摸',
  preTouches === 0
    && /reason=anchor-mismatch/u.test(coveredExpect.answer)
    && replyOf(coveredExpect.answer).found === '更多',
  `got ${preTouches} touch(es), found=${JSON.stringify(replyOf(coveredExpect.answer).found)}`,
)

// 降验收 (2026-11-22): 列表行 —— 行名的文字框很小而 target 是整行, 行内子文本的 target 也是整行
preRows = [
  { text: '蓝牙', bounds: [40, 400, 460, 480], target: [40, 400, 900, 480] },
  { text: '已连接', bounds: [700, 410, 880, 470], target: [40, 400, 900, 480] },
]
preLines = []
preTouches = 0
const inRow = await press({ displayId: 0, x: 750, y: 440, expect: '蓝牙' }, { session: 'pre-in-row' })
check.run(
  '降验收: 行名 + 行内具名子文本 (两者 target 都是整行) → anchor=confirmed, 按一次',
  preTouches === 1 && /anchor=confirmed/u.test(inRow.answer) && !/anchor-mismatch/u.test(inRow.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(inRow.answer.split('\n')[0])}`,
)

// backlog (第三轮): namedAt 已删 —— 按名字那条路只在唯一命中时才按, 恢复那一屏与按之前是同一份树,
// 同一个名字挑不出第二处。所以这里量的是"唯一命中时重锚交回的就是它", 另加一条反向: 两格同名而
// target 不同时一次都不按 (否则删掉 namedAt 等于放宽了"同名不猜")
preRows = [
  { text: '设置', bounds: [40, 300, 500, 380], target: [40, 300, 900, 380] },
  { text: '设置', bounds: [520, 300, 880, 380], target: [40, 300, 900, 380] },
]
preLines = []
preTouches = 0
const namedShared = await press({ text: '设置', displayId: 0 }, { session: 'pre-named-shared' })
check.run(
  'backlog: 按名字唯一命中 → 按一次, 重锚交回那颗 target 的中心 470,340 (namedAt 已删)',
  preTouches === 1
    && /recover=reanchor/u.test(namedShared.answer)
    && /centre 470,340/u.test(namedShared.answer)
    && namedShared.logged.some((line) => line.includes('LwTap: recover=reanchor anchor=470,340')),
  `got ${preTouches} touch(es), ${JSON.stringify(namedShared.logged.slice(-3))}`,
)

preRows = [
  { text: '设置', bounds: [40, 300, 500, 380], target: [40, 300, 500, 380] },
  { text: '设置', bounds: [40, 600, 900, 680], target: [40, 600, 900, 680] },
]
preLines = []
preTouches = 0
const namedSplit = await press({ text: '设置', displayId: 0 }, { session: 'pre-named-split' })
check.run(
  'backlog: 两格同名而 target 不同 → 0 次触摸 + skip=ambiguous (静默不猜)',
  preTouches === 0 && /skip=ambiguous/u.test(namedSplit.answer),
  `got ${preTouches} touch(es), ${JSON.stringify(namedSplit.answer.split('\n')[0])}`,
)

// backlog 2: 同时给 text 与 expect 不再静默丢掉那份期望
preRows = SETTINGS_ROWS
preLines = []
preTouches = 0
let refused = ''
try {
  await press({ text: '设置', expect: '蓝牙', displayId: 0 }, { session: 'pre-both' })
} catch (error) {
  refused = String(error?.message ?? error)
}
check.run(
  'backlog: 同时给 text 与 expect 时报错, 一次触摸都不发',
  /expect belongs to a press by point/u.test(refused) && preTouches === 0,
  `got ${JSON.stringify(refused)} / ${preTouches} touch(es)`,
)

preChannel.close()
delete process.env.LW_CHANNEL_ENDPOINT
delete process.env.LW_CHANNEL_TOKEN

if (!check.done()) process.exit(1)
