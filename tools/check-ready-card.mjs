/**
 * 「开始使用」引导窗 (四件依赖 + 两个模型下载) 的判据
 *
 * 2026-11-04 主人把这张卡改成了**居中对话框**: 首启自动弹一次、设置页「省电」上方那一行手动弹,
 * 原来内嵌的两处 (启动页底部 / 设置页那个 item) 都撤了; 虚拟屏那一行后来又整个撤了 (同日第二条);
 * 设置页右上角那个刷新图标也去掉了。所以这张卡的接缝比原来多几条, 每一处**漂开了都不会报错**:
 *
 *   1. **四件顺序**: 特权通道 → 无障碍 → 唤醒模型 → 语音模型。这是**依赖顺序**, 不是重要性
 *      顺序 —— 排错了不会崩, 只会让人按着一个点不动的按钮
 *   2. **键名与两份 strings**: 全部 `ready_*` 前缀, en 与 zh 都在, 顺序也一至; 半截用 `settings_ready_*`
 *      就会让那一半没字 (那一批键只该出现在这一张卡上)
 *   3. **四档状态都在**: 没办 / 正在下 / 做完了 / 试过没成 —— 少一档就退化成"打勾与没打勾"
 *   4. **只走既有下载通道**: 唤醒词与语音模型各有一个现成下载器 (`WakeWordDownload` /
 *      `SpeechModelDownload`), 这一卡只许调它们的 `download()`、只许读它们的 `phase` / `received` /
 *      `total`; 自己再写一套 http 客户端就是第二份文件表与第二份 sha256
 *   5. **入口**: ① 首启一次 (prefs 键 `ready-dialog-seen`, 挂在 AppNav 最外层, 排在加载界面之后)
 *      ② 设置页「省电」**上方**那一行。两处内嵌的挂载必须都不在了, 否则又是"底部半张卡"
 *   6. **虚拟屏整行都不在了** (2026-11-04 主人: 那一行去掉): 判定是"step 里 `action` 的赋值只有
 *      四处" + `CreateScreen` 全无 + `ready_screen` 那三条文案与 `VirtualScreen` 引用一起没了 ——
 *      少一条它就悄悄长回一行
 *   7. **刷新按钮真的没了**: 它原来是 `reload` 计数 + `key(reload)` 整棵重建。删一半 (只删图标、留着
 *      `reload += 1`) 编译不过, 删错一半 (留着死代码) 则看不出问题, 所以四条一起看
 *   8. **加载界面在前, 首启引导在后** (2.8.0 #44, 推翻 #39): 开屏与页面加载照常开跑 (页面 host 一就绪
 *      就挂), 引导等加载界面收尾才弹 —— 页面画出来 / host 起不来 / 45 s 兜底, 三条里任一条放行
 *
 * 不需要设备: 全是拿真源码对着核 (与 `check-ball-menu.mjs` 同一个办法)。
 *
 * 用法: node tools/check-ready-card.mjs
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const src = (name) => `app/src/main/java/io/github/yuloong07star/luwi/${name}`
const card = await read(src('ui/ReadyCard.kt'))
const settings = await read(src('ui/SettingsScreen.kt'))
const host = await read(src('ui/HostScreen.kt'))
const nav = await read(src('ui/AppNav.kt'))
const activity = await read(src('MainActivity.kt'))
const en = await read('app/src/main/res/values/strings.xml')
const zh = await read('app/src/main/res/values-zh/strings.xml')

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

const keysOf = (xml, prefix) => [...xml.matchAll(/<string\s+name="([^"]+)"/gu)]
  .map((one) => one[1])
  .filter((key) => key.startsWith(prefix))

// "代码里有没有"这类断言先去掉注释: 注释里交代"为什么不下 GLM / 为什么不自己写下载器"是好事,
// 不该被当成"代码里用了"判掉
const code = card
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/\/\/[^\n]*/gu, '')

/* ── 一、四件的顺序就是依赖顺序 ───────────────────────────────────────── */

// 顺序靠"步骤标题"认: 每一件在 [steps] 里只出现一次, 而且顺序看得见
const stepTitles = [...card.matchAll(/title\s*=\s*stringResource\(R\.string\.(ready_[a-z_]+)\)/gu)]
  .map((one) => one[1])
  // `ready_permissions` 是竖轨上那个入口行的标题, 不是四件依赖之一 (它没有状态、不进环的分母)
  .filter((key) => !key.startsWith('ready_permissions'))
check(
  '四件的顺序: 特权通道 → 无障碍 → 唤醒模型 → 语音模型',
  stepTitles,
  ['ready_channel', 'ready_accessibility', 'ready_wake', 'ready_speech'],
)

/* ── 二、键名 ready_* , 两份 strings 都在, 顺序一致 ────────────────────── */

// 卡片里真正引用到的键 (含 CTA 与"开始使用 Luwi"那句)
const used = [...new Set([...card.matchAll(/R\.string\.(ready_[a-z_]+)/gu)].map((one) => one[1]))].sort()
const enKeys = keysOf(en, 'ready_')
const zhKeys = keysOf(zh, 'ready_')
check('卡片引用的键全在两份 strings 里', [used.every((key) => enKeys.includes(key)), used.every((key) => zhKeys.includes(key))], [true, true])
check('ready_* 两份的键集合相同', enKeys.slice().sort(), zhKeys.slice().sort())
check('ready_* 两份的顺序相同', enKeys, zhKeys)
check(
  '旧前缀 settings_ready_* 一个都不剩 (那一批有一半是启动页在用的)',
  [en.includes('settings_ready_'), zh.includes('settings_ready_')],
  [false, false],
)
check(
  '四档状态各有各的话: 没下 / 正在下 / 已就绪 / 没下成',
  ['ready_model_missing', 'ready_model_downloading', 'ready_model_ready', 'ready_model_failed']
    .every((key) => enKeys.includes(key) && zhKeys.includes(key)),
  true,
)
check(
  '对话框与设置入口那三条文案两份都在',
  ['ready_dialog_close', 'ready_check', 'ready_check_summary']
    .every((key) => enKeys.includes(key) && zhKeys.includes(key)),
  true,
)

/* ── 三、四档状态: 定义、映射、画法都在 ───────────────────────────────── */

check(
  'ReadyState 四档 (TODO / RUNNING / DONE / FAILED)',
  /enum class ReadyState \{[^}]*\bTODO\b[^}]*\bRUNNING\b[^}]*\bDONE\b[^}]*\bFAILED\b[^}]*\}/u.test(card),
  true,
)
check(
  '两个下载器的 phase 各自映射到四档 (IDLE 时再看一眼磁盘)',
  [
    card.includes('WakeWordDownload.Phase.DOWNLOADING -> ReadyState.RUNNING'),
    card.includes('WakeWordDownload.Phase.FAILED -> ReadyState.FAILED'),
    card.includes('WakeWordDownload.Phase.READY -> ReadyState.DONE'),
    card.includes('WakeWordDownload.Phase.IDLE -> if (present) ReadyState.DONE else ReadyState.TODO'),
    card.includes('SpeechModelDownload.Phase.DOWNLOADING -> ReadyState.RUNNING'),
    card.includes('SpeechModelDownload.Phase.FAILED -> ReadyState.FAILED'),
    card.includes('SpeechModelDownload.Phase.READY -> ReadyState.DONE'),
    card.includes('SpeechModelDownload.Phase.IDLE -> if (present) ReadyState.DONE else ReadyState.TODO'),
  ],
  [true, true, true, true, true, true, true, true],
)
check(
  '节点把四档都画了 (打勾 / 进度弧 / 错误色 / 浅圈)',
  [
    card.includes('ReadyState.DONE -> {'),
    card.includes('ReadyState.RUNNING -> {'),
    card.includes('ReadyState.FAILED -> {'),
    card.includes('ReadyState.TODO -> drawCircle('),
  ],
  [true, true, true, true],
)
check(
  '下载中那一行给的是确定进度 (环 + 细条 + 百分比), 不是转圈',
  [
    card.includes('WakeWordDownload.received'),
    card.includes('WakeWordDownload.total'),
    card.includes('SpeechModelDownload.received'),
    card.includes('SpeechModelDownload.total'),
    card.includes('sweepAngle = 360f * progress.coerceIn(0f, 1f)'),
    card.includes('ReadyBar('),
    card.includes('stringResource(R.string.ready_percent'),
    !/CircularProgressIndicator|LinearProgressIndicator|InfiniteTransition|rememberInfiniteTransition/u.test(code),
  ],
  [true, true, true, true, true, true, true, true],
)

/* ── 四、只许调既有下载入口, 不许自建网络层 ───────────────────────────── */

check(
  '两个模型的下载走的是现成的 download()',
  [
    card.includes('WakeWordDownload.download(context)'),
    card.includes('SpeechModelDownload.download(context)'),
    !card.includes('WakeWordDownload.download(') || card.indexOf('WakeWordDownload.download(context)') >= 0,
  ],
  [true, true, true],
)
check(
  '没有自带 http 客户端 / 第二份文件表',
  [
    /okhttp3|OkHttpClient|HttpURLConnection|java\.net|Retrofit|URL\(/u.test(code),
    /items\s*=|sha256|\.part"|sources\s*=/u.test(code),
  ],
  [false, false],
)
check(
  'GLM-ASR 要点名才下, 不算进这张卡的必做项',
  [/GlmAsr|glm-asr/iu.test(code)],
  [false],
)
check(
  '打开时只做一次不联网的 refresh (读状态, 不下载)',
  [
    card.includes('WakeWordDownload.refresh(context)'),
    card.includes('SpeechModelDownload.refresh(context)'),
    !card.includes('WakeWordDownload.download(context)\n    }\n    val'),
  ],
  [true, true, true],
)

/* ── 五、它现在是一个**居中对话框** (2026-11-04 主人 #1 / #2) ───────────── */

check(
  'ReadyCard 作为**居中对话框**的内容存在 (Dialog 居中 + 一张会滚的 Card + 一颗"开始使用 Luwi")',
  [
    /internal fun ReadyCardDialog\(onDismiss: \(\) -> Unit, onReport: \(\) -> Unit\)/u.test(card),
    card.includes('Dialog('),
    card.includes('DialogProperties(usePlatformDefaultWidth = false)'),
    card.includes('contentAlignment = Alignment.Center'),
    card.includes('verticalScroll(rememberScrollState())'),
    /fun ReadyCardBody\(permissionsDone: Boolean, onPermissions: \(\) -> Unit, onReport: \(\) -> Unit\)/u.test(card),
    card.includes('R.string.ready_dialog_close'),
    // 原来那套"内嵌占位"跟着内嵌挂载一起退休了: 对话框里没有要 reserve 的页面空间
    !card.includes('reserve.toDp()'),
  ],
  [true, true, true, true, true, true, true, true],
)

check(
  '第五件是「选择权限」入口, 点开是设置页那一段本身 (2026-11-07 主人)',
  [
    card.includes('R.string.ready_permissions'),
    /internal fun ReadyPermissionsDialog\(onDismiss: \(\) -> Unit\)/u.test(card),
    // 权限那一段只有一份实现: 设置页那个函数必须是 internal, 否则卡里调不到, 迟早被抄成第二份
    card.includes('PermissionsItems()'),
    /internal fun PermissionsItems\(\)/u.test(settings),
    // 它不是 ReadyStep: 不进环的分母, 也不参与"还差几步"
    [...code.matchAll(/^\s+action = ReadyAction\./gmu)].length,
    // 位置: 竖轨里的第五个节点 (2026-11-07 主人: "也放在那个竖向进度条的下方"), 不能掉到"下一步"
    // 按钮后面去; 四行的末行不再收口 (`last = false`), 轨道才接得到它
    (() => {
      const rows = card.indexOf('steps.forEachIndexed')
      const link = card.indexOf('ReadyLinkRow(')
      const next = card.indexOf('if (next != null)')
      return rows >= 0 && link > rows && next > link && card.includes('last = false')
    })(),
    zh.includes('<string name="ready_permissions">选择权限</string>'),
    en.includes('<string name="ready_permissions">Choose permissions</string>'),
  ],
  [true, true, true, true, 4, true, true, true],
)

check(
  '权限那一行的节点颜色与就绪判断 (2026-11-07 主人: 颜色不对 / 没办却说准备完毕)',
  [
    // 未办 / 已办都是四件同一档的节点: 不另画第五种 (2026-11-07 主人: "保持一致")
    card.includes('state = if (done) ReadyState.DONE else ReadyState.TODO'),
    // 箭头那套已经撤了: 竖轨里不该再出现四件都没有的形状
    !card.includes('val half = NodeRadius.toPx() * 0.42f'),
    card.includes('onAccent = colors.surface'),
    // 就绪判断把这一件也算进去, 否则权限没看过也会说"全部就绪"
    card.includes('if (permissionsDone) 1 else 0'),
    card.includes('val total = steps.size + 1'),
    card.includes('ReadyHead(done = done, total = total, missing = missing)'),
    // 关掉那一窗才算办过, 而且跨启动记得住
    card.includes('PermissionsSeen.read'),
    card.includes('PermissionsSeen.mark'),
    zh.includes('<string name="ready_permissions_summary">也可在设置里进行修改</string>'),
    en.includes('<string name="ready_permissions_summary">You can also change these in Settings</string>'),
  ],
  [true, true, true, true, true, true, true, true, true, true],
)

check(
  '第二窗的「完成」常驻底部, 且不压在权限项上 (2026-11-07 主人)',
  [
    // 滚区只包内容: 按钮在它之外, 于是滚到底时最后一行停在按钮上面, 不会被盖住
    /Column\(\s*modifier = Modifier\s*\.weight\(1f, fill = false\)\s*\.verticalScroll/u.test(card) ||
      card.includes('.weight(1f, fill = false)'),
    card.includes('R.string.ready_permissions_close'),
    (() => {
      const scroller = card.indexOf('.weight(1f, fill = false)')
      const close = card.indexOf('R.string.ready_permissions_close')
      return scroller > 0 && close > scroller
    })(),
    // 标题也固定: 滚到第十七项时还要知道这一窗是什么
    card.includes('MiuixTheme.textStyles.title3'),
  ],
  [true, true, true, true],
)

check(
  '那颗按钮说的是"开始使用 Luwi" (2026-11-04 主人第二条)',
  [
    zh.includes('<string name="ready_dialog_close">开始使用 Luwi</string>'),
    en.includes('<string name="ready_dialog_close">Start using Luwi</string>'),
  ],
  [true, true],
)

/* ── 六、设置页「省电」上方那一行, 与两处内嵌挂载都撤了 ────────────────── */

check(
  '设置页「省电」上方有「检查所需依赖」那一行, 点它弹同一个对话框',
  [
    settings.includes('R.string.ready_check'),
    settings.includes('R.string.ready_check_summary'),
    settings.includes('onClick = { readyOpen = true }'),
    // 2026-11-10 起这一窗还带 `onReport` (自检那条路), 所以这里只认"同一个对话框 + 同一个开关"
    /if \(readyOpen\) \{\s*ReadyCardDialog\(\s*onDismiss = \{ readyOpen = false \},/u.test(settings),
    // 位置必须在「省电」那一段之前
    settings.indexOf('R.string.ready_check') > 0
      && settings.indexOf('R.string.ready_check') < settings.indexOf('key = "power"'),
  ],
  [true, true, true, true, true],
)
check(
  '两处内嵌挂载都撤了 (启动页底部 / 设置页那个 item)',
  [
    !host.includes('ReadyCard('),
    !settings.includes('item { ReadyCard() }'),
    settings.includes('ReadyCardDialog('),
  ],
  [true, true, true],
)

/* ── 七、首启弹一次: prefs 键 + 挂在最外层 (排在加载界面之后) ─────────── */

check(
  '首启弹一次, 弹过记 `ready-dialog-seen`; 挂在 AppNav 最外层',
  [
    card.includes('private const val SEEN = "ready-dialog-seen"'),
    card.includes('getBoolean(SEEN, false)'),
    card.includes('putBoolean(SEEN, true)'),
    card.includes('internal fun ReadyPrompt()'),
    // 弹之前先看闸: 加载界面还没走完就不 claim (2.8.0 #44, 顺序见第十一节)
    /LaunchedEffect\(waiting\) \{\s*\n\s*if \(waiting\) return@LaunchedEffect\s*\n\s*if \(withContext\(Dispatchers\.IO\) \{ ReadyDialogSeen\.claim\(context\) \}\) open = true/u
      .test(card),
    nav.includes('ReadyPrompt()'),
  ],
  [true, true, true, true, true, true],
)

/* ── 八、虚拟屏那一行整个不在了 (2026-11-04 主人: 那一行去掉) ──────────── */

check(
  '虚拟屏整行撤了: 代码里没有它, 两份 strings 也没有它的字',
  [
    !/CreateScreen/u.test(code),
    // 四个 step 各一处 action 赋值 (通道 / 无障碍 / 唤醒词 / 语音)
    [...code.matchAll(/^\s+action = ReadyAction\./gmu)].length,
    !/ready_screen/u.test(code),
    !/VirtualScreen/u.test(code),
    !enKeys.includes('ready_screen') && !zhKeys.includes('ready_screen'),
  ],
  [true, 4, true, true, true],
)

/* ── 九、设置页右上角那个刷新按钮没了 (2026-11-04 主人 #4) ──────────────── */

check(
  '那个刷新图标与它的 reload 计数整套都没了 (不是只删了图标)',
  [
    !settings.includes('MiuixIcons.Refresh'),
    !settings.includes('R.string.settings_refresh'),
    !settings.includes('R.string.settings_refreshed'),
    !settings.includes('reload += 1'),
    !/key\(reload\)/u.test(settings),
    !settings.includes('var reload by'),
  ],
  [true, true, true, true, true, true],
)

/* ── 十、动效刻度: 行 90 / 环 600 / 弹 1.06 ───────────────────────────── */

check(
  '动效刻度没被顺手改掉, 行被打断时仍补到不透明',
  [
    card.includes('private const val RowStaggerMillis = 90L'),
    card.includes('private const val RingMillis = 600'),
    card.includes('private const val PopScale = 1.06f'),
    card.includes('enter.snapTo(1f)'),
    !card.includes('LingerMillis'),
  ],
  [true, true, true, true, true],
)

/* ── 十一、加载界面在前, 首启引导在后 (落实表 2.8.0 #44, 2026-11-13) ─────── */

// 首启那一段三件事挤在同一秒: 原生开屏 (host 就绪 → 页面加载), 页面里 dsh 自己的登录 / 凭据弹窗,
// 与原生这张「开始使用」。顺序是**加载界面在前, 引导在后** —— 页面照旧 host 一就绪就挂 (不然真正的
// 加载要等引导关掉才开始), 引导改成等加载界面收尾: 页面画出来 / host 起不来 / 45 s 兜底
check(
  '首启引导排在加载界面之后, 页面不再被引导押住 (2.8.0 #44)',
  [
    card.includes('internal object GettingStarted {'),
    // 两条纯判据, 单测 (GettingStartedTest) 钉的是它们
    card.includes('internal fun firstRunWaits('),
    card.includes('internal fun guideWaitsLoading('),
    // 判在组合之前: 引导读的那份状态要在第一帧就位
    activity.includes('GettingStarted.prepare(this)'),
    // #39 那条"引导压着 WebView"已经撤了: 页面不再读 holdsPage, 也不再为引导画另一种开屏
    !host.includes('GettingStarted.holdsPage'),
    !host.includes('R.string.boot_stage_guide'),
    !`${en}${zh}`.includes('boot_stage_guide'),
    // 页面画出来那一下算加载界面走完: onReady 里 settle, 而且要在 onLost 之前
    (() => {
      const ready = host.indexOf('onReady = {')
      const settle = host.indexOf('GettingStarted.settle()', ready)
      const lost = host.indexOf('onLost =', ready)
      return ready > 0 && settle > ready && lost > settle
    })(),
    // host 起不来也算走完: 引导里那张体检表正是修这一步的地方
    (() => {
      const failed = host.indexOf('status is HostStatus.Failed')
      return failed > 0 && host.indexOf('GettingStarted.settle()', failed) > failed
    })(),
    // 引导等的是状态 (等它翻成 false), 不是"这一帧就弹"; 兜底也得在
    card.includes('val waiting = GettingStarted.waiting'),
    /LaunchedEffect\(waiting\)/u.test(card),
    card.includes('delay(LOADING_BACKSTOP_MS)'),
  ],
  [true, true, true, true, true, true, true, true, true, true, true, true],
)

console.log(failures === 0 ? `\n${checks} / ${checks} 条通过` : `\n${failures} / ${checks} 条判据不过`)
process.exit(failures === 0 ? 0 : 1)