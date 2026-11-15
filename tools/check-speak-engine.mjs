/**
 * 语音输出那两件 (2026-11-15, 2.8.1 #5): **默认关** 与 **第五引擎 DeepSeek 官方 TTS**
 *
 * 为什么单独立一条: 这两件事各自只有几行代码, 却都"错了不报" ——
 *   1. 缺省值写成 `true` 时没有异常、没有日志, 只是每一条回答都自己出声 (替主人做主)
 *   2. 官方那条接口要令牌, 而令牌只能在宿主那一侧; 应用与宿主各写一份端点/路由, 抄错一个字就是
 *      "登录着却没声音", 而两边都不会报错 —— 所以这里把两处的字面量**逐字**对一遍
 *
 * 量的七件事:
 *   1. `SpeakSettings.readAloud` 缺省 false (`speak-read-aloud` 没那个键就是关)
 *   2. `SpeakSettings` 有 `DEEPSEEK` 这一档与 `usesDeepseek()`, 音色只认 `stella` / `tide`
 *   3. 应用那一侧: 路由与端点取自 `LwDeepseekSpeech`, 请求由宿主转 (应用不碰令牌)
 *   4. 宿主那一侧: `/lw-tts` 只认回环两头、只收 POST, 令牌先问账号再退 API Key, 端点与请求体字段对得上
 *   5. 设置页那一行在, 两份 strings 的键都在
 *   6. `lw_speak` 的说明与 status 文案认这第五档
 *   7. 接口文档写了这条引擎 (登录即可用 / 两个音色 / 没有语速参数)
 *
 * 不需要设备, 也不需要 host。用法: node tools/check-speak-engine.mjs
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

const settings = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/SpeakSettings.kt')
const speech = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwDeepseekSpeech.kt')
const tts = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwDeepseekTts.kt')
const speak = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwSpeak.kt')
const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const host = await read('host-plugin/index.mjs')
const doc = await read('app/src/main/assets/interfaces/README.md')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')

/* ── 一、默认关: 没那个键就是关 ──────────────────────────────────────────── */

check(
  '自动念的缺省是关 (speak-read-aloud 没那个键就是 false)',
  [
    /private const val AUTO_KEY = "speak-read-aloud"/.test(settings),
    /readAloud = stored\.getBoolean\(AUTO_KEY, false\)/.test(settings),
  ],
  [true, true],
)
check(
  '那一档的内存缺省也是关 (第一帧先按它画)',
  /var readAloud: Boolean by mutableStateOf\(false\)/.test(settings),
  true,
)

/* ── 二、第五引擎在设置里 ─────────────────────────────────────────────────── */

check(
  '枚举里有 DEEPSEEK, 并给出 usesDeepseek()',
  [
    /enum class Engine \{ SYSTEM, ON_DEVICE, EDGE, API, DEEPSEEK \}/.test(settings),
    /fun usesDeepseek\(\): Boolean = engine == Engine\.DEEPSEEK/.test(settings),
  ],
  [true, true],
)
check(
  '音色只有官方那两个 (stella / tide), 认不出退回缺省',
  [
    /"stella" to "海星/.test(speech),
    /"tide" to "暗潮/.test(speech),
    /const val DEFAULT_VOICE = "stella"/.test(speech),
    /fun known\(voice: String\)/.test(speech),
  ],
  [true, true, true, true],
)
check(
  '音色存进偏好, 且存之前先过白名单',
  [
    /private const val DEEPSEEK_VOICE_KEY = "speak-deepseek-voice"/.test(settings),
    /fun setDeepseekVoice\(context: Context, value: String\)/.test(settings),
    /if \(LwDeepseekSpeech\.known\(wanted\)\) wanted else LwDeepseekSpeech\.DEFAULT_VOICE/.test(settings),
  ],
  [true, true, true],
)

/* ── 三、应用那一侧: 只发稿子, 不碰令牌 ──────────────────────────────────── */

check(
  '应用把稿子发到回环路由, 地址由 DshHost.PORT 拼出来',
  [
    /const val ROUTE_PATH = "\/lw-tts"/.test(speech),
    /"http:\/\/127\.0\.0\.1:\$\{DshHost\.PORT\}\$\{LwDeepseekSpeech\.ROUTE_PATH\}"/.test(tts),
    /LwDeepseekSpeech\.requestBody\(text, voice\)/.test(tts),
  ],
  [true, true, true],
)
check(
  '应用这一侧没有令牌的容身处 (偏好里只存音色, 请求头不由它带)',
  [
    /speak-deepseek-voice/.test(settings) && !/speak-deepseek-key|speak-deepseek-token/.test(settings),
    !/setRequestProperty\("Authorization"/.test(tts),
  ],
  [true, true],
)
check(
  '五条引擎的读数与点名都认 deepseek',
  [
    /SpeakSettings\.usesDeepseek\(\) -> "deepseek"/.test(speak),
    /"ds", "deepseek" -> SpeakSettings\.Engine\.DEEPSEEK/.test(speak),
    /put\("deepseekVoice", SpeakSettings\.deepseekVoice\)/.test(speak),
    /LwDeepseekTts\.speaking/.test(speak),
  ],
  [true, true, true, true],
)

/* ── 四、宿主那一侧: 令牌只在这里, 路由只认回环 ──────────────────────────── */

check(
  '端点两处逐字相同 (官方 /v1/tools/tts)',
  [
    /const val ENDPOINT = "https:\/\/api\.deepseek\.com\/v1\/tools\/tts"/.test(speech),
    /const LW_TTS_ENDPOINT = 'https:\/\/api\.deepseek\.com\/v1\/tools\/tts'/.test(host),
  ],
  [true, true],
)
check(
  '路由两处逐字相同 (/lw-tts)',
  [
    /const LW_TTS_ROUTE = '\/lw-tts'/.test(host),
    /path: LW_TTS_ROUTE/.test(host),
    /'lw-tts\.routes'/.test(host),
  ],
  [true, true, true],
)
check(
  '令牌先问账号, 没登录再退 API Key (登录即可用的那条链)',
  [
    /typeof account\.resolveToken === 'function'/.test(host),
    /await account\.resolveToken\(LW_TTS_ENDPOINT\)/.test(host),
    /credentials\.resolve\(LW_ACCOUNT_KEY_REF\)/.test(host),
  ],
  [true, true, true],
)
check(
  '路由只认回环两头, 只收 POST, 正文有上限',
  [
    /function serveLwTts\(ctx\)[\s\S]{0,600}req\.method !== 'POST'/.test(host),
    /function serveLwTts\(ctx\)[\s\S]{0,1600}lwLoopback\(req\.socket\?\.remoteAddress\)/.test(host),
    /const LW_TTS_BODY_MAX = 64 \* 1024/.test(host),
  ],
  [true, true, true],
)
check(
  '请求体是官方那四个字段 (text / voice_id / format / filter_markdown), 不带语速',
  [
    /body: JSON\.stringify\(\{ text, voice_id: voice, format: 'wav', filter_markdown: true \}\)/.test(host),
    !/speed:/.test(host.slice(host.indexOf('function serveLwTts('), host.indexOf('/** 图: `Content-Type`'))),
  ],
  [true, true],
)
check(
  '没登录时回一句人话, 且明说 signedIn=false',
  /reply\(401, \{\s*\n\s*ok: false,\s*\n\s*signedIn: false,/.test(host),
  true,
)
check(
  '上游错误把令牌抹掉再往外带',
  [
    /detail\.split\(token\)\.join\('\*\*\*'\)/.test(host),
    /'X-Lw-Token-Source': from/.test(host),
  ],
  [true, true],
)

/* ── 五、设置页与两份 strings ─────────────────────────────────────────────── */

check(
  '设置页有第五行, 并在选中时画出音色与登录那一行',
  [
    /R\.string\.settings_speak_engine_deepseek\)/.test(screen),
    /SpeakSettings\.Engine\.DEEPSEEK\) \}/.test(screen),
    /R\.string\.settings_speak_deepseek_account\)/.test(screen),
    /LwDeepseekSpeech\.VOICES\.forEach/.test(screen),
  ],
  [true, true, true, true],
)
const keys = ['settings_speak_engine_deepseek', 'settings_speak_engine_deepseek_summary',
  'settings_speak_engine_deepseek_using', 'settings_speak_deepseek_account',
  'settings_speak_deepseek_signed_in', 'settings_speak_deepseek_signed_out',
  'settings_speak_deepseek_login_unknown', 'settings_speak_deepseek_where',
  'settings_speak_deepseek_where_summary', 'settings_speak_deepseek_volume']
check(
  '那十个键两份 strings 都有',
  keys.filter((key) => !zh.includes(`name="${key}"`) || !en.includes(`name="${key}"`)),
  [],
)

/* ── 六、lw_speak 的说明与文案 ────────────────────────────────────────────── */

check(
  '工具说明与 status 文案认这第五档',
  [
    /The fifth '/.test(host) && /engine is the official DeepSeek voice/.test(host),
    /answer\.readingWith === 'deepseek'/.test(host),
    /with the official DeepSeek voice/.test(host),
  ],
  [true, true, true],
)

/* ── 七、接口文档 ─────────────────────────────────────────────────────────── */

check(
  '接口文档写了这条引擎 (登录即可用 / 两个音色 / 没有语速参数)',
  [
    doc.includes('DeepSeek 官方语音'),
    doc.includes('`stella`') && doc.includes('`tide`'),
    doc.includes('/lw-tts'),
    doc.includes('没有语速参数'),
  ],
  [true, true, true, true],
)

/* ── 八、路由的行为: 抽上线那份源码真跑一次 ──────────────────────────────── */

const sliceStart = host.indexOf('const LW_TTS_ROUTE')
const sliceEnd = host.indexOf('/** 图: `Content-Type`')
if (sliceStart < 0 || sliceEnd < 0) throw new Error('the DeepSeek TTS route is not in host-plugin/index.mjs')
const route = new Function(
  'ACCOUNT_SEAM', 'LW_ACCOUNT_KEY_REF', 'warn', 'lwLoopback',
  `${host.slice(sliceStart, sliceEnd)}; return { serveLwTts, LW_TTS_ENDPOINT, LW_TTS_ROUTE }`,
)(
  'deepseekAccount',
  'DEEPSEEK_API_KEY',
  () => {},
  (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(address ?? '')),
)

/** 一进一出的假 req/res: 只实现那两个函数真正用到的那几个成员 */
function exchange({ method = 'POST', body = '', remote = '127.0.0.1', local = '127.0.0.1' } = {}) {
  const res = {
    status: 0,
    headers: {},
    body: null,
    writeHead(code, headers) {
      this.status = code
      this.headers = headers ?? {}
      return this
    },
    end(payload) {
      this.body = payload
    },
  }
  const req = {
    method,
    socket: { remoteAddress: remote, localAddress: local },
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield Buffer.from(body)
    },
  }
  return { req, res }
}

const accountService = (token) => ({
  resolveToken: async (url) => (url === route.LW_TTS_ENDPOINT ? token : undefined),
})

/** 一次请求: 给定 ctx 与一段 JSON 正文, 回 res */
async function callRoute(ctx, options) {
  const { req, res } = exchange(options)
  await route.serveLwTts(ctx)(req, res)
  return res
}

// ① 没登录: 401 + signedIn=false (设置页那句提示与它同一件事)
const anon = await callRoute(
  { get: () => undefined },
  { body: JSON.stringify({ text: '你好' }) },
)
const anonBody = JSON.parse(anon.body)
check(
  '没登录时回 401 并说明 signedIn=false',
  [anon.status, anonBody.ok, anonBody.signedIn, anonBody.error.includes('not signed in')],
  [401, false, false, true],
)

// ② 登录了: 带账号令牌去打官方那一条, 音频原样回来
const seen = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  seen.push({ url, options })
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'audio/wav']]),
    arrayBuffer: async () => Uint8Array.from([82, 73, 70, 70]).buffer,
    text: async () => '',
  }
}
const signed = await callRoute(
  { get: (name) => (name === 'deepseekAccount' ? accountService('tok-123') : undefined) },
  { body: JSON.stringify({ text: '你好', voice_id: 'tide' }) },
)
check(
  '登录了就用账号令牌打官方那一条, 字段与正文都对',
  [
    signed.status,
    signed.headers['Content-Type'],
    [...Buffer.from(signed.body)].join(','),
    seen.length,
    seen[0]?.url,
    seen[0]?.options.headers.Authorization,
    JSON.parse(seen[0]?.options.body),
  ],
  [200, 'audio/wav', '82,73,70,70', 1, route.LW_TTS_ENDPOINT, 'Bearer tok-123',
    { text: '你好', voice_id: 'tide', format: 'wav', filter_markdown: true }],
)
check('回执带上令牌来源 (读数用)', signed.headers['X-Lw-Token-Source'], 'account')

// ③ 音色打错一个不认识的 id: 按缺省 stella 发, 不把那个串送给官方
await callRoute(
  { get: (name) => (name === 'deepseekAccount' ? accountService('tok-123') : undefined) },
  { body: JSON.stringify({ text: '喂', voice_id: 'nova' }) },
)
check('不认识的音色退回 stella', JSON.parse(seen[1]?.options.body).voice_id, 'stella')

// ④ 没登录但填过 API Key 的机器也能用 (令牌来源 key)
const keyed = await callRoute(
  {
    get: (name) => {
      if (name === 'deepseekAccount') return accountService(undefined)
      if (name === 'credentials') return { resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? 'key-9' : undefined) }
      return undefined
    },
  },
  { body: JSON.stringify({ text: '喂' }) },
)
check(
  '没登录时退到那把 API Key',
  [keyed.status, seen[2]?.options.headers.Authorization, keyed.headers['X-Lw-Token-Source']],
  [200, 'Bearer key-9', 'key'],
)

// ⑤ 上游报错, 而且它把令牌回显进错误里: 往外带的必须是抹过的
globalThis.fetch = async () => ({
  ok: false,
  status: 500,
  headers: new Map(),
  text: async () => 'boom: Authorization Bearer tok-123 rejected',
  arrayBuffer: async () => new ArrayBuffer(0),
})
const broken = await callRoute(
  { get: (name) => (name === 'deepseekAccount' ? accountService('tok-123') : undefined) },
  { body: JSON.stringify({ text: '喂' }) },
)
const brokenText = String(broken.body)
check(
  '上游报错时 502, 且把令牌抹掉',
  [broken.status, brokenText.includes('tok-123'), brokenText.includes('***'), brokenText.includes('500')],
  [502, false, true, true],
)
globalThis.fetch = realFetch

// ⑥ 三道门: 非 POST / 非回环 / 空稿 / 正文过大
const wrongMethod = await callRoute({ get: () => undefined }, { method: 'GET' })
const offLoop = await callRoute({ get: () => undefined }, { remote: '10.0.0.8' })
const emptyText = await callRoute({ get: () => undefined }, { body: JSON.stringify({ text: '   ' }) })
const tooLarge = await callRoute({ get: () => undefined }, { body: 'x'.repeat(64 * 1024 + 10) })
check(
  '只收 POST / 只认回环 / 空稿 400 / 正文过大 413',
  [wrongMethod.status, offLoop.status, emptyText.status, tooLarge.status],
  [405, 404, 400, 413],
)

console.log(`\n${checks - failures} / ${checks} 通过`)
if (failures > 0) process.exit(1)
