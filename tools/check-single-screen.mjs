/**
 * 虚拟屏"同一时刻只允许一块"的判据
 *
 * 这条限制有两层实现 (应用那一侧先关旧再建, 特权那一侧最后一道闸), 还有两处把它说给模型听的地方
 * (工具描述与建屏答案)。任何一处漂开, 现象都是"能开出第二块屏"或"模型以为旧屏还在" —— 都是
 * 一次误操作就能踩到的, 而它们在真机上要开着 Shizuku 才验证得了
 *
 * 这里量的是源码与工具定义, 不需要设备:
 *
 *   1. 特权侧建屏前真的先放掉已有的每块屏
 *   2. 应用侧的建屏路径先关本地状态, 再把唯一那块屏落进列表
 *   3. 桥的建屏答案带着"被替换的是哪一块"
 *   4. 插件把这条规则写进 `lw_screen_create` 的描述, 并在答案里念出来
 *   5. 模型可以省略 displayId (省略时补手里那块), 但事件订阅不补 (省略等于全看)
 *
 * 用法: node tools/check-single-screen.mjs
 * 退出码: 0 = 每一条都成立; 1 = 有失败项 (逐条印出文件与原因)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const check = (() => {
  let failures = 0
  let checks = 0
  return {
    run(name, okay, detail = '') {
      checks += 1
      if (okay) {
        console.log(`ok   ${name}`)
      } else {
        failures += 1
        console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`)
      }
    },
    done() {
      console.log(`\n${checks - failures}/${checks} 条通过`)
      return failures === 0
    },
  }
})()

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

/* ── 源码: 两层闸都在 ───────────────────────────────────────────────────── */

const display = source('../app/src/main/java/io/github/yuloong07star/luwi/channel/LwVirtualDisplay.kt')
const virtual = source('../app/src/main/java/io/github/yuloong07star/luwi/channel/VirtualScreen.kt')
const bridge = source('../app/src/main/java/io/github/yuloong07star/luwi/channel/PrivilegedBridge.kt')
const capture = source('../app/src/main/java/io/github/yuloong07star/luwi/channel/LwCapture.kt')
const frames = source('../app/src/main/java/io/github/yuloong07star/luwi/channel/FrameCache.kt')

check.run(
  '特权侧: 建屏前先把已有的屏全放掉 (最后一道闸)',
  /screens\.isNotEmpty\(\)[\s\S]{0,200}?releaseAll\(\)/.test(display),
  'LwVirtualDisplay.create() 里要有 "if (screens.isNotEmpty()) releaseAll()"',
)
check.run(
  '应用侧: 建屏时先关旧屏的本地状态, 再建新的',
  virtual.includes('closeLocal(old, byUser = false, replaced = true)')
    && virtual.includes('screens = listOf(screen)'),
  'VirtualScreen.create() 要 closeLocal(...) 之后把列表换成单元素 listOf(screen)',
)
check.run(
  '应用侧: 屏的帧源是运行时那份缓存, 不是被删掉的 ScreenKeeper',
  virtual.includes('frames[id] = frame') && !virtual.includes('ScreenKeeper'),
  'ScreenKeeper 已由 FrameCache 取代, 建屏要把 FrameCache 记进 frames',
)
check.run(
  '帧源: ImageReader 带着合成器要的两个 usage 位',
  frames.includes('USAGE_GPU_COLOR_OUTPUT') && frames.includes('USAGE_GPU_SAMPLED_IMAGE'),
  'FrameCache 的 ImageReader.newInstance 必须带 usage, 否则合成器当这块屏没有有效输出',
)
check.run(
  '帧源: 有预览时按帧间隔镜像, 没有预览时只缓存',
  frames.includes('previewGapFor') && frames.includes('FRAME_KEEP_MS')
    && /val interval = if \(target != null\) previewGap else FRAME_KEEP_MS/u.test(frames),
  '没有预览时按 FRAME_KEEP_MS 只留最新一帧, 有预览时按 previewGapFor() 算出的间隔镜像'
    + ' (旧的 PREVIEW_GAP_MS 常量已被那支纯函数取代, 这条判据跟着改口径)',
)
check.run(
  '桥: 建屏答案带着被替换的那一块',
  bridge.includes('put("replaced"') && bridge.includes('put("replacedLabel"'),
  'PrivilegedBridge 的 create 分支要回 replaced / replacedLabel',
)
check.run(
  '截图: 虚拟屏不再走特权侧的 screencap',
  capture.includes('capturePrimary') && !capture.includes('fun capture('),
  'LwCapture 应只剩 capturePrimary (display 0), 虚拟屏的帧在 FrameCache 里',
)

/* ── 主页: 错误只弹一次, 且不看屏的时候也弹 (2.8.0 B2-c) ────────────────── */

const home = source('../app/src/main/java/io/github/yuloong07star/luwi/ui/HostScreen.kt')
check.run(
  '主页: 屏没选中时也不再常驻一行「虚拟屏: …」',
  !home.includes('text = "虚拟屏: $reason"'),
  '失败那句话以前挂在 `selected == null` 那一支上, 要等下一次成功才消失',
)
check.run(
  '主页: 错误 Dialog 与浮标同级 (有没有屏在看都会弹), 不是只挂在"没屏"那一支上',
  /FloatingBall\([\s\S]{0,900}?screenError\?\.let \{ reason ->\n\s*OverlayDialog\(/u.test(home),
  '弹窗要放在 Box 那一层, 紧跟 FloatingBall —— 挂在 selected == null 里面就变成"有屏时不报错"',
)
check.run(
  '主页: 同一句 reason 30 s 内只弹一次',
  home.includes('screenErrorOnce.take(reason, SystemClock.uptimeMillis())')
    && home.includes('internal const val SCREEN_ERROR_WINDOW_MS = 30_000L'),
  '去重状态要挂在文件级 (remember 会在离开组合时丢掉)',
)

/* ── 插件: 工具定义与答案 ────────────────────────────────────────────────── */

const registered = []
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  },
  on() {},
}

const plugin = await import(pathToFileURL(resolve('host-plugin/index.mjs')).href)
plugin.apply(ctx)

const create = registered.find((tool) => tool.name === 'lw_screen_create')
check.run('插件: 有 lw_screen_create', create !== undefined)
check.run(
  '插件: 描述里写清"同时只能一块, 建新的先关旧的"',
  typeof create?.description === 'string'
    && /only one virtual screen/i.test(create.description)
    && /closes the screen that is already/i.test(create.description),
  'lw_screen_create.description 要写明这条硬限制',
)
check.run(
  '插件: 答案里念出被关掉的那一块',
  source('../host-plugin/index.mjs').includes('may exist at a time, so the screen that was there'),
  'formatCreated 要在 replaced > 0 时说清楚',
)
check.run('插件: 有 lw_wait_text', registered.some((tool) => tool.name === 'lw_wait_text'))
check.run(
  '插件: lw_ocr 有调试图开关',
  registered.find((tool) => tool.name === 'lw_ocr')
    ?.parameters?.properties?.debug !== undefined,
  'lw_ocr 的 debug 参数要在',
)

// `register` 收到的是 defineTool 编译过的参数 schema: 参数在 properties 里, 必填在 required 里
const withDisplay = registered.filter((tool) => tool.parameters?.properties?.displayId !== undefined)
check.run(
  '插件: displayId 一律可以省略 (省略时补手里那块)',
  withDisplay.length > 10
    && withDisplay.every((tool) => !(tool.parameters?.required ?? []).includes('displayId')),
  `${withDisplay.length} 个带 displayId 的工具里仍有标成必填的`,
)
check.run(
  '插件: 事件订阅的 displayId 不注入默认值',
  source('../host-plugin/index.mjs').includes("const WATCH_ALL_TOOLS = new Set(['lw_events_subscribe', 'lw_events_wait'])"),
  '省略事件订阅的 displayId 等于"全看", 补进去会把它静默改成"看这块"',
)
check.run(
  '插件: 请求有超时上限 (应用不回话时不永久挂住)',
  source('../host-plugin/index.mjs').includes('const REQUEST_TIMEOUT_MS = 150_000'),
  'request() 里那个定时器与常量都要在',
)
check.run(
  '插件: 视频模式拒绝表带上 lw_wait_text',
  source('../host-plugin/index.mjs')
    .slice(source('../host-plugin/index.mjs').indexOf('const VIDEO_MODE_DENIED'), source('../host-plugin/index.mjs').indexOf('])', source('../host-plugin/index.mjs').indexOf('const VIDEO_MODE_DENIED')))
    .includes("'lw_wait_text'"),
  'VIDEO_MODE_DENIED 要加 lw_wait_text (它是读屏类)',
)

if (!check.done()) process.exit(1)
