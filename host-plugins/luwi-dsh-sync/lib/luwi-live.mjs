// lib/luwi-live.mjs — Luwi 新增文件 (上游 v0.2.24 没有这一份)
//
// G1-2「进行中的回答」的投影算术: 把一场会话的事件折成**只有 user 与 assistant 文本**的一份
// 快照, 再写到 <repoDir>/live/<本机设备id>/<sessionId>.json (退路载体), 同时它也直接回答
// 对端的 GET /luwi-sync/peer/transcript (主路载体)
//
// 两条口径在这里定死:
//   · **只要回答**: 只认 user/message 与 assistant/message 的 text 块。reasoning 与 tool 的
//     东西没有入口 —— reasoning 不是一种事件, 它只是 AssistantMessage.content 里的一个块,
//     所以这里按块过滤; tool/call 与 tool/result 是别的事件类型, **工具名与参数一个字都不进**。
//     2026-11-21 加一档: 一轮里只有工具、没有文本时, 用工具**次数**造一行占位; 计划
//     (`exit_plan_mode` 的 `plan`) 则把正文当这一轮的回答折出来 —— 否则手机上整轮空白
//     (主人报的"没有收到回复": 319 条 assistant 里只有 1 条带文本, 其余全是工具)
//   · **草稿不进日志**: entries 只收"已经落定"的东西 (user 一律收, assistant 只收那一轮
//     已经落定的), 正在流的那一段进 draft。对端把这些 entries 追加进自己的投影会话
//     (幂等), 而 draft 只在界面上看 —— 否则投影会话会随每一次流式分片长出一堆事件
//
// **"落定"不能只看 turn/end** (2026-10-14 修的): 主路载体是宿主的 `sessionQuery.readSurface`,
// 而它只回 **surface 事件** (system/message·user/message·assistant/message·tool/result —
// 见 dsh-session 的 `isSurfaceEvent`), `turn/end` 是 log-only 的一种, **永远不在那一串里**。
// 从前只认 turn/end 的后果是: 每一轮的回答都判成"还在流", 于是投影里永远只有主人那几句话
// (主人报的现象: "同步功能只显示了用户的话, 没有显示 agent 的回答", 而最后那句回答卡在 draft)。
// 所以落定按三个来源判:
//   · 后面还有没有一条主人自己的用户消息 —— 下一轮开了, 这一轮就落定 (主路只有这一条)
//   · turn/end —— 退路载体 (index.mjs 的 eventsFromMessages) 会造它, 认它
//   · 最后那一轮 —— 由 `running` 说话: 没在跑 (或没说) 就算落定, 在跑才进 draft
//
// 一份快照的形状 (v3):
//   {v, deviceId, deviceName, sessionId, title, cwd, running, updatedAt, truncated,
//    entries: [{seq, role: 'user'|'assistant', text, at, media: [...]}], draft: {seq, text}|null}
// v2 = entries 里除了用户那几句, 还有**已经落定的回答** (v1 那条只认 turn/end 的口径下,
// 主路载体折出来的 entries 只有用户那几句) —— 读的一侧据此决定要不要重做一场投影
// v3 (2026-11-22) = 每一条多一格 `media`: 那一句带的图片与文件。手机端照着它把字节取回去, 落在
// 自己工作区的 `lw-in/`, 终端那一页才画得出真图与文件名

import { LIVE_LIMITS } from './constants.mjs'
import { badConfig } from './errors.mjs'
import { saysText, textOfContent } from './luwi-peer.mjs'
import { attachPathsOf, baseNameOf, isImageName, safeFileName } from './luwi-attach.mjs'

/** 会话 id 收成文件名时保留的字符集 (会话 id 是宿主给的不透明串, 这里只管能不能当文件名) */
const SAFE_ID_RE = /[^0-9A-Za-z._-]/gu

/** 会话 id 折成文件名的长度上限 */
const MAX_FILE_NAME_LENGTH = 128

/**
 * 投影快照的版本号。
 *
 * v2 (2026-10-14) 起 entries 里除了用户那几句, 还有**已经落定的回答**; v1 只认 turn/end, 而主路
 * 载体 (`sessionQuery.readSurface`) 永远不给 turn/end, 于是 v1 折出来的 entries 只有用户的话。
 * 读的一侧拿它比对自己账上消费过的那一版, 对端报得更高就该把那场投影重做一场 (见 index.mjs)
 *
 * v3 (2026-11-22, 2.8.1 #50): 条目多一格 `media` —— 那一句带的图片与文件 (附件块 / 附件段两路)。
 * 手机端照着它把字节取回去落在自己工作区的 `lw-in/`, 终端里才画得出真图
 */
export const LIVE_SNAPSHOT_VERSION = 3

/** 没有版本号的快照按 v1 读 (老对端写的东西就是这个形状) */
export const LIVE_SNAPSHOT_VERSION_LEGACY = 1

/** 一轮的工具调用上限 (只为了给个数量, 不是业务上限) */
const MAX_TOOL_TURNS = 9999

/** 计划正文折进投影时的前缀 (2026-11-21 主人: "把 exit_plan_mode 的计划正文当回答文本折进投影") */
export const PLAN_ANSWER_PREFIX = '（这一轮在电脑上给出了计划）\n\n'

/** 计划正文最多折多少字 (再长就截断: 手机端一条气泡装不下几万字) */
export const MAX_PLAN_ANSWER_CHARS = 8000

/** 一条消息最多带几份媒体 (与手机侧 `BallMedia.MAX_ATTACH` 同数: 一次最多 6 个) */
export const MAX_MEDIA_PER_ENTRY = 6

/**
 * 一条消息带的图片与文件 (2026-11-22, 2.8.1 #50)。
 *
 * 两路来源, 各自认自己的:
 *   · **附件块** (`{type:'image'|'file', attachment:{attachmentId, name, mediaType, bytes}}`) ——
 *     电脑那一侧 dsh 的原生发图走这一路, 字节在宿主的附件仓里, 手机端按 id 过来取
 *   · **正文里的附件段** (`[附件 N 个…]` + `1. /abs/path`) —— 门户 `+` 与球那一侧写的都是这一段,
 *     字节就在工作区 `lw-in/` 里, 手机端按路径过来取
 *
 * 只留"取得到"的字段: 名字空的那一项就别报了 —— 手机端拿到一个连名字都没有的引用, 只能画一行
 * 「图没取到」, 不如当它没有
 * @param {unknown} content - 消息的 content 数组。
 * @param {string} text - 已经折出来的正文 (附件段就在里面)。
 * @returns {Array<object>} 媒体清单 (最多 [MAX_MEDIA_PER_ENTRY] 项)。
 */
export function mediaOf(content, text) {
  const out = []
  const seen = new Set()
  const push = (item) => {
    if (out.length >= MAX_MEDIA_PER_ENTRY) return
    const key = item.attachmentId !== undefined ? `a:${item.attachmentId}` : `p:${item.path}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }
  const blocks = Array.isArray(content) ? content : []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const type = block.type === 'image' ? 'image' : block.type === 'file' ? 'file' : ''
    if (type === '') continue
    const attachment = block.attachment !== null && typeof block.attachment === 'object' ? block.attachment : null
    const attachmentId = attachment !== null && typeof attachment.attachmentId === 'string' ? attachment.attachmentId : ''
    if (attachmentId === '') continue
    const rawName = attachment !== null && typeof attachment.name === 'string' ? attachment.name : ''
    const name = rawName !== '' ? (safeFileName(rawName) || '') : ''
    push({
      kind: 'attachment',
      attachmentId,
      name,
      mediaType: attachment !== null && typeof attachment.mediaType === 'string' ? attachment.mediaType : '',
      bytes: attachment !== null && Number.isFinite(attachment.bytes) ? Number(attachment.bytes) : 0,
      image: type === 'image',
    })
  }
  for (const path of attachPathsOf(text)) {
    const name = safeFileName(path)
    if (name === '' && path === '') continue
    push({ kind: 'path', path, name: name === '' ? baseNameOf(path) : name, image: isImageName(name) })
  }
  return out
}

/**
 * 一轮只有工具、没有文字时的那句占位 (主人原话的形状)。
 * @param {number} count - 这一轮跑了多少次工具。
 * @returns {string} 占位正文。
 */
export function toolOnlyAnswer(count) {
  const times = Number.isFinite(count) ? Math.max(0, Math.min(MAX_TOOL_TURNS, Math.trunc(count))) : 0
  return `（这一轮在电脑上跑了 ${times} 次工具，没有文字回复）`
}

/**
 * 从 `tool/call` 的 arguments 里取计划正文 (JSON 字符串, 坏了解析不出就当没有)。
 * @param {unknown} raw - `data.arguments`。
 * @returns {string} 计划正文 (空串 = 这次调用没带计划)。
 */
export function planAnswerOf(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return ''
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return ''
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const plan = /** @type {Record<string, unknown>} */ (parsed).plan
  if (typeof plan !== 'string') return ''
  const text = plan.trim()
  if (text === '') return ''
  if (text.length <= MAX_PLAN_ANSWER_CHARS) return text
  return `${text.slice(0, MAX_PLAN_ANSWER_CHARS)}…`
}

/**
 * 把一场会话的事件折成"条目 + 草稿" —— **不截窗口**。
 *
 * live 快照只留最近 N 条 (滚动窗口), 而方案文档 §5.4 的 `conv/` 对话账要的是**全部**已落定的
 * 条目: 对端离线一轮再回来时, 窗口可能已经滑过它的游标, 中间那段只有这本能补。两条口径同一份
 * 代码折 (见 [condense]), 不各写一遍
 *
 * 2026-11-21: 一轮**没有文本回答**时也要有条目 —— 否则手机端整轮空白 (主人报的"没有收到回复")。
 * 计划那一档 (`exit_plan_mode` 的 `plan`) 优先, 否则落一行「这一轮在电脑上跑了 N 次工具」。
 * 工具名与参数依旧一个字都不进 entries
 * @param {Array<{seq?: number, time?: number, type?: string, data?: unknown}>} events - 日志顺序的事件。
 * @param {{running?: boolean}} [options] - "这一场此刻在不在跑" (在跑则最后那一轮的回答进草稿)。
 * @returns {{entries: Array<{seq: number, role: string, text: string, at: number}>, draft: {seq: number, text: string}|null}} 全部条目与草稿。
 */
export function collectLiveEntries(events, options = {}) {
  const running = options.running === true
  const list = Array.isArray(events) ? events : []
  /** 有序的收条: 先按日志顺序摆好, 最后一步才排序合并 */
  const items = []
  /**
   * 每一轮的"最后那段回答": 一条 user/message 开一个桶, 之后的 assistant/message 往当前那个桶里写
   * (一轮里可能有好几条 —— 工具调用前后各一条 —— 后一条顶掉前一条)。
   *
   * 用**桶**而不是 turn 号: 主路载体里根本没有 turn/end, 而 turn 号只说明"这条消息属于哪一步",
   * 拿它当轮号会随宿主的号重新起算而错位; 桶由"用户那句话"划界, 与日志顺序一一对上
   * @type {Array<{seq: number, text: string, at: number, ended: boolean, tools: number, plan: string, planSeq: number, altSeq: number, altAt: number}>}
   */
  const turns = []
  const openBucket = () => ({ seq: 0, text: '', at: 0, ended: false, tools: 0, plan: '', planSeq: 0, altSeq: 0, altAt: 0, media: [] })
  for (const event of list) {
    if (event === null || typeof event !== 'object') continue
    const type = typeof event.type === 'string' ? event.type : ''
    const seq = Number.isFinite(event.seq) ? Number(event.seq) : 0
    const at = Number.isFinite(event.time) ? Number(event.time) : 0
    const data = event.data !== null && typeof event.data === 'object' ? /** @type {Record<string, unknown>} */ (event.data) : {}
    if (type === 'turn/end') {
      // 退路载体那一串里才有: 它收的是**现在开着的那一轮**
      const open = turns[turns.length - 1]
      if (open !== undefined) open.ended = true
      continue
    }
    if (type === 'user/message') {
      const source = data.source !== null && typeof data.source === 'object' ? /** @type {Record<string, unknown>} */ (data.source) : {}
      // 只有"主人自己说的"才算一条用户消息 (注入的上下文行与插件通知都不算)
      if (source.kind !== 'user') continue
      const text = textOfContent(data.content)
      // 2026-11-22: 只有一张图、没有一句话的那种也是用户消息 (以前整条丢掉, 手机端连"他说了什么"
      // 都看不见)。附件清单空且正文空才算"什么都没说"
      const media = mediaOf(data.content, text)
      if (text === '' && media.length === 0) continue
      items.push({ seq, role: 'user', text, at, media })
      turns.push(openBucket())
      continue
    }
    if (type === 'assistant/message') {
      const message = data.message !== null && typeof data.message === 'object' ? /** @type {Record<string, unknown>} */ (data.message) : {}
      // 只有工具调用 (或只有图片) 的那种不算回答: 宿主自己的 session-turn-outline 也是"text-bearing
      // 的那条顶前一条", 拿占位 (`[tool-call]`) 当回答只会在投影里长出一堆没有内容的东西
      if (!saysText(message.content)) continue
      const text = textOfContent(message.content)
      // 没有开着的那一轮 (回答在自家开一轮之前的也算): 补一个匿名桶, 别把这段回答丢掉
      if (turns.length === 0) turns.push(openBucket())
      const turn = turns[turns.length - 1]
      turn.seq = seq
      turn.text = text
      turn.at = at
      // 2026-11-22: 她那段回答里带的图与文件也记下来 (手机端同样要取回去画)
      turn.media = mediaOf(message.content, text)
      continue
    }
    if (type === 'tool/call') {
      // 2026-11-21: 只数次数、只取计划正文; 工具名与参数绝不出这一层
      if (turns.length === 0) turns.push(openBucket())
      const turn = turns[turns.length - 1]
      turn.tools += 1
      turn.altSeq = seq
      if (turn.altAt === 0) turn.altAt = at
      const name = typeof data.name === 'string' ? data.name : ''
      if (name === 'exit_plan_mode') {
        const plan = planAnswerOf(data.arguments)
        if (plan !== '') {
          turn.plan = plan
          turn.planSeq = seq
        }
      }
      continue
    }
  }
  /**
   * 这一轮要落成的那段回答 (文本优先, 其次计划, 最后工具占位)。
   * @param {{seq: number, text: string, at: number, tools: number, plan: string, planSeq: number, altSeq: number, altAt: number}} turn - 桶。
   * @returns {{seq: number, text: string, at: number}} 回答 (text 空 = 这一轮没东西可落)。
   */
  const answerOf = (turn) => {
    if (turn.text !== '') return { seq: turn.seq, text: turn.text, at: turn.at, media: turn.media }
    if (turn.plan !== '') return { seq: turn.planSeq !== 0 ? turn.planSeq : turn.altSeq, text: `${PLAN_ANSWER_PREFIX}${turn.plan}`, at: turn.altAt, media: [] }
    if (turn.tools > 0) return { seq: turn.altSeq, text: toolOnlyAnswer(turn.tools), at: turn.altAt, media: [] }
    return { seq: 0, text: '', at: 0, media: [] }
  }
  // 落定: 桶被 turn/end 收过, 或者**它后面还有一条主人自己的用户消息**(下一轮开了这一轮就落了),
  // 最后那个桶由 running 说话 (在跑 = 还在流, 进 draft)
  const answers = []
  let draft = null
  for (const [index, turn] of turns.entries()) {
    const answer = answerOf(turn)
    if (answer.text === '') continue
    const settled = turn.ended || index !== turns.length - 1 || !running
    if (!settled) {
      // 还在跑的那一轮只有**真文本**进 draft (工具占位要等落定, 否则每次分片都要改一次投影)
      if (turn.text !== '') draft = { seq: turn.seq, text: turn.text }
      continue
    }
    answers.push({ seq: answer.seq, role: 'assistant', text: answer.text, at: answer.at, media: answer.media })
  }
  const entries = [...items, ...answers].sort((left, right) => left.seq - right.seq || left.role.localeCompare(right.role))
  return { entries, draft }
}

/**
 * 把一场会话的事件折成投影快照里的那两坨。
 *
 * @param {Array<{seq?: number, time?: number, type?: string, data?: unknown}>} events - 日志顺序的事件 (sessionQuery.readSurface / readSession 的产物)。
 * @param {{maxEntries?: number, maxChars?: number, running?: boolean}} [options] - 窗口 (缺省取 LIVE_LIMITS 的下界与常量缺省) 与"这一场此刻在不在跑" (在跑则最后那一轮的回答进 draft, 否则它也算落定)。
 * @returns {{entries: Array<{seq: number, role: string, text: string, at: number}>, draft: {seq: number, text: string}|null, truncated: boolean, all: Array<{seq: number, role: string, text: string, at: number}>}} 投影内容 (外加**不截窗口**的那一份 `all`: 对话账 conv/ 用它)。
 */
export function condense(events, options = {}) {
  const maxEntries = clampInt(options.maxEntries, LIVE_LIMITS.MIN_MAX_ENTRIES, LIVE_LIMITS.MAX_MAX_ENTRIES, 40)
  const maxChars = clampInt(options.maxChars, LIVE_LIMITS.MIN_MAX_CHARS, LIVE_LIMITS.MAX_MAX_CHARS, 16000)
  const collected = collectLiveEntries(events, { running: options.running === true })
  // 窗口: 先按条数, 再按字数 (从最老的开始丢), 丢了就如实标记
  let truncated = false
  let kept = collected.entries
  if (kept.length > maxEntries) {
    kept = kept.slice(kept.length - maxEntries)
    truncated = true
  }
  let budget = maxChars
  // 至少留下最新那一条: 最新一条自己就超预算时, cut 停在"只留它", 而不是因为 break 把整窗留下
  let cut = Math.max(0, kept.length - 1)
  for (let index = kept.length - 1; index >= 0; index -= 1) {
    budget -= kept[index].text.length
    if (budget < 0) break
    cut = index
  }
  if (cut > 0) {
    kept = kept.slice(cut)
    truncated = true
  }
  return { entries: kept, draft: collected.draft, truncated, all: collected.entries }
}

/**
 * 一份投影快照的完整形状 (落盘与应答共用)。
 * @param {object} input 输入。
 * @param {string} input.deviceId - 本机设备 id。
 * @param {string} input.deviceName - 本机设备名 (空 = 本机)。
 * @param {string} input.sessionId - 会话 id。
 * @param {string} [input.title] - 会话标题。
 * @param {string} [input.cwd] - 会话的工作目录。
 * @param {boolean} [input.running] - 这一场此刻在不在跑。
 * @param {Array<object>} input.entries - condense() 的 entries。
 * @param {{seq: number, text: string}|null} [input.draft] - condense() 的 draft。
 * @param {boolean} [input.truncated] - 窗口有没有截断。
 * @param {number} input.updatedAt - 生成时刻。
 * @returns {object} 快照 JSON。
 */
export function liveSnapshot(input) {
  return {
    // v2 (2026-10-14): entries 里多了"已经落定的回答" —— v1 那条口径下主路载体折出来的只有用户的话,
    // 读的一侧 (index.mjs 的 applyTranscript) 按这个版本号决定要不要把旧投影重做一场
    v: LIVE_SNAPSHOT_VERSION,
    deviceId: String(input.deviceId ?? ''),
    deviceName: String(input.deviceName ?? ''),
    sessionId: String(input.sessionId ?? ''),
    title: String(input.title ?? ''),
    cwd: String(input.cwd ?? ''),
    running: input.running === true,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : 0,
    truncated: input.truncated === true,
    entries: Array.isArray(input.entries) ? input.entries : [],
    draft: input.draft ?? null,
  }
}

/**
 * 会话 id 折成文件名的形态 (只留能当文件名的字符)。
 * @param {unknown} sessionId - 会话 id。
 * @returns {string} 文件名 (不含目录, 不含 .json)。
 */
export function liveFileName(sessionId) {
  const cleaned = String(sessionId ?? '')
    .replace(SAFE_ID_RE, '-')
    .replace(/^[.\-]+|[.\-]+$/gu, '')
  const kept = cleaned === '' ? 'session' : cleaned
  return kept.slice(0, MAX_FILE_NAME_LENGTH)
}

/**
 * 校验一份从对端读回来的投影快照 (退路载体是对方写的 JSON, 全是不可信输入)。
 * @param {unknown} value - 解析出来的对象。
 * @returns {object|null} 合格的快照; 不合格 null。
 */
export function readLiveSnapshot(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = /** @type {Record<string, unknown>} */ (value)
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : ''
  if (sessionId === '') return null
  const entries = Array.isArray(raw.entries)
    ? raw.entries.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') return []
      const item = /** @type {Record<string, unknown>} */ (entry)
      const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : ''
      if (role === '' || typeof item.text !== 'string') return []
      return [{
        seq: Number.isFinite(item.seq) ? Number(item.seq) : 0,
        role,
        text: item.text,
        at: Number.isFinite(item.at) ? Number(item.at) : 0,
        // 2026-11-22 (v3): 那一条带的图片与文件 (老快照没有这一格 = 空清单)
        media: readMediaOf(item.media),
      }]
    })
    : []
  const draftValue = raw.draft !== null && typeof raw.draft === 'object' ? /** @type {Record<string, unknown>} */ (raw.draft) : null
  const draft = draftValue !== null && typeof draftValue.text === 'string'
    ? { seq: Number.isFinite(draftValue.seq) ? Number(draftValue.seq) : 0, text: draftValue.text }
    : null
  return {
    // 没有版本号 = v1 (老对端写的快照就是这个形状: entries 里只有用户那几句)
    v: Number.isFinite(raw.v) ? Number(raw.v) : LIVE_SNAPSHOT_VERSION_LEGACY,
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
    deviceName: typeof raw.deviceName === 'string' ? raw.deviceName : '',
    sessionId,
    title: typeof raw.title === 'string' ? raw.title : '',
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    running: raw.running === true,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
    truncated: raw.truncated === true,
    entries,
    draft,
  }
}

/**
 * 校验一份从对端读回来的"媒体清单" (2026-11-22, v3)。
 *
 * 对端写的是不可信输入: 只留认得的两种 (附件块 id / 工作区路径), 名字过 [safeFileName],
 * 路径长度与 NUL 都卡住, 条数按 [MAX_MEDIA_PER_ENTRY] 截。认不出的整项丢掉 —— 手机端拿到一条
 * 读不懂的引用只会画「图没取到」, 不如当它没有
 * @param {unknown} value - 条目里的 `media`。
 * @returns {Array<{kind: string, path?: string, attachmentId?: string, name: string, mediaType?: string, bytes?: number, image: boolean}>} 干净的清单。
 */
function readMediaOf(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const raw of value) {
    if (out.length >= MAX_MEDIA_PER_ENTRY) break
    if (raw === null || typeof raw !== 'object') continue
    const item = /** @type {Record<string, unknown>} */ (raw)
    const name = typeof item.name === 'string' ? (safeFileName(item.name) || '') : ''
    const image = item.image === true
    if (item.kind === 'attachment') {
      const attachmentId = typeof item.attachmentId === 'string' ? item.attachmentId.trim() : ''
      if (attachmentId === '' || attachmentId.length > 200) continue
      out.push({
        kind: 'attachment',
        attachmentId,
        name,
        mediaType: typeof item.mediaType === 'string' ? item.mediaType.slice(0, 100) : '',
        bytes: Number.isFinite(item.bytes) ? Math.max(0, Number(item.bytes)) : 0,
        image,
      })
      continue
    }
    if (item.kind === 'path') {
      const path = typeof item.path === 'string' ? item.path : ''
      if (path === '' || path.length > 1024 || path.includes('\u0000')) continue
      out.push({ kind: 'path', path, name: name === '' ? baseNameOf(path) : name, image })
    }
  }
  return out
}

/** 整数夹逼 (配置层的边界在 resolveLiveSpec 里已经校验过, 这里只是防御) */
function clampInt(value, min, max, fallback) {  if (!Number.isInteger(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * 投影目录 (仓库工作树顶层, **不在镜像根之下** —— 镜像只认 <mirrorDir>, 别处的文件它不删)。
 * @param {string} repoDir - 同步工作树根。
 * @param {string} deviceId - 本机设备 id。
 * @returns {string} 本机投影目录。
 */
export function liveDirectory(repoDir, deviceId) {
  const id = String(deviceId ?? '').replace(/[^0-9A-Za-z._-]/gu, '')
  if (id === '') throw badConfig('cannot place live projections without a device id')
  return `${repoDir}/live/${id}`
}
