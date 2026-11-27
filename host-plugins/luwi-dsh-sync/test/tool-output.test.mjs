// test/tool-output.test.mjs — 工具结果必须是"无损 JSON"这条契约的回归。
//
// 症状 (2026-10-14 在真宿主上第一次挂上插件时撞到): `sync_status` 调下去, 宿主回
//   `tool "sync_status" returned invalid output: value is not lossless JSON`
// 根因: `collectStatus` 的读数对象里**显式写了 `undefined`** (`head` / `remoteHead` /
// `error` / `dirty` 那一批), 工具把引擎结果原样交回去时这些键还在 —— `JSON.stringify`
// 会把它们悄悄丢掉, 而宿主按"无损"判据拒收整条结果。
// 修法: 在工具边界统一剔掉 undefined 值的键 (`losslessStatus`), 不动共享的读数构造。
import test from 'node:test'
import assert from 'node:assert/strict'

import { losslessStatus, makeSyncPushTool, makeSyncPullTool, makeSyncStatusTool } from '../index.mjs'

/** 一个和 collectStatus 同形的读数: 一半字段是显式 undefined。 */
function statusWithHoles() {
  return {
    ok: true,
    branch: 'main',
    remote: 'set',
    head: undefined,
    remoteHead: undefined,
    ahead: 0,
    behind: 0,
    dirty: [],
    forks: [],
    diffStat: '',
    mergeInProgress: false,
    lastCommits: [],
    error: undefined,
    warnings: undefined,
  }
}

test('losslessStatus drops undefined-valued keys and keeps everything else', () => {
  const cleaned = losslessStatus(statusWithHoles())
  assert.equal(Object.values(cleaned).includes(undefined), false)
  assert.equal('head' in cleaned, false)
  assert.equal('error' in cleaned, false)
  assert.equal(cleaned.branch, 'main')
  assert.equal(cleaned.ahead, 0)
  assert.deepEqual(cleaned.dirty, [])
  assert.deepEqual(losslessStatus(undefined), {})
})

test('the status tool never hands the host an undefined-valued key', async () => {
  // 引擎/元数据都按"最坏情况"给: 有洞的读数 + 三个都没记过的元数据
  const tool = makeSyncStatusTool(
    () => ({ ok: true, scope: 'sessions', engine: { status: async () => statusWithHoles() }, label: '' }),
    async () => ({ deviceId: 'dev-1', lastPullAt: undefined, lastPushAt: undefined, lastError: undefined }),
    async () => undefined,
  )
  const value = await tool.execute({}, { signal: undefined })
  assert.equal(value.ok, true)
  assert.equal(Object.values(value).includes(undefined), false, `有 undefined 值的键: ${Object.entries(value).filter(([, v]) => v === undefined).map(([k]) => k).join(', ')}`)
  assert.equal('lastPullAt' in value, false)
  assert.equal('peerCount' in value, false)
  // 无损: JSON 往返之后仍与交出去的对象逐键相同
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
})

test('a failed status read is still lossless', async () => {
  const tool = makeSyncStatusTool(
    () => ({ ok: true, scope: 'sessions', engine: { status: async () => ({ ok: false, error: 'git exploded', head: undefined }) }, label: '' }),
    async () => { throw new Error('metadata table unavailable') },
    undefined,
  )
  const value = await tool.execute({}, { signal: undefined })
  assert.equal(value.ok, false)
  assert.equal(value.error, 'git exploded')
  assert.equal(Object.values(value).includes(undefined), false)
})

// ---------------------------------------------------------------------------
// sync_pull / sync_push: 解析器要从**自己那一份 deps** 里拿
//
// 症状 (2026-10-14 真机): 这两个工具一调就是 `ReferenceError: resolveTarget is not defined`
// —— 工厂签名收的是 `deps` 对象, 而 execute 里写的是裸的 `resolveTarget(...)`, 这个名字在
// 作用域里根本不存在。单测原先只覆盖 `sync_status` (它是位置参数的老签名), 于是漏掉了。
// ---------------------------------------------------------------------------

/**
 * 一趟会放行的确认通道 (选项文案按动作分: pull 是 Pull, push 是 Push)。
 * @param {string} approveLabel - 要选中的那个选项。
 * @returns {object} 够用的 ctx。
 */
function answeringCtx(approveLabel) {
  return {
    get: (name) => (name === 'userQuestions'
      ? { ask: async () => ({ answers: [{ id: 'session-sync-confirm', selected: [approveLabel] }] }) }
      : undefined),
  }
}

for (const [action, factory, label] of [['pull', makeSyncPullTool, 'Pull'], ['push', makeSyncPushTool, 'Push']]) {
  test(`sync_${action} resolves its target from its own deps and reaches the engine`, async () => {
    const seen = []
    const engine = {
      pull: async () => { seen.push('pull'); return { ok: true, pulled: true, head: 'abc1234' } },
      push: async () => { seen.push('push'); return { ok: true, pushed: true, head: 'abc1234' } },
    }
    const resolveTarget = (target) => { seen.push(`target:${target ?? ''}`); return { ok: true, engine, label: '' } }
    const tool = factory({ resolveTarget, ctx: answeringCtx(label), confirmVia: 'userQuestions', eventGate: () => ({ append: false }), logger: { warn() {} } })
    const value = await tool.execute({ target: 'sessions' }, { signal: undefined })
    assert.deepEqual(seen, ['target:sessions', action], `走到了引擎: ${seen.join(' -> ')}`)
    assert.equal(value.ok, true)
  })
}

test('sync_push still fails closed without an answerer (而不是抛 ReferenceError)', async () => {
  const tool = makeSyncPushTool({
    resolveTarget: () => ({ ok: true, engine: { push: async () => ({ ok: true }) }, label: '' }),
    ctx: { get: () => undefined },
    confirmVia: 'auto',
    eventGate: () => ({ append: false }),
    logger: { warn() {} },
  })
  const value = await tool.execute({}, { signal: undefined })
  assert.equal(value.ok, false)
  assert.match(String(value.error), /confirmation|answerer/iu)
})

// ---------------------------------------------------------------------------
// 输出 schema 必须**声明**工具真的会交回去的每一个键
//
// 症状 (2026-11-23 Android 真机): 手机上 sync_status / sync_pull / sync_push 每次必炸
//   `tool "sync_status" returned invalid output: "value.sources[1].budget.files" is not a
//    declared property (additionalProperties: false)`
// 根因: schema 写的是 additionalProperties:false, 而引擎实发的键比它声明的多 ——
//   预算那层实发 {files, bytes, over}, schema 只写了 {maxFiles, maxBytes};
//   pull 实发 via/purged/skipped/failed, push 实发 via, 全都没声明。
//   Android 恒走 api.github.com 那条路, 于是每调必报; 桌面端偶尔走 git 路才漏过去。
// 这条测试锁住"实发键 ⊆ 声明键", 再加键就得同时改 schema。
// ---------------------------------------------------------------------------

/** schema 里某条路径上的 properties 名集合 (找不到就空集)。 */
function declaredKeys(schema, path = []) {
  let node = schema
  for (const step of path) {
    node = node?.properties?.[step]
    if (node === undefined) return new Set()
  }
  return new Set(Object.keys(node?.properties ?? {}))
}

test('预算那一层的 schema 声明了引擎实发的 files / bytes / over', () => {
  const status = makeSyncStatusTool(
    () => ({ ok: true, scope: 'sessions', engine: { status: async () => ({}) }, label: '' }),
    async () => ({}),
    undefined,
  )
  const statusResult = status.output.schema.properties.sources.items
  const statusBudget = new Set(Object.keys(statusResult.properties.budget.properties))
  for (const key of ['files', 'bytes', 'over']) assert.ok(statusBudget.has(key), `status.budget 缺 ${key}`)

  const push = makeSyncPushTool({
    resolveTarget: () => ({ ok: true, engine: { push: async () => ({ ok: true }) }, label: '' }),
    ctx: { get: () => undefined },
    confirmVia: 'auto',
    eventGate: () => ({ append: false }),
    logger: { warn() {} },
  })
  const pushBudget = new Set(Object.keys(push.output.schema.properties.sources.items.properties.budget.properties))
  for (const key of ['files', 'bytes', 'over']) assert.ok(pushBudget.has(key), `push.budget 缺 ${key}`)
})

test('sync_pull / sync_push 的 schema 声明了 via (pull 另加 purged / skipped / failed)', () => {
  const deps = () => ({
    resolveTarget: () => ({ ok: true, engine: { pull: async () => ({ ok: true }), push: async () => ({ ok: true }) }, label: '' }),
    ctx: { get: () => undefined },
    confirmVia: 'auto',
    eventGate: () => ({ append: false }),
    logger: { warn() {} },
  })
  const pullKeys = declaredKeys(makeSyncPullTool(deps()).output.schema)
  for (const key of ['via', 'purged', 'skipped', 'failed']) assert.ok(pullKeys.has(key), `sync_pull 缺 ${key}`)
  const pushKeys = declaredKeys(makeSyncPushTool(deps()).output.schema)
  assert.ok(pushKeys.has('via'), 'sync_push 缺 via')
  // 严格模式要留着 —— 放宽 additionalProperties 不是这次的修法
  assert.equal(makeSyncPullTool(deps()).output.schema.additionalProperties, false)
})
