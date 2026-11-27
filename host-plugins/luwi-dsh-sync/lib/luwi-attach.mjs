// lib/luwi-attach.mjs — Luwi 新增文件 (2.8.1 #50, 2026-11-22)
//
// 「附件段」的唯一一处解析器。那一段的形状由应用那半边先定下来 (`tool/LwIn.kt` 的 `BallAttach`):
//
// ```
// 看这个
//
// [附件 2 个, 图片用 read_image 打开]
// 1. /storage/emulated/0/DSH/Luwi/lw-in/a.png
// 2. /storage/emulated/0/DSH/Luwi/lw-in/b.pdf
// ```
//
// 门户靠同一段把"自己发过的图"认回来 (`presets/luwi-portal/lib/client.js` 的 `splitAttach`),
// 宿主 `/lw-out/in/<名字>` 用的也是它。**图片与文件跨设备时, 这一段就是唯一的名单** —— 手机发出去的
// 路径到电脑上不存在 (反过来也一样), 所以两边都只认这一段的**行**, 换掉行里的路径再重新拼一段。
//
// 为什么单独一份纯函数: 手机侧 (发出去) 与电脑侧 (收下来) 各要解析一次, 两边解析得不一样就是
// "手机说带了图、电脑说没附件"这种最难查的状态。零依赖、无 IO, 单测直接吃它。

/** 附件段的前导空行 (与 `BallAttach.block()` 逐字一致: 正文和段之间空一行) */
const ATTACH_SEPARATOR = '\n\n'

/** 抬头的开头 (长度固定, `lastIndexOf` 找的就是它) */
const ATTACH_PREFIX = '[附件 '

/** 抬头那一句里的固定尾巴 (个数前面还有一个数字, 由 [attachHeader] 拼) */
const ATTACH_TAIL = ' 个, 图片用 read_image 打开]'

/** 一段抬头: `[附件 N 个, ...]` —— 只认"个数是正整数"这一种, 别的当正文 */
const ATTACH_HEADER_RE = /^\[附件\s+(\d+)\s*个[^\]]*\]$/u

/** 名单里的一行: `1. /abs/path` */
const ATTACH_ROW_RE = /^\s*(\d+)\.\s+(.+?)\s*$/u

/** 图那几种扩展名 (与宿主 `LW_OUT_IMAGE_TYPES` 同一张表) */
export const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif'])

/**
 * 一段抬头的正文 (不带前导空行)。
 * @param {number} count - 附件个数。
 * @returns {string} 例如 `[附件 2 个, 图片用 read_image 打开]`。
 */
export function attachHeader(count) {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  return `${ATTACH_PREFIX}${n}${ATTACH_TAIL}`
}

/**
 * 整段附件 (含前导空行); 没有路径时回空串 (调用方直接 `text + block`)。
 * @param {string[]} paths - 绝对路径 (空串与重复项跳过)。
 * @returns {string} 那一段, 或者空串。
 */
export function attachBlock(paths) {
  const list = Array.isArray(paths) ? paths.filter(path => typeof path === 'string' && path.trim() !== '') : []
  if (list.length === 0) return ''
  const rows = list.map((path, index) => `${index + 1}. ${path}`)
  return `${ATTACH_SEPARATOR}${attachHeader(rows.length)}\n${rows.join('\n')}`
}

/**
 * 把正文拆成"人话"与附件名单。
 *
 * 认法照 `BallAttach.strip()`: 从**最后一个** `\n\n[附件 ` 往后看, 抬头必须是 `[附件 N 个…]`,
 * 之后每一行都得是 `序号. 路径` (空行不算)。有一条不合就整段当正文 —— 宁可多留一段, 也不能把
 * 主人自己写的 "[附件 2 个" 切掉。
 * @param {string} text - 正文。
 * @returns {{main: string, paths: string[]}} 去掉附件段的正文 (已 trimEnd) 与名单。
 */
export function stripAttach(text) {
  const src = typeof text === 'string' ? text : ''
  const at = src.lastIndexOf(`${ATTACH_SEPARATOR}${ATTACH_PREFIX}`)
  if (at < 0) return { main: src.trimEnd(), paths: [] }
  const tail = src.slice(at + ATTACH_SEPARATOR.length)
  const lines = tail.split('\n')
  const head = lines.length > 0 ? ATTACH_HEADER_RE.exec(lines[0].trim()) : null
  if (head === null) return { main: src.trimEnd(), paths: [] }
  const paths = []
  for (const line of lines.slice(1)) {
    const row = line.trim()
    if (row === '') continue
    const match = ATTACH_ROW_RE.exec(row)
    if (match === null) return { main: src.trimEnd(), paths: [] }
    const number = Number.parseInt(match[1], 10)
    if (!Number.isFinite(number) || number <= 0) return { main: src.trimEnd(), paths: [] }
    paths.push(match[2])
  }
  // 抬头说 N 个, 名单里却是别的条数: 这一段不可信, 整段算正文 (与"抬头都没有"同一档)
  if (paths.length !== Number.parseInt(head[1], 10)) return { main: src.trimEnd(), paths: [] }
  return { main: src.slice(0, at).trimEnd(), paths }
}

/**
 * 只要名单 (不看正文)。
 * @param {string} text - 正文。
 * @returns {string[]} 附件路径 (没有就是空数组)。
 */
export function attachPathsOf(text) {
  return stripAttach(text).paths
}

/**
 * 正文换一段名单 (原来的附件段先剥掉)。
 *
 * **前导那个空行不许 trim 掉**: 门户认的是 `\n\n[附件 ` (见 `splitAttach`), 没有它那一段就成正文了。
 * 只有"人话是空的"那一档 (`main === ''`) 会留下一个以空行开头的正文 —— 那是对的, 门户读出来的
 * main 恰好也是空串, 屏上就只剩附件那一行
 * @param {string} text - 正文。
 * @param {string[]} paths - 新的路径。
 * @returns {string} 拼好的正文。
 */
export function withAttach(text, paths) {
  const { main } = stripAttach(text)
  return `${main}${attachBlock(paths)}`
}

/**
 * 正文里那个"人话"部分 (附件段剥掉) —— 跨设备回声认同一句时只比这一段。
 *
 * 本地先追加的那一句带的是**本机**路径, 对端折回来那一句带的是**对端**路径, 两串永远不相等;
 * 但它们的人话是一个字都不差的。所以 pendingTexts 的比对键只能是这一段。
 * @param {string} text - 正文。
 * @returns {string} 比对键。
 */
export function pendingKeyOf(text) {
  return stripAttach(text).main
}

/**
 * 路径里最后那一段 (同时认 `/` 与 `\` —— 电脑那一侧回的是 Windows 路径)。
 * @param {string} path - 路径。
 * @returns {string} 名字 (取不到回空串)。
 */
export function baseNameOf(path) {
  const src = typeof path === 'string' ? path : ''
  let cut = -1
  for (let i = src.length - 1; i >= 0; i -= 1) {
    const ch = src[i]
    if (ch === '/' || ch === '\\') {
      cut = i
      break
    }
  }
  return src.slice(cut + 1)
}

/**
 * 一个能被落盘的名字: 只留最后一段, 拒 `..` / NUL / 空 / 纯点。
 * @param {string} raw - 对端给的原始名字或路径。
 * @returns {string} 干净的名字 (不合法回空串)。
 */
export function safeFileName(raw) {
  const src = typeof raw === 'string' ? raw : ''
  if (src === '' || src.includes('\u0000')) return ''
  const name = baseNameOf(src).trim()
  if (name === '' || name === '.' || name === '..') return ''
  if (name.includes('..')) return ''
  return name
}

/**
 * 这个名字的扩展名 (小写; 没有扩展名回空串)。
 * @param {string} name - 文件名。
 * @returns {string} 扩展名。
 */
export function extensionOf(name) {
  const src = typeof name === 'string' ? name : ''
  const dot = src.lastIndexOf('.')
  return dot > 0 ? src.slice(dot + 1).toLowerCase() : ''
}

/**
 * 这个名字是不是图。
 * @param {string} name - 文件名。
 * @returns {boolean} 是图就 true。
 */
export function isImageName(name) {
  return IMAGE_EXTENSIONS.includes(extensionOf(name))
}

/**
 * 同名顺延 (`a.png` → `a_2.png`), 与 `LwIn.put` 同一手感: **不覆盖**别人的那一份。
 * @param {string} name - 想用的名字。
 * @param {Iterable<string>} taken - 已经占着的名字。
 * @returns {string} 可用的名字。
 */
export function dedupeFileName(name, taken) {
  const used = new Set()
  if (taken !== null && taken !== undefined) {
    for (const one of taken) used.add(String(one).toLowerCase())
  }
  const raw = safeFileName(name)
  if (raw === '') return ''
  if (!used.has(raw.toLowerCase())) return raw
  const dot = raw.lastIndexOf('.')
  const stem = dot > 0 ? raw.slice(0, dot) : raw
  const ext = dot > 0 ? raw.slice(dot) : ''
  for (let i = 2; i < 1000; i += 1) {
    const next = `${stem}_${i}${ext}`
    if (!used.has(next.toLowerCase())) return next
  }
  return `${stem}_${Date.now()}${ext}`
}

/**
 * 把一段名单里的旧路径换成新路径 (按顺序一一对应)。
 * @param {string} text - 正文。
 * @param {Map<string, string>|object} mapping - 旧路径 → 新路径。
 * @returns {string} 换过路径的正文 (没换成的原样留着)。
 */
export function rewriteAttachPaths(text, mapping) {
  const { main, paths } = stripAttach(text)
  if (paths.length === 0) return typeof text === 'string' ? text : ''
  const get = typeof mapping?.get === 'function'
    ? (key) => mapping.get(key)
    : (key) => (mapping !== null && typeof mapping === 'object' ? mapping[key] : undefined)
  const next = paths.map(path => {
    const found = get(path)
    return typeof found === 'string' && found !== '' ? found : path
  })
  return `${main}${attachBlock(next)}`
}
