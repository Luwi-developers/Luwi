// lib/command-words.mjs — `/sync` 命令里的动作词 (2026-11-22 晚: 主人说"那些命令你都改成中文")
//
// 只有一件事: 把用户敲的那一格归一到内部用的那几个英文词。**中文是正写, 英文留作别名** ——
// 老习惯 (`/sync p2p on`) 与文档里的英文写法都不至于突然失效。
//
// 零依赖、无 IO, 单测直接吃它 (index.mjs 那一份只 import 再转出去, 免得命令词表住在需要
// dsh 依赖的模块里, 本机跑不了单测)。

/** p2p 认得的动作 (内部名)。 */
export const P2P_ACTIONS = Object.freeze(['state', 'on', 'off', 'confirm', 'revoke'])

/**
 * `/sync p2p` 的动作词归一化。
 *
 * @param {unknown} raw - 命令里那一格 (中文 / 英文都行; 空 = 状态)。
 * @returns {string} `state` | `on` | `off` | `confirm` | `revoke` | 原样的小写串 (认不出时)。
 */
export function normalizeP2pAction(raw) {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (text === '' || text === 'state' || text === 'status' || text === '状态' || text === '读数') return 'state'
  if (text === 'on' || text === '开' || text === '打开') return 'on'
  if (text === 'off' || text === '关' || text === '关闭') return 'off'
  if (text === 'confirm' || text === '确认' || text === '确认换机') return 'confirm'
  if (text === 'revoke' || text === '吊销' || text === '撤销') return 'revoke'
  return text
}

/** `ask` 认得的动作 (内部名): 状态 / 关 / 提示 (= 传过去但只在电脑上答) / 中继 / 自动 */
export const ASK_ACTIONS = Object.freeze(['state', 'off', 'notify', 'relay', 'auto'])

/**
 * `/sync ask` 的动作词归一化。中文是正写, 英文留别名 (与 `/sync p2p` 同一口径)。
 *
 * @param {unknown} raw - 命令里那一格 (中文 / 英文都行; 空 = 状态)。
 * @returns {string} `state` | `off` | `notify` | `relay` | `auto` | 原样的小写串 (认不出时)。
 */
export function normalizeAskAction(raw) {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (text === '' || text === 'state' || text === 'status' || text === '状态' || text === '读数') return 'state'
  if (text === 'off' || text === '关' || text === '关闭') return 'off'
  if (text === 'notify' || text === '提示' || text === '通知') return 'notify'
  if (text === 'relay' || text === '中继' || text === '转发') return 'relay'
  if (text === 'auto' || text === '自动' || text === '自定义') return 'auto'
  return text
}
