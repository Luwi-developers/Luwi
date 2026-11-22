// lib/luwi-ask.mjs — Luwi 新增文件 (2026-11-22 终端问答中继)
//
// 手机终端里回答不了 dsh 的 `ask_user_question`: 那张卡片长在 dsh 自己的会话界面上, 而手机看的是
// 投影会话 (只有 user / assistant 文本)。这一份只做**纯算术**, 不碰 ctx、不写盘:
//
//   · `resolveAskSpec`   —— `session-sync.json` 的 `ask` 段缺省与校验 (四档模式)
//   · `askEntryText`     —— 那份问题在手机屏上长什么样 (往快照里多塞一条 assistant 条目)
//   · `askAnsweredText`  —— 手机答完之后那条"我按你说的继续了"的回执条目
//   · `parseAskReply`    —— 手机回的那句话怎么折成 AskUserQuestionAnswer (序号 / 选项原文 / 自定义)
//
// 三条口径在这里定死:
//   · **只认文本**: 不去解析附件段, 也不改写主人的正文 —— 跨设备回声去重只比"人话" (`pendingKeyOf`),
//     正文动一个字, 手机就会把同一句画两遍
//   · **一条问题一个答案项**: 上游 `userQuestions.ask()` 只认"每个问题恰好一次"的批次, 少了多了都拒
//   · **认不出就还给上游**: `parseAskReply` 回 `{ok:false}`, 那一句按普通消息投递, 不吞主人的话

import { badConfig } from './errors.mjs'
import { ASK_DEFAULTS, ASK_LIMITS } from './constants.mjs'

/** 四档模式; `relay` 是缺省 (传过去 + 手机上能答 + 超时按自定义回答继续) */
export const ASK_MODES = Object.freeze(['off', 'notify', 'relay', 'auto'])

/** 超时之后替主人定下来时喂给模型的那一句 (逐字定死, 判据也读它) */
export const AUTO_NOTICE = '（这条问题在终端里没人能作答：主人此刻在手机上，问答卡片在那里不可见。请按你的最佳判断继续，并在正文里用「我替你定了：…」说明你选了什么。）'

/**
 * 手机驱动那一场里每轮附一次的上下文 (走 `agent/pre-step`, `source.kind` 不是 `user`,
 * 所以 `condense` 不会把它折成投影条目 —— 手机上不会多出一行)
 */
export const TERMINAL_BRIEF = [
  '这一场是从手机终端发起的: 主人此刻在手机上, 看不到问答卡片, 只能看到你的正文。',
  '需要确认时优着自己定 —— 直接按最合理的一档做, 并在正文里用「我替你定了：…」写清你定了什么、为什么。',
  '确实必须问的时候, 一次只问一件, 选项写成 1) 2) 这样的清单: 手机那边会用 1 / 2 / 一句自定义回答你。',
  '发图与发文件照旧 (附件段), 手机能收到并打开。',
].join('\n')

/** 一条问题最多列几个选项 (再多手机那一行也读不完) */
const MAX_OPTIONS_SHOWN = 8

/** 选项描述最多留多少字 */
const MAX_OPTION_DESC = 60

/**
 * 解析 `ask` 段。
 *
 * @param {unknown} raw - `session-sync.json` 的 `ask` 段 (没有就 undefined)。
 * @returns {{mode: string, waitMs: number, brief: boolean}} 规格。
 * @throws {Error} 段形状不对 / 取值越界时抛 badConfig (调用方只 warn 并退回缺省)。
 */
export function resolveAskSpec(raw) {
  const spec = { mode: ASK_DEFAULTS.MODE, waitMs: ASK_DEFAULTS.WAIT_MS, brief: ASK_DEFAULTS.BRIEF }
  if (raw === undefined || raw === null) return spec
  if (typeof raw !== 'object' || Array.isArray(raw)) throw badConfig('ask must be an object')
  if (Object.prototype.hasOwnProperty.call(raw, 'mode')) {
    const mode = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : ''
    if (!ASK_MODES.includes(mode)) throw badConfig(`ask.mode must be one of ${ASK_MODES.join(', ')}`)
    spec.mode = mode
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'waitMs')) {
    const wait = Number(raw.waitMs)
    if (!Number.isInteger(wait) || wait < ASK_LIMITS.MIN_WAIT_MS || wait > ASK_LIMITS.MAX_WAIT_MS) {
      throw badConfig(`ask.waitMs must be an integer in [${ASK_LIMITS.MIN_WAIT_MS}, ${ASK_LIMITS.MAX_WAIT_MS}]`)
    }
    spec.waitMs = wait
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'brief')) {
    if (typeof raw.brief !== 'boolean') throw badConfig('ask.brief must be true or false')
    spec.brief = raw.brief
  }
  return spec
}

/**
 * 问题条目正文 (手机终端里看到的那一段)。
 *
 * @param {{questions: Array<object>, at: number, waitMs: number, mode: string}} ask - 等在手机上的那一件。
 * @param {number} [now] - 现在 (给"还剩多少秒"用)。
 * @returns {string} 条目正文。
 */
export function askEntryText(ask, now = Date.now()) {
  const questions = Array.isArray(ask?.questions) ? ask.questions : []
  const waitMs = Number.isFinite(ask?.waitMs) ? Number(ask.waitMs) : ASK_DEFAULTS.WAIT_MS
  const left = Number.isFinite(ask?.at) ? Math.max(0, Math.ceil((Number(ask.at) + waitMs - now) / 1000)) : 0
  const head = ask?.mode === 'notify'
    ? '（电脑在等你回答，这一条只能在电脑上答）'
    : `（电脑在等你回答，约 ${left} 秒内没回应就按自定义回答继续）`
  const lines = [head]
  for (const [index, question] of questions.entries()) {
    const header = typeof question?.header === 'string' && question.header.trim() !== '' ? `【${question.header.trim()}】` : ''
    const label = questions.length > 1 ? `Q${index + 1}. ` : ''
    lines.push('')
    lines.push(`${label}${header}${String(question?.question ?? '')}`)
    const options = Array.isArray(question?.options) ? question.options : []
    for (const [at, option] of options.slice(0, MAX_OPTIONS_SHOWN).entries()) {
      const desc = typeof option?.description === 'string' && option.description.trim() !== ''
        ? ` — ${trimDesc(option.description.trim())}`
        : ''
      lines.push(`  ${at + 1}) ${String(option?.label ?? '')}${desc}`)
    }
    if (options.length === 0) lines.push('  （没有预设选项，直接回一句话就是自定义回答）')
    else if (question?.multiSelect === true) lines.push('  （可多选：回 1,2 这样）')
  }
  lines.push('')
  lines.push(ask?.mode === 'notify'
    ? '回法：这一条只能在电脑上回答 —— 你在手机上回的任何字都当普通消息发过去。'
    : questions.length > 1
      ? '回法：按问题的顺序回，用分号隔开（例如 1;2）；其它任何文字都当自定义回答。'
      : '回法：直接回 1 / 2 …；其他任何文字都当自定义回答。')
  return lines.join('\n')
}

/**
 * 手机答完之后那一条回执条目。
 *
 * @param {object} ask - 那一件问题。
 * @param {{answers: Array<{id: string, selected: string[], custom?: string}>}} answer - 答案。
 * @returns {string} 条目正文。
 */
export function askAnsweredText(ask, answer) {
  const questions = Array.isArray(ask?.questions) ? ask.questions : []
  const answers = Array.isArray(answer?.answers) ? answer.answers : []
  const parts = []
  for (const [index, item] of answers.entries()) {
    const question = questions.find(entry => entry?.id === item?.id) ?? questions[index]
    const selected = Array.isArray(item?.selected) ? item.selected.filter(label => typeof label === 'string' && label !== '') : []
    const custom = typeof item?.custom === 'string' ? item.custom.trim() : ''
    const what = selected.length > 0 ? selected.join(', ') : custom
    if (what === '') continue
    const name = typeof question?.question === 'string' && questions.length > 1 ? `Q${index + 1} ` : ''
    parts.push(`${name}${what}`)
  }
  if (parts.length === 0) return '（已按你在手机上的回答继续）'
  return `（已按你在手机上的回答继续：${parts.join('；')}）`
}

/**
 * 把手机回的那一句话折成上游认的答案批次。
 *
 * 规则 (与 `askEntryText` 里写的回法逐条对上):
 *   1. `1` / `1,2` / `1 2` 且序号在范围内 → `selected: [label…]` (单选的题只取第一个)
 *   2. 整串等于某个选项 label (忽略大小写与首尾空白) → `selected: [那个 label]`
 *   3. 其它 → `custom: 原文` (选了又写了字的那一档, selected 也留着)
 *   4. 多问: 按 `;` 或换行切, 条数对得上就逐条套 1–3; 对不上整串当所有问的 custom
 *
 * @param {Array<object>} questions - 那一批问题。
 * @param {unknown} raw - 手机回的正文。
 * @returns {{ok: boolean, answers: Array<{id: string, selected: string[], custom?: string}>, reason?: string}} 结果。
 */
export function parseAskReply(questions, raw) {
  const list = Array.isArray(questions) ? questions.filter(question => question !== null && typeof question === 'object') : []
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (list.length === 0) return { ok: false, answers: [], reason: 'no pending question' }
  if (text === '') return { ok: false, answers: [], reason: 'the reply was empty' }
  const parts = splitReplies(text)
  if (list.length === 1 || parts.length === list.length) {
    const answers = list.map((question, index) => answerOne(question, list.length === 1 ? text : parts[index]))
    return { ok: true, answers }
  }
  // 条数对不上: 整串当每一问的自定义回答 (宁可多给一句, 也别把主人的话吞掉)
  return { ok: true, answers: list.map(question => ({ id: String(question?.id ?? ''), selected: [], custom: text })) }
}

/**
 * 超时/自动档喂给模型的那一批答案 (一个问题一项, 全部走 custom)。
 *
 * @param {Array<object>} questions - 那一批问题。
 * @param {string} [notice] - 自定义回答正文 (缺省 AUTO_NOTICE)。
 * @returns {{answers: Array<{id: string, selected: string[], custom: string}>}} 答案批次。
 */
export function autoAnswers(questions, notice = AUTO_NOTICE) {
  const list = Array.isArray(questions) ? questions : []
  return { answers: list.map(question => ({ id: String(question?.id ?? ''), selected: [], custom: notice })) }
}

/**
 * 一条问题 + 一段文本 → 一个答案项。
 * @param {object} question - 问题。
 * @param {string} text - 这一段回答。
 * @returns {{id: string, selected: string[], custom?: string}} 答案项。
 */
function answerOne(question, text) {
  const id = String(question?.id ?? '')
  const raw = typeof text === 'string' ? text.trim() : ''
  const options = Array.isArray(question?.options) ? question.options : []
  if (options.length === 0) return { id, selected: [], custom: raw }
  const byLabel = options.find(option => String(option?.label ?? '').toLowerCase() === raw.toLowerCase())
  if (byLabel !== undefined) return { id, selected: [String(byLabel.label)] }
  const indexes = numericIndexes(raw)
  if (indexes !== null) {
    const picked = []
    for (const at of indexes) {
      const option = options[at - 1]
      if (option !== undefined && typeof option.label === 'string' && option.label !== '') picked.push(option.label)
    }
    if (picked.length > 0) {
      const selected = question?.multiSelect === true ? uniqueOf(picked) : [picked[0]]
      return { id, selected, custom: selected.length < indexes.length ? raw : undefined }
    }
  }
  return { id, selected: [], custom: raw }
}

/**
 * 多问时的切法: 分号 (半角/全角) 或换行。
 * @param {string} text - 正文。
 * @returns {string[]} 各问的回答 (空串已丢)。
 */
function splitReplies(text) {
  const pieces = text.split(/[;\n\r]+|；/u).map(piece => piece.trim()).filter(piece => piece !== '')
  return pieces.length === 0 ? [text] : pieces
}

/**
 * `1` / `1,2` / `1 2` / `1、2` 这样的序号串 → 序号数组; 不是这一档回 null。
 * @param {string} text - 正文。
 * @returns {number[]|null} 序号 (从 1 起)。
 */
function numericIndexes(text) {
  if (!/^\d+(?:\s*[,，、/]?\s*\d+)*$/u.test(text)) return null
  const numbers = text.split(/[^\d]+/u).filter(piece => piece !== '').map(piece => Number(piece))
  if (numbers.length === 0 || numbers.some(value => !Number.isInteger(value) || value < 1)) return null
  return numbers
}

/** 去重但保留顺序 */
function uniqueOf(list) {
  const out = []
  for (const item of list) if (!out.includes(item)) out.push(item)
  return out
}

/** 选项描述截短 (手机那一行放不下整段) */
function trimDesc(text) {
  return text.length <= MAX_OPTION_DESC ? text : `${text.slice(0, MAX_OPTION_DESC)}…`
}

/**
 * `/sync ask` 与 doctor 的读数行。
 *
 * @param {{mode: string, waitMs: number, brief: boolean}} spec - ask 规格。
 * @param {{pending: number, answered: number, expired: number, lastSessionId: string}} counters - 计数。
 * @returns {string} 一行读数 (与 `/sync p2p 状态` 同一个口气)。
 */
export function renderAskState(spec, counters) {
  const mode = spec === null || spec === undefined ? 'off' : String(spec.mode ?? 'off')
  const wait = Math.round((Number(spec?.waitMs) || ASK_DEFAULTS.WAIT_MS) / 1000)
  const brief = spec?.brief === true ? '开' : '关'
  const pending = Number(counters?.pending ?? 0)
  const answered = Number(counters?.answered ?? 0)
  const expired = Number(counters?.expired ?? 0)
  const last = String(counters?.lastSessionId ?? '')
  return [
    `问答: ${mode} · 等 ${wait}s · 终端提示 ${brief}`,
    `计数: 答回 ${answered} · 超时 ${expired} · 此刻在等 ${pending}`,
    pending === 0 || last === '' ? '在等: 没有' : `在等: ${last.slice(-8)}`,
  ].join('\n')
}
