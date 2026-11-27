/**
 * 「她还在出声吗」这条判据的判据 (2026-10-16)
 *
 * 为什么值得单独一步: 这条链上的错法**都不会报错**, 只会偶尔表现得不对 ——
 *
 *   1. 判据又回到 `AudioManager.isMusicActive()`: 那是全系统 STREAM_MUSIC 的活跃度, 不看是谁在放,
 *      于是别的应用一放音乐/视频, 球上就写「正在说」(主人 2026-10-16 报的那条), 而"窗口有多长"还与
 *      这一句真实播了多久无关
 *   2. 五处消费各读各的符号: 球上写着「正在说」而点一下不掐播报 (显示与动作两套判据), 或者半双工
 *      那道闸不认新判据 —— 她自己的回答被录回去
 *   3. 系统那条引擎拿不到"我们那一份声音"的属性: 判据会退化成"只按预算" (可以接受, 但必须**知道**
 *      —— 真机上用 `speak op=probe` 量, 见 [probe])
 *
 * 不需要设备: 全是拿真源码对着核 (与 `check-image-edit.mjs` 同一个办法)。
 *
 * 用法: node tools/check-speech-tail.mjs
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const src = (name) => `app/src/main/java/io/github/yuloong07star/luwi/${name}`
const speak = await read(src('tool/LwSpeak.kt'))
const tail = await read(src('tool/SpeechTail.kt'))
const system = await read(src('tool/SystemSpeech.kt'))
const wake = await read(src('wake/WakeWordService.kt'))
const overlay = await read(src('overlay/OverlayService.kt'))
const host = await read(src('ui/HostScreen.kt'))
const settings = await read(src('ui/SettingsScreen.kt'))
const apiTts = await read(src('tool/LwApiTts.kt'))
const deepseekTts = await read(src('tool/LwDeepseekTts.kt'))

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

/** 取一个 Kotlin 函数的函数体 (从签名那一行到下一个顶层 `}`), 用来断言"里面没有某样东西" */
function bodyOf(source, signature) {
  const start = source.indexOf(signature)
  if (start < 0) return ''
  const end = source.indexOf('\n    }', start)
  return end < 0 ? source.slice(start) : source.slice(start, end)
}

const talking = bodyOf(speak, 'internal fun talking(context: Context)')
check('talking 那一段能取到', talking.length > 0 && talking.includes('SpeechTail.holding'), true)
check(
  'talking 里**不再**看系统媒体流 (这条 bug 的根)',
  [talking.includes('isMusicActive'), talking.includes('SystemSpeech.playing'), talking.includes('utterancePending')],
  [false, true, true],
)
check(
  '读数的探针还在 (真机上量"我们那份属性吃不吃的"就靠它)',
  [speak.includes('"probe" -> probe(context)'), speak.includes('put("musicActive"')],
  [true, true],
)
check(
  '给系统引擎那份属性是 助手场景 + 语音内容 两半',
  [system.includes('AudioAttributes.USAGE_ASSISTANT'), system.includes('AudioAttributes.CONTENT_TYPE_SPEECH')],
  [true, true],
)
check(
  '引擎真的收到了那份属性 (setAudioAttributes 紧挨着 engine = instance)',
  /setAudioAttributes\(SystemSpeech\.attributes\(\)\)[\s\S]{0,400}engine = instance/.test(speak),
  true,
)
check(
  '预算那条只是上限: 算术在 SpeechTail 里 (能单测)',
  [
    tail.includes('fun budgetMs(text: String): Long'),
    tail.includes('TAIL_MAX_MS = 25_000L'),
    speak.includes('SpeechTail.budgetMs(text)'),
  ],
  [true, true, true],
)

/* ── 垫话 (2.8.1 #14): 等首包时先出一声, 而它**不进** tail 预算 ───────────── */

check(
  '垫话不计入 tail 预算: 预算只按正文的字数算, 首包那一声一个字符都不加',
  [
    // 预算的算式只认 `text.length` 与那 4 s 余量 —— 垫话那一声塞进来, 等于正文说完之后还要白关一段麦克风
    /fun budgetMs\(text: String\): Long =\s*\(text\.length \* TAIL_MS_PER_CHAR \+ TAIL_MARGIN_MS\)\.coerceAtMost\(TAIL_MAX_MS\)/
      .test(tail),
    // 垫话那一套刻度只在 SpeechTail 里 (阈值 / 响哪一段 / 该不该响), 两条引擎不各写一份
    [tail.includes('const val FILLER_AFTER_MS'), tail.includes('const val FILLER_CLIP'), tail.includes('fun fillerDue(')],
    // 要等一趟网络的那两条: 起播先排一声垫话, 首片一到**先掐它再放真正的** (两段声音不叠), 失败也撤
    apiTts.includes('LwSpeak.fillerFor(context)') &&
      /fillerFor\(context\)[\s\S]{0,600}\.ready\(\)[\s\S]{0,400}LwVoiceClip\.play/.test(apiTts) &&
      apiTts.includes('filler?.cancel()'),
    deepseekTts.includes('LwSpeak.fillerFor(context)') &&
      /fillerFor\(context\)[\s\S]{0,600}\.ready\(\)[\s\S]{0,400}LwVoiceClip\.play/.test(deepseekTts) &&
      deepseekTts.includes('filler?.cancel()'),
    // 换音色 / 再念一句: 上一趟还在响的那一份先掐掉, 否则两条播放器各放各的就是叠音
    speak.includes('cutPrevious()') &&
      speak.includes('LwDeepseekTts.stop() ?: LwEdgeTts.stop() ?: LwApiTts.stop()'),
    // 一声垫话只属于一趟: 号码变了 (换了一句 / 被掐断) 就不许响
    speak.includes('fillerPending?.cancel(false)'),
  ],
  [true, [true, true, true], true, true, true, true],
)

/* ── 五处消费: 一个都不能各读各的符号 ─────────────────────────────────── */

check(
  '半双工那道闸: 我们的喇叭 + 那一声「嘀」',
  wake.includes('HalfDuplex.forward(LwSpeak.talking(this) || VoiceState.speaking)'),
  true,
)
check(
  '说时关麦 / 说完拉起: 同一个 talking',
  [
    wake.includes('private fun ttsPlaying(): Boolean = LwSpeak.talking(this)'),
    // 看门狗那条兜底也认它 (`!ttsPlaying()`)
    wake.includes('!ttsPlaying()'),
  ],
  [true, true],
)
check(
  '球上那三个字: 同一个 talking',
  overlay.includes('val speaking = LwSpeak.talking(this)'),
  true,
)
check(
  '点球那一下的动作: 与显示同一个判据 (原来读 speakingNow, 于是显示与动作会不一致)',
  overlay.includes('speaking = LwSpeak.talking(this) || VoiceState.speaking'),
  true,
)
check(
  '通知栏那两句 (唤醒词那条 + 浮窗那条) 都走同一条',
  [
    wake.includes('if (LwSpeak.talking(this)) return "$names · 正在说话, 先不听"'),
    overlay.includes('notice(word)'),
  ],
  [true, true],
)
check(
  '闲置账挂起那条也认它',
  /VoiceIdle\.held\([\s\S]{0,700}speaking = LwSpeak\.talking\(this\)/.test(wake),
  true,
)
check(
  '⋮ 菜单「停止朗读」那条 2026-10-24 已撤, 停止朗读在设置页那行 (同一个 LwSpeak.stop)',
  [
    // 撤掉是有意的 (主人: "设置浮标的停止说话去掉"), 注释留在原处 —— 有人凭空加回来时这一条会红
    host.includes('「停止朗读」那一条 2026-10-24 撤掉了'),
    settings.includes('R.string.settings_speak_stop'),
    settings.includes('LwSpeak.stop()'),
  ],
  [true, true, true],
)

/* ── 读数里那三样必须报出来 (不然真机上判不出"退化了没有") ────────────── */

check(
  'status 报 tailUntil / lastWasSystem / systemMatches',
  [
    speak.includes('put("tailUntil"'),
    speak.includes('put("lastWasSystem"'),
    speak.includes('put("systemMatches"'),
  ],
  [true, true, true],
)
check(
  'status 的 speaking 与 speakingNow 是同一个答案 (原来漏了自带那条引擎)',
  speak.includes('put("speaking", speakingNow)'),
  true,
)

console.log(failures === 0 ? `\n${checks} / ${checks} 条通过` : `\n${failures} / ${checks} 条判据不过`)
process.exit(failures === 0 ? 0 : 1)
