/**
 * 设置页最末那段「接口」与它那份文档 (2026-10-25 主人: "接口文档不能只放开屏的，还要有浮标的状态等，
 * 其它开放的接口，版块只留接口文档和复制文档地址，两个选项即可")
 *
 * 这一段是**给人/给 agent 看的说明书**, 它最容易出的错是"文档里写的路径与代码里那份不是同一处" ——
 * 那种漂开不会报错, 只会让 agent 照着一份过期的路径干活, 然后把文件写到没人读的地方。所以这里把
 * 文档里提到的每一个文件名都拿去源码里对一遍:
 *
 *   1. `assets/interfaces/README.md` 里点的每个文件名, 都要在那几个 Kotlin 文件里真的出现
 *   2. 落盘路径与 seeds 的那一处 ([LwInterfaces]) 要对得上, 且开屏时真的会 seed
 *   3. 那一段只有两行 (接口文档 / 复制文档地址), 不多不少
 *   4. 文档里覆盖了该覆盖的那几条接口 (开屏 / 浮标状态 / 浮标外观 / 语音状态 / 快捷指令 / 技能 /
 *      自动指令 / 探索卡 / API 朗读与音色库)
 *   5. API 朗读那五样 (地址 / 端点 / 密钥状态 / 模型 / 音色) 的占位符在文档里、也在注入那一处;
 *      **密钥明文不许进文档** (只报有没有设置), 改了设置会重写文档 (偏好监听),
 *      音色库那份文件与源码/设置页对得上
 *
 * 不需要设备, 也不需要 host。用法: node tools/check-interfaces-doc.mjs
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

const doc = await read('app/src/main/assets/interfaces/README.md')
const seeder = await read('app/src/main/java/io/github/yuloong07star/luwi/host/LwInterfaces.kt')
const api = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/ApiItems.kt')
const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const host = await read('app/src/main/java/io/github/yuloong07star/luwi/host/DshHostService.kt')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')

/* ── 一、文档里每条路径, 代码里都要有它 ───────────────────────────────── */

/** 文档提到的文件 → 那个文件在源码里的"主人" (谁读写它) */
const OWNERS = [
  ['splash.json', 'splash.json'],
  ['ball-phase.json', 'ball-phase.json'],
  ['voice-live.json', 'voice-live.json'],
  ['explore-card.md', 'explore-card.md'],
  ['.theme.json', '.theme.json'],
  ['interfaces.md', 'interfaces.md'],
  ['tts-voices.json', 'tts-voices.json'],
]

const sources = await Promise.all([
  read('app/src/main/java/io/github/yuloong07star/luwi/ui/SplashSetting.kt'),
  read('app/src/main/java/io/github/yuloong07star/luwi/overlay/BallPhaseFile.kt'),
  read('app/src/main/java/io/github/yuloong07star/luwi/voice/VoiceLive.kt'),
  read('app/src/main/java/io/github/yuloong07star/luwi/tool/ExploreTask.kt'),
  read('app/src/main/java/io/github/yuloong07star/luwi/plugin/theme/BallTheme.kt'),
  read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwApiVoices.kt'),
  seeder,
])
const all = sources.join('\n')
check(
  '文档里点到的每个文件名, 源码里都真的在用',
  OWNERS.filter(([name]) => !all.includes(name)).map(([name]) => name),
  [],
)
check(
  '文档里写着的那几条路径, 文本本身也在文档里',
  OWNERS.filter(([name]) => !doc.includes(name)).map(([name]) => name),
  [],
)

/* ── 二、落盘位置与 seed 对得上 ─────────────────────────────────────────── */

check(
  '落盘在 $DSH_HOME/lw/interfaces.md (与球/语音那几份小文件同一层)',
  [seeder.includes('private const val NAME = "interfaces.md"'), seeder.includes('DshHost.settingsDirectory(context)')],
  [true, true],
)
check(
  '文档只有一份来源: asset 里那份, 抄的时候把 $DSH_HOME 换掉',
  [seeder.includes('private const val ASSET = "interfaces/README.md"'), seeder.includes('replace("\\$DSH_HOME", home)')],
  [true, true],
)
check('进程一起来就 seed 一次 (agent 不用等谁打开设置页)', host.includes('LwInterfaces.seed(this)'), true)

/* ── 三、那一段只有两行 ─────────────────────────────────────────────────── */

check(
  '只要两行: 接口文档 + 复制文档地址',
  [api.includes('R.string.settings_api_doc)'), api.includes('R.string.settings_api_copy_path)'), (api.match(/ArrowPreference\(/g) ?? []).length],
  [true, true, 2],
)
check(
  '复制的是**地址**而不是全文 (剪贴板里放的是路径)',
  [api.includes('ClipData.newPlainText("Luwi interfaces", path)'), api.includes('LwInterfaces.docFile(context).absolutePath')],
  [true, true],
)

/* ── 四、该覆盖的几条都在 ───────────────────────────────────────────────── */

const topics = ['开屏', '浮标状态', '浮标外观', '语音状态', '快捷指令', '技能', '自动指令', '探索卡',
  'API 朗读', '音色库']
check('文档覆盖了这九条 (音色库那一条 2026-10-25 加)', topics.filter((topic) => !doc.includes(topic)), [])
check(
  '两份 strings 都有那几条 (节标题 / 文档 / 复制地址 / 已复制)',
  ['settings_section_api', 'settings_section_api_summary', 'settings_api_doc', 'settings_api_doc_title',
    'settings_api_doc_summary', 'settings_api_copy_path', 'settings_api_copy_path_summary',
    'settings_api_copied', 'settings_api_copy_failed']
    .filter((key) => !zh.includes(`name="${key}"`) || !en.includes(`name="${key}"`)),
  [],
)

/* ── 四之二、自动指令的目录: 文档与 AutomationStore 对得上 (2.8.0 #25) ───── */

const automations = await read('app/src/main/java/io/github/yuloong07star/luwi/automation/AutomationStore.kt')
const hostPlugin = await read('host-plugin/index.mjs')
const rulesDir = /const val RULES_DIRECTORY = "([^"]+)"/.exec(automations)?.[1] ?? ''
const rejectedDir = /const val REJECTED_DIRECTORY = "([^"]+)"/.exec(automations)?.[1] ?? ''
check(
  '自动指令文档写的新写目录与坏规则目录, 就是 AutomationStore 里那两份',
  [rulesDir, rejectedDir, doc.includes(`automations/${rulesDir}/`), doc.includes(`automations/${rejectedDir}/`)],
  ['rules', 'rejected', true, true],
)
check(
  '自动指令文档写清旧目录只读一版, 坏规则带 .error.txt 且设置页能删',
  [
    doc.includes('只读兼容这一版'),
    doc.includes('.error.txt'),
    doc.includes('点坏规则那一行就能删'),
    automations.includes('REJECTED_ERROR_SUFFIX'),
  ],
  [true, true, true, true],
)
check(
  'lw_automation 的说明也点到 rules/ 与 rejected/ (模型照这一段写)',
  [hostPlugin.includes('automations/rules'), hostPlugin.includes('automations/rejected')],
  [true, true],
)

/* ── 五、API 朗读那几样: 文档里有占位符, 注入那一处也要有 ────────────────── */

const PLACEHOLDERS = ['{{API_URL}}', '{{API_ENDPOINT}}', '{{API_KEY_STATE}}', '{{API_MODEL}}', '{{API_VOICE}}']
check(
  '文档里五个占位符都在 (地址 / 端点 / 密钥状态 / 模型 / 音色)',
  PLACEHOLDERS.filter((one) => !doc.includes(one)),
  [],
)
check(
  '密钥明文不进文档: 旧的 {{API_KEY}} 不许回来, 注入那一处也不许替换 api.key',
  [
    doc.includes('{{API_KEY}}'),
    seeder.includes('replace(API_KEY, api.key'),
    seeder.includes('值不写进文档'),
  ],
  [false, false, true],
)
check(
  '注入那一处认得这五个占位符, 也从偏好读实况',
  [
    PLACEHOLDERS.filter((one) => !seeder.includes(one)),
    seeder.includes('SpeakSettings.storedApi'),
    seeder.includes('LwApiSpeech.endpoint'),
  ],
  [[], true, true],
)
check(
  '改了 API 那四样会重写文档 (偏好监听 + 键前缀), 且监听留了强引用',
  [
    seeder.includes('registerOnSharedPreferenceChangeListener'),
    seeder.includes('SpeakSettings.API_KEY_PREFIX'),
    seeder.includes('private var watcher'),
  ],
  [true, true, true],
)

/* ── 六、音色库那份文件与设置页对得上 ───────────────────────────────────── */

const library = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwApiVoices.kt')
const speak = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwSpeak.kt')
const plugin = await read('host-plugin/index.mjs')
check(
  '音色库文件名只在两处写: 文档与 LwApiVoices',
  [
    ['tts-voices.json'].filter((name) => !doc.includes(name) || !library.includes(name)),
    library.includes('const val FILE = "tts-voices.json"'),
  ],
  [[], true],
)
check(
  '设置页真的在读音色库并列出那一段',
  [
    screen.includes('LwApiVoices.read(context)'),
    screen.includes('LwApiVoices.Watch'),
    screen.includes('R.string.settings_speak_api_voices'),
  ],
  [true, true, true],
)
check(
  '登记由应用代写: 桥上有 op=voice, 工具也暴露了它',
  [
    speak.includes('"voice" -> voice(context, request)'),
    speak.includes('LwApiVoices.add('),
    speak.includes('LwApiVoices.remove('),
    plugin.includes("args.op === 'voice'"),
    plugin.includes('if (args.action !== undefined) request.action = args.action'),
  ],
  [true, true, true, true, true],
)
check(
  '文档讲的登记通道是工具而不是手写文件 (会话的文件工具看不到 DSH_HOME)',
  [doc.includes('lw_speak op=voice action=add'), doc.includes('工作区'), doc.includes('action=remove')],
  [true, true, true],
)
check(
  '音色库那几个 strings 键两份都有',
  ['settings_speak_api_voices', 'settings_speak_api_voices_summary', 'settings_speak_api_voices_none',
    'settings_speak_api_voices_scanning', 'settings_speak_api_voices_broken', 'settings_speak_api_voice_model']
    .filter((key) => !zh.includes(`name="${key}"`) || !en.includes(`name="${key}"`)),
  [],
)

console.log(`\n${checks - failures} / ${checks} 通过`)
if (failures > 0) process.exit(1)
