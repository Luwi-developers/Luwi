/**
 * 「开始使用」引导卡 (五件依赖 + 两个模型下载) 的判据
 *
 * 这张卡横着五处接缝, 每一处**漂开了都不会报错**, 只会安静地变坏:
 *
 *   1. **五件顺序**: 特权通道 → 无障碍 → 唤醒模型 → 语音模型 → 虚拟屏。这是**依赖顺序**, 不是重要性
 *      顺序 —— 排错了不会崩, 只会让人按着一个点不动的按钮
 *   2. **键名与两份 strings**: 全部 `ready_*` 前缀, en 与 zh 都在, 顺序也一至; 半截用 `settings_ready_*`
 *      就会让启动页那半截没字 (那一批键只该出现在这一张卡上)
 *   3. **四档状态都在**: 没办 / 正在下 / 做完了 / 试过没成 —— 少一档就退化成"打勾与没打勾"
 *   4. **只走既有下载通道**: 唤醒词与语音模型各有一个现成下载器 (`WakeWordDownload` /
 *      `SpeechModelDownload`), 这一卡只许调它们的 `download()`、只许读它们的 `phase` / `received` /
 *      `total`; 自己再写一套 http 客户端就是第二份文件表与第二份 sha256
 *   5. **进场的两处旧毛病**: ① 入场若跟着 `missing` 重启, 被打断的那一帧会停在半透明上, 五行一起灰着;
 *      ② 全绿时不占位, 启动页底部会塌下去一截, 上面那几行跟着跳
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

// 卡片里真正引用到的键 (含 CTA 那几句)
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
  '进页面时只做一次不联网的 refresh (读状态, 不下载)',
  [
    card.includes('WakeWordDownload.refresh(context)'),
    card.includes('SpeechModelDownload.refresh(context)'),
    !card.includes('WakeWordDownload.download(context)\n    }\n    val'),
  ],
  [true, true, true],
)

/* ── 五、两处旧毛病的修法 ─────────────────────────────────────────────── */

check(
  '① 进场交给 AnimatedVisibility (不跟着 missing 重启), 行被打断时补到不透明',
  [
    card.includes('AnimatedVisibility('),
    card.includes('enter.snapTo(1f)'),
    !/appear\.animateTo/u.test(card),
  ],
  [true, true, true],
)
check(
  '② 全绿之后按量到的高度占位 (启动页底部不跳), 从没露过面则一个像素不占',
  [
    card.includes('reserve = it.height'),
    card.includes('reserve.toDp()'),
    card.includes('if (visible || reserve == 0)'),
  ],
  [true, true, true],
)

/* ── 六、挂载: 设置页与启动页各一处, 且不再套一层 Card ─────────────────── */

check(
  '设置页只挂 ReadyCard 本身 (卡由它自己画, 全绿时整块不画)',
  [settings.includes('item { ReadyCard() }'), !settings.includes('Card { ReadyCard() }')],
  [true, true],
)
check('启动页底部也挂这一张', host.includes('ReadyCard('), true)

/* ── 七、动效刻度: 入场 280 / 行 90 / 环 600 / 收尾 900 ────────────────── */

check(
  '动效刻度没被顺手改掉',
  [
    card.includes('private const val AppearMillis = 280'),
    card.includes('private const val RowStaggerMillis = 90L'),
    card.includes('private const val RingMillis = 600'),
    card.includes('private const val LingerMillis = 900L'),
  ],
  [true, true, true, true],
)

console.log(failures === 0 ? `\n${checks} / ${checks} 条通过` : `\n${failures} / ${checks} 条判据不过`)
process.exit(failures === 0 ? 0 : 1)
