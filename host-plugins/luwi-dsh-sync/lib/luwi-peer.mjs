// lib/luwi-peer.mjs — Luwi 新增文件 (上游 v0.2.24 没有这一份)
//
// G1-2「跨设备对端」的两段配置面与一组纯函数: peer 段 (通道开关/令牌/地址/超时/轮询) 与
// live 段 (投影窗口)。与 lib/luwi-workspace.mjs 同一个形制 —— **只住 JSON 层**
// ($DSH_HOME/lw/session-sync.json), 不进 Schemastery schema: 装载器按 schema 校验之后会丢掉
// 没声明的键, 所以这两段写进 profile 覆盖行是无效的, 这一条在 lib/luwi-workspace.mjs 的文件头
// 已经记过一次
//
// 三件事在这一份里定死:
//   · 令牌纪律: 空令牌 = 通道关 (失败关闭), 界面/日志/工具结果只许出现 maskSecret() 的产物
//   · 地址纪律: peer.url 必须长得像 http(s), 否则就是一行永远打不通的死配置, 加载期响亮拒
//   · 同名备注: annotateWorkspaceNames() 是「工作区同名则写 名字（设备名）」的唯一实现
//
// 与 docs/DSH-LW-3.0.0-G1-施工单.md 第 14 节的对应: 通道是"一个可达的 base URL + 一个共享
// 令牌", 用什么把两端连起来 (局域网 / adb 转发 / Tailscale / Cloudflare Mesh) 是部署的事,
// 这份代码一行都不用改

import { LIVE_DEFAULTS, LIVE_LIMITS, PEER_DEFAULTS, PEER_LIMITS } from './constants.mjs'
import { badConfig } from './errors.mjs'
import { sanitizeRemote } from './sanitize.mjs'

/** 全角括号: 界面文案里那一对, 与施工单里写的「名字（设备名）」逐字一致 */
const FULLWIDTH_OPEN = '\uff08'
const FULLWIDTH_CLOSE = '\uff09'

/** http(s) 地址的粗判 (只认这一种: 通道要直连一个 HTTP 服务, 别的形态一律拒) */
const HTTP_URL_RE = /^https?:\/\/[^\s]+$/iu

/** 设备名/工作区名里不许出现在目录名上的字符 (Windows 与安卓都要能建) */
const UNSAFE_NAME_RE = /[\u0000-\u001f/\\:*?"<>|]/gu

/**
 * 解析 peer 段。缺省或显式关掉时返回 null (整块不存在: 没有路由、没有队列、没有对端工具)。
 *
 * 校验全部在加载期响亮失败 (BAD_CONFIG): 令牌太短、地址不像话、超时/轮询越界 —— 这些
 * 都到不了运行时。**令牌空 = 通道关**, 不是"匿名放开": 一个能被对端调用的路由必须是
 * 带令牌的, 没令牌就没有这条通道
 * @param {unknown} [config] `$DSH_HOME/lw/session-sync.json` 的 peer 段。
 * @param {{controller?: boolean}} [role] 这一台是"手机/控制器"还是被管的那一侧:
 *   `controller` 缺省 false。控制器的缺省是**不听、不收指令** (2026-11-21 终端口径: 只由手机管电脑),
 *   被管那一侧的缺省仍是原来的听 + 收。
 * @returns {object|null} 规格; 关掉时 null。
 */
export function resolvePeerSpec(config, role = {}) {
  const controller = role?.controller === true
  if (config === undefined || config === null) return null
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw badConfig('peer config must be an object')
  }
  const raw = /** @type {Record<string, unknown>} */ (config)
  const token = typeof raw.token === 'string' ? raw.token.trim() : ''
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : token !== ''
  if (!enabled) return null
  if (token === '') {
    throw badConfig('peer.enabled is on but peer.token is empty: a reachable route needs a shared token')
  }
  if (token.length < PEER_LIMITS.MIN_TOKEN_LENGTH) {
    throw badConfig(`peer.token must be at least ${PEER_LIMITS.MIN_TOKEN_LENGTH} characters`)
  }
  if (token.length > PEER_LIMITS.MAX_TOKEN_LENGTH) {
    throw badConfig(`peer.token must be at most ${PEER_LIMITS.MAX_TOKEN_LENGTH} characters`)
  }
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (url !== '' && !HTTP_URL_RE.test(url)) {
    throw badConfig('peer.url must be an http(s) URL (empty = take it from the peer card in the mirror)')
  }
  // mode: auto = 先拨 HTTP, 打不通落队列; queue = 一句话都不拨, 只写仓库队列 (2026-10-21 主人选定)
  if (raw.mode !== undefined && typeof raw.mode !== 'string') {
    throw badConfig('peer.mode must be "auto" or "queue" (empty = auto)')
  }
  const rawMode = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : ''
  if (rawMode !== '' && rawMode !== 'auto' && rawMode !== 'queue') {
    throw badConfig('peer.mode must be "auto" or "queue" (empty = auto)')
  }
  const mode = rawMode === 'queue' ? 'queue' : 'auto'
  const sendTimeoutMs = raw.sendTimeoutMs === undefined ? PEER_DEFAULTS.SEND_TIMEOUT_MS : raw.sendTimeoutMs
  if (!Number.isInteger(sendTimeoutMs)
    || sendTimeoutMs < PEER_LIMITS.MIN_SEND_TIMEOUT_MS
    || sendTimeoutMs > PEER_LIMITS.MAX_SEND_TIMEOUT_MS) {
    throw badConfig(`peer.sendTimeoutMs must be an integer in [${PEER_LIMITS.MIN_SEND_TIMEOUT_MS}, ${PEER_LIMITS.MAX_SEND_TIMEOUT_MS}]`)
  }
  const pollSeconds = raw.pollSeconds === undefined ? PEER_DEFAULTS.POLL_SECONDS : raw.pollSeconds
  if (!Number.isInteger(pollSeconds)
    || pollSeconds < PEER_LIMITS.MIN_POLL_SECONDS
    || pollSeconds > PEER_LIMITS.MAX_POLL_SECONDS) {
    throw badConfig(`peer.pollSeconds must be an integer in [${PEER_LIMITS.MIN_POLL_SECONDS}, ${PEER_LIMITS.MAX_POLL_SECONDS}]`)
  }
  // Luwi 加 (2026-10-14): 两个上界。缺省就有值 —— "不设上限"不是可选档, 那一档正是事故的成因
  const maxShadows = raw.maxShadows === undefined ? PEER_DEFAULTS.MAX_SHADOWS : raw.maxShadows
  if (!Number.isInteger(maxShadows)
    || maxShadows < PEER_LIMITS.MIN_MAX_SHADOWS
    || maxShadows > PEER_LIMITS.MAX_MAX_SHADOWS) {
    throw badConfig(`peer.maxShadows must be an integer in [${PEER_LIMITS.MIN_MAX_SHADOWS}, ${PEER_LIMITS.MAX_MAX_SHADOWS}]`)
  }
  const maxProxies = raw.maxProxies === undefined ? PEER_DEFAULTS.MAX_PROXIES : raw.maxProxies
  if (!Number.isInteger(maxProxies)
    || maxProxies < PEER_LIMITS.MIN_MAX_PROXIES
    || maxProxies > PEER_LIMITS.MAX_MAX_PROXIES) {
    throw badConfig(`peer.maxProxies must be an integer in [${PEER_LIMITS.MIN_MAX_PROXIES}, ${PEER_LIMITS.MAX_MAX_PROXIES}]`)
  }
  return {
    enabled: true,
    // 这一台在两端里的角色 (2026-11-21): `controller` = 扫过配对码的手机, 它管电脑; false = 被管的电脑
    controller,
    // mode: 'queue' 时出站只写队列、也不接对端调用 (listen 跟着强制 false)
    mode,
    // listen: 本机接不接受对端调用 (关掉只影响进来那半, 出去那半照旧)
    // 控制器缺省不听: 电脑不能再读手机这边的东西 (2026-11-21)
    listen: mode === 'queue'
      ? false
      : (typeof raw.listen === 'boolean' ? raw.listen : !controller),
    // acceptSend: 接不接受对端**下发的指令** (peer/send). 与 listen 分两档是因为
    // "只读一次对话" 与 "在我这里跑一句话" 是两件事 —— 2026-11-21 起电脑那一侧照旧收
    // (手机管电脑走的就是这一条), 手机那一侧一律拒 (显式写 true 才放开, 配对时由 app 写 false)
    acceptSend: mode === 'queue'
      ? false
      : (controller ? raw.acceptSend === true : true),
    // proxy: 要不要为对端工作区建影子目录与投影会话 (关掉 = 回到逐字节取回)
    // 2026-11-21 单向口径: 电脑只为**手机那几场**建投影是"电脑接收手机的对话", 主人点名关掉;
    // 手机那一侧照旧为电脑那几场建投影 (PC -> Luwi 这一条仍在)
    proxy: controller ? (typeof raw.proxy === 'boolean' ? raw.proxy : true) : false,
    token,
    url,
    sendTimeoutMs,
    pollSeconds,
    maxShadows,
    maxProxies,
  }
}

/**
 * 这一台在终端里是哪一侧 (2026-11-21)
 *
 * 判据三条, 顺序就是优先级:
 *   ① 显式 `role` (`phone` / `pc`) —— 手机扫码时由 App 写, 电脑面板保存/重新配对时写 `pc`
 *   ② 老配置没有 role: **有 pairing 且 `peer.url` 非空** = 手机 (手机记着电脑的地址; 电脑那一侧
 *      通常没有 `peer.url` —— 它是被连的那一头)
 *   ③ 其余 = 电脑 (被管的那一侧; 行为与 2026-11-21 之前一个字节不变)
 *
 * 为什么不能只看 `pairing`: 电脑生成配对码时**也**会写一份 `pairing` (面板保存仓库时顺手写),
 * 拿它判角色会把电脑也关成不听不收, 手机反而连不上它
 * @param {{role?: unknown, paired?: boolean, peerUrl?: unknown}} [input] 配置层的三个事实。
 * @returns {'phone'|'pc'} 角色。
 */
export function resolveRole(input = {}) {
  const declared = typeof input.role === 'string' ? input.role.trim().toLowerCase() : ''
  if (declared === 'phone') return 'phone'
  if (declared === 'pc') return 'pc'
  const peerUrl = typeof input.peerUrl === 'string' ? input.peerUrl.trim() : ''
  return input.paired === true && peerUrl !== '' ? 'phone' : 'pc'
}

/**
 * 解析 live 段 (进行中的回答投影)。整段缺省 = 开, 只有显式写 false 才关。
 * @param {unknown} [config] `$DSH_HOME/lw/session-sync.json` 的 live 段。
 * @returns {{enabled: boolean, maxEntries: number, maxChars: number, keepMinutes: number}} 规格。
 */
export function resolveLiveSpec(config) {
  if (config === undefined || config === null) {
    return {
      enabled: LIVE_DEFAULTS.ENABLED,
      maxEntries: LIVE_DEFAULTS.MAX_ENTRIES,
      maxChars: LIVE_DEFAULTS.MAX_CHARS,
      keepMinutes: LIVE_DEFAULTS.KEEP_MINUTES,
    }
  }
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw badConfig('live config must be an object')
  }
  const raw = /** @type {Record<string, unknown>} */ (config)
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : LIVE_DEFAULTS.ENABLED
  const pick = (value, fallback, min, max, field) => {
    const number = value === undefined ? fallback : value
    if (!Number.isInteger(number) || number < min || number > max) {
      throw badConfig(`live.${field} must be an integer in [${min}, ${max}]`)
    }
    return number
  }
  return {
    enabled,
    maxEntries: pick(raw.maxEntries, LIVE_DEFAULTS.MAX_ENTRIES, LIVE_LIMITS.MIN_MAX_ENTRIES, LIVE_LIMITS.MAX_MAX_ENTRIES, 'maxEntries'),
    maxChars: pick(raw.maxChars, LIVE_DEFAULTS.MAX_CHARS, LIVE_LIMITS.MIN_MAX_CHARS, LIVE_LIMITS.MAX_MAX_CHARS, 'maxChars'),
    keepMinutes: pick(raw.keepMinutes, LIVE_DEFAULTS.KEEP_MINUTES, LIVE_LIMITS.MIN_KEEP_MINUTES, LIVE_LIMITS.MAX_KEEP_MINUTES, 'keepMinutes'),
  }
}

/**
 * 令牌的打码形态: 界面/日志/工具结果里只许出现它。
 * 长度不足 8 时不回任何尾字符 (短令牌的尾巴也是信息)
 * @param {unknown} value - 原始令牌。
 * @returns {string} `<unset>` 或 `••••` + 后四位。
 */
export function maskSecret(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return '<unset>'
  if (text.length < 8) return '••••'
  return `••••${text.slice(-4)}`
}

/**
 * 对端地址的对外读数 (与 describeRemote 同一条纪律: 值里可能有凭据, 脱敏之后才给)。
 * @param {unknown} value - peer.url 或对端名片里的 url。
 * @returns {{state: 'set'|'unset', display: string}} 读数。
 */
export function peerUrlState(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return { state: 'unset', display: '' }
  return { state: 'set', display: sanitizeRemote(text) }
}

/**
 * 定长比较 (令牌): 长度不同直接 false, 相同则逐字符异或累积 —— 别用 === 把长度与
 * 前缀当成两个可以分开量出来的事实
 * @param {unknown} actual - 请求带来的令牌。
 * @param {unknown} expected - 配置里的令牌。
 * @returns {boolean} 相等。
 */
export function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected === '') return false
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let index = 0; index < actual.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return diff === 0
}

/**
 * 对端调用要带的那两个头。
 * @param {string} token - 共享令牌。
 * @returns {Record<string, string>} 请求头。
 */
export function peerHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  }
}

/**
 * 「工作区分组名怎么写」的唯一实现。
 *
 * 两条规则:
 *   · **对端那一侧永远带 `（设备名）`** —— 影子分组是混在本机那一堆分组里出现的, 光看名字分不出
 *     "这是对面那台机器上的工作区" (2026-10-14 主人报的: 没有 pc/Luwi 的标注)。于是裸名字 = 本机的
 *   · **本机那一侧只在同名跨设备时才带** —— 名字两边都有的时候, 只给一边加会让人以为另一条裸名字
 *     才是本机的那一份 (两台都加)
 *
 * 加之前先把名字尾巴上**本设备**那个标注去掉 (幂等): 影子工作区的标题是这一层自己写进注册表的,
 * 万一一层影子套一层影子, 名字会一个括号一个括号地长下去 (2026-10-14 真机上长到过
 * `apk（Luwi 手机）（PC）（PC）…`), 去掉尾巴保证同一台设备的标注只会有一层
 * @param {object} input 输入。
 * @param {Array<{key: string, title: string}>} [input.local] 本机工作区 (key 由调用方给, 通常是 workspaceId)。
 * @param {string} [input.localDeviceName] 本机设备名 (空 = 本机)。
 * @param {Array<{key: string, title: string}>} [input.peer] 对端工作区。
 * @param {string} [input.peerDeviceName] 对端设备名 (空 = 对端)。
 * @returns {{local: Array<{key: string, title: string, label: string, annotated: boolean}>, peer: Array<{key: string, title: string, label: string, annotated: boolean}>}} 两边的显示标签。
 */
export function annotateWorkspaceNames(input = {}) {
  const localDevice = namedOrFallback(input.localDeviceName, '本机')
  const peerDevice = namedOrFallback(input.peerDeviceName, '对端')
  const local = (input.local ?? []).map(entry => ({ key: entry.key, title: entry.title, device: localDevice }))
  const peer = (input.peer ?? []).map(entry => ({ key: entry.key, title: entry.title, device: peerDevice }))
  /** 名字 -> 出现它的设备集合 (只数非空名字; 名字按去掉本设备后缀之后那一个算) */
  const devicesByName = new Map()
  for (const entry of [...local, ...peer]) {
    const name = bareNameOf(entry.title, entry.device)
    if (name === '') continue
    const set = devicesByName.get(name) ?? new Set()
    set.add(entry.device)
    devicesByName.set(name, set)
  }
  const label = (entry, side) => {
    const name = bareNameOf(entry.title, entry.device)
    if (name === '') return entry.device
    const shared = (devicesByName.get(name)?.size ?? 0) > 1
    return shared || side === 'peer' ? `${name}${FULLWIDTH_OPEN}${entry.device}${FULLWIDTH_CLOSE}` : name
  }
  const named = (entry, side) => ({ key: entry.key, title: entry.title, label: label(entry, side), annotated: label(entry, side) !== entry.title.trim() })
  return { local: local.map(entry => named(entry, 'local')), peer: peer.map(entry => named(entry, 'peer')) }
}

/** 名字末尾那个"本设备"的标注去掉 (同一台设备的括号只留一层) */
function bareNameOf(title, device) {
  const name = typeof title === 'string' ? title.trim() : ''
  if (name === '' || typeof device !== 'string' || device === '') return name
  const suffix = `${FULLWIDTH_OPEN}${device}${FULLWIDTH_CLOSE}`
  return name.endsWith(suffix) ? name.slice(0, -suffix.length).trim() : name
}

/** 设备名空则用兜底词 (界面里那句"本机 / 对端") */
function namedOrFallback(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? fallback : text
}

/**
 * 把工作区名收成一个能当目录名的形状 (影子目录的最后一段)。
 * 空名或全被打掉时用设备短 id 兜底 —— 影子目录必须唯一且能建出来, 名字好不好看是次要的
 * @param {unknown} name - 对端给的工作区名。
 * @param {string} deviceId - 对端设备 id (兜底用)。
 * @returns {string} 目录名。
 */
export function shadowDirName(name, deviceId) {
  const cleaned = (typeof name === 'string' ? name : '')
    .replace(UNSAFE_NAME_RE, '-')
    .replace(/^\.+/u, '')
    .trim()
    .slice(0, 64)
  if (cleaned !== '') return cleaned
  const short = typeof deviceId === 'string' ? deviceId.replace(/[^0-9a-z]/giu, '').slice(0, 8) : ''
  return short === '' ? 'peer' : `peer-${short}`
}

/**
 * 从 ContentBlock 数组里取"人话": 只认 text 块, 别的块折成一句占位。
 *
 * 这是「只要回答」那条口径的最底下一层: reasoning 与 tool 的东西在这里就没有入口 ——
 * reasoning 不是一种事件, 它只是 AssistantMessage.content 里的一个块
 * @param {unknown} content - ContentBlock 数组。
 * @returns {string} 文本 (没有文本块时给一句能读的占位, 空数组给空串)。
 */
export function textOfContent(content) {
  const parts = textPartsOf(content)
  if (parts.length > 0) return parts.join('\n')
  return placeholderOf(content)
}

/**
 * 这条消息里有没有**真的说了的话** (非空 text 块)。
 *
 * 与 [textOfContent] 的差别只在"没有 text 块"那一档: 那个给一句能读的占位 (`[tool-call]` / `[图片]`),
 * 这里给 false。投影那一侧要的是它 —— 只有工具调用的那种不是回答, 拿占位当回答会让投影里长出一堆
 * 没有内容的东西 (2026-10-14 在真会话日志上量到过一条 `[tool-call]`)
 * @param {unknown} content - ContentBlock 数组。
 * @returns {boolean} 有非空 text 块就 true。
 */
export function saysText(content) {
  return textPartsOf(content).length > 0
}

/** 把 content 里所有非空 text 块挑出来 (textOfContent 与 saysText 共用的那一层) */
function textPartsOf(content) {
  if (!Array.isArray(content)) return []
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = /** @type {Record<string, unknown>} */ (block)
    if (record.type !== 'text') continue
    if (typeof record.text === 'string' && record.text !== '') parts.push(record.text)
  }
  return parts
}

/** 一个 text 块都没有时那句能读的占位 (有 text 块时用不上) */
function placeholderOf(content) {
  if (!Array.isArray(content)) return ''
  let placeholder = ''
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const type = /** @type {Record<string, unknown>} */ (block).type
    if (type === 'text' || type === 'reasoning') continue
    if (type === 'image') placeholder = placeholder === '' ? '[图片]' : placeholder
    else if (typeof type === 'string' && placeholder === '') placeholder = `[${type}]`
  }
  return placeholder
}
