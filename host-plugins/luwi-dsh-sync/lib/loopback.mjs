// lib/loopback.mjs — Luwi 新增文件 (上游 v0.2.24 没有这一份)
//
// 「这条请求是不是本机自己发出来的」的唯一判据。
//
// 为什么要有它 (2026-11-21 终端口径): 这个插件的 HTTP 面有两类
//   · 面板 / 终端那几条 (panel/op · panel/term · send · peer-live) 是**人的界面**用的, 宿主自己
//     那个 WebView / 本机浏览器就在回环上 —— 它们过去一条闸都没有, 而 host 一旦 `--allow-lan`
//     监听 0.0.0.0, 局域网里任何一台机器的浏览器都能 POST 过来写配置、在手机的 Linux 沙盒里跑命令
//     (那正是"电脑控制手机")
//   · 对端那几条 (peer/*) 另有共享令牌那一道闸, 与本文件无关
//
// 口径: 控制面只认**本机**. 两道都要过:
//   ① `req.socket.remoteAddress` 是回环 (v4 / v6 / v4-mapped / 全零四种写法)
//   ② `Host` 头里的主机名也是回环 (`127.0.0.1` / `localhost` / `[::1]`) —— 只挡 ① 时还有两扇门:
//      DNS rebinding (浏览器里 evil.com 解析到 127.0.0.1, remoteAddress 也是 127.0.0.1) 与同机反代
//      (外部请求全从回环进来, `--public-url` 那种部署下 ① 恒真)。Host 头是浏览器给的、脚本改不了,
//      于是这两条都被挡下; 正常用法 (WebView 打 `127.0.0.1:3080` / 本机浏览器) 一个字节不变
//
// 纯函数, 不吃 node:http, 于是能在单测里直接量 (见 test/terminal-direction.test.mjs)

/** 算「本机」的那几个 remoteAddress 写法 (测试与调用方共用这一份) */
export const LOOPBACK_ADDRESSES = Object.freeze(['127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1'])

/** Host 头里算「本机」的主机名 */
export const LOOPBACK_HOSTNAMES = Object.freeze(['127.0.0.1', 'localhost', '[::1]'])

const LOOPBACK = new Set(LOOPBACK_ADDRESSES)
const LOOPBACK_HOSTS = new Set(LOOPBACK_HOSTNAMES)

/**
 * 这个地址算不算本机回环。
 * @param {unknown} address `req.socket.remoteAddress` 那一份。
 * @returns {boolean} 是回环就 true (认不出 = false)。
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  return LOOPBACK.has(address.trim().toLowerCase())
}

/**
 * 这条请求是不是本机发出的 (只看 socket, 老调用方与测试用)。
 * @param {{socket?: {remoteAddress?: unknown}}} req node 的 IncomingMessage (只用到 socket)。
 * @returns {boolean} 回环就 true。
 */
export function isLoopbackRequest(req) {
  const address = req !== null && typeof req === 'object' ? req.socket?.remoteAddress : undefined
  return isLoopbackAddress(address)
}

/**
 * `Host` 头的主机名算不算本机 (端口不算, IPv6 字面量带方括号)。
 * @param {unknown} value `req.headers.host`。
 * @returns {boolean} 是就 true; 空 / 认不出 = false。
 */
export function isLoopbackHostHeader(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
  if (raw === '') return false
  const host = raw.startsWith('[')
    ? raw.slice(0, raw.indexOf(']') === -1 ? raw.length : raw.indexOf(']') + 1)
    : raw.split(':')[0]
  return LOOPBACK_HOSTS.has(host)
}

/**
 * 控制面的正式判据: socket 是回环 **且** Host 头是回环。
 * @param {{socket?: object, headers?: object}} req node 的 IncomingMessage。
 * @returns {boolean} 两道都过才 true。
 */
export function isLocalRequest(req) {
  if (!isLoopbackRequest(req)) return false
  return isLoopbackHostHeader(req?.headers?.host)
}

/** 控制面被非本机请求碰到时回的那一句 (面板与终端共用, 措辞只有一处) */
export const LOOPBACK_ONLY_ERROR = 'this control surface is loopback-only on this host'
