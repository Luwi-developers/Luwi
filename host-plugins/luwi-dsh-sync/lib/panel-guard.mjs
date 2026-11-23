// lib/panel-guard.mjs — 面板那几张"会改东西 / 会吐口令"的路由的门槛
//
// Luwi 修 (2026-11-23, 审计 P0 第 1 条)：原来 `/luwi-sync/op` 与 `/luwi-sync/term` 只看
// `info.config.panelOps`，而这个值是默认 true —— 也就是说，只要为了手机把端口开到局域网，
// 同网任何人可以：
//   POST /luwi-sync/op {op:'configure', confirm:true, remote:'https://attacker/x.git'}  → 改道
//   POST /luwi-sync/op {op:'pair'}                                                      → 拿到含 PAT 的配对文本
//   POST /luwi-sync/term {command:'…'}                                                  → 在本机执行命令
// 对端(`/peer/*`)那一路一直是过令牌的，面板这一路是漏的。
//
// 现在的门槛两条任一即可：
//   1. 请求来自本机 (回环地址) —— 浏览器面板、本机的 curl 都算；
//   2. 带着对端共享令牌 (Bearer) —— 手机端的同步语义走这条。
// 读那几条 (status / peers / doctor) 不设门槛：它们不含口令，面板在局域网的浏览器里
// 打开时也要能读。**写操作一律本地**。
//
// 为什么本机也算安全：跨源 POST 带 `Content-Type: application/json` 会触发预检，
// 而这里不回 CORS 头 —— 别的网页没法借浏览器的手打这个口；同机上的进程本来就有本机权限。

import { sameSecret } from './luwi-peer.mjs'

/** 回环地址的几种写法 (`::ffff:` 是 v6 映射的 v4)。 */
const LOOPBACK_EXACT = Object.freeze(['127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1'])

/**
 * 这个地址是不是本机。
 * @param {unknown} address - `req.socket.remoteAddress`。
 * @returns {boolean} 是就 true。
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false
  if (LOOPBACK_EXACT.includes(address)) return true
  const mapped = address.startsWith('::ffff:') ? address.slice(7) : address
  if (LOOPBACK_EXACT.includes(mapped)) return true
  return /^127\./u.test(mapped)
}

/**
 * 取请求的对端地址 (http 模块在不同版本里挂在不同地方)。
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @returns {string} 地址; 取不到回空串。
 */
export function remoteAddressOf(req) {
  const address = req?.socket?.remoteAddress ?? req?.connection?.remoteAddress
  return typeof address === 'string' ? address : ''
}

/**
 * 取请求带的 Bearer 令牌。
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @returns {string} 令牌; 没带就空串。
 */
export function bearerOf(req) {
  const header = req?.headers?.authorization
  if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) return ''
  return header.slice(7).trim()
}

/**
 * 面板写操作 / 吐口令的那几条的门槛。
 *
 * @param {import('node:http').IncomingMessage} req - 请求。
 * @param {object} [options] - 选项。
 * @param {object|null} [options.spec] - 对端通道的 spec (`token` / `listen`); 没开就传 null。
 * @param {string} [options.what] - 给报错用的一句话, 例如 "改配置"。
 * @returns {{status: number, body: object}|null} 拒绝时给应答; 放行 null。
 */
export function guardLocalWrite(req, options = {}) {
  const spec = options.spec ?? null
  if (spec !== null && spec.listen === true && sameSecret(bearerOf(req), spec.token)) return null
  if (isLoopbackAddress(remoteAddressOf(req))) return null
  return {
    status: 403,
    body: {
      ok: false,
      error: `${options.what ?? 'this op'} 只能在电脑本机操作 (请求来自 ${remoteAddressOf(req) || '未知地址'}); 想从别的设备写, 请带对端共享令牌 (Authorization: Bearer …)`,
    },
  }
}
