/**
 * `@modusensus/dsh-mneme` 的四处 Luwi 补丁 (2026-11-10 起)
 *
 * 用法: 被 `tools/pack-host.mjs` (构建期打补丁) 与 `tools/check-mneme-patches.mjs`
 * (任意版本离线预演) import, 不单独执行
 *
 * 这一份是**唯一**的补丁表: `tools/pack-host.mjs` 在 npm pack 之后用它打补丁,
 * `tools/check-mneme-patches.mjs` 拿它对任意版本做离线预演. 两处共用同一份,
 * 判据才不会与构建漂开
 *
 * 四处各管一件事:
 *
 * 1. `tavern-config` / `tavern-summarize` / `tavern-inject`: 酒馆那一档不进记忆库
 *    (上游没有按 preset 排除的配置, 由这三处补上 `excludeAgentPresets`)
 * 2. `hot-memory-unanswered`: 热记忆不再把"还没回答的当前轮"算成一整轮 —— 那是
 *    2026-11-10 主人报的「每次回复都发两条意思一样的句子」的根因: 每个 step 的
 *    prompt 组装都会重算热记忆, 当前轮 A 位空着会让模型以为上一问没人答, 于是在
 *    同一个 turn 里再答一遍
 *
 * **每条独立判断是否已应用** (靠 `appliedWhen` 那句标记): 上游哪天自己实现了
 * `excludeAgentPresets`, 只跳过它自己那一处, 另外两条消费点仍然补; 绝不再出现
 * "第一个文件命中就整段跳过"那种连坐 —— 那会让热记忆的修复静默丢失
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 一处补丁
 *
 * `file` 相对 mneme 包根; `insert` 追加在锚点之后, `replace` 整句替换锚点 (二选一);
 * `appliedWhen` 是"这处已经打过了"的标记文本; `retiredWhen` 是"上游自己做了这件事"的标记
 * —— 命中就跳过这一处, 不再往新版里塞旧补丁 (2026-11-13: 0.15.0 用 Issue #637 的
 * `omitPendingRound` 自己实现了热记忆那条)
 *
 * @typedef {object} MnemePatch
 * @property {string} id - 稳定名字, 报错与读数都用它
 * @property {string} file - 相对包根的路径
 * @property {string} appliedWhen - 已应用时文件里必然出现的标记
 * @property {string} [retiredWhen] - 上游已经自己实现了时, 文件里必然出现的标记
 * @property {string} anchor - 必须恰好命中一次的原文
 * @property {string} [insert] - 追加在锚点之后
 * @property {string} [replace] - 替换整个锚点
 */

/** @type {readonly MnemePatch[]} */
export const MNEME_PATCHES = Object.freeze([
  {
    id: 'tavern-config',
    file: join('lib', 'config.js'),
    appliedWhen: "excludeAgentPresets: z.array(z.string()).default(['tavern'])",
    anchor: 'autoSummarize: z.boolean().default(true),',
    insert: "\n  excludeAgentPresets: z.array(z.string()).default(['tavern']),",
  },
  {
    id: 'tavern-summarize',
    file: join('lib', 'summarize.js'),
    appliedWhen: 'const excludedPresets = Array.isArray(config.excludeAgentPresets)',
    anchor: 'async function summarize(session, triggerEvent, opts = {}) {',
    insert: '\n    const excludedPresets = Array.isArray(config.excludeAgentPresets) ? config.excludeAgentPresets : [];'
      + '\n    let presetName = null;'
      + '\n    try { presetName = session?.header?.agentPreset ?? null } catch { presetName = null }'
      + '\n    if (typeof presetName === "string" && excludedPresets.includes(presetName.trim())) return;',
  },
  {
    id: 'tavern-inject',
    file: join('lib', 'inject.js'),
    appliedWhen: 'config.excludeAgentPresets.includes(presetName.trim())',
    anchor: 'text: (ctx) => {',
    insert: '\n        let presetName = null;'
      + '\n        try { presetName = ctx?.agent?.session?.header?.agentPreset ?? null } catch { presetName = null }'
      + '\n        if (typeof presetName === "string" && Array.isArray(config.excludeAgentPresets)'
      + '\n          && config.excludeAgentPresets.includes(presetName.trim())) return "";',
  },
  {
    id: 'hot-memory-unanswered',
    file: join('lib', 'hot-memory.js'),
    appliedWhen: 'Luwi: 当前这一轮还没说出话',
    // 2026-11-13 (0.15.0): 上游用 Issue #637 的 `omitPendingRound` 自己把这条修了 ——
    // 注入侧 inject.js 传 `{ omitPendingRound: true }`, 尾部 pending 轮不再进块。
    // 新版不要再打旧补丁 (锚点也变了), 只认"上游已经做了"。
    retiredWhen: 'omitPendingRound',
    // 行首那个 `\n` 不能省: 同一个调用在循环里还有一份 (6 空格缩进), 不带换行时
    // 这一串会命中两次, 补丁会因为"锚点不唯一"整段失败
    anchor: '\n  if (pendingQuery) rounds.push({ query: pendingQuery, response: "" });',
    replace: '\n  // Luwi: 当前这一轮还没说出话 (A 空) 时不当成一整轮 —— 每个 step 的 prompt 组装都会重算这条\n'
      + '  // 块, "A: " 空着会让模型以为上一问没人答, 于是同一个 turn 里再答一遍 (真机实测每轮两条)',
  },
])

/**
 * 对一份 mneme 包目录打补丁
 *
 * **不抛错**: 每处的失败进 `failures`, 调用方自己决定是构建失败 (pack-host) 还是
 * 报一行读数 (预演脚本). 这样一次能看到全部问题, 而不是修一个红一个
 *
 * @param {string} packageRoot - mneme 包根 (含 `package.json` 与 `lib/`)
 * @returns {{ applied: string[], already: string[], failures: Array<{ id: string, reason: string }> }}
 */
export function applyMnemePatches(packageRoot) {
  /** @type {{ applied: string[], already: string[], failures: Array<{ id: string, reason: string }> }} */
  const result = { applied: [], already: [], failures: [] }
  for (const patch of MNEME_PATCHES) {
    const path = join(packageRoot, patch.file)
    if (!existsSync(path)) {
      result.failures.push({ id: patch.id, reason: `missing ${patch.file}` })
      continue
    }
    const source = readFileSync(path, 'utf8')
    if (patch.retiredWhen && source.includes(patch.retiredWhen)) {
      // 上游自己实现了: 不打旧补丁, 记为 already (构建与预演都不算失败)
      result.already.push(patch.id)
      continue
    }
    if (source.includes(patch.appliedWhen)) {
      result.already.push(patch.id)
      continue
    }
    const hits = source.split(patch.anchor).length - 1
    if (hits !== 1) {
      result.failures.push({
        id: patch.id,
        reason: hits === 0
          ? `anchor not found in ${patch.file}`
          : `anchor found ${String(hits)} times in ${patch.file}`,
      })
      continue
    }
    const next = patch.replace === undefined ? patch.anchor + patch.insert : patch.replace
    writeFileSync(path, source.replace(patch.anchor, next))
    result.applied.push(patch.id)
  }
  return result
}

/**
 * 热记忆的行为自检: 打完补丁真跑一次 `roundsFromEvents`
 *
 * 文本断言只能证明"替换发生过", 证明不了"行为对". 上游换个写法、补丁换种实现,
 * 只要行为对就该绿; 行为不对就该红 —— 这条判据钉的是行为
 *
 * @param {string} packageRoot - mneme 包根
 * @returns {Promise<{ unanswered: number, answered: number }>} 两组输入的轮次数
 */
export async function verifyHotMemory(packageRoot) {
  const entry = join(packageRoot, 'lib', 'hot-memory.js')
  if (!existsSync(entry)) throw new Error(`hot-memory.js is missing under ${packageRoot}`)
  const module = await import(`${pathToFileURL(entry).href}?luwi-check=${String(Date.now())}`)
  if (typeof module.roundsFromEvents !== 'function') {
    throw new Error(`${entry} does not export roundsFromEvents`)
  }
  const userOnly = [{
    type: 'user/message',
    seq: 1,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
  }]
  // 两种世界都认:
  //   - 旧版 (0.13.x): 我们那条补丁把 pending 轮整段删掉 → 不带参数调用就是 0 条
  //   - 0.15.0 起: 上游用 `omitPendingRound` 开关自己实现了 → 带参调用才是 0 条,
  //     此时还必须确认 *真的有人传 true* (lib/inject.js), 否则开关等于没接线
  const legacy = module.roundsFromEvents(userOnly, 5, new Set([1]))
  const withOmit = module.roundsFromEvents(userOnly, 5, new Set([1]), { omitPendingRound: true })
  if (legacy.length !== 0 && withOmit.length !== 0) {
    throw new Error(`an unanswered round still reaches hot memory: default=${JSON.stringify(legacy)} omitPendingRound=${JSON.stringify(withOmit)}`)
  }
  /** @type {{ omitPendingRound?: boolean }} */
  let opts = {}
  if (legacy.length !== 0) {
    const injectPath = join(packageRoot, 'lib', 'inject.js')
    const inject = existsSync(injectPath) ? readFileSync(injectPath, 'utf8') : ''
    if (!/omitPendingRound\s*:\s*true/.test(inject)) {
      throw new Error('上游有 omitPendingRound 开关, 但 lib/inject.js 没有传 true —— 热记忆修复没接线')
    }
    opts = { omitPendingRound: true }
  }
  const unanswered = legacy.length === 0 ? legacy : withOmit
  const answered = [
    ...userOnly,
    {
      type: 'assistant/message',
      seq: 2,
      data: { source: { kind: 'assistant' }, message: { content: [{ type: 'text', text: '在' }] } },
    },
  ]
  const rounds = module.roundsFromEvents(answered, 5, new Set([1, 2]), opts)
  if (rounds.length !== 1 || rounds[0]?.response !== '在') {
    throw new Error(`an answered round did not reach hot memory: ${JSON.stringify(rounds)}`)
  }
  return { unanswered: unanswered.length, answered: rounds.length }
}
