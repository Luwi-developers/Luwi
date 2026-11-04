/**
 * 「开始使用」引导窗 (五件依赖 + 两个模型下载) 的判据
 *
 * 2026-11-04 主人把这张卡改成了**居中对话框**: 首启自动弹一次、设置页「省电」上方那一行手动弹,
 * 原来内嵌的两处 (启动页底部 / 设置页那个 item) 都撤了; 虚拟屏那一项只剩状态、不再给 CTA;
 * 设置页右上角那个刷新图标也去掉了。所以这张卡的接缝比原来多几条, 每一处**漂开了都不会报错**:
 *
 *   1. **五件顺序**: 特权通道 → 无障碍 → 唤醒模型 → 语音模型 → 虚拟屏。这是**依赖顺序**, 不是重要性
 *      顺序 —— 排错了不会崩, 只会让人按着一个点不动的按钮
 *   2. **键名与两份 strings**: 全部 `ready_*` 前缀, en 与 zh 都在, 顺序也一至; 半截用 `settings_ready_*`
 *      就会让那一半没字 (那一批键只该出现在这一张卡上)
 *   3. **四档状态都在**: 没办 / 正在下 / 做完了 / 试过没成 —— 少一档就退化成"打勾与没打勾"
 *   4. **只走既有下载通道**: 唤醒词与语音模型各有一个现成下载器 (`WakeWordDownload` /
 *      `SpeechModelDownload`), 这一卡只许调它们的 `download()`、只许读它们的 `phase` / `received` /
 *      `total`; 自己再写一套 http 客户端就是第二份文件表与第二份 sha256
 *   5. **入口**: ① 首启一次 (prefs 键 `ready-dialog-seen`, 挂在 AppNav 最外层, 于是开屏那一屏上就
 *      盖得住) ② 设置页「省电」**上方**那一行。两处内嵌的挂载必须都不在了, 否则又是"底部半张卡"
 *   6. **虚拟屏不给 CTA**: 那一项只报状态。判定方式是"step 里 `action` 的赋值只有四处" +
 *      `CreateScreen` 全无 + 那两条文案也删了 —— 少一条它就悄悄长回一个按钮
 *   7. **刷新按钮真的没了**: 它原来是 `reload` 计数 + `key(reload)` 整棵重建。删一半 (只删图标、留着
 *      `reload += 1`) 编译不过, 删错一半 (留着死代码) 则看不出问题, 所以四条一起看
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

/* ── 一、五件的顺序就是依赖顺序 ───────────────────────────────────────── */

// 顺序靠"步骤标题"认: 每一件在 [steps] 里只出现一次, 而且顺序看得见
const stepTitles = [...card.matchAll(/title\s*=\s*stringResource\(R\.string\.(ready_[a-z_]+)\)/gu)]
  .map((one) => one[1])
check(
  '五件的顺序: 特权通道 → 无障碍 → 唤醒模型 → 语音模型 → 虚拟屏',
  stepTitles,
  ['ready_channel', 'ready_accessibility', 'ready_wake', 'ready_speech', 'ready_screen'],
)

/* ── 二、键名 ready_* , 两份 strings 都在, 顺序一致 ────────────────────── */

// 卡片里真正引用到的键 (含 CTA 与"知道了"那几句)
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
  'ReadyCard 作为**居中对话框**的内容存在 (Dialog 居中 + 一张会滚的 Card + 一颗"知道了")',
  [
    /internal fun ReadyCardDialog\(onDismiss: \(\) -> Unit\)/u.test(card),
    card.includes('Dialog('),
    card.includes('DialogProperties(usePlatformDefaultWidth = false)'),
    card.includes('contentAlignment = Alignment.Center'),
    card.includes('verticalScroll(rememberScrollState())'),
    card.includes('fun ReadyCardBody()'),
    card.includes('R.string.ready_dialog_close'),
    // 原来那套"内嵌占位"跟着内嵌挂载一起退休了: 对话框里没有要 reserve 的页面空间
    !card.includes('reserve.toDp()'),
  ],
  [true, true, true, true, true, true, true, true],
)

/* ── 六、设置页「省电」上方那一行, 与两处内嵌挂载都撤了 ────────────────── */

check(
  '设置页「省电」上方有「检查所需依赖」那一行, 点它弹同一个对话框',
  [
    settings.includes('R.string.ready_check'),
    settings.includes('R.string.ready_check_summary'),
    settings.includes('onClick = { readyOpen = true }'),
    settings.includes('if (readyOpen) ReadyCardDialog(onDismiss = { readyOpen = false })'),
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

/* ── 七、首启弹一次: prefs 键 + 挂在最外层 (开屏那一屏就盖得住) ─────────── */

check(
  '首启弹一次, 弹过记 `ready-dialog-seen`; 挂在 AppNav 最外层',
  [
    card.includes('private const val SEEN = "ready-dialog-seen"'),
    card.includes('getBoolean(SEEN, false)'),
    card.includes('putBoolean(SEEN, true)'),
    card.includes('internal fun ReadyPrompt()'),
    /LaunchedEffect\(Unit\) \{\s*\n\s*if \(withContext\(Dispatchers\.IO\) \{ ReadyDialogSeen\.claim\(context\) \}\) open = true/u.test(card),
    nav.includes('ReadyPrompt()'),
  ],
  [true, true, true, true, true, true],
)

/* ── 八、虚拟屏那一项不给 CTA (2026-11-04 主人 #3) ────────────────────── */

check(
  '虚拟屏那一项只显示状态, 不再给 CTA',
  [
    !/CreateScreen/u.test(code),
    // 五个 step 里只有四处 action 赋值 (通道 / 无障碍 / 唤醒词 / 语音), 虚拟屏那一个没有
    [...code.matchAll(/^\s+action = ReadyAction\./gmu)].length,
    !enKeys.includes('ready_action_screen'),
    !zhKeys.includes('ready_action_screen'),
  ],
  [true, 4, true, true],
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

console.log(failures === 0 ? `\n${checks} / ${checks} 条通过` : `\n${failures} / ${checks} 条判据不过`)
process.exit(failures === 0 ? 0 : 1)
