// lib/lw-reverse.mjs — `adb reverse` 那条管子的读数与修补 (2026-11-22)
//
// 手机里存的是回环口 (`http://127.0.0.1:63560/`), 电脑那一侧每次 dsh 重启换一个随机端口,
// 全靠 `adb reverse tcp:63560 tcp:<电脑端口>` 撑着。管子断了/指错了, 手机上就是
// 「电脑没连上 … (fetch failed)」, 而电脑这边一点动静都没有 (它不去拨手机)。
//
// 这一份只放纯逻辑: 解析 `adb reverse --list`、判断是否要修、以及"最多试三次"的循环;
// 真正跑 pwsh / adb 的接线在 index.mjs (那样这里可以在任何机器上单测)。

/** 修补最多试几次 (主人 2026-11-22: 先尝试三次) */
export const REVERSE_MAX_ATTEMPTS = 3

/** 第一次重试前等多久; 之后每次翻倍 (1s → 2s) */
export const REVERSE_RETRY_BASE_MS = 1000

/**
 * 解析 `adb reverse --list` 的输出。
 *
 * 形状 (真机): `UsbFfs tcp:63560 tcp:58717` / `host-12 tcp:63560 tcp:62666`;
 * 也有 `<serial> tcp:63560 tcp:58717` 与带 `[::1]` 的写法, 这里只认两段 `tcp:<port>`.
 * @param {string} text - 命令输出 (多行)。
 * @returns {Array<{serial: string, devicePort: number, pcPort: number}>} 条目。
 */
export function parseReverseList(text) {
  const rows = []
  for (const raw of String(text ?? '').split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') continue
    const hit = /^(.*?)\s+tcp:(\d+)\s+tcp:(\d+)\s*$/u.exec(line)
    if (hit === null) continue
    const devicePort = Number(hit[2])
    const pcPort = Number(hit[3])
    if (!Number.isInteger(devicePort) || !Number.isInteger(pcPort)) continue
    rows.push({ serial: hit[1].trim(), devicePort, pcPort })
  }
  return rows
}

/**
 * 管子是不是断了 / 指错了。
 *
 * 判据两条, 任一条成立就要修:
 *   ① 一条 `devicePort` 的 rеverse 都没有 (adb 重连之后常见);
 *   ② 有, 但指向的 `pcPort` 不是电脑这一趟实际在听的端口 (电脑重启换端口之后常见)。
 * @param {Array<{devicePort: number, pcPort: number}>} entries - [parseReverseList] 的产物。
 * @param {number} devicePort - 手机那一侧的口 (缺省 63560)。
 * @param {number} pcPort - 电脑这一趟实际在听的口; 0 = 还不知道 (不判, 直接算"不用修")。
 * @returns {boolean} 要修就 true。
 */
export function reverseIsStale(entries, devicePort, pcPort) {
  if (!Number.isInteger(pcPort) || pcPort <= 0) return false
  const mine = (Array.isArray(entries) ? entries : []).filter((row) => row.devicePort === devicePort)
  if (mine.length === 0) return true
  return mine.every((row) => row.pcPort !== pcPort)
}

/**
 * 先在 `attempts` 次以内把它修好; 每次失败之间等 `baseMs * 2^(n-1)`。
 *
 * `readEntries` 每次重新读一遍 `adb reverse --list`; `repair` 跑那一趟修补脚本。
 * 两条都是注入的 —— 这个函数本身不碰进程, 单测可以直接喂假实现。
 * @param {object} options - 依赖与参数。
 * @param {() => Promise<Array<{devicePort: number, pcPort: number}>>} options.readEntries - 读当前 reverse 表。
 * @param {() => Promise<{ok: boolean, error?: string}>} options.repair - 跑一次修补。
 * @param {number} options.devicePort - 手机那一侧的口。
 * @param {number} options.pcPort - 电脑这一趟实际在听的口。
 * @param {number} [options.attempts] - 最多试几次 (缺省 [REVERSE_MAX_ATTEMPTS])。
 * @param {(ms: number) => Promise<void>} [options.sleep] - 等的实现 (测试注入)。
 * @param {number} [options.baseMs] - 第一次重试前等多久。
 * @returns {Promise<{ok: boolean, attempts: number, error?: string}>} 结果。
 */
export async function repairReverse(options) {
  const attempts = Number.isInteger(options?.attempts) && options.attempts > 0 ? options.attempts : REVERSE_MAX_ATTEMPTS
  const baseMs = Number.isFinite(options?.baseMs) && options.baseMs >= 0 ? options.baseMs : REVERSE_RETRY_BASE_MS
  const sleep = typeof options?.sleep === 'function' ? options.sleep : (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })
  let error = ''
  for (let round = 1; round <= attempts; round += 1) {
    let entries = []
    try {
      entries = await options.readEntries()
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
      entries = []
    }
    if (!reverseIsStale(entries, options.devicePort, options.pcPort)) {
      return round === 1 ? { ok: true, attempts: 0 } : { ok: true, attempts: round - 1 }
    }
    try {
      const result = await options.repair()
      if (result?.ok === false) error = result.error ?? 'the repair script failed'
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
    }
    if (round < attempts) await sleep(baseMs * 2 ** (round - 1))
  }
  // 最后一趟再读一次: 脚本可能成功了却没回话
  try {
    const entries = await options.readEntries()
    if (!reverseIsStale(entries, options.devicePort, options.pcPort)) return { ok: true, attempts }
  } catch {
    // 读不到就按失败算
  }
  return { ok: false, attempts, error: error === '' ? 'the reverse entry is still stale' : error }
}
