/**
 * 语音输入那一条 (2026-11-15, 2.8.1 #6): **第三档引擎 DeepSeek 官方语音输入**
 *
 * 为什么单独立一条: 这一条最容易"看起来接好了, 真机上永远出不了字" ——
 *   1. 应用与宿主各写一份端点 / 路由, 抄错一个字就是"登录着却没反应", 而两边都不会报错
 *   2. 官方那条是 `multipart/form-data` 的 `file` 字段, 手拼的那几个字节错了只会拿回一个 400
 *   3. 令牌只能在宿主那一侧; 应用要是自己带上一枚, 那就是多一处要守的明文
 *   4. 引导里选了官方那一档的机器**没有本地模型**, 判据要是还按"模型在不在"分岔, 这条路会一直报"还没下"
 *
 * 量的八件事:
 *   1. 端点与路由两处逐字相同, 且与官方文档那一串对得上
 *   2. 应用这一侧没有令牌的容身处 (请求头不由它带)
 *   3. 宿主 `/lw-asr`: 只收 POST、只认回环两头、正文 ≤ 8 MiB、必须以 RIFF/WAVE 开头
 *   4. 令牌先问账号, 没登录再退 API Key (与 TTS 那条同一个顺序)
 *   5. 宿主那一趟真的打官方接口: multipart 的 `file` 字段、端点是 `/v1/tools/asr`、回来的那句带出去
 *   6. 上游报错时把令牌抹掉再往外带
 *   7. 常驻链与页面那颗麦克风都按 `lw/voice-source.json` 分岔, 而"没下模型"不再是错误
 *   8. 设置页两行 + 两份 strings + privacy 的出站表 + 接口文档
 *   9. 一分钟以上的长语音怎么切片: 60 s 不再硬切, 切点找 300 ms 的能量低谷 (前后各 3 s), 相邻两片叠
 *      400 ms, 拼回去时把重叠处重复的那几个字剪掉 (2026-11-18, 2.8.1 #28)
 *
 * 不需要设备, 也不需要 host。用法: node tools/check-voice-asr.mjs
 */

import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

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

const asr = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwDeepseekAsr.kt')
const transcribe = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwDeepseekTranscribe.kt')
const speech = await read('app/src/main/java/io/github/yuloong07star/luwi/tool/LwSpeech.kt')
const wake = await read('app/src/main/java/io/github/yuloong07star/luwi/wake/WakeWordService.kt')
const settings = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const source = await read('app/src/main/java/io/github/yuloong07star/luwi/voice/VoiceSource.kt')
const screen = await read('app/src/main/java/io/github/yuloong07star/luwi/ui/SettingsScreen.kt')
const host = await read('host-plugin/index.mjs')
const doc = await read('app/src/main/assets/interfaces/README.md')
const privacy = await read('docs/privacy.md')
const zh = await read('app/src/main/res/values-zh/strings.xml')
const en = await read('app/src/main/res/values/strings.xml')

/* ── 一、端点与路由: 两处逐字相同 (抄错一个字就是永远出不了字) ────────────── */

const ENDPOINT = 'https://api.deepseek.com/v1/tools/asr'
check(
  '端点两处逐字相同 (官方 /v1/tools/asr)',
  [
    asr.includes(`const val ENDPOINT = "${ENDPOINT}"`),
    host.includes(`const LW_ASR_ENDPOINT = '${ENDPOINT}'`),
  ],
  [true, true],
)
check(
  '路由两处逐字相同 (/lw-asr)',
  [
    asr.includes('const val ROUTE_PATH = "/lw-asr"'),
    host.includes("const LW_ASR_ROUTE = '/lw-asr'"),
    host.includes('path: LW_ASR_ROUTE'),
    host.includes("'lw-asr.routes'"),
  ],
  [true, true, true, true],
)
check(
  '应用把 wav 发到回环路由, 地址由 DshHost.PORT 拼出来',
  [
    transcribe.includes('"http://127.0.0.1:${DshHost.PORT}${LwDeepseekAsr.ROUTE_PATH}"'),
    transcribe.includes('connection.setRequestProperty("Content-Type", "audio/wav")'),
    transcribe.includes('LwDeepseekAsr.wav(piece)'),
  ],
  [true, true, true],
)
check(
  '应用这一侧没有令牌的容身处 (令牌只在宿主, 请求头不由它带)',
  [
    !/setRequestProperty\("Authorization"/.test(transcribe),
    !/\bresolveToken\s*\(/.test(asr + transcribe),
  ],
  [true, true],
)

/* ── 二、宿主那道门: 方法 / 回环 / 上限 / 真是 wav ────────────────────────── */

const sliceStart = host.indexOf('const LW_ASR_ROUTE')
const sliceEnd = host.indexOf('/* ── DeepSeek 官方 TTS')
if (sliceStart < 0 || sliceEnd < 0 || sliceEnd < sliceStart) {
  throw new Error('the DeepSeek speech input route is not in host-plugin/index.mjs')
}
const routeSlice = host.slice(sliceStart, sliceEnd)
const route = new Function(
  'ACCOUNT_SEAM', 'LW_ACCOUNT_KEY_REF', 'warn', 'lwLoopback', 'randomUUID',
  `${routeSlice}; return { serveLwAsr, lwAsrToken, LW_ASR_ENDPOINT, LW_ASR_ROUTE, LW_ASR_BODY_MAX }`,
)(
  'deepseekAccount',
  'DEEPSEEK_API_KEY',
  () => {},
  (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(address ?? '')),
  randomUUID,
)
check(
  '那一段里写着只收 POST, 且两个头都要是回环',
  [
    /function serveLwAsr\(ctx\)[\s\S]{0,700}req\.method !== 'POST'/.test(host),
    /function serveLwAsr\(ctx\)[\s\S]{0,900}lwLoopback\(req\.socket\?\.remoteAddress\)/.test(host),
    /function serveLwAsr\(ctx\)[\s\S]{0,900}lwLoopback\(req\.socket\?\.localAddress\)/.test(host),
  ],
  [true, true, true],
)
check('正文上限就是官方那个 8 MiB', route.LW_ASR_BODY_MAX, 8 * 1024 * 1024)
check(
  '令牌先问账号, 没登录再退 API Key',
  [
    /typeof account\.resolveToken === 'function'/.test(routeSlice),
    /await account\.resolveToken\(LW_ASR_ENDPOINT\)/.test(routeSlice),
    /credentials\.resolve\(LW_ACCOUNT_KEY_REF\)/.test(routeSlice),
  ],
  [true, true, true],
)

/** 一进一出的假 req/res: 只实现那两个函数真正用到的那几个成员 */
function exchange({ method = 'POST', body = null, remote = '127.0.0.1', local = '127.0.0.1' } = {}) {
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
      if (body) yield Buffer.from(body)
    },
  }
  return { req, res }
}

/** 一段最小的合格 wav (44 字节头 + 40 字节静音) */
function wavBytes(samples = 20) {
  const data = Buffer.alloc(samples * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8, 'latin1')
  head.write('fmt ', 12, 'latin1')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(16000, 24)
  head.writeUInt32LE(32000, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36, 'latin1')
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

async function callRoute(ctx, options) {
  const { req, res } = exchange(options)
  await route.serveLwAsr(ctx)(req, res)
  return res
}

const anon = await callRoute({ get: () => undefined }, { body: wavBytes() })
const anonBody = JSON.parse(anon.body)
check(
  '没登录时回 401 并说明 signedIn=false',
  [anon.status, anonBody.ok, anonBody.signedIn, anonBody.error.includes('not signed in')],
  [401, false, false, true],
)

// ② 登录了: 带账号令牌打官方那一条, multipart 的 file 字段与边界都对
const seen = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  seen.push({ url, options })
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({ request_id: 'req-7', text: ' 上海今天天气怎么样？ ', duration_ms: 3200 }),
    text: async () => '',
  }
}
const accountService = (token) => ({
  resolveToken: async (url) => (url === route.LW_ASR_ENDPOINT ? token : undefined),
})
const recording = wavBytes(32)
const signed = await callRoute(
  { get: (name) => (name === 'deepseekAccount' ? accountService('tok-123') : undefined) },
  { body: recording },
)
const signedBody = JSON.parse(signed.body)
const sent = seen[0]
const boundary = /boundary=(.+)$/.exec(sent?.options.headers['Content-Type'] ?? '')?.[1] ?? ''
const sentBody = sent?.options.body ?? Buffer.alloc(0)
check(
  '登录了就用账号令牌打官方那一条 (账号令牌走 dsh 那个头)',
  [
    sent?.url,
    sent?.options.method,
    sent?.options.headers['x-dsh-auth-token'],
    // 账号那条**不许**再塞 Authorization: 平台令牌在那个头上一直是 401
    sent?.options.headers.Authorization,
    sent?.options.headers['Content-Type'].startsWith('multipart/form-data; boundary='),
    boundary.length > 0,
  ],
  [ENDPOINT, 'POST', 'tok-123', undefined, true, true],
)
check(
  '请求体是 multipart 的 file 字段 (名字 / 文件名 / 类型 / 首尾边界)',
  [
    sentBody.includes('Content-Disposition: form-data; name="file"; filename="speech.wav"'),
    sentBody.includes('Content-Type: audio/wav'),
    sentBody.subarray(0, 2).toString('latin1') === '--',
    sentBody.includes(`--${boundary}--`),
    // **那一段 wav 原样在里面**: 少了它官方只会说 400
    sentBody.includes(recording.subarray(0, 12).toString('latin1')),
    sentBody.length > recording.length,
  ],
  [true, true, true, true, true, true],
)
check(
  '回来的那一句带出去 (text 去掉两头空白, 时长与 requestId 一起)',
  [signed.status, signedBody.ok, signedBody.text, signedBody.durationMs, signedBody.requestId,
    signedBody.source],
  [200, true, '上海今天天气怎么样？', 3200, 'req-7', 'account'],
)

// ③ 没登录但填过 API Key 的机器也能用 (令牌来源 key)
const keyed = await callRoute(
  {
    get: (name) => {
      if (name === 'deepseekAccount') return accountService(undefined)
      if (name === 'credentials') return { resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? 'key-9' : undefined) }
      return undefined
    },
  },
  { body: wavBytes() },
)
check(
  '没登录时退到那把 API Key',
  [keyed.status, seen[1]?.options.headers.Authorization, JSON.parse(keyed.body).source],
  [200, 'Bearer key-9', 'key'],
)

// ④ 上游报错, 而且它把令牌回显进错误里: 往外带的必须是抹过的
globalThis.fetch = async () => ({
  ok: false,
  status: 500,
  headers: new Map(),
  text: async () => 'boom: Authorization Bearer tok-123 rejected',
  json: async () => ({}),
})
const broken = await callRoute(
  { get: (name) => (name === 'deepseekAccount' ? accountService('tok-123') : undefined) },
  { body: wavBytes() },
)
const brokenText = String(broken.body)
check(
  '上游报错时 502, 且把令牌抹掉',
  [broken.status, brokenText.includes('tok-123'), brokenText.includes('***'), brokenText.includes('500')],
  [502, false, true, true],
)

// ⑤ 官方说"这一段里没听见什么": 502 且句子是人话
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: new Map([['content-type', 'application/json']]),
  json: async () => ({ request_id: 'req-8', text: '   ', duration_ms: 10 }),
  text: async () => '',
})
const silent = await callRoute(
  { get: (name) => (name === 'deepseekAccount' ? accountService('tok-123') : undefined) },
  { body: wavBytes() },
)
check(
  '空转写回 502 并说"什么都没听见"',
  [silent.status, JSON.parse(silent.body).error.includes('heard nothing')],
  [502, true],
)
globalThis.fetch = realFetch

// ⑥ 五道门: 非 POST / 非回环 / 空正文 / 不是 wav / 正文过大
const wrongMethod = await callRoute({ get: () => undefined }, { method: 'GET' })
const offLoop = await callRoute({ get: () => undefined }, { remote: '10.0.0.8' })
const empty = await callRoute({ get: () => undefined }, { body: null })
const notWav = await callRoute({ get: () => undefined }, { body: 'hello there, not a wav' })
const tooLarge = await callRoute({ get: () => undefined }, { body: Buffer.alloc(8 * 1024 * 1024 + 16) })
check(
  '只收 POST / 只认回环 / 空正文 400 / 不是 wav 400 / 正文过大 413',
  [wrongMethod.status, offLoop.status, empty.status, notWav.status, tooLarge.status],
  [405, 404, 400, 400, 413],
)

/* ── 三、常驻链与页面那颗麦克风按同一份选择分岔 ──────────────────────────── */

check(
  '应用这一侧认得 deepseek 这一档 (常量 / 判据 / 就绪)',
  [
    /const val DEEPSEEK = "deepseek"/.test(speech),
    /if \(VoiceSource\.usesAccount\(context\)\) DEEPSEEK else ENGINE/.test(speech),
    /fun readyFor\(context: Context\): Boolean = engine\(context\) == DEEPSEEK \|\| ready\(context\)/.test(speech),
    /if \(engine == DEEPSEEK\)[\s\S]{0,400}LwDeepseekTranscribe\.answer\(context/.test(speech),
    /if \(engine\(context\) == DEEPSEEK\) return recognizeByAccount\(context, samples\)/.test(speech),
    /if \(engine\(context\) == DEEPSEEK\) return true/.test(speech),
  ],
  [true, true, true, true, true, true],
)
check(
  '那份选择的字面量与宿主读的是同一个 (source / deepseek)',
  [
    /const val DEEPSEEK = "deepseek"/.test(source),
    /const val KEY = "source"/.test(source),
    /body\?\.source === 'deepseek' \? 'deepseek' : 'local'/.test(host),
  ],
  [true, true, true],
)
check(
  '常驻链: 就绪按来源判, 云端那一档不预热',
  [
    /val ready = LwSpeech\.readyFor\(this\)/.test(wake),
    /LwSpeech\.engine\(this\) == LwSpeech\.DEEPSEEK/.test(wake),
    /if \(LwSpeech\.engine\(this\) == LwSpeech\.DEEPSEEK\) return/.test(wake),
  ],
  [true, true, true],
)
check(
  '宿主 provider: 选了账号那条就不再要那 240 MB',
  [
    /const engine = voiceSourceChoice\(\) === SPEECH_ENGINE_DEEPSEEK[\s\S]{0,120}SPEECH_ENGINE_DEEPSEEK[\s\S]{0,120}SPEECH_ENGINE_SHERPA/.test(host),
    /if \(engine === SPEECH_ENGINE_SHERPA && !info\.present\)/.test(host),
    /if \(engine === SPEECH_ENGINE_DEEPSEEK\) \{\s*\n\s*return await call\('speech'/.test(host),
  ],
  [true, true, true],
)
check(
  'lw_speech 的说明与 status 认这第三档',
  [
    /engine=deepseek is the official DeepSeek speech input/.test(host),
    /DeepSeek speech input: POST \$\{LW_ASR_ENDPOINT\}/.test(host),
    /engine=deepseek has nothing to download/.test(host),
    /the voice input button in the GUI and the ball use/.test(host),
  ],
  [true, true, true, true],
)

/* ── 四、设置页两行 + 两份 strings + 出站表 + 接口文档 ────────────────────── */

check(
  '设置页两行 (本地 / 官方), 点一下就是选它',
  [
    /R\.string\.settings_voice_source_local\)/.test(settings),
    /VoiceSource\.choose\(context, VoiceSource\.LOCAL\)/.test(settings),
    /R\.string\.settings_voice_source_deepseek\)/.test(settings),
    /VoiceSource\.choose\(context, VoiceSource\.DEEPSEEK\)/.test(settings),
    /var voiceSource by remember \{ mutableStateOf\(VoiceSource\.read\(context\)\) \}/.test(screen),
  ],
  [true, true, true, true, true],
)
const keys = ['settings_voice_source_local', 'settings_voice_source_local_using',
  'settings_voice_source_local_pick', 'settings_voice_source_deepseek',
  'settings_voice_source_deepseek_using', 'settings_voice_source_deepseek_pick']
check(
  '那六个键两份 strings 都有',
  keys.filter((key) => !zh.includes(`name="${key}"`) || !en.includes(`name="${key}"`)),
  [],
)
check(
  '出站表写了 api.deepseek.com 与"录音"',
  [
    privacy.includes('api.deepseek.com'),
    privacy.includes('那一整段录音'),
    privacy.includes('/v1/tools/asr'),
  ],
  [true, true, true],
)
check(
  '接口文档写了这条链 (端点 / 路由 / 上限 / 计费)',
  [
    doc.includes('/v1/tools/asr'),
    doc.includes('/lw-asr'),
    doc.includes('8 MiB'),
    doc.includes('120 s'),
    doc.includes('按音频时长计费'),
  ],
  [true, true, true, true, true],
)

/* ── 五、长语音的切片接缝: 低谷回溯切 + 400 ms 重叠拼接 (2026-11-18, 2.8.1 #28) ────────────
 *
 * 这一节把 `LwDeepseekAsr.pieces` 的算术在 JS 里重写一份 (常数从 Kotlin 源码里读), 然后拿一段 75 s
 * 的合成朗读跑真值表: 60 s 那一刀不再硬切, 而是往前/往后 3 s 里找一段 300 ms 的能量低谷, 相邻两片
 * 叠 400 ms, 拼回来时重叠处重复的字剪掉。Kotlin 那一份的对应判据在 LwDeepseekAsrTest 里。
 */

const constant = (name) => {
  const found = new RegExp(`const val ${name} = ([0-9_]+)`).exec(asr)
  if (!found) throw new Error(`LwDeepseekAsr.kt 里没有 ${name}`)
  return Number(found[1].replaceAll('_', ''))
}

const SR = constant('SAMPLE_RATE')
const CHUNK_SECONDS = constant('CHUNK_SECONDS')
const PIECE_OVERLAP_MS = constant('PIECE_OVERLAP_MS')
const CUT_SEARCH_MS = constant('CUT_SEARCH_MS')
const CUT_WINDOW_MS = constant('CUT_WINDOW_MS')
const CUT_STEP_MS = constant('CUT_STEP_MS')
const SEAM_CHARS = constant('SEAM_CHARS')

check(
  '接缝那几个刻度: 400 ms 重叠 / 3 s 搜索 / 300 ms 低谷窗 / 10 ms 步长',
  [SR, CHUNK_SECONDS, PIECE_OVERLAP_MS, CUT_SEARCH_MS, CUT_WINDOW_MS, CUT_STEP_MS],
  [16000, 60, 400, 3000, 300, 10],
)

const chunkSamples = (sr) => sr * CHUNK_SECONDS
const overlapSamples = (sr) => Math.floor((sr * PIECE_OVERLAP_MS) / 1000)
const searchSamples = (sr) => (sr * CUT_SEARCH_MS) / 1000
const windowSamples = (sr) => (sr * CUT_WINDOW_MS) / 1000
const stepSamples = (sr) => Math.max(1, (sr * CUT_STEP_MS) / 1000)

check(
  '重叠按采样率折成采样数 (16 kHz 下 6400)',
  [overlapSamples(SR), (overlapSamples(SR) / SR) * 1000],
  [6400, 400],
)

/** LwDeepseekAsr.quietCut 的镜像: 均方最低那个窗口的中线, 平手取最早 */
function quietCut(samples, low, high, window, step) {
  if (high <= low) return low
  const span = Math.max(1, Math.min(window, high - low + 1))
  const stride = Math.max(1, step)
  let bestAt = low
  let best = Number.POSITIVE_INFINITY
  for (let at = low; at <= high - span + 1; at += stride) {
    let sum = 0
    for (let index = at; index < at + span; index += 1) sum += samples[index] * samples[index]
    if (sum < best) {
      best = sum
      bestAt = at
    }
  }
  return bestAt + Math.floor(span / 2)
}

/** LwDeepseekAsr.pieces 的镜像: 名义 60 s 前后找低谷, 下一片从切点往前 400 ms 起 */
function piecesOf(samples, sr) {
  const limit = chunkSamples(sr)
  if (!samples.length) return []
  if (samples.length <= limit) return [samples]
  const overlap = overlapSamples(sr)
  const out = []
  let from = 0
  while (from + limit < samples.length) {
    const nominal = from + limit
    const low = Math.max(from + 1, nominal - searchSamples(sr))
    const high = Math.min(samples.length - 1, nominal + searchSamples(sr))
    const cut = Math.min(high, Math.max(low, quietCut(samples, low, high, windowSamples(sr), stepSamples(sr))))
    out.push(samples.subarray(from, cut))
    from = Math.max(cut - overlap, from + 1)
  }
  out.push(samples.subarray(from))
  return out
}

/** LwDeepseekAsr.stitch 的镜像: 上一片结尾就是下一片开头那几个字时剪掉, 否则只留一个空格 */
function stitch(previous, next) {
  if (!previous) return next
  if (!next) return previous
  const tail = previous.replace(/\s+$/, '')
  const head = next.replace(/^\s+/, '')
  const room = Math.min(SEAM_CHARS, tail.length, head.length)
  for (let length = room; length >= 2; length -= 1) {
    if (tail.endsWith(head.slice(0, length))) {
      return tail + next.slice(next.length - head.length + length)
    }
  }
  return `${previous} ${next}`
}

/** 75 s 合成朗读: 59 s 一条 V 形低谷, 60 s 一包「设置」的能量 (0.9), 别处是普通语音 */
function synth(seconds = 75, sr = SR) {
  const total = seconds * sr
  const out = new Float32Array(total)
  for (let index = 0; index < total; index += 1) {
    const at = index / sr
    let amplitude = 0.35
    const away = Math.abs(at - 59.0)
    if (away < 0.5) amplitude = 0.02 + 0.6 * away
    if (at >= 60.0 && at < 60.2) amplitude = 0.9
    out[index] = amplitude * Math.sin(2 * Math.PI * 180 * at)
  }
  return out
}

const SECONDS = 75
const TOTAL = SECONDS * SR
const SENTENCE = '先打开设置，再点 WLAN，然后把代理改成手动，最后保存'
const CHAR_SAMPLES = 3200
const samples = synth(SECONDS, SR)
const pieces = piecesOf(samples, SR)
const overlap = overlapSamples(SR)
const cut = pieces[0].length

check('75 s 的朗读切成 2 片', pieces.length, 2)
check('第二片从切点往前 400 ms 起 (两片重叠 6400 采样)', pieces[0].length - (TOTAL - pieces[1].length), 6400)
check(
  '切点落在 59 s 那条低谷里, 不在 60 s 那包能量上',
  [Math.abs(cut / SR - 59.0) <= 0.05, Math.abs(cut - 60 * SR) >= SR / 2],
  [true, true],
)

/** 一个窗口的均方 (与切点判据同一个量) */
function meanSquare(from, window, data = samples) {
  let sum = 0
  for (let index = from; index < from + window; index += 1) sum += data[index] * data[index]
  return sum / window
}
check(
  '切点处的能量比 60 s 那包低一个量级以上',
  meanSquare(cut - windowSamples(SR) / 2, windowSamples(SR)) * 10 < meanSquare(60 * SR, windowSamples(SR)),
  true,
)
check(
  '两片都在官方那两条上限之内 (120 s / 8 MiB)',
  pieces.every((piece) => piece.length / SR <= 120 && 44 + piece.length * 2 <= 8 * 1024 * 1024),
  true,
)

/** 这一段里被"听见"的字: 与 [from, to) 有交集的字都算 (重叠处两边各听见一次) */
function spoken(truth, from, to) {
  const per = TOTAL / truth.length
  let said = ''
  for (let index = 0; index < truth.length; index += 1) {
    if ((index + 1) * per > from && index * per < to) said += truth[index]
  }
  return said
}

const truth = SENTENCE.repeat(Math.ceil(TOTAL / CHAR_SAMPLES / SENTENCE.length) + 1).slice(0, TOTAL / CHAR_SAMPLES)
const first = spoken(truth, 0, cut)
const second = spoken(truth, cut - overlap, TOTAL)
const joined = stitch(first, second)

check('真值表: 每个字 0.2 s, 75 s 一共 375 个字', truth.length, 375)
check('重叠区正好跨两个字 (不去重就会多 2 字)', first.length + second.length - truth.length, 2)
check(
  '拼接后与原句逐字一致 (差异 0 字, 也不含重复字)',
  [joined === truth, joined.length, truth.length],
  [true, 375, 375],
)

check(
  'Kotlin 那一侧真的是低谷回溯切 (叠 400 ms / 窗口 / 中线 / 不原地打转)',
  [
    /fun pieces\(samples: FloatArray, sampleRate: Int = SAMPLE_RATE\): List<FloatArray> \{[\s\S]{0,1400}quietCut\(/.test(asr),
    /fun quietCut\(samples: FloatArray, low: Int, high: Int, window: Int, step: Int\): Int \{/.test(asr),
    /fun overlapSamples\(sampleRate: Int = SAMPLE_RATE\): Int/.test(asr),
    /from = maxOf\(cut - overlap, from \+ 1\)/.test(asr),
  ],
  [true, true, true, true],
)
check(
  'text() 走去重叠拼接, 并打一行 pieces=N overlap=Nms (tag LwAsr)',
  [
    /LwDeepseekAsr\.stitch\(said, answer\.text\)/.test(transcribe),
    /private const val TAG_PIECES = "LwAsr"/.test(transcribe),
    /Log\.i\(TAG_PIECES, "pieces=\$\{pieces\.size\} overlap=\$\{overlapMs\}ms"\)/.test(transcribe),
  ],
  [true, true, true],
)

console.log(`\n${checks - failures} / ${checks} 通过`)
if (failures > 0) process.exit(1)
