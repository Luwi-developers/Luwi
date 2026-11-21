/**
 * 两本只追加的账: `lw/memory/plans.jsonl` (策略分布) 与 `lw/memory/relation.jsonl` (关系曲线)
 *
 * 为什么单独一个模块: `state.mjs` 是**纯函数** (无 fs 无时钟, 判据能把某一刻钉死), 而这两本账
 * 必须碰盘 —— 混在一起会让"纯"那条不清. 分开之后判据可以真跑这里 (写 501 行只剩 500 / 坏行跳过 /
 * 写不动就抛 / 8 个并发写全都在), 而不用只拿正则 grep 宿主的源码
 *
 * 四条纪律:
 * - 读不到 / 坏行 = 空 (账本坏了不该让整份记忆跟着坏)
 * - 只留最新 [max] 行 (账本无限长会把审计拖垮)
 * - **同一份账上的写入串起来**: 读-改-写整份重写不是原子追加, 两个调用同时进来会丢其中一个
 * - **写不动就抛** —— 由调用方决定是 warn 还是当错误 (宿主的两次调用都是"账本坏了别拖死这一场")
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 读一份 jsonl 的每一行 (坏行跳过; 读不到就是空) */
export async function readJsonl(path) {
  if (!path) return []
  try {
    const text = await readFile(path, 'utf8')
    return text
      .split('\n')
      .filter(Boolean)
      .map((one) => {
        try {
          const parsed = JSON.parse(one)
          return parsed && typeof parsed === 'object' ? parsed : null
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 往账上补一行 (只留最新 [max] 行)
 *
 * @param {string} path 目标文件
 * @param {object} row 这一行
 * @param {number} max 最多留几行
 * @returns {Promise<number>} 落盘之后一共几行
 */
export async function appendJsonl(path, row, max) {
  return enqueue(path, async () => {
    if (!path) throw new Error('the ledger has nowhere to go')
    const limit = Math.max(1, Math.round(Number(max) || 1))
    return writeNow(path, [...(await readJsonl(path)), row].slice(-limit))
  })
}

/**
 * 整份重写 (只留最新 [max] 行) —— 同一天的关系曲线要**改写那一行**, 不能一路往后追加
 *
 * @param {string} path 目标文件
 * @param {object[]} rows 全部行
 * @param {number} max 最多留几行
 * @returns {Promise<number>} 落盘之后一共几行
 */
export async function writeJsonl(path, rows, max) {
  return enqueue(path, async () => {
    if (!path) throw new Error('the ledger has nowhere to go')
    const limit = Math.max(1, Math.round(Number(max) || 1))
    return writeNow(path, (Array.isArray(rows) ? rows : []).slice(-limit))
  })
}

/** 每条路径一条 promise 链: 上一条写完才轮到下一条 (失败了也放行, 否则一次写不动会把整条链卡死) */
const chains = new Map()

function enqueue(path, job) {
  const key = String(path ?? '')
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.then(job, job)
  chains.set(key, next.then(() => {}, () => {}))
  return next
}

/** 真正落盘那一下 (调用方已经在链里了) */
async function writeNow(path, rows) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporary, rows.map((one) => JSON.stringify(one)).join('\n') + '\n', 'utf8')
  await rename(temporary, path)
  return rows.length
}
