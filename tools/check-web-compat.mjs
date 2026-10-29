/**
 * 老 WebView 兼容层 (2.8.0, 主人 2026-10-25)
 *
 * 病根: dsh 往页面里塞的第一行就是 `(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers())`
 * (`dsh-host-webserver` 的 READY_MARKUP), 而 `Promise.withResolvers` 是 Chrome 119 才有的 —— 2022 年
 * 前后出厂、WebView 没更新过的机器停在 100~116, 那一行**解析期就抛**, 入口脚本一个都没跑起来, 屏幕上
 * 于是永远停在"连接中"。
 *
 * 这一条判据不只看"文件在不在", 而是**真的把 `assets/web/lw-compat.js` 跑一遍**:
 *
 *   1. 在一个"这些 API 全被删掉"的沙箱里跑, 跑完必须**一个都不缺**, 而且垫上的那几个要真能用
 *      (withResolvers 能 resolve / any 能兜第一个成功 / at 负数下标 / groupBy 分组 / 随机 UUID 形状…)
 *   2. 在一个"原生都在"的沙箱里跑, 它必须**一个都不动** (新机器上这段等于空跑, 这一点不许漂)
 *   3. 接线四条: app 那一侧真的在"文档开始"注入它 / 桥名与 asset 里那句一致 / 12 秒卡住有兜底弹窗 /
 *      两份 strings 都有那几条文案
 *   4. **更新指引是分步的** (2026-10-26): 四步 + 达标一行 + 应用详情页 / 应用商店两个入口, 正文自己滚
 *
 * 不需要设备, 也不需要 host。用法: node tools/check-web-compat.mjs
 */

import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'

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

const asset = await read('app/src/main/assets/web/lw-compat.js')
const host = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/HostScreen.kt')
const compat = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/WebCompat.kt')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')

/**
 * 造一个"像老 WebView"的沙箱: 把 Chrome 119 之前没有的那些从**这一份 realm 的**内建对象上删掉
 *
 * `vm` 的上下文自带一份独立的内建对象, 所以这里删的是沙箱那一份, 判据自己那一份不受影响
 */
const OLD_APIS = [
  ['Promise', 'withResolvers'],
  ['Promise', 'any'],
  ['Promise', 'try'],
  ['Array.prototype', 'at'],
  ['String.prototype', 'at'],
  ['Object', 'hasOwn'],
  ['String.prototype', 'replaceAll'],
  ['Array.prototype', 'findLast'],
  ['Array.prototype', 'findLastIndex'],
  ['Array.prototype', 'toSorted'],
  ['Array.prototype', 'toReversed'],
  ['Array.prototype', 'with'],
  ['Object', 'groupBy'],
  ['Map', 'groupBy'],
  ['URL', 'canParse'],
]

const BOOTSTRAP = `
  globalThis.window = globalThis
  globalThis.navigator = { userAgent: 'Mozilla/5.0 Chrome/108.0.5359.128' }
  globalThis.setTimeout = (fn) => { try { fn() } catch (error) {} return 0 }
  globalThis.crypto = {
    getRandomValues(array) {
      for (let index = 0; index < array.length; index += 1) array[index] = (index * 37 + 11) & 255
      return array
    },
  }
  globalThis.AbortSignal = class {
    constructor() { this.aborted = false; this.reason = undefined; this._listeners = [] }
    addEventListener(type, listener) {
      if (type !== 'abort') return
      if (this.aborted) { listener.call(this, { target: this }); return }
      this._listeners.push(listener)
    }
    removeEventListener(type, listener) {
      const at = this._listeners.indexOf(listener)
      if (at >= 0) this._listeners.splice(at, 1)
    }
  }
  globalThis.AbortController = class {
    constructor() { this.signal = new globalThis.AbortSignal() }
    abort(reason) {
      const signal = this.signal
      if (signal.aborted) return
      signal.aborted = true
      signal.reason = reason
      const listeners = signal._listeners.slice()
      signal._listeners.length = 0
      for (let index = 0; index < listeners.length; index += 1) listeners[index].call(signal, { target: signal })
    }
  }
  globalThis.reports = []
  globalThis.LuwiWeb = { report(json) { globalThis.reports.push(json) } }
  // vm 的 context 不带 Web 全局, 这里造一个够用的 URL (带 canParse) —— 删掉它才像是
  // Chrome 116 那批 (canParse 是 117)
  globalThis.URL = function URL(text, base) {
    if (typeof text !== 'string') throw new TypeError('URL needs a string')
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) && base === undefined) throw new TypeError('invalid URL: ' + text)
    this.href = String(text)
  }
  globalThis.URL.canParse = function canParse(text, base) {
    try { new globalThis.URL(text, base); return true } catch (error) { return false }
  }
`

/** 沙箱里跑 asset, 再跑一段断言; 回 `{ report, fixed, missing, results }` */
function run(deleteOldApis) {
  const context = createContext({})
  runInContext(BOOTSTRAP, context)
  if (deleteOldApis) {
    for (const [owner, name] of OLD_APIS) {
      runInContext(`delete globalThis.${owner}.${name}`, context)
    }
    runInContext('delete globalThis.structuredClone', context)
    runInContext('delete globalThis.crypto.randomUUID', context)
    runInContext('delete globalThis.AbortSignal.timeout', context)
    runInContext('delete globalThis.AbortSignal.abort', context)
    runInContext('delete globalThis.AbortSignal.any', context)
  }
  runInContext(asset, context)
  const results = runInContext(`
    (function () {
      var out = {}
      try {
        var held = Promise.withResolvers()
        held.resolve(42)
        out.withResolvers = true
        held.promise.then(function (value) { out.withResolversValue = value })
      } catch (error) { out.withResolvers = false }
      out.hasWithResolvers = typeof Promise.withResolvers === 'function'
      out.hasAny = typeof Promise.any === 'function'
      out.at = [1, 2, 3].at(-1) === 3 && 'abc'.at(-1) === 'c'
      out.hasOwn = Object.hasOwn({ a: 1 }, 'a') === true && Object.hasOwn({ a: 1 }, 'b') === false
      out.replaceAll = 'a-b-c'.replaceAll('-', '/') === 'a/b/c' && 'ab'.replaceAll('', '-') === '-a-b-'
      out.findLast = [1, 2, 3].findLast(function (n) { return n < 3 }) === 2
      out.findLastIndex = [1, 2, 3].findLastIndex(function (n) { return n < 3 }) === 1
      out.toSorted = [3, 1, 2].toSorted().join() === '1,2,3' && [3, 1, 2].join() === '3,1,2'
      out.toReversed = [1, 2, 3].toReversed().join() === '3,2,1'
      out.withAt = [1, 2, 3].with(-1, 9).join() === '1,2,9'
      var grouped = Object.groupBy([1, 2, 3, 4], function (n) { return n % 2 ? 'odd' : 'even' })
      out.groupBy = grouped.odd.length === 2 && grouped.even.length === 2 && grouped.odd[0] === 1
      var mapped = Map.groupBy([1, 2, 3], function (n) { return n > 1 })
      out.mapGroupBy = mapped instanceof Map && mapped.get(true).length === 2
      var source = { a: [1, { b: 2 }], when: new Date(0) }
      var copy = structuredClone(source)
      copy.a[1].b = 99
      out.structuredClone = source.a[1].b === 2 && copy.a[1].b === 99 && copy.when instanceof Date
      out.uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(crypto.randomUUID())
      out.timeout = typeof AbortSignal.timeout === 'function' && typeof AbortSignal.abort === 'function'
      out.promiseTry = typeof Promise.try === 'function'
      // AbortSignal.any —— vivo Y77 那一批的病根: 缺了它 dsh 的连接层整条起不来
      var first = new AbortController()
      var second = new AbortController()
      var merged = AbortSignal.any([first.signal, second.signal])
      var seen = null
      merged.addEventListener('abort', function () { seen = merged.reason })
      first.abort('stop')
      out.abortAny = merged.aborted === true && seen === 'stop'
      var early = new AbortController()
      early.abort('early')
      out.abortAnyEarly = AbortSignal.any([early.signal]).aborted === true
      out.abortAnyEmpty = AbortSignal.any([]).aborted === false
      out.canParse = URL.canParse('https://example.com/a') === true && URL.canParse('not a url') === false
      return out
    })()
  `, context)
  const report = runInContext('globalThis.reports.length ? JSON.parse(globalThis.reports[0]) : null', context)
  return { results, report }
}

/* ── 一、老 WebView 上: 一个都不许缺, 而且垫上的要真能用 ───────────────── */

const old = run(true)
check(
  '老 WebView 沙箱: 垫完之后报告里 missing 为空',
  old.report === null ? 'the script never reported' : old.report.missing,
  [],
)
check(
  '垫上的每一项都真的能用 (withResolvers / any / at / hasOwn / replaceAll / findLast / toSorted / with / groupBy / structuredClone / randomUUID / AbortSignal.any / URL.canParse)',
  Object.entries(old.results).filter(([, value]) => value !== true).map(([key]) => key),
  [],
)
check(
  '报告里点了名: 这段 polyfill 补了哪些 (至少 withResolvers / any / AbortSignal.any)',
  ['Promise.withResolvers', 'Promise.any', 'AbortSignal.any'].filter((name) => !(old.report?.fixed ?? []).includes(name)),
  [],
)

/* ── 二、新机器上: 一个都不许动 ─────────────────────────────────────────── */

const modern = run(false)
check('新机器沙箱: 报告里 missing 为空', modern.report?.missing ?? 'no report', [])
check(
  '新机器沙箱: 原生都在的那几项一个字节都不动',
  (modern.report?.fixed ?? []).filter((name) => ['Promise.withResolvers', 'Promise.any', 'Array.prototype.at',
    'String.prototype.replaceAll', 'Object.hasOwn', 'Array.prototype.findLast'].includes(name)),
  [],
)

/* ── 三、接线四条 ───────────────────────────────────────────────────────── */

check(
  'app 那一侧在"文档开始"注入它 (WebViewCompat.addDocumentStartJavaScript)',
  compat.includes('WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))'),
  true,
)
check(
  'asset 里的桥名与 Kotlin 那个常量一致',
  [asset.includes('window.LuwiWeb'), compat.includes('const val BRIDGE = "LuwiWeb"')],
  [true, true],
)
check(
  '文档一开始注入, 不是等 onPageFinished (那种垫得太晚) —— HostScreen 里那一句在 factory 里',
  host.includes('WebCompat.install(this, compat)') && host.indexOf('WebCompat.install(this, compat)') < host.indexOf('override fun onPageFinished'),
  true,
)
check(
  '12 秒还没画出来就弹窗 (别让人对着连接中干等)',
  [
    host.includes('delay(STUCK_SECONDS * 1000L)'),
    host.includes('if (readyAt == seen)'),
    host.includes('WebViewTroubleDialog('),
    compat.includes('internal const val STUCK_SECONDS = 12'),
  ],
  [true, true, true, true],
)
check(
  '弹窗用的是真 Dialog (WebView 是子 View, Miuix 的 OverlayDialog 盖不住)',
  compat.includes('import androidx.compose.ui.window.Dialog') && compat.includes('DialogProperties(usePlatformDefaultWidth = false)'),
  true,
)

/* ── 四、两份文案键一致 ─────────────────────────────────────────────────── */

const keys = ['webview_trouble_title', 'webview_trouble_missing', 'webview_trouble_slow', 'webview_trouble_steps',
  'webview_trouble_step_store', 'webview_trouble_step_manual', 'webview_trouble_step_multi',
  'webview_trouble_step_reopen', 'webview_trouble_target', 'webview_trouble_details', 'webview_trouble_market',
  'webview_trouble_retry', 'webview_trouble_later', 'webview_trouble_no_settings', 'webview_trouble_no_market']
check(
  '两份 strings 都有那十五条, 一条不落',
  keys.filter((key) => !zh.includes(`name="${key}"`) || !en.includes(`name="${key}"`)),
  [],
)
check(
  '带参那几条用的是位置参数 (%1$s / %2$s / %1$d)',
  [
    zh.includes('%1$s, 内置兼容层之后仍缺'),
    zh.includes('界面 %1$d 秒了还没出来'),
    zh.includes('真正加载的那一份是 %1$s'),
    zh.includes('到 Chrome %1$d'),
  ],
  [true, true, true, true],
)

/* ── 五、更新指引是分步的 (2026-10-26 主人: "加 webview 更新指引") ──────── */

check('指引四步 + 达标一行都在弹窗里', [
  compat.includes('R.string.webview_trouble_steps'),
  compat.includes('R.string.webview_trouble_step_store'),
  compat.includes('R.string.webview_trouble_step_manual'),
  compat.includes('R.string.webview_trouble_step_multi'),
  compat.includes('R.string.webview_trouble_step_reopen'),
  compat.includes('R.string.webview_trouble_target'),
], [true, true, true, true, true, true])
check('两个入口分开: 应用详情页与商店各一个按钮', [
  compat.includes('WebCompat.openDetails(context, info)'),
  compat.includes('WebCompat.openMarket(context, info)'),
  compat.includes('R.string.webview_trouble_details'),
  compat.includes('R.string.webview_trouble_market'),
], [true, true, true, true])
check('正文自己滚, 按钮钉在卡片底下', [
  compat.includes('verticalScroll(rememberScrollState())'),
  compat.includes('heightIn(max = 520.dp)'),
], [true, true])

console.log(`\n${checks - failures} / ${checks} 通过`)
if (failures > 0) process.exit(1)
