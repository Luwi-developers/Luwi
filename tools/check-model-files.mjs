/**
 * 两个模型 (唤醒词 KWS + 语音 SenseVoice/VAD) 的**文件表与下载入口不许漂开**
 *
 * 2026-10-28 起 app 侧也有一份语音模型下载器 (`SpeechModelDownload`), 宿主侧那一份
 * (`host-plugin/index.mjs` 的 `SPEECH_FILES` / `SPEECH_VAD`) 照旧是 dsh 页面点语音按钮时用的 ——
 * 两边下的是同一批文件, 落的是同一批目录。只要有一边改了文件名 / 字节数 / sha256 / 镜像地址,
 * 另一边的"检查在不在"就会说"模型坏了", 而真到那一刻才发现太晚
 *
 * 这里还把"首启只弹一次"那几处接好了没有一起钉住: 判据不是"有个弹窗", 而是
 * 缺什么 → 弹一次 → 写过记号 → AppNav 真挂上 → 设置页还有补下的路
 *
 * 跑法: node tools/check-model-files.mjs   (不需要设备, 也不需要 host)
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

const host = await read('host-plugin/index.mjs')
const speech = await read('app/src/main/java/io/github/yuloong07star/luwi/voice/SpeechModelDownload.kt')
const wake = await read('app/src/main/java/io/github/yuloong07star/luwi/wake/WakeWordDownload.kt')
const setup = await read('app/src/main/java/io/github/yuloong07star/luwi/voice/ModelSetup.kt')
// 那个「还差两个模型」的说明窗 2026-11-07 撤了 (主人: 这个弹窗可以去掉了); 文件没了, 这里按空串读,
// 于是下面那几条弹窗相关的断言一律走反向 —— 谁把它挂回来, 那一条就红
const dialog = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/ModelSetupDialog.kt').catch(() => '')
const nav = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/AppNav.kt')
const settings = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const lwSpeech = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwSpeech.kt')
const segmenter = await read('app/src/main/java/io/github/yuloong07star/luwi/voice/SpeechSegmenter.kt')
const lwWake = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwWakeWord.kt')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')

/** 从一段源码里切出 `from` 到 `to` 之间 */
function between(source, from, to) {
  const start = source.indexOf(from)
  if (start < 0) throw new Error(`找不到 ${JSON.stringify(from)}`)
  const end = source.indexOf(to, start + from.length)
  if (end < 0) throw new Error(`找不到分界 ${JSON.stringify(to)}`)
  return source.slice(start, end + to.length)
}

/** Kotlin 里一处 `const val NAME = "value"` */
function kotlinConst(source, name) {
  const match = new RegExp(`const val\\s+${name}\\s*=\\s*"([^"]+)"`).exec(source)
  if (match === null) throw new Error(`源码里找不到 ${name}`)
  return match[1]
}

/** host 那一份 `{ name, bytes, sha256 }` 表 */
function hostItems(block) {
  return [...block.matchAll(/name:\s*'([^']+)',\s*bytes:\s*(\d+),\s*sha256:\s*'([0-9a-f]{64})'/g)]
    .map((one) => ({ name: one[1], bytes: Number(one[2]), sha256: one[3] }))
}

/** app 那一份 `Item("name", 123L, "sha")`, 名字也允许写成 `LwSpeech.MODEL_FILE` */
function kotlinItems(block, resolve) {
  return [...block.matchAll(/Item\(\s*(?:"([^"]+)"|LwSpeech\.(MODEL_FILE|TOKENS_FILE))\s*,\s*([\d_]+)L\s*,\s*"([0-9a-f]{64})"\s*,?\s*\)/g)]
    .map((one) => ({
      name: one[1] ?? resolve[one[2]],
      bytes: Number(one[3].replaceAll('_', '')),
      sha256: one[4],
    }))
}

const modelFile = kotlinConst(lwSpeech, 'MODEL_FILE')
const tokensFile = kotlinConst(lwSpeech, 'TOKENS_FILE')
const vadFile = kotlinConst(segmenter, 'MODEL_FILE')

const hostSpeech = hostItems(between(host, 'const SPEECH_FILES = [', '\n]'))
const hostVad = hostItems(between(host, 'const SPEECH_VAD = {', '\n}'))
const hostWake = hostItems(between(host, 'const WAKEWORD_FILES = [', '\n]'))

const appSpeech = kotlinItems(
  between(speech, 'val files: List<Item> = listOf(', '\n    )'),
  { MODEL_FILE: modelFile, TOKENS_FILE: tokensFile },
)
const appVad = kotlinItems(between(speech, 'val vad: Item = Item(', '\n    )'), {
  MODEL_FILE: modelFile,
  TOKENS_FILE: tokensFile,
})
const appWake = kotlinItems(between(wake, 'val files: List<Item> = listOf(', '\n    )'), {
  MODEL_FILE: modelFile,
  TOKENS_FILE: tokensFile,
})

check('三个文件名两侧一致 (识别 / 符号表 / 切段)', [modelFile, tokensFile, vadFile], [
  'model.int8.onnx',
  'tokens.txt',
  'silero_vad.onnx',
])
check('语音识别模型表与宿主逐项一致', appSpeech, hostSpeech)
check('切段模型那一行与宿主一致', appVad, hostVad)
check('唤醒词模型表与宿主逐项一致', appWake, hostWake)

/** 源地址: app 的常量必须真的在宿主那份表里出现过 */
const appSpeechRepo = kotlinConst(speech, 'SPEECH_REPO')
const appSpeechBackup = kotlinConst(speech, 'SPEECH_REPO_BACKUP')
const appVadRepo = kotlinConst(speech, 'VAD_REPO')
const appVadBackup = kotlinConst(speech, 'VAD_REPO_BACKUP')
check('语音模型的镜像与宿主同一串', [
  host.includes(appSpeechRepo),
  host.includes(appSpeechBackup),
  host.includes(appVadRepo),
  host.includes(appVadBackup),
  appSpeechRepo.startsWith('https://hf-mirror.com/'),
  appSpeechBackup.startsWith('https://huggingface.co/'),
], [true, true, true, true, true, true])

const wakeRelease = kotlinConst(wake, 'RELEASE')
const hostWakeRelease = /const WAKEWORD_RELEASE =\s*\n\s*'([^']+)'/.exec(host)?.[1]
check('唤醒词模型的自有 Release 与镜像两侧一致', [
  wakeRelease === hostWakeRelease,
  wake.includes('https://ghfast.top/$RELEASE'),
  host.includes('https://ghfast.top/${WAKEWORD_RELEASE}'),
], [true, true, true])

/* ── 首启引导那一条链 ─────────────────────────────────────────────────── */

check('检测: 两个模型各看各的, 缺一个都算', [
  /fun missing\(context: Context\): List<Need>/.test(setup),
  /if \(!WakeWordDownload\.present\(context\)\) add\(Need\.WAKE\)/.test(setup),
  /if \(!SpeechModelDownload\.present\(context\)\) add\(Need\.SPEECH\)/.test(setup),
], [true, true, true])
check('每次冷启动提醒一次, 最多 3 次; 到数之后不再检测', [
  /private const val COUNT = "model-prompt-count"/.test(setup),
  /const val MAX_PROMPTS = 3/.test(setup),
  /if \(promptedThisRun\) return null/.test(setup),
  /if \(times >= MAX_PROMPTS\) return null/.test(setup),
  setup.indexOf('if (times >= MAX_PROMPTS) return null') < setup.indexOf('val needs = missing(context)'),
  /promptedThisRun = true/.test(setup),
], [true, true, true, true, true, true])
check('提醒次数在弹出来那一刻就加; 旧布尔记号迁移成 1 次', [
  /putInt\(COUNT, next\)/.test(setup),
  /LEGACY_SEEN/.test(setup),
  /putInt\(COUNT, 1\)/.test(setup),
  !/ModelSetupPrompt\(\)/u.test(nav),
], [true, true, true, true])
check('下载编排: 缺唤醒词先下唤醒词 (下完补词表 / 按许可起听), 再下语音', [
  /WakeWordDownload\.download\(context\)/.test(setup),
  /LwWakeWord\.afterModelDownload\(context\)/.test(setup),
  /SpeechModelDownload\.download\(context\)/.test(setup),
  /fun afterModelDownload\(context: Context\): String/.test(lwWake),
  /WakeWordWords\.defaultText\(\)/.test(lwWake),
], [true, true, true, true, true])
check('入口只剩两处: 体检表那两行 (带下载) 与设置页补下那一行', [
  // 首启那个说明窗撤了 (2026-11-07 主人: 这个弹窗可以去掉了), 所以 AppNav 里不许再有它
  !/ModelSetupPrompt\(\)/u.test(nav),
  /SpeechModelDownload\.refresh\(context\)/u.test(settings),
  /R\.string\.settings_wake_speech\b/.test(settings),
  // 它的 16 条文案也一起删了: 两份 strings 里一个都不许剩
  !zh.includes('model_setup_') && !en.includes('model_setup_'),
], [true, true, true, true])

console.log(`\n${checks - failures} / ${checks} 通过`)
if (failures > 0) process.exit(1)
