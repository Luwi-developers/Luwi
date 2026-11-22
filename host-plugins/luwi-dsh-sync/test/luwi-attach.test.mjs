// test/luwi-attach.test.mjs — 附件段的解析与重拼 (2.8.1 #50, 2026-11-22)
//
// 这一段是"图片与文件跨设备"的唯一名单: 手机发出去的绝对路径到电脑上不存在, 于是两边都只认行,
// 换掉路径再拼一段。这一份钉的就是"拿来什么都能拆对、拆错了也不许切坏正文"。
//
// 与 `tool/LwIn.kt` 的 `BallAttach` 同一串: 前导空行 + `[附件 N 个, 图片用 read_image 打开]` + `序号. 路径`。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attachBlock,
  attachHeader,
  attachPathsOf,
  baseNameOf,
  dedupeFileName,
  extensionOf,
  isImageName,
  pendingKeyOf,
  rewriteAttachPaths,
  safeFileName,
  stripAttach,
  withAttach,
} from '../lib/luwi-attach.mjs'

const SEG = '\n\n[附件 2 个, 图片用 read_image 打开]\n1. /sdcard/DSH/Luwi/lw-in/a.png\n2. /sdcard/DSH/Luwi/lw-in/b.pdf'

test('attachHeader / attachBlock: 与 BallAttach 逐字同一串', () => {
  assert.equal(attachHeader(2), '[附件 2 个, 图片用 read_image 打开]')
  assert.equal(attachBlock(['/a.png']), '\n\n[附件 1 个, 图片用 read_image 打开]\n1. /a.png')
  assert.equal(attachBlock([]), '', '没有路径 = 空串 (调用方直接 text + block)')
  assert.equal(attachBlock(['', '  ']), '', '空行不算附件')
})

test('stripAttach: 拆得出人话与名单', () => {
  const result = stripAttach(`看这个${SEG}`)
  assert.equal(result.main, '看这个')
  assert.deepEqual(result.paths, ['/sdcard/DSH/Luwi/lw-in/a.png', '/sdcard/DSH/Luwi/lw-in/b.pdf'])
  assert.deepEqual(attachPathsOf(`看这个${SEG}`), result.paths)
})

test('stripAttach: 没有附件段原样交回 (只 trimEnd 尾巴)', () => {
  assert.deepEqual(stripAttach('  只说一句话 \n'), { main: '  只说一句话', paths: [] })
  assert.deepEqual(stripAttach(''), { main: '', paths: [] })
  assert.deepEqual(stripAttach(undefined), { main: '', paths: [] })
})

test('stripAttach: 认不出来就不切 (宁可多留一段)', () => {
  const bad = '正文\n\n[附件 2 个, 图片用 read_image 打开]\n这一行不是序号'
  assert.deepEqual(stripAttach(bad), { main: bad.trimEnd(), paths: [] })
  const counted = '正文\n\n[附件 3 个, 图片用 read_image 打开]\n1. /a.png\n2. /b.png'
  assert.deepEqual(stripAttach(counted), { main: counted.trimEnd(), paths: [] }, '抬头说 3 个, 名单只有 2 行')
  const zero = '正文\n\n[附件 0 个, 图片用 read_image 打开]'
  assert.deepEqual(stripAttach(zero), { main: '正文', paths: [] }, '0 个与 0 行对得上 = 这一段就是空的 (与 BallAttach 同一条)')
  const plain = '主人自己写的\n\n[附件 两个]'
  assert.deepEqual(stripAttach(plain), { main: plain.trimEnd(), paths: [] })
})

test('stripAttach: 只认最后那一段 (正文里提到过附件抬头也不受影响)', () => {
  const text = `[附件 1 个, 图片用 read_image 打开]\n1. /old.png 这段是引用${SEG}`
  const result = stripAttach(text)
  assert.equal(result.main, '[附件 1 个, 图片用 read_image 打开]\n1. /old.png 这段是引用')
  assert.deepEqual(result.paths, ['/sdcard/DSH/Luwi/lw-in/a.png', '/sdcard/DSH/Luwi/lw-in/b.pdf'])
})

test('withAttach / rewriteAttachPaths: 换一条路径不碰人话', () => {
  const text = `看这个${SEG}`
  const map = new Map([
    ['/sdcard/DSH/Luwi/lw-in/a.png', 'C:\\Users\\yg\\Luwi\\lw-in\\a.png'],
    ['/sdcard/DSH/Luwi/lw-in/b.pdf', 'C:\\Users\\yg\\Luwi\\lw-in\\b.pdf'],
  ])
  const next = rewriteAttachPaths(text, map)
  assert.equal(next, '看这个\n\n[附件 2 个, 图片用 read_image 打开]\n1. C:\\Users\\yg\\Luwi\\lw-in\\a.png\n2. C:\\Users\\yg\\Luwi\\lw-in\\b.pdf')
  assert.equal(withAttach('看这个', ['/x/a.png']), '看这个\n\n[附件 1 个, 图片用 read_image 打开]\n1. /x/a.png')
  assert.equal(withAttach(`看这个${SEG}`, []), '看这个', '给空名单 = 只剩人话')
})

test('rewriteAttachPaths: 没在表里的路径原样留着', () => {
  const text = `看这个${SEG}`
  const next = rewriteAttachPaths(text, { '/sdcard/DSH/Luwi/lw-in/b.pdf': '/new/b.pdf' })
  assert.ok(next.includes('/sdcard/DSH/Luwi/lw-in/a.png'))
  assert.ok(next.includes('/new/b.pdf'))
})

test('pendingKeyOf: 两边路径不同、人话相同就算同一句', () => {
  const phone = `看这个${SEG}`
  const pc = '看这个\n\n[附件 2 个, 图片用 read_image 打开]\n1. C:\\lw-in\\a.png\n2. C:\\lw-in\\b.pdf'
  assert.equal(pendingKeyOf(phone), pendingKeyOf(pc))
  assert.equal(pendingKeyOf(phone), '看这个')
  assert.equal(pendingKeyOf(''), '')
})

test('baseNameOf / safeFileName: 两种分隔符都认, 危险名字不收', () => {
  assert.equal(baseNameOf('/sdcard/DSH/Luwi/lw-in/a.png'), 'a.png')
  assert.equal(baseNameOf('C:\\Users\\yg\\a.png'), 'a.png')
  assert.equal(baseNameOf('a.png'), 'a.png')
  assert.equal(baseNameOf(''), '')
  assert.equal(safeFileName('C:\\x\\..\\..\\etc\\passwd'), 'passwd')
  assert.equal(safeFileName('..'), '')
  assert.equal(safeFileName('../a.png'), 'a.png', '只取最后一段, 前面的 .. 不跟着走')
  assert.equal(safeFileName('a..b.png'), '', '名字里带 .. 一律不收')
  assert.equal(safeFileName('a\u0000b.png'), '')
  assert.equal(safeFileName('   '), '')
})

test('extensionOf / isImageName: 只认那五种图', () => {
  assert.equal(extensionOf('a.PNG'), 'png')
  assert.equal(extensionOf('a'), '')
  assert.equal(isImageName('a.jpeg'), true)
  assert.equal(isImageName('a.pdf'), false)
})

test('dedupeFileName: 同名顺延, 不覆盖', () => {
  assert.equal(dedupeFileName('a.png', []), 'a.png')
  assert.equal(dedupeFileName('a.png', ['a.png']), 'a_2.png')
  assert.equal(dedupeFileName('a.png', ['a.png', 'a_2.png']), 'a_3.png')
  assert.equal(dedupeFileName('a.png', ['A.PNG']), 'a_2.png', '大小写不敏感')
  assert.equal(dedupeFileName('noext', ['noext']), 'noext_2')
  assert.equal(dedupeFileName('', []), '')
})
