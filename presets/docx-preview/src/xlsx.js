/**
 * xlsx 的"能看就行"那一档 (2026-11-09)
 *
 * 与 pptx 同一档口径: **这不是渲染器, 是抽取器** —— 每页出它的格子内容 (前 4 页 / 200 行 / 26 列),
 * 不出列宽、不出合并单元格、不出条件格式。上游那个 excel 预览 (fortune-sheet + exceljs) 只服务
 * dsh 自己的右栏, 而门户那一侧要的是"点开看一眼这一份写了什么", 所以这里自己解 OOXML:
 * xlsx 就是一只 zip, 页面清单在 `xl/workbook.xml`, 文字在 `xl/sharedStrings.xml`, 格子在同目录的
 * `xl/worksheets/sheetN.xml` 里
 *
 * 三条上限, 免得一份坏文件把预览窗拖死: 4 页 / 每页 200 行 / 每行 26 列, 单元格文本再封 200 字
 */

import JSZip from 'jszip'

/** 最多出几页 */
const MAX_SHEETS = 4
/** 每页最多几行 (非空行) */
const MAX_ROWS = 200
/** 每行最多几列 */
const MAX_COLS = 26
/** 单个格子最多几个字 (再长也不是"看一眼") */
const MAX_CELL_CHARS = 200

/**
 * 把一段相对的 zip 路径按 base 所在目录解析出来 (`..` 与 `.` 都处理)
 *
 * **以 `/` 开头的是包内绝对路径** (OPC 允许那样写, 而 Excel 自己写出来的
 * `xl/_rels/workbook.xml.rels` 就是 `/xl/worksheets/sheet1.xml`): 照根算, 不能拼到 base 后面 ——
 * 拼了会变成 `xl/xl/worksheets/sheet1.xml`, 于是整份表格一行都读不出来 (2026-11-09 真机踩到)
 */
function resolvePath(base, target) {
  const clean = String(target).replaceAll('\\', '/')
  if (clean.startsWith('/')) return clean.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const segment of clean.split('/')) {
    if (segment === '..') parts.pop()
    else if (segment !== '.' && segment !== '') parts.push(segment)
  }
  return parts.join('/')
}

/** 把 rels 那份 XML 读成 rId -> { target, external } */
function relationshipsOf(xml, parser) {
  const doc = parser.parseFromString(xml, 'application/xml')
  const out = new Map()
  for (const node of doc.getElementsByTagName('Relationship')) {
    const id = node.getAttribute('Id')
    const target = node.getAttribute('Target')
    if (id === null || target === null) continue
    out.set(id, { target, external: node.getAttribute('TargetMode') === 'External' })
  }
  return out
}

/**
 * 按 `xl/workbook.xml` 的顺序给出每页的名字与路径, 读不到清单时退回按文件名数字排
 * @param {JSZip} zip 整只 xlsx
 * @param {DOMParser} parser XML 解析器
 * @returns {Promise<{ name: string, path: string }[]>} 每页一份
 */
async function sheetPaths(zip, parser) {
  const workbook = zip.file('xl/workbook.xml')
  const relsFile = zip.file('xl/_rels/workbook.xml.rels')
  if (workbook !== null && relsFile !== null) {
    const rels = relationshipsOf(await relsFile.async('string'), parser)
    const doc = parser.parseFromString(await workbook.async('string'), 'application/xml')
    const ordered = []
    for (const node of doc.getElementsByTagName('sheet')) {
      const id = node.getAttribute('r:id')
      const relationship = id === null ? undefined : rels.get(id)
      if (relationship === undefined || relationship.external) continue
      ordered.push({
        name: node.getAttribute('name') ?? '',
        path: resolvePath('xl/workbook.xml', relationship.target),
      })
    }
    if (ordered.length > 0) return ordered
  }
  return Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.replace(/\D+/g, '')) - Number(right.replace(/\D+/g, '')))
    .map((path) => ({ name: '', path }))
}

/**
 * 共享字符串表: 一个 `<si>` 一行 (富文本会拆成好几个 `<t>`, 连起来才是那一条)
 * @param {string} xml `xl/sharedStrings.xml` 的正文
 * @param {DOMParser} parser XML 解析器
 * @returns {string[]} 下标就是格子里的那个数
 */
function sharedStringsOf(xml, parser) {
  const doc = parser.parseFromString(xml, 'application/xml')
  const out = []
  for (const node of doc.getElementsByTagName('si')) {
    out.push(Array.from(node.getElementsByTagName('t'), (one) => one.textContent ?? '').join(''))
  }
  return out
}

/** `B12` -> 1 (`A` 是 0); 拆不出来时回 -1 */
function columnIndex(ref) {
  const letters = /^([A-Z]+)[0-9]+$/.exec(String(ref ?? '').toUpperCase())
  if (letters === null) return -1
  let index = 0
  for (const letter of letters[1]) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/** 一个格子的文字: 共享字符串 / 内联串 / 布尔 / 错误 / 数字, 认不出就当空 */
function cellText(node, shared) {
  const type = node.getAttribute('t') ?? ''
  const valueOf = () => {
    for (const child of node.getElementsByTagName('v')) return child.textContent ?? ''
    return ''
  }
  let text = ''
  if (type === 's') {
    const index = Number(valueOf())
    text = Number.isInteger(index) ? (shared[index] ?? '') : ''
  } else if (type === 'inlineStr') {
    text = Array.from(node.getElementsByTagName('t'), (one) => one.textContent ?? '').join('')
  } else if (type === 'b') {
    text = valueOf() === '1' ? 'TRUE' : 'FALSE'
  } else {
    text = valueOf()
  }
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) + '…' : text
}

/**
 * 读一页的格子
 * @returns {{ rows: string[][], cutRows: boolean, cutCols: boolean }} 非空行, 以及是否被截断
 */
function rowsOf(xml, parser, shared) {
  const doc = parser.parseFromString(xml, 'application/xml')
  const rows = []
  let cutRows = false
  let cutCols = false
  for (const rowNode of doc.getElementsByTagName('row')) {
    if (rows.length >= MAX_ROWS) {
      cutRows = true
      break
    }
    const cells = []
    let last = -1
    for (const cell of rowNode.getElementsByTagName('c')) {
      const at = columnIndex(cell.getAttribute('r'))
      const index = at >= 0 ? at : last + 1
      if (index >= MAX_COLS) {
        cutCols = true
        continue
      }
      last = index
      while (cells.length < index) cells.push('')
      cells[index] = cellText(cell, shared)
    }
    // 整行都空的不占一行 (空白行在"看一眼"里只是噪音)
    if (cells.some((one) => one !== '')) rows.push(cells)
  }
  return { rows, cutRows, cutCols }
}

/**
 * 抽出一份 xlsx 每页的格子
 * @param {Uint8Array} bytes 原生字节
 * @returns {Promise<{ sheets: { name: string, rows: string[][] }[], truncated: boolean }>} 按页顺序
 * @throws 当它不是一只 zip 时
 */
export async function renderXlsx(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const parser = new DOMParser()
  const sharedFile = zip.file('xl/sharedStrings.xml')
  const shared = sharedFile === null ? [] : sharedStringsOf(await sharedFile.async('string'), parser)
  const paths = await sheetPaths(zip, parser)
  let truncated = paths.length > MAX_SHEETS
  const sheets = []
  for (const sheet of paths.slice(0, MAX_SHEETS)) {
    const file = zip.file(sheet.path)
    if (file === null) continue
    const parsed = rowsOf(await file.async('string'), parser, shared)
    if (parsed.cutRows || parsed.cutCols) truncated = true
    sheets.push({ name: sheet.name, rows: parsed.rows })
  }
  return { sheets, truncated }
}
