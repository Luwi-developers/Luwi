/**
 * dsh 后台持久化那一摊的判据 (2026-10-26 主人: "加强 dsh 后台持久化，当前每次打开都要重新加载")
 *
 * 这一批改的三件事都在源码里, 不需要设备, 也不需要真机:
 *
 *   1. **页面别被回收**: `HostScreen` 把 renderer 优先级钉在 VISIBLE 且不可见时也不豁免;
 *      renderer 真死时自己换一块新的 (`onRenderProcessGone` 返回 true, 不让系统把应用进程一起带走),
 *      并且有重建次数上限
 *   2. **回前台自愈**: `MainActivity.onResume` 把前台服务再拉一次 (幂等), host 已经活着时是空转
 *   3. **白名单点一下就能给**: `BatteryWhitelist` 先要系统确认框、再退名单页; 权限段与省电段两处都用它,
 *      而且判据只有它一处 (`isIgnoringBatteryOptimizations` 全仓一次)
 *
 * 跑法: node tools/check-host-persistence.mjs
 * 退出码: 0 = 全过; 1 = 有 FAIL
 */

import { readFile } from 'node:fs/promises'

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

const host = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/HostScreen.kt')
const main = await read('app/src/main/java/io/github/yuloong07star/luwi/MainActivity.kt')
const tavern = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/TavernChatScreen.kt')
const overlay = await read('app/src/main/java/io/github/yuloong07star/luwi/overlay/OverlayService.kt')
const whitelist = await read('app/src/main/java/io/github/yuloong07star/luwi/util/BatteryWhitelist.kt')
const catalog = await read('app/src/main/java/io/github/yuloong07star/luwi/util/PermissionCatalog.kt')
const gate = await read('app/src/main/java/io/github/yuloong07star/luwi/util/PermissionGate.kt')
const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')

/* ── 一、页面别被回收 ───────────────────────────────────────────────────── */

check('renderer 优先级钉在 BOUND, 不可见也不豁免降级', [
  /setRendererPriorityPolicy\(\s*WebView\.RENDERER_PRIORITY_BOUND,\s*false\s*\)/u.test(host),
], [true])
check('renderer 死了自己换一块新的, 不让系统杀应用进程', [
  /override fun onRenderProcessGone\(/u.test(host),
  /if \(rebuilds > MAX_PAGE_REBUILDS\)/u.test(host),
  /view\.destroy\(\)/u.test(host),
  /generation \+= 1/u.test(host),
], [true, true, true, true])
check('重建次数有上限 (不陷进重建循环)', /private const val MAX_PAGE_REBUILDS = 3/u.test(host), true)
check('换新页时把开屏盖回去 (onLost)', [
  /onLost: \(\) -> Unit = \{\}/u.test(host),
  /onLost = \{ pageUp = false \}/u.test(host),
], [true, true])
check('每次重建都真的换一个 AndroidView (key(generation))', /key\(generation\) \{/u.test(host), true)
check('同一个地址不会因为重组再 loadUrl 一次 (302 之后 view.url 永不等于 token URL)', [
  /if \(launched\[0\] != url\)/u.test(host),
  !/if \(view\.url != url\) view\.loadUrl\(url\)/u.test(host),
], [true, true])

/* ── 一之二、酒馆与浮标输入条 (2026-10-28) ──────────────────────────────── */

// 酒馆那块也是"常驻复用"的一条: 退出只摘不 destroy, 再进来直接是上一屏。它比主界面多两件事 ——
// 令牌换了要重建 / 重载 (host 重启后旧 cookie 会 401), renderer 死了要自己接住 (缺省会杀应用进程)
check('酒馆 WebView 复用槽带 token, 退出不 destroy', [
  /internal object TavernWebViewCache/u.test(tavern),
  /var token: String\?/u.test(tavern),
  /TavernWebViewCache\.token == token/u.test(tavern),
  /fun release\(\)/u.test(tavern),
  /TavernWebViewCache\.store\(this, token\)/u.test(tavern),
  /runCatching \{ view\.onPause\(\) \}/u.test(tavern),
  /runCatching \{ view\.onResume\(\) \}/u.test(tavern),
], [true, true, true, true, true, true, true])
check('酒馆 renderer 也钉住, 死了换一块新的 (不带走应用进程)', [
  /setRendererPriorityPolicy\(WebView\.RENDERER_PRIORITY_BOUND, false\)/u.test(tavern),
  /override fun onRenderProcessGone\(/u.test(tavern),
  /TavernWebViewCache\.forget\(view\)/u.test(tavern),
  /generation \+= 1/u.test(tavern),
  /key\(generation\) \{/u.test(tavern),
  /TavernWebViewCache\.release\(\)/u.test(main),
], [true, true, true, true, true, true])
check('host 令牌变了只重载一次, 不是把坏页面摆出来', [
  /if \(TavernWebViewCache\.token != token\)/u.test(tavern),
  /tavern: the host token changed, reloading once/u.test(tavern),
  /tavern: the host token changed, rebuilding the page/u.test(tavern),
], [true, true, true])

// 浮标输入条是第三块 dsh WebView: 收起只摘, 展开必须把原来那一块挂回去; host 重启换 URL 才重载
check('浮标输入条收起再展开是重新挂上, 不是重载', [
  /private var stripUrl: String\?/u.test(overlay),
  /manager\.addView\(existing, previous\)/u.test(overlay),
  /strip: reattached without a reload/u.test(overlay),
  /strip: the host url changed, reloading once/u.test(overlay),
  /stripUrl != url/u.test(overlay),
], [true, true, true, true, true])

/* ── 二、回前台自愈 ─────────────────────────────────────────────────────── */

check('MainActivity.onResume 把前台服务再拉一次, 并按 host 状态留一行判据', [
  /override fun onResume\(\)/u.test(main),
  /DshHostService\.start\(this\)/u.test(main),
  /resumed with host \$\{DshHost\.status\}/u.test(main),
], [true, true, true])

/* ── 三、电池白名单只有一份实现, 两处入口 ───────────────────────────────── */

check('BatteryWhitelist: 先要系统确认框, 再退名单页', [
  /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/u.test(whitelist),
  /ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS/u.test(whitelist),
  /package:\$\{context\.packageName\}/u.test(whitelist),
], [true, true, true])
check('白名单判据全仓只有一处 (PermissionCatalog 转调它)', [
  (whitelist.match(/isIgnoringBatteryOptimizations/gu) ?? []).length,
  (catalog.match(/isIgnoringBatteryOptimizations/gu) ?? []).length,
  /BatteryWhitelist\.ignored\(context\)/u.test(catalog),
], [1, 0, true])
check('权限段的「忽略电池优化」也走一键入口', [
  /capability\.settings\?\.action == Settings\.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS/u.test(gate),
  /BatteryWhitelist\.request\(context\)/u.test(gate),
], [true, true])
check('省电段多一行「后台保活」, 回前台重读一次', [
  screen.includes('R.string.settings_power_keepalive'),
  screen.includes('BatteryWhitelist.request(context)'),
  /if \(event == Lifecycle\.Event\.ON_RESUME\) whitelisted = BatteryWhitelist\.ignored\(context\)/u.test(screen),
], [true, true, true])
check('两条文案两份 strings 都有, 顺序也一样', [
  ['settings_power_keepalive', 'settings_power_keepalive_granted',
    'settings_power_keepalive_missing', 'settings_power_keepalive_failed']
    .filter((key) => !zh.includes(`name="${key}"`) || !en.includes(`name="${key}"`)),
  zh.indexOf('settings_power_keepalive_granted') < zh.indexOf('settings_power_keepalive_missing'),
  en.indexOf('settings_power_keepalive_granted') < en.indexOf('settings_power_keepalive_missing'),
], [[], true, true])

console.log(`\n${checks - failures} / ${checks} 通过`)
if (failures > 0) process.exit(1)
