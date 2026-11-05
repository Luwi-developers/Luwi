// lib/term-channel.mjs — 终端面板的宿主半: 把一条命令送进手机的沙盒, 把输出带回来。
//
// 为什么不直接调 lw_linux 那个工具: 插件之间没有互调的口子 —— 宿主给插件的是
// `ctx.tools.register()` (只能登记自己的), 没有 call/invoke 一类的东西。同一个宿主的
// 另一个插件 (host-plugin/index.mjs) 手里那个 `lw_linux` 我们够不着。
//
// 但还有一条更底层的路, 而且是现成的: App 启动宿主时把"特权通道"的地址与令牌以
// 环境变量交给**整个宿主进程** (`LW_CHANNEL_ENDPOINT` / `LW_CHANNEL_TOKEN`)。两个插件
// 跑在同一个进程里 ⇒ 这一份环境变量我们也读得到, 照它发一行 JSON 过去就行。协议就是
// host-plugin/index.mjs 里 request() 的那一套: TCP 连 host:port, 写一行 JSON + \n,
// 读回一行 JSON。
//
// 纪律:
//   · 本模块不向外抛 —— 任何失败都降级成 {ok:false, error}, 面板永远解析得动
//   · 命令原样送进去, 不在这一层拼接 shell (沙盒那边是 `sh -lc <command>`)
//   · 只回文本, 不回令牌与端点

import { connect } from 'node:net'

/** App 交给宿主的两个环境变量 (与 host-plugin/index.mjs 里同名同义)。 */
export const TERM_ENDPOINT_VARIABLE = 'LW_CHANNEL_ENDPOINT'
export const TERM_TOKEN_VARIABLE = 'LW_CHANNEL_TOKEN'

/** 一条命令的长度上限: 面板那条通道的 body 上限是 4 KiB, 留出 JSON 外壳的余量。 */
export const TERM_MAX_COMMAND_CHARS = 4000

/** 与 lw_linux 的默认/上限对齐 (它那边 120000 默认, 600000 封顶)。 */
export const TERM_DEFAULT_TIMEOUT_MS = 120_000
export const TERM_MAX_TIMEOUT_MS = 600_000

/** 等回话的富余: 沙盒那边跑满 timeoutMs 之后还要把输出收拢回来。 */
const SLACK_MS = 30_000

/**
 * 把 timeoutMs 收进合法区间。
 * @param {unknown} value - 客户端给的值。
 * @returns {number} 合法毫秒数。
 */
function clampTimeout(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return TERM_DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.round(ms), 1_000), TERM_MAX_TIMEOUT_MS)
}

/**
 * 发一行 JSON, 读回一行 JSON (TCP, 行分隔)。
 * @param {string} endpoint - `host:port`, 由 App 给出。
 * @param {string} line - 一行 JSON (不带换行)。
 * @param {number} timeoutMs - 等回话的上限。
 * @returns {Promise<string>} 回去的那一行。
 */
function sendLine(endpoint, line, timeoutMs) {
  const split = endpoint.lastIndexOf(':')
  if (split <= 0) return Promise.reject(new Error(`${TERM_ENDPOINT_VARIABLE} is not host:port`))
  const host = endpoint.slice(0, split)
  const port = Number(endpoint.slice(split + 1))
  if (!Number.isFinite(port) || port <= 0) {
    return Promise.reject(new Error(`${TERM_ENDPOINT_VARIABLE} has no usable port`))
  }
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    let buffer = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(`the app did not answer within ${timeoutMs}ms`))
    }, timeoutMs)
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${line}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end < 0) return
      settled = true
      clearTimeout(timer)
      socket.end()
      resolve(buffer.slice(0, end))
    })
    socket.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`could not reach the privileged channel: ${error.message}`))
    })
    socket.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('the app closed the channel without answering'))
    })
  })
}

/**
 * 终端通道。
 *
 * @param {object} [env] - 环境变量来源 (测试可注入)。
 * @returns {{ available: () => boolean, run: (command: string, timeoutMs?: number) => Promise<{ok: boolean, text?: string, error?: string}> }} 通道句柄。
 */
export function createTermChannel(env = process.env) {
  const endpointOf = () => (typeof env[TERM_ENDPOINT_VARIABLE] === 'string' ? env[TERM_ENDPOINT_VARIABLE].trim() : '')
  const tokenOf = () => (typeof env[TERM_TOKEN_VARIABLE] === 'string' ? env[TERM_TOKEN_VARIABLE] : '')

  return {
    /** 宿主是不是 Luwi 起的 (没有这两个变量就没有沙盒可跑)。 */
    available: () => endpointOf() !== '' && tokenOf() !== '',

    /**
     * 在手机的沙盒里跑一条命令。
     * @param {string} command - 原样交给 `sh -lc`。
     * @param {number} [timeoutMs] - 这一条的上限, 默认 120000, 封顶 600000。
     * @returns {Promise<{ok: boolean, text?: string, error?: string}>} 输出文本或失败原因。
     */
    async run(command, timeoutMs) {
      if (typeof command !== 'string' || command.trim() === '') {
        return { ok: false, error: 'command is empty' }
      }
      if (command.length > TERM_MAX_COMMAND_CHARS) {
        return { ok: false, error: `command is longer than ${TERM_MAX_COMMAND_CHARS} characters` }
      }
      const endpoint = endpointOf()
      const token = tokenOf()
      if (endpoint === '' || token === '') {
        return { ok: false, error: 'this host was not started by Luwi, so there is no sandbox to run in' }
      }
      const budget = clampTimeout(timeoutMs)
      let raw
      try {
        raw = await sendLine(
          endpoint,
          JSON.stringify({ method: 'linux', token, op: 'run', command, timeoutMs: budget }),
          budget + SLACK_MS,
        )
      } catch (thrown) {
        return { ok: false, error: thrown instanceof Error ? thrown.message : String(thrown) }
      }
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { ok: false, error: 'the app answered with something that is not JSON' }
      }
      if (parsed === null || typeof parsed !== 'object') {
        return { ok: false, error: 'the app answered with an empty payload' }
      }
      if (typeof parsed.text === 'string') return { ok: true, text: parsed.text }
      if (parsed.ok === false) {
        return { ok: false, error: typeof parsed.error === 'string' ? parsed.error : 'the sandbox refused that command' }
      }
      return { ok: true, text: JSON.stringify(parsed) }
    },
  }
}
