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

/* ── 结果 ─────────────────────────────────────────────────────────────── */

console.log(`\n${checks - failures}/${checks} passed`)
if (failures > 0) process.exitCode = 1
