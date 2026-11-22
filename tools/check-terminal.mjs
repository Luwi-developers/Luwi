/**
 * 终端口径的方向闸 (2.8.1 #48; 2026-11-21 修整)
 *
 * 这一份钉的是「终端 = 手机管电脑」这条口径的**方向闸**, 不碰真机:
 *
 *   ① 回环判据只认四个本机写法 (其余一律不放行)
 *   ② 角色派生: 手机 (控制器) 不听不收指令, 电脑照旧全开
 *   ③ 写面 / 本机发送 / peer-live 三条都过 `isLocalRequest`, 入站 send 看 `acceptSend`
 *   ④ 行为断言文件 (`test/terminal-direction.test.mjs`) 真能跑 (六个用例)
 *   ⑤ 沙盒终端 (原 2.8.0 #32 的 `/luwi-sync/term` + 侧边栏面板) 整条下线: 面板入口、
 *      路由、`lib/term-channel.mjs` 一个都不该再在
 *
 * 跑法: node tools/check-terminal.mjs   (不需要设备, 也不需要 host)
 */

import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const client = await read('host-plugins/luwi-dsh-sync/lib/client.js')
const routes = await read('host-plugins/luwi-dsh-sync/lib/panel-routes.mjs')

let failures = 0
let checks = 0
function check(name, got, want) {
  checks += 1
  const same = JSON.stringify(got) === JSON.stringify(want)
  if (!same) failures += 1
  console.log(
    `${same ? 'ok  ' : 'FAIL'} ${name}`
      + (same ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`),
  )
}

/* ── 终端口径: 只由手机管电脑 (2026-11-21, 落实表 #48) ─────────────────── */

{
  const loopback = await read('host-plugins/luwi-dsh-sync/lib/loopback.mjs')
  const peerRuntime = await read('host-plugins/luwi-dsh-sync/lib/luwi-peer-runtime.mjs')
  const peerSource = await read('host-plugins/luwi-dsh-sync/lib/luwi-peer.mjs')
  const directionTest = await read('host-plugins/luwi-dsh-sync/test/terminal-direction.test.mjs')
  const { LOOPBACK_ADDRESSES, isLoopbackAddress, isLoopbackRequest } = await import(
    new URL('host-plugins/luwi-dsh-sync/lib/loopback.mjs', root)
  )
  const { resolvePeerSpec } = await import(
    new URL('host-plugins/luwi-dsh-sync/lib/luwi-peer.mjs', root)
  )

  check('回环判据只在四个本机写法上放行', [
    LOOPBACK_ADDRESSES.every((address) => isLoopbackAddress(address)),
    isLoopbackAddress('192.168.1.20'),
    isLoopbackAddress(undefined),
    isLoopbackRequest({ socket: { remoteAddress: '::1' } }),
    isLoopbackRequest({ method: 'POST' }),
  ], [true, false, false, true, false])

  check('角色派生: 手机不听不收指令, 电脑照旧', [
    resolvePeerSpec({ token: 'x'.repeat(24) }, { controller: true }).listen,
    resolvePeerSpec({ token: 'x'.repeat(24) }, { controller: true }).acceptSend,
    resolvePeerSpec({ token: 'x'.repeat(24) }).listen,
    resolvePeerSpec({ token: 'x'.repeat(24) }).acceptSend,
  ], [false, false, true, true])

  // 2026-11-21 晚 (主人: 单向): 面板那条本机发送路整条下线 —— 电脑不再往手机发指令;
  // 手机管电脑走门户终端 (归属方闸 -> peer/send), 所以 peer-live 那道回环闸还在
  check('面板写面 / peer-live 都过那道闸, 面板发送路已下线, 入站 send 看 acceptSend', [
    /LOOPBACK_ONLY_ERROR/u.test(loopback),
    (routes.match(/isLocalRequest\(req\)/gu) ?? []).length >= 1,
    (peerRuntime.match(/isLocalRequest\(req\)/gu) ?? []).length >= 1,
    peerRuntime.includes('/luwi-sync/send'),
    /spec\.acceptSend !== true/u.test(peerRuntime),
    /acceptSend: mode === 'queue'/u.test(peerSource),
  ], [true, true, true, false, true, true])

  check('那份行为断言真能跑 (terminal-direction 六个用例)', [
    (directionTest.match(/^test\(/gmu) ?? []).length,
    directionTest.includes('does not accept cross-device commands'),
    directionTest.includes('loopback-only'),
  ], [6, true, true])

  // 2026-11-21 主人: 沙盒终端 (在手机的 Linux 沙盒里跑命令) 与同步无关, 整条下线
  check('沙盒终端整条下线: 面板入口 / /term 路由 / term-channel 都不在', [
    client.includes('luwi-term'),
    client.includes('termStatus'),
    /path:\s*`\$\{PANEL_PREFIX\}\/term`/u.test(routes),
    routes.includes('runTerm'),
  ], [false, false, false, false])

  // 2026-11-21 晚 (主人: 侧边栏又没有 luwi终端 了): 左座位必须 (1) 显示名是 luwi终端,
  // (2) 先于右座位装, (3) 装不上要 console.warn —— 以前那一处是 `catch {}`, 入口无声消失
  check('侧边栏 luwi终端: 显示名 / 先装左座位 / 失败要出声', [
    /name: 'sidebar\.panellist', id: LEFT_PANEL_ID, order: 40, label: \(\) => t\('luwi终端'\)/u.test(client),
    client.indexOf('installLeftSeat(ctx)') > 0 && client.indexOf('installLeftSeat(ctx)') < client.indexOf('installRightSeat(ctx)'),
    /left seat not registered/u.test(client),
  ], [true, true, true])

  let channelGone = false
  try {
    await read('host-plugins/luwi-dsh-sync/lib/term-channel.mjs')
  } catch {
    channelGone = true
  }
  check('lib/term-channel.mjs 已经删掉', channelGone, true)
}

/* ── 2026-11-22 主人: "将仓库以下的面板全部删除" ───────────────────────── */

{
  const panel = await read('host-plugins/luwi-dsh-sync/lib/client.js')
  check('面板只剩配对卡与仓库卡 (镜像读数 / 操作 / 对端 / P2P / 运行结果五块整块撤掉)', [
    panel.includes('function renderOverview'),
    panel.includes('function renderOpsCard'),
    panel.includes('function renderPeerCard'),
    panel.includes('function renderP2pCard'),
    panel.includes('function renderAnswer'),
    panel.includes('function renderRepoCard'),
    panel.includes('function renderPairCard'),
  ], [false, false, false, false, false, true, true])

  check('配对卡排在仓库卡之前; 动作失败仍有一处出口 (状态条下面那一行)', [
    panel.indexOf('renderPairCard(),') < panel.indexOf('renderRepoCard(),'),
    panel.includes("h('div', { className: 'luwi-sync-bad', key: 'action-error' }, pairError)"),
    panel.includes('setPairError(String(error ?? `HTTP ${status}`))'),
  ], [true, true, true])

  check('手机侧那块只读面板还在 (bridge runner 的读数不走这一刀)', [
    panel.includes('function renderPhonePanel'),
    panel.includes('renderPhonePanel(mount, config, deviceName)'),
  ], [true, true])

  // 2026-11-22: P2P 那三件跟着面板一起撤掉之后, 只剩 /sync p2p 这一条路 —— 命令在, 且与面板写的是
  // 同一个文件 / 同一张信任表 (applyConfigure 的 p2p 段 + p2pConfirmPeer / p2pRevokePeer)
  const host = await read('host-plugins/luwi-dsh-sync/index.mjs')
  const renderer = await read('host-plugins/luwi-dsh-sync/lib/render.mjs')
  const words = await read('host-plugins/luwi-dsh-sync/lib/command-words.mjs')
  check('P2P 三件挪进 /sync p2p: 动作词中文为主 (英文留别名), 帮助里点得到', [
    /action === 'p2p'/u.test(host),
    host.includes('const what = normalizeP2pAction(rest[0])'),
    words.includes("text === '状态'"),
    words.includes("text === '开' || text === '打开'"),
    words.includes("text === '关' || text === '关闭'"),
    words.includes("text === '确认' || text === '确认换机'"),
    words.includes("text === '吊销' || text === '撤销'"),
    host.includes('/sync p2p [状态]'),
    host.includes('/sync p2p 开|关'),
  ], [true, true, true, true, true, true, true, true, true])
  check('命令与面板写同一批口: applyConfigure 的 p2p 段 + 两张信任表函数', [
    host.includes('await applyConfigure(syncConfigFile, { p2p: { enabled } })'),
    host.includes('const answer = await p2pConfirmPeer(deviceId)'),
    host.includes('const answer = await p2pRevokePeer(deviceId)'),
    renderer.includes('export function renderP2pState'),
    renderer.includes('开关: /sync p2p 开|关'),
  ], [true, true, true, true, true])
  check('P2P 那几行人话是中文 (状态 / 传输 / 信任 / 计数 / 冷却 / 等确认换机)', [
    renderer.includes('`  信任: ${trust}${sas}`'),
    renderer.includes('`  计数: 发出 ${state?.sent ?? 0}'),
    renderer.includes("冷却中: 上一次没成"),
    renderer.includes('等确认换机:'),
    renderer.includes('最近错误:'),
  ], [true, true, true, true, true])
}

/* ── 2026-11-22 终端问答: 电脑上的问答传到手机, 答不回来就按自定义回答继续 ────── */

{
  const host = await read('host-plugins/luwi-dsh-sync/index.mjs')
  const ask = await read('host-plugins/luwi-dsh-sync/lib/luwi-ask.mjs')
  const live = await read('host-plugins/luwi-dsh-sync/lib/luwi-live.mjs')
  const runtime = await read('host-plugins/luwi-dsh-sync/lib/luwi-peer-runtime.mjs')
  const words = await read('host-plugins/luwi-dsh-sync/lib/command-words.mjs')
  const configure = await read('host-plugins/luwi-dsh-sync/lib/luwi-configure.mjs')
  const askTest = await read('host-plugins/luwi-dsh-sync/test/luwi-ask.test.mjs')

  check('问答中继的四档与那一句自定义回答都在 (纯算术只住一份)', [
    ask.includes("export const ASK_MODES = Object.freeze(['off', 'notify', 'relay', 'auto'])"),
    ask.includes('export function resolveAskSpec'),
    ask.includes('export function createAskRelay'),
    ask.includes('export function parseAskReply'),
    ask.includes('我替你定了'),
    ask.includes('export const TERMINAL_BRIEF'),
    host.includes('createAskRelay(askSpec'),
  ], [true, true, true, true, true, true, true])

  // 必须 prepend: dsh 自己的问答卡片也挂在这个 waterfall 上 (客户端 remote 监听), 晚一步就
  // 只能眼看着 PC 的卡片弹出来而手机永远不知道有这一问
  check('接管请求走 prepend, 只对"手机驱动的那一场"生效, 电脑本地照旧 next()', [
    /ctx\.on\('user-questions\/request', \(request, next\) => handleUserQuestion\(request, next\), \{ prepend: true \}\)/u.test(host),
    host.includes('if (!isPeerDriven(sessionId)) return next()'),
    host.includes('const askRelayOn = askSpec.mode !== \'off\' && controller === false && peerSpec !== null'),
  ], [true, true, true])

  // 手机上那一行: 合成条目走 condense 的 extra (进 entries, 不进 all), seq 取 tool/call 的
  check('问题那一行进快照但不算对话账, seq 取 tool/call 的真号', [
    host.includes('extra: askExtraEntries(sessionId)'),
    live.includes('const extra = Array.isArray(options.extra)'),
    host.includes('noteAskCall(sessionId, data.callId, event.seq, event.time, questions)'),
    ask.includes('seq: item.ask.seq + 0.5'),
  ], [true, true, true, true])

  // 问一句不改会话日志: 不抬 /peer/info 的 updatedAt, 手机那一侧永远不会重新取快照
  check('/peer/info 的 revision 被问题抬起来 (否则手机不来取)', [
    host.includes('const askedAt = askRelayOn ? askRelay.askedAt(id) : 0'),
    host.includes('updatedAt: Math.max(Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : 0, askedAt)'),
    host.includes('summariesCache.at = 0'),
  ], [true, true, true])

  // 回答那一侧: 在投递之前问 answerAsk —— 卡在工具里的那一轮读不到 steer 进来的话
  check('手机回的答案先问 answerAsk, 命中就不投递 (顺序不能反)', [
    runtime.includes('const answered = await deps.answerAsk(sessionId, text)'),
    runtime.indexOf('deps.answerAsk') < runtime.indexOf('deps.makeUserMessage'),
    host.includes('answerAsk: answerAskFromPeer'),
  ], [true, true, true])

  // 终端提示只追加一条上下文消息, 绝不改主人发的那句话 (回声去重只比人话)
  check('终端提示走 pre-step 的独立上下文消息, 正文一个字都不动', [
    host.includes("source: { kind: PLUGIN_NAME, form: 'snapshot', sections: [{ name: PLUGIN_NAME, text }] }"),
    host.includes('briefTerminalStep(payload, next, briefText)'),
    host.includes('ASK_BRIEF_AGAIN_MS'),
    // 中继关着时换那一份 (别教它"回 1"); 两份都在纯算术那一层
    host.includes('const briefText = askRelayOn ? TERMINAL_BRIEF : TERMINAL_BRIEF_LOCAL'),
    ask.includes('export const TERMINAL_BRIEF_LOCAL'),
  ], [true, true, true, true, true])

  check('/sync ask 四个动作 (中文为主) + ask 段写面 + doctor 读数', [
    host.includes("if (action === 'ask')"),
    host.includes('/sync ask [状态]'),
    words.includes("text === '提示'"),
    words.includes("text === '中继'"),
    configure.includes("ASK: 'ask',"),
    configure.includes('ask.mode must be one of'),
    host.includes('问答: ${askSpec.mode}'),
  ], [true, true, true, true, true, true, true])

  // 快照版本不动: 条目形状没变, 老手机插件照样折得动 (升版本会让老投影重做一场)
  check('LIVE_SNAPSHOT_VERSION 仍是 3 (问答条目不改快照形状)', [
    live.includes('export const LIVE_SNAPSHOT_VERSION = 3'),
    host.includes('LIVE_SNAPSHOT_VERSION, LIVE_SNAPSHOT_VERSION_LEGACY'),
  ], [true, true])

  check('那一份行为断言真能跑 (luwi-ask 的用例都在)', [
    (askTest.match(/^test\(/gmu) ?? []).length >= 20,
    askTest.includes('createAskRelay'),
    askTest.includes('parseAskReply'),
    askTest.includes('normalizeAskAction'),
  ], [true, true, true, true])
}

/* ── 结果 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} passed`)
if (failures > 0) process.exitCode = 1
