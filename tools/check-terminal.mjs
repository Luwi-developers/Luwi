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

/* ── 结果 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} passed`)
if (failures > 0) process.exitCode = 1
