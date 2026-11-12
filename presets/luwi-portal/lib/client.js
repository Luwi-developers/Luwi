/**
 * Luwi 的门户界面 (2026-11-07)
 *
 * **这是盖在 dsh 对话界面上的一层, 不是另一场会话**: 它认 `$DSH_HOME/voice/session.json` 那本账
 * (`{id, at, origin, cwd}`), 而球说话时宿主 `voiceCurrentSession()` 认的也是这一本 —— 于是"在应用里
 * 说"与"在外面用球说"落在同一个 sessionId 上, 两边看到同一个消息流
 *
 * 三条纪律:
 *
 * 1. **只读 dsh 的会话快照, 不自己造消息**: 消息从 `ctx.uiConversation.binding(...).target('chat')`
 *    的快照里取 durable 节点 (user / assistant / turn-error); 过程类节点 (reasoning / tool / 步骤) 一律
 *    不画 —— 这一层是"门户", 只显示人话
 * 2. **判断层只显示宿主判过的结果**: `router.json` 的 `last` / `checks` 与 `sim.json` 的阈值原文,
 *    由 `window.LuwiPortal.portalStatus()` 原样读出; 点「敲钟」投的就是 `RouterTick` 那条收件箱行, 与
 *    定时敲钟同一个入口 (判断永远只在宿主那一处)
 * 3. **写好读回**: 每次动作之后重新拉一次 `portalStatus()`, 界面显示的就是文件里的事实
 *
 * **这一份不是普通的 ESM**: dsh 的客户端模块按 `window.__ModuleLoader__.load({ id, factory })` 装载,
 * 写成 `export ...` 会被当成经典脚本解析 (与 `luwi-ui-fix` 同一个坑, 2026-10-17 踩过)
 *
 * 界面用原生 DOM 写, 不走 React: 这一层要能整块撤掉, 而且它渲染的东西 (气泡与面板) 与 dsh 的组件
 * 没有复用关系, 引 React 只会把这一包的构建链拖进来
 */
window.__ModuleLoader__.load({
  id: 'luwi-portal',
  // 2026-11-09: 预览窗要借 `lw-docx-preview` 那份 Office 渲染器 (按包名从模块表里 require),
  // 所以这一层要把 factory 的 require 收进来 —— 它是同步的, 只在真的要解一份文件时才调
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    /** 模块表的 require (取不到时退回 `window.__LW_OFFICE__`, 见 [officeRenderer]) */
    var hostRequire = typeof require === 'function' ? require : null

    /** 开关: `on` / `off`; 关掉之后右下角留一个小圆点可以再打开 */
    var SWITCH = 'dsh.luwi.portal'
    /** 账本轮询间隔: 球的 10 分钟窗口一过就会换场, 门户要跟过去 */
    var LEDGER_POLL = 3000
    /** 重绘节流: 流式期间快照会连着变 */
    var RENDER_MS = 120
    /** `lw/face.json` 的缓存键: 背景图一次几百 KB, 换一张才搬一次 */
    var WALL_CACHE = 'dsh.luwi.portal.wall'
    /**
     * 头像那张图的缓存键 (2026-11-10, 与背景同一个套路: 版本没变就不搬图)
     *
     * 头像比背景小得多 (<=512px), 但它每次挂载都要用一次 —— 不缓存就是每次开都多搬一份 base64
     */
    var AVATAR_CACHE = 'dsh.luwi.portal.avatar'
    /** 没有自定义昵称时头栏与空态显示的那个名字 (设置里留空 = 回这一个) */
    var DEFAULT_NAME = 'Luwi'
    /**
     * 这一层自己记住的那一场 (2026-11-08 主人: "下次会话还在这个界面, 可看见之前的对话")
     *
     * 为什么不靠 dsh 的 mainView: 收起门户时 `hide()` 会开一张新对话 (旧口径), 冷启动时
     * dsh 恢复的也可能是别的一场 —— 门户要的是"上次我画的那一场", 只有自己记才稳。
     * 键与开关同一个 origin (`http://127.0.0.1:3080`), WebView 的 localStorage 是持久的
     */
    var SESSION_KEY = 'dsh.luwi.portal.session'
    /** 时间分段: 相邻两条隔这么久以上就另起一段 (2026-11-08 主人: "对话 30min 后分段") */
    var SECTION_GAP_MS = 30 * 60 * 1000

    /**
     * `+` 上那个加号: dsh 的 `IconPlusOutlineMedium` 就这两笔 —— 与 `presets/ui-fix` 同一条分寸
     * (只借形状, 不复制组件)
     */
    var PLUS_ICON = [
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
      '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    ].join('')

    var CHEVRON_ICON = [
      '<svg class="lwp-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none"',
      ' stroke-width="1.5" aria-hidden="true">',
      '<path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6"',
      ' stroke="currentColor"></path></svg>',
    ].join('')

    /** 发送钮的两副面孔: 箭头与转圈 (dsh 的 `.primary` 用的就是这两条 path) */
    var SEND_ICON = [
      '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">',
      '<path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297',
      ' 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577',
      'L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233',
      'C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"',
      ' fill="currentColor"/></svg>',
    ].join('')

    var SPIN_ICON = [
      '<svg class="lwp-spin" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">',
      '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="2"/>',
      '<path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="2"',
      ' stroke-linecap="round"/></svg>',
    ].join('')

    /**
     * 表情那颗 (2026-11-09 主人: "`+` 的右边增加表情包图标")
     *
     * 只有一张笑脸: 那个按钮上**一个字都不放**, 面板里也一样 (主人的原话是"不能有文字")
     */
    var STICKER_ICON = [
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
      '<circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.4"/>',
      '<path d="M5.5 9.6c.55.85 1.45 1.4 2.5 1.4s1.95-.55 2.5-1.4" stroke="currentColor"',
      ' stroke-width="1.4" stroke-linecap="round"/>',
      '<circle cx="6.1" cy="6.5" r="0.85" fill="currentColor"/>',
      '<circle cx="9.9" cy="6.5" r="0.85" fill="currentColor"/></svg>',
    ].join('')

    /** 预览窗右上那颗关闭: 两笔交叉, 与 dsh 的 `IconCloseOutlineMedium` 同一分寸 */
    var CLOSE_ICON = [
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
      '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5"',
      ' stroke-linecap="round"/></svg>',
    ].join('')

    /** 文件名前面那张小纸 (只借形状: 一张折角纸, 14px) */
    var FILE_ICON = [
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
      '<path d="M9 1.75H4.75A1.75 1.75 0 0 0 3 3.5v9a1.75 1.75 0 0 0 1.75 1.75h6.5A1.75 1.75 0 0 0 13 12.5V5.75L9 1.75Z"',
      ' stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
      '<path d="M9 1.75v4h4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    ].join('')

    /* MARK_PNG:BEGIN */
    /** 品牌标记: 由 tools/make-portal-mark.py 生成, 别手改 (改了重跑就覆盖回来) */
    var MARK_PNG = 'data:image/png;base64,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'
    /* MARK_PNG:END */

    // ── 小工具 ────────────────────────────────────────────────────────────────

    function h(tag, cls, text) {
      var node = document.createElement(tag)
      if (cls) node.className = cls
      if (text !== undefined && text !== null) node.textContent = String(text)
      return node
    }

    /**
     * 边缘划入的接管 (2026-11-08)
     *
     * dsh-web-mobile 3.3.0 自己那条在这套 WebView 上会被打断 —— 真机探针读数:
     * `pointerdown(x=60) → 插件在轴锁那一刻 toggle 开 (collapsed→false) → 86ms 后收到 pointercancel
     * → 它自己的 release 走 !wasTracking → commitFollowClose → 0.6s 后又 collapsed→true`。
     * 净效果是"划一下什么都不发生", 或者"一开就弹回"。cancel 的源头在宿主与插件那一侧 (抽屉打开时
     * 中心列被加 inert, 插件自己还换过一次子树), 指针目标离开命中树 Chromium 就 cancel, 而那段 JS
     * 在包里, 我们改不到。
     *
     * 这里在**窗口捕获阶段**先吃掉"左边缘起划"那串 pointermove: 插件的轴锁就是靠 move 判的, 收不到
     * move 等于没看见这一划; 然后自己在轴锁那一刻提交 (跟不了手 —— 这套 WebView 划几十 px 就把指针
     * cancel 掉, 所以不做 follow 动画, 交给宿主的 .28s transition 收尾)。轻点 (没有移动) 一个事件
     * 都不吞, 于是左上那颗开关按钮、抽屉里头的一切点击都不受影响
     */
    var EDGE_ZONE = 96
    var EDGE_LOCK_PX = 24
    var EDGE_MIN_PX = 8

    function installEdgeSwipe(ctx) {
      if (typeof window === 'undefined' || window.__LW_EDGE_SWIPE__) return
      window.__LW_EDGE_SWIPE__ = 1
      var startX = 0
      var startY = 0
      var armed = false
      var grabbed = false

      function drawerOpen() {
        var node = document.querySelector('[data-mobile-nav="frame"]')
        return node !== null && !node.hasAttribute('data-sidebar-collapsed')
      }

      function openDrawer() {
        try {
          var layout = typeof ctx.get === 'function' ? ctx.get('layout') : ctx.layout
          if (layout && typeof layout.toggleSidebar === 'function') layout.toggleSidebar()
        } catch (_noLayout) {
          // 服务不在就什么都不做, 至少不把页面搞坏
        }
      }

      window.addEventListener('pointerdown', function (event) {
        grabbed = false
        armed = false
        if (event.pointerType === 'mouse' && event.buttons !== 1) return
        if (drawerOpen()) return
        if (event.clientX > EDGE_ZONE) return
        armed = true
        startX = event.clientX
        startY = event.clientY
      }, { capture: true, passive: false })

      window.addEventListener('pointermove', function (event) {
        if (!armed) return
        var dx = event.clientX - startX
        var dy = event.clientY - startY
        if (Math.abs(dx) < EDGE_MIN_PX) return
        // 纵向为主、或者往回走, 都不算这一划 (还回去给页面滚动)
        if (dx <= 0 || Math.abs(dx) <= Math.abs(dy)) {
          armed = false
          grabbed = false
          return
        }
        grabbed = true
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
        if (dx < EDGE_LOCK_PX) return
        armed = false
        openDrawer()
      }, { capture: true, passive: false })

      window.addEventListener('pointerup', function (event) {
        var wasGrabbed = grabbed
        armed = false
        grabbed = false
        if (!wasGrabbed) return
        event.stopImmediatePropagation()
      }, true)

      window.addEventListener('pointercancel', function () {
        // 提交已经发生在轴锁那一刻, 这里只做清理
        armed = false
        grabbed = false
      }, true)
    }

    function clock(ms) {
      var date = new Date(Number(ms) || Date.now())
      var hh = String(date.getHours()).padStart(2, '0')
      var mm = String(date.getMinutes()).padStart(2, '0')
      return hh + ':' + mm
    }

    /** 本地时区的那一天: 分段除了看 30 分钟, 跨了午夜也要另起一段 */
    function dayKey(ms) {
      var value = Number(ms)
      if (!isFinite(value) || value <= 0) return ''
      var date = new Date(value)
      return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate()
    }

    /**
     * 分段章上那句话: 今天 / 昨天 说相对, 今年内说月日, 跨年才带年份
     *
     * 用相对或本地化日期 (不是 `11/08` 那种两义写法): 这一段是给人看"什么时候聊的",
     * 不是给机器排序的
     */
    function stamp(ms) {
      var value = Number(ms)
      if (!isFinite(value) || value <= 0) return ''
      var date = new Date(value)
      var now = new Date()
      var time = clock(value)
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      var day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      var away = Math.round((today - day) / 86400000)
      if (away === 0) return '今天 ' + time
      if (away === 1) return '昨天 ' + time
      var monthDay = (date.getMonth() + 1) + '月' + date.getDate() + '日 '
      if (date.getFullYear() === now.getFullYear()) return monthDay + time
      return date.getFullYear() + '年' + monthDay + time
    }

    function readSwitch() {
      try {
        return localStorage.getItem(SWITCH) === 'off' ? 'off' : 'on'
      } catch (_unreadable) {
        return 'on'
      }
    }

    function writeSwitch(value) {
      try {
        localStorage.setItem(SWITCH, value)
      } catch (_storageRefused) {
        // 关不上也让这一页按内存里的选择走
      }
    }

    /** 记住"这一层上次画的是哪一场" (下次挂载先回到它) */
    function rememberSession(id) {
      if (typeof id !== 'string' || id === '') return
      try {
        localStorage.setItem(SESSION_KEY, id)
      } catch (_storageRefused) {
        // 存不下就每次落回 dsh 当前那一场, 不报错
      }
    }

    function recallSession() {
      try {
        var id = localStorage.getItem(SESSION_KEY)
        return typeof id === 'string' ? id : ''
      } catch (_unreadable) {
        return ''
      }
    }

    function forgetSession() {
      try {
        localStorage.removeItem(SESSION_KEY)
      } catch (_storageRefused) {
        // 清不掉也只是下次再判一次"它还在不在"
      }
    }

    /** 读一小段 JSON 形状的 localStorage (读不到 / 坏了都当没有) */
    function readStored(key) {
      try {
        var raw = localStorage.getItem(key)
        if (typeof raw !== 'string' || raw === '') return null
        return JSON.parse(raw)
      } catch (_unreadable) {
        return null
      }
    }

    /** 写一小段 JSON 形状的 localStorage (配额满了就让这次改动只活在内存里) */
    function writeStored(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (_storageRefused) {
        // 存不下就算了: 下一次挂载重新向桥上要
      }
    }

    /** 背景的不透明度: 认不出来回缺省那个数, 越界夹进 0..1 */
    function clampAlpha(value) {
      var number = Number(value)
      if (!isFinite(number)) return 0.4
      return Math.min(1, Math.max(0, number))
    }

    /** 一段错误给人看的样子: 有 message 用 message, 没有就 `String()` —— 日志里那一行要能读 */
    function describeError(error) {
      if (error && typeof error.message === 'string' && error.message !== '') return error.message
      return String(error)
    }

    /**
     * 把一次宿主调用收成 Promise
     *
     * 宿主那几个面 (`settings.update` / `catalog()` / `command()` / `directory.load()`) 在**没连上**时
     * 是**同步抛**的, 而 `Promise.resolve(x())` 拦不住它 —— 那一下会把 `apply()` 一起带走, 表现是
     * "这一层没挂上" (dsh 的日志只有一句 `1 entry did not activate`)。包一层之后同步抛也变成 reject
     */
    function settle(call) {
      return Promise.resolve().then(call)
    }

    /**
     * 全局默认权限拨到「完全权限」, **只写一次** (2026-11-08 主人: "默认完全权限")
     *
     * 写的是宿主 settings 里 `permission.defaultPreset` —— 那是"以后新开会话"的默认档, 于是新场
     * 天生就是完全权限, 不必每场再拨一次。**只做一次**: 主人之后在设置里改成别的档, 这一层不会
     * 把它改回来 (默认是默认, 不是强制)
     */
    function ensureDefaultPermission(ctx) {
      var DONE = 'dsh.luwi.portal.perm-default'
      try {
        if (localStorage.getItem(DONE) === '1') return
      } catch (_unreadable) {
        return
      }
      var remote
      try {
        remote = ctx.remote
      } catch (_noRemote) {
        return
      }
      var settings = remote && remote.settings
      if (!settings || typeof settings.update !== 'function') return
      settle(function () { return settings.update('permission', { defaultPreset: 'danger-full-access' }) }).then(function (result) {
        if (result && result.ok === false) return
        try {
          localStorage.setItem(DONE, '1')
        } catch (_storageRefused) {
          // 存不下就下次再试, 反正写的是同一个值
        }
      }).catch(function () {
        // 宿主没让写就留着, 场内那一手 (ensureFullAccess) 仍然在
      })
    }

    /** 桥: 页面与 app 之间那一座 (`window.LuwiPortal`, 见 HostScreen.kt 的 PortalBridge) */
    function bridge() {
      var api = typeof window === 'undefined' ? undefined : window.LuwiPortal
      return api && typeof api.portalStatus === 'function' ? api : null
    }

    /** 桥上每个方法都回一段 JSON 字符串; 认不出来就当没有 */
    function call(method, arg) {
      var api = bridge()
      if (api === null || typeof api[method] !== 'function') return null
      try {
        var raw = arg === undefined ? api[method]() : api[method](arg)
        if (typeof raw !== 'string' || raw === '') return null
        return JSON.parse(raw)
      } catch (_bad) {
        return null
      }
    }

    /**
     * 一条消息节点的正文: **只取文本块, 跳过 reasoning**
     *
     * 助手那一串 `blocks` 里 `{kind:'reasoning', text}` 与 `{kind:'text', text}` 都带 `text` 字段,
     * 不分判别字段就会把思考内容当正文画出来 (2026-11-07 真机上就是这样, 一段英文推理冒在回复上面)。
     * 用户消息那边用的是 `type`, 两套判别字段都认
     */
    function textOf(blocks) {
      if (!Array.isArray(blocks)) return ''
      var parts = []
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i]
        if (!block || typeof block !== 'object') continue
        if (block.kind !== 'text' && block.type !== 'text') continue
        if (typeof block.text === 'string' && block.text !== '') parts.push(block.text)
      }
      return parts.join('\n')
    }

    /** 图片那几种扩展名 (与宿主 `LW_IMAGE_EXTS` 同一个集合) */
    var IMAGE_EXTS = { png: 1, jpg: 1, jpeg: 1, webp: 1, gif: 1 }

    /** 门户里能当文本读的那几种 (与宿主 `LW_OUT_TEXT_TYPES` 对齐) */
    var TEXT_EXTS = { txt: 1, md: 1, csv: 1, log: 1, json: 1 }

    /**
     * 预览窗能自己解的 Office (2026-11-09) —— 与 `lw-docx-preview` 的 `renderOffice` 认的是同一组
     *
     * `doc` / `ppt` / `xls` 那三个老二进制格式**不在这一组里**: 页面解不开, 走"交给系统里的应用"
     */
    var OFFICE_EXTS = { docx: 1, pptx: 1, xlsx: 1 }

    /** 名字的文件名那一段 (路径也只取最后一段, 与宿主的 basename 口径一致) */
    function baseNameOf(name) {
      var text = String(name || '')
      var cut = text.lastIndexOf('/')
      if (cut >= 0) text = text.slice(cut + 1)
      return text
    }

    /** 去掉最后那个扩展名的名字 (表情那条路由按裸名字找文件) */
    function stemOf(name) {
      var text = baseNameOf(name)
      var dot = text.lastIndexOf('.')
      return dot > 0 ? text.slice(0, dot) : text
    }

    function extOf(name) {
      var text = baseNameOf(name)
      var dot = text.lastIndexOf('.')
      return dot > 0 ? text.slice(dot + 1).toLowerCase() : ''
    }

    function isImageName(name) {
      return IMAGE_EXTS[extOf(name)] === 1
    }

    function isTextName(name) {
      return TEXT_EXTS[extOf(name)] === 1
    }

    function isOfficeName(name) {
      return OFFICE_EXTS[extOf(name)] === 1
    }

    /** 取到的 Office 渲染器 (一次就够; null 表示还没问过 / 问过没有, 用 [officeTried] 分开) */
    var officeApi = null
    /** 问过一次就不再反复问模块表 (那一包中途挂上的情况由"重开一次预览窗"覆盖) */
    var officeTried = false

    /**
     * Office 渲染器 (2026-11-09): `lw-docx-preview` 那一包导出的 `renderOffice`
     *
     * **为什么不自己再打一份 docx-preview**: 那一包已经把 docx-preview + jszip 打进
     * `lib/client.js`, 而它本来就是"Office 在 Luwi 里怎么显示"的唯一实现 —— 右栏那个 tab 与这张
     * 预览窗读同一份, 于是不会出现"右栏能看、门户不能看"
     *
     * 三条退路按顺序: 模块表 `require('<包名>')` → `window.__LW_OFFICE__` (那一包 factory 跑过就挂上)
     * → null (调用处照实说"预览模块没挂上", 不摆假预览)。**懒取**: 首次点开文件时才查, 之后缓存,
     * 于是门户启动与那一包谁先起来都不影响
     * @returns {object | null} `{ renderOffice, isOfficeName }` 或 null
     */
    function officeRenderer() {
      if (officeApi !== null) return officeApi
      if (officeTried) return officeApi
      officeTried = true
      if (hostRequire !== null) {
        try {
          var got = hostRequire('lw-docx-preview')
          if (got && typeof got.renderOffice === 'function') {
            officeApi = got
            return officeApi
          }
        } catch (_noModule) {
          // 那一包没挂上 (或模块表里还没登记): 退下面的全局
        }
      }
      var fallback = typeof window !== 'undefined' ? window.__LW_OFFICE__ : null
      if (fallback && typeof fallback.renderOffice === 'function') officeApi = fallback
      return officeApi
    }

    /** 从文件名猜媒体类型 (表情变成 image 块时要用) */
    function mimeOfName(name) {
      var ext = extOf(name)
      if (ext === 'png') return 'image/png'
      if (ext === 'gif') return 'image/gif'
      if (ext === 'webp') return 'image/webp'
      if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
      return 'image/png'
    }

    /**
     * 把正文里的附件段拆出来 (`attachLines()` 写进去的那一段)
     *
     * 正文长这样:
     *
     * ```
     * 看这个
     *
     * [附件 2 个]
     * 1. /storage/emulated/0/DSH/lw-in/a.png
     * 2. /storage/emulated/0/DSH/lw-in/b.pdf
     * ```
     *
     * 返回 `{ main, names }`: `main` 是去掉附件段之后的正文 (气泡里只画人话), `names` 是她自己
     * 发过的那几个文件名。**为什么认这一段而不是认 image 块**: 会话落盘只留 attachment 引用,
     * 字节在快照里没有 —— 门户只能从自己写进正文的路径把图找回来
     */
    function splitAttach(text) {
      var src = String(text === undefined || text === null ? '' : text)
      var head = '\n\n[附件 '
      var at = src.indexOf(head)
      if (at < 0) return { main: src, names: [] }
      var tail = src.slice(at + head.length)
      var names = []
      var lines = tail.split('\n')
      for (var i = 0; i < lines.length; i += 1) {
        var match = /^\s*\d+\.\s+(.+?)\s*$/.exec(lines[i])
        if (!match) continue
        var base = baseNameOf(match[1])
        if (base !== '') names.push(base)
      }
      return { main: src.slice(0, at), names: names }
    }

    // ── 样式 ──────────────────────────────────────────────────────────────────

    /**
     * 玻璃材质: **PC 上 dsh 的那几个 token 原样引用**, 不另抄一份数
     *
     * 2026-11-08 主人: "对话框的样式使用当前 pc 的 dsh 玻璃质感同参数" —— 那套参数在 dsh 里是
     * `--dsw-menu-surface-fill` (`#fcfdfeb3`, 即 0.7 的底) 与 `--dsw-menu-backdrop-filter`
     * (`blur(40px) saturate(150%)`), 深色主题下前者由主题自己换成 `#303136a3`。所以这里只写变量,
     * 后面跟一个同值的字面量兜底: token 缺了也不至于糊成一片白
     */
    var GLASS = [
      '--lwp-glass-fill:var(--dsw-menu-surface-fill,#fcfdfeb3);',
      '--lwp-glass-blur:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));',
    ].join('')

    var CSS = [
      ':root{' + GLASS + '}',
      // 底色用硬值而不是只靠 `--dsw-alias-bg-base`: 变量解析不出来时那一条 background 会整条失效,
      // 覆盖层就变透明, 底下的 dsh 界面 (上下文滑杆、宽度控制) 会透上来
      '#lwp-root{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;',
      'background:#f7f7f8;background:var(--dsw-alias-bg-base,#f7f7f8);',
      'color:var(--dsw-alias-label-primary,#18181b);',
      // 键盘那一格 (2026-11-09 主人: "呼出键盘时不应整个界面上移, 只要输入框和聊天记录向上移"):
      // 高度由宿主 `setKeyboard` 写进 `--lwp-ime`, 这里只让出底部那一段 —— **WebView 尺寸不动**,
      // 于是 `#lwp-wall` (absolute inset:0, 包含块是这一层的 padding box) 与头栏一个像素都不动
      'padding-bottom:var(--lwp-ime,0px);',
      'font:14px/1.6 system-ui,-apple-system,"Noto Sans CJK SC",sans-serif}',
      '@media (prefers-color-scheme:dark){#lwp-root{background:#16181c}}',
      '#lwp-root[hidden]{display:none}',

      // 背景层: 一整张铺满, 浓淡由 --lwp-wall-alpha 说 (0 = 只剩底色)。它在最底下, 上面几块都
      // 抬到 z-index:1, 否则 absolute 的那一层会盖住正常流的兄弟
      '#lwp-wall{position:absolute;inset:0;z-index:0;pointer-events:none;',
      'background-position:center;background-repeat:no-repeat;background-size:cover;',
      // 只变透明度, 别让气泡的重绘把它一起重新栅格化 (键盘起落那一下最明显)
      'will-change:opacity;',
      'opacity:var(--lwp-wall-alpha,0);transition:opacity .18s ease}',
      '#lwp-wall[hidden]{display:none}',

      '#lwp-head{position:relative;z-index:1;display:flex;align-items:center;gap:8px;padding:8px 14px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.1));flex:none}',
      // 左边那一块 = 身份 (2026-11-10 主人: "右上角 luwi 图标和 luwi 名可在外观设置中修改" +
      // 本轮定下的布局 B: 身份在左、按钮在右). 整块仍可点 = 开一场新对话
      '#lwp-brand{display:flex;align-items:center;gap:9px;flex:1;min-width:0;appearance:none;',
      'border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:4px 6px;',
      'margin-left:-6px;border-radius:14px;cursor:pointer;',
      'transition:background-color .15s ease,transform .15s ease}',
      '#lwp-brand:active{background:rgba(1,180,255,.1);transform:scale(.98)}',
      '@media (hover:hover){#lwp-brand:hover{background:rgba(1,180,255,.08)}}',
      '#lwp-brand:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3964fe);outline-offset:2px}',
      '#lwp-brand .lwp-mark{position:relative;flex:none;width:28px;height:28px;display:grid;place-items:center}',
      // 头像换成自定义那张时可能是方图: 圆裁 + 铺满, 28px 的框不变 (布局不跟着图抖)
      '#lwp-brand .lwp-mark img{display:block;width:28px;height:28px;border-radius:999px;object-fit:cover}',
      '#lwp-brand .lwp-brand-text{display:flex;flex-direction:column;min-width:0;gap:1px}',
      '#lwp-brand .lwp-brand-name{font-size:15px;font-weight:600;line-height:1.15;letter-spacing:.01em;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:34vw}',
      '#lwp-head .lwp-meta{display:none}',
      // 「正在做」那颗点 (2026-11-10 主人: "正在做的标识改成右上角加黄色点表示" +
      // 紧接着 "旧的两处标识 新对话（绿）对话中（蓝）也加在那个点里"): 贴住头像右下角,
      // 一顆点三种颜色 —— 绿 = 新对话 (空场), 蓝 = 对话中, 黄 = 正在做 (呼吸光晕)
      '#lwp-busy{position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;box-sizing:border-box;',
      'border:2px solid var(--lwp-glass-fill,rgba(252,253,254,.9));border-radius:999px;background:#22c55e;',
      'transition:background-color .18s ease}',
      '#lwp-busy[data-state="chat"]{background:#3b82f6}',
      '#lwp-busy[data-state="busy"]{background:#f59e0b;animation:lwp-pulse 1.7s ease-in-out infinite}',
      '@keyframes lwp-pulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.42)}',
      '50%{box-shadow:0 0 0 5px rgba(245,158,11,0)}}',
      '@media (prefers-reduced-motion:reduce){#lwp-busy[data-state="busy"]{animation:none}}',
      // 右边那两颗: 历史 / 更多. 类名而不是 `#lwp-head > button` —— 后者特异性比 `#lwp-brand` 高,
      // 会把品牌按钮也套进"圆角描边小按钮"那一套里 (2026-11-08 预览里就是一颗白胶囊)
      '#lwp-head .lwp-tab{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));',
      'background:transparent;color:inherit;border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;',
      'line-height:1.5;flex:none}',
      '#lwp-head .lwp-tab[data-on="on"]{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff;border-color:transparent}',
      // `⋯` 那顆比文字按钮宽一点, 点起来才不憋
      '#lwp-head .lwp-tab.lwp-more{padding:4px 11px;font-size:15px}',

      /* ── 历史记录窗 (2026-11-10 主人: "左边再加上历史记录 … 弹窗显示, 上方显示搜索框") ────
       *
       * 外壳与预览窗同一套口径 (居中 / 左右 20dp / 高封 78% / 圆角 28 / 遮罩 40% 黑):
       * 这一层上已经有两扇窗, 第三扇再长一个样子只会让人找不着北
       */
      '#lwp-history{position:fixed;inset:0;z-index:9;display:flex;align-items:center;justify-content:center;',
      'padding:0 20px;background:rgba(0,0,0,.4)}',
      '#lwp-history[hidden]{display:none}',
      '#lwp-history .lwp-history-card{width:100%;max-height:78%;display:flex;flex-direction:column;',
      'gap:10px;box-sizing:border-box;padding:16px;border-radius:28px;',
      'background:var(--lwp-glass-fill,rgba(252,253,254,.96));',
      // 卡片是浅色的 (与预览窗同一张脸), 所以字必须自己钉深色 —— 深色主题下 `inherit` 拿到的是浅色字,
      // 灰底灰字 (2026-11-10 真机上读出来的那一眼)
      'color:var(--history-ink,#18181b);',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      'box-shadow:var(--dsw-elevation-panel)}',
      '#lwp-history .lwp-history-head{display:flex;align-items:center;gap:8px;flex:none}',
      '#lwp-history .lwp-history-title{flex:1;min-width:0;font-size:15px;font-weight:600}',
      '#lwp-history .lwp-history-close{appearance:none;border:0;background:transparent;color:inherit;',
      'width:30px;height:30px;border-radius:999px;display:grid;place-items:center;font-size:18px;line-height:1}',
      '#lwp-history input[type="search"]{appearance:none;width:100%;box-sizing:border-box;',
      'border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));border-radius:12px;padding:9px 12px;',
      'font:inherit;font-size:13px;background:#fff;color:var(--history-ink,#18181b);flex:none}',
      '#lwp-history input[type="search"]::placeholder{color:#6b7280}',
      '#lwp-history .lwp-history-list{flex:1;min-height:0;overflow-y:auto;display:flex;',
      'flex-direction:column;gap:6px;contain:layout style}',
      '#lwp-history .lwp-history-row{appearance:none;display:flex;flex-direction:column;gap:2px;',
      'text-align:left;border:0;border-radius:14px;padding:9px 11px;font:inherit;',
      'color:var(--history-ink,#18181b);background:rgba(15,23,42,.045)}',
      '#lwp-history .lwp-history-row[data-current="on"]{background:rgba(57,100,254,.16)}',
      '#lwp-history .lwp-history-row .lwp-history-name{font-size:13px;line-height:1.35;',
      'overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '#lwp-history .lwp-history-row .lwp-history-when{font-size:11px;color:#6b7280}',
      '#lwp-history .lwp-history-empty{font-size:12px;text-align:center;padding:20px 0;color:#6b7280}',
      '#lwp-history .lwp-history-new{appearance:none;border:0;border-radius:16px;padding:11px 14px;',
      'font:inherit;font-size:14px;font-weight:600;color:#fff;flex:none;',
      'background:var(--dsw-alias-button-info-fill,#3b82f6)}',

      /* ── 选工作区窗 (2026-11-12 #37) ────────────────────────────────────────────
       *
       * 外壳与历史窗 / 预览窗同一套 (居中 / 左右 20dp / 高封 78% / 圆角 28 / 遮罩 40% 黑):
       * 首启还没有工作区时, 空态那颗「选工作区」张的就是这一扇
       */
      '#lwp-pick{position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;',
      'padding:0 20px;background:rgba(0,0,0,.4)}',
      '#lwp-pick[hidden]{display:none}',
      '#lwp-pick .lwp-pick-card{width:100%;max-height:78%;display:flex;flex-direction:column;gap:10px;',
      'box-sizing:border-box;padding:16px;border-radius:28px;',
      'background:var(--lwp-glass-fill,rgba(252,253,254,.96));color:var(--history-ink,#18181b);',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      'box-shadow:var(--dsw-elevation-panel)}',
      '#lwp-pick .lwp-pick-head{display:flex;align-items:center;gap:8px;flex:none}',
      '#lwp-pick .lwp-pick-title{flex:1;min-width:0;font-size:15px;font-weight:600}',
      '#lwp-pick .lwp-pick-close{appearance:none;border:0;background:transparent;color:inherit;',
      'width:30px;height:30px;border-radius:999px;display:grid;place-items:center;font-size:18px;line-height:1}',
      '#lwp-pick .lwp-pick-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;',
      'gap:6px;contain:layout style}',
      '#lwp-pick .lwp-pick-row{appearance:none;display:flex;flex-direction:column;gap:2px;text-align:left;',
      'border:0;border-radius:14px;padding:9px 11px;font:inherit;color:var(--history-ink,#18181b);',
      'background:rgba(15,23,42,.045)}',
      '#lwp-pick .lwp-pick-row[data-current="on"]{background:rgba(57,100,254,.16)}',
      '#lwp-pick .lwp-pick-name{font-size:13px;line-height:1.35;overflow:hidden;white-space:nowrap;',
      'text-overflow:ellipsis}',
      '#lwp-pick .lwp-pick-path{font-size:11px;color:#6b7280;overflow:hidden;white-space:nowrap;',
      'text-overflow:ellipsis}',
      '#lwp-pick .lwp-pick-empty{font-size:12px;text-align:center;padding:20px 0;color:#6b7280}',

      /* ── `⋯` 里那几行 (判断层 / 工作 / 返回) ─────────────────────────────────── */
      '#lwp-drawer .lwp-menu-row{appearance:none;display:flex;align-items:center;gap:10px;width:100%;',
      'box-sizing:border-box;padding:11px 12px;margin-top:6px;font:inherit;font-size:14px;',
      'border-radius:14px;border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));',
      'background:transparent;color:inherit;text-align:left}',
      '#lwp-drawer .lwp-menu-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#lwp-drawer .lwp-menu-row em{font-style:normal;font-size:12px;',
      'color:var(--dsw-alias-label-secondary,#9ca3af)}',
      '#lwp-drawer .lwp-menu-back{align-self:flex-start;margin-bottom:2px}',

      '#lwp-flow{position:relative;z-index:1;flex:1;min-height:0;overflow-y:auto;padding:16px 14px 8px;',
      // 键盘起落只改这一块的高度: 重排与重绘收在对话区里, 不往头栏与背景那边扩散
      'contain:layout style;',
      'display:flex;flex-direction:column;gap:14px}',
      '.lwp-row{display:flex;flex-direction:column;gap:4px;max-width:100%}',
      '.lwp-row[data-who="user"]{align-items:flex-end}',
      // 气泡 = dsh 的玻璃: 同一组 token, 同一条 0.5px 发丝描边 + 柔和投影 (`--dsw-elevation-panel`
      // 已经把描边算在里面)
      '.lwp-bubble{max-width:86%;padding:9px 12px;white-space:pre-wrap;overflow-wrap:anywhere;border:0;',
      'border-radius:var(--dsw-radius-lg,16px);background:var(--lwp-glass-fill);',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      'box-shadow:var(--dsw-elevation-panel)}',
      // 两侧靠色调分, 不靠材质分: 底色是照片时, 实心蓝那一块会把背景整块盖死
      '.lwp-row[data-who="user"] .lwp-bubble{border-bottom-right-radius:6px;',
      'color:var(--dsw-alias-label-primary,#18181b);',
      'background:linear-gradient(0deg,rgba(57,100,254,.16),rgba(57,100,254,.16)),var(--lwp-glass-fill)}',
      '.lwp-row[data-who="assistant"] .lwp-bubble{border-bottom-left-radius:6px}',
      '.lwp-row[data-who="error"] .lwp-bubble{color:var(--dsw-alias-state-error-primary,#b91c1c);',
      'background:linear-gradient(0deg,rgba(220,38,38,.1),rgba(220,38,38,.1)),var(--lwp-glass-fill)}',
      // 老 WebView 不认 backdrop-filter: 退回一块更实的底, 免得字压在照片上看不清
      '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){',
      '.lwp-bubble{background:rgba(252,253,254,.92)}',
      '.lwp-row[data-who="user"] .lwp-bubble{background:rgba(216,227,255,.94)}',
      '.lwp-row[data-who="error"] .lwp-bubble{background:rgba(252,232,232,.94)}}',
      '.lwp-time{font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af)}',
      // 空态: 中间一张品牌标记 + 名字 (2026-11-08 主人: "对话界面中间显示 luwi 及其图标")
      // 光晕与浮动只做氛围, 不承载信息; 关掉动效也完全看得懂
      '#lwp-hero{position:relative;flex:1;min-height:180px;display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;padding:24px 0 8px;text-align:center}',
      '#lwp-hero::before{content:"";position:absolute;left:50%;top:50%;width:min(78vw,340px);',
      'height:min(78vw,340px);transform:translate(-50%,-52%);border-radius:50%;pointer-events:none;',
      'background:radial-gradient(circle,rgba(1,180,255,.12),rgba(1,180,255,0) 62%)}',
      '#lwp-hero .lwp-hero-mark{position:relative;width:96px;height:96px;display:grid;place-items:center;',
      'animation:lwp-float 4.2s ease-in-out infinite}',
      // 空态那张脸与头栏**同一个形状** (2026-11-10 主人: "这个新对话屏幕中间的图案应用圆形, 与头像一致"):
      // 圆裁 + 铺满, 96px 的框不变 —— 方图 (相册里随手选的那张) 也不会挤出一个方角
      '#lwp-hero .lwp-hero-mark img{display:block;width:96px;height:96px;border-radius:999px;object-fit:cover}',
      // 换了自定义头像之后, 头栏那颗 28px 有白描边才立得住; 空态这张大图同理 (原来是品牌图, 有自带留白)
      '#lwp-hero .lwp-hero-mark[data-photo="on"] img{box-shadow:0 0 0 2px var(--lwp-glass-fill,rgba(252,253,254,.9)),',
      '0 0 0 3px rgba(15,23,42,.08)}',
      '#lwp-hero .lwp-hero-name{position:relative;margin-top:14px;font-size:22px;font-weight:700;',
      'line-height:1.2;letter-spacing:.02em}',
      '#lwp-hero .lwp-hero-line{position:relative;margin-top:6px;font-size:13px;line-height:1.7;',
      'color:var(--dsw-alias-label-secondary,#6b7280)}',
      // 空态那颗「选工作区」(2026-11-12 #37): 首启还没有工作区时才画 (见 pickWanted), 实体按钮
      // 而不是一行蓝字 —— 真机的无障碍树要读到 clickable=true 才有得点
      '#lwp-hero .lwp-hero-pick{position:relative;margin-top:16px;appearance:none;border:0;',
      'border-radius:999px;padding:10px 22px;font:inherit;font-size:14px;font-weight:600;line-height:1.4;',
      'color:#fff;cursor:pointer;background:var(--dsw-alias-button-info-fill,#3b82f6);',
      'box-shadow:var(--dsw-elevation-panel)}',
      '#lwp-hero .lwp-hero-pick:active{transform:scale(.97)}',
      '#lwp-hero .lwp-hero-pick[hidden]{display:none}',
      '#lwp-hero .lwp-hero-pick:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3964fe);',
      'outline-offset:2px}',
      '@keyframes lwp-float{0%,100%{transform:translateY(0);opacity:1}50%{transform:translateY(-3px);opacity:.94}}',
      // 键盘抬着时头像不浮 (见 applyIme): 起落那一下少一条每帧的合成
      '#lwp-root[data-ime="on"] #lwp-hero .lwp-hero-mark{animation:none}',
      '@media (prefers-reduced-motion:reduce){#lwp-hero .lwp-hero-mark{animation:none}}',
      '.lwp-empty{margin:auto;color:var(--dsw-alias-label-secondary,#9ca3af);font-size:13px;text-align:center;line-height:1.8}',
      // 待发附件那一行 (2026-11-10 主人: "附件发图片和发表情包, 应该要在输入框上方显示, 像 dsh 原生
      // 那样"): **在文本区上面**, 图与表情是 64px 缩略图 + 右上角 `×`, 非图片文件仍是名字 chip。
      // dsh 的 `.rail` 是 `padding:2px 10px 0` + `margin-bottom:-6px` (卡片 gap 12 -> 视觉 6), 照抄
      '#lwp-attach-row{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px;padding:2px 10px 0;',
      'margin-bottom:-6px}',
      '#lwp-attach-row[hidden]{display:none}',
      '.lwp-attach-thumb{position:relative;flex:none;width:64px;height:64px;box-sizing:border-box;',
      'padding:0;overflow:hidden;border:0.5px solid var(--dsw-alias-border-l2,rgba(15,23,42,.12));',
      'border-radius:var(--dsw-radius-xl,16px);background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.05))}',
      '.lwp-attach-thumb img{display:block;width:100%;height:100%;object-fit:cover}',
      // 还在读的那一颗: 一道扫光, 64px 的框不变 (解码前后不跳)
      '.lwp-attach-thumb[data-state="reading"]::after{content:"";position:absolute;inset:0;',
      'background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0));',
      'animation:lwp-thumb-pass 1.1s ease-in-out infinite}',
      '@keyframes lwp-thumb-pass{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}',
      '@media (prefers-reduced-motion:reduce){.lwp-attach-thumb[data-state="reading"]::after{animation:none}}',
      '.lwp-attach-thumb[data-state="error"]{border-color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '.lwp-attach-thumb[data-state="error"] img{opacity:.4}',
      '.lwp-attach-x{position:absolute;top:3px;right:3px;z-index:1;display:grid;place-items:center;',
      'width:18px;height:18px;padding:0;border:0;border-radius:999px;line-height:1;font-size:12px;',
      'background:var(--dsw-alias-button-contrast-fill,rgba(15,23,42,.62));color:#fff;cursor:pointer}',
      '.lwp-attach-thumb[data-state="reading"] .lwp-attach-x{opacity:.5}',
      // 非图片文件: 一颗 chip (名字 + 大小 + 状态), 点一下撤掉
      '#lwp-attach{font-size:12px;line-height:18px;padding:2px 10px;border-radius:999px;max-width:70vw;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary,#6b7280);background:rgba(15,23,42,.06)}',
      '#lwp-attach[data-state="ready"]{color:var(--dsw-alias-state-business-primary,#3964fe);',
      'background:rgba(57,100,254,.12)}',
      '#lwp-attach[data-state="error"]{color:var(--dsw-alias-state-error-primary,#b91c1c);',
      'background:rgba(220,38,38,.1)}',
      // 她发来的那张图: 一个泡里先图后话; 取不到时那一块自己变成一句「图没取到」
      // **长宽各收一半** (2026-11-10 主人: "图太大了, 最大长宽都缩短到原来一半"): 宽 86% → 43%,
      // 高 60vh → 30vh。要看全就点开预览窗 (那一档仍是 78vh, 不缩)
      // **没有常驻的 `min-height`** (2026-11-09): 原来那 72px 对每一张图都成立, 于是解码前先多出一条
      // 空白带 —— 真机读数就是"没滑动时有明显空行, 滚一下才对上"; 图的占位改由行里带的 `w/h` 算
      // 出来的比例说了算 (见 `imageBubble`)
      '.lwp-image{max-width:43%;border:0;border-radius:var(--dsw-radius-lg,16px);overflow:hidden;',
      'contain:layout paint;box-shadow:var(--dsw-elevation-panel);background:rgba(15,23,42,.045)}',
      '.lwp-image img{display:block;max-width:100%;max-height:30vh;width:auto;height:auto;',
      'object-fit:contain;margin:0 auto;cursor:zoom-in}',
      // 「图没取到」那一句是字, 不该跟着图一起收窄 (43% 里三个字要折行)
      '.lwp-image[data-broken="on"]{max-width:86%;padding:10px 12px;font-size:12px;',
      'color:var(--dsw-alias-label-secondary,#6b7280)}',
      // 表情: 门户也画那张小图 (走 /lw-out/stickers), 取不到就一行灰字
      // **120 的方框写死**: 图在解码前后占的是同一块地, 下面那条不会被顶上来 (2026-11-09 的抖动)
      '.lwp-sticker{max-width:86%;padding:6px 10px;border-radius:var(--dsw-radius-lg,16px);',
      'contain:layout paint;',
      'font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary,#6b7280);background:rgba(15,23,42,.045)}',
      '.lwp-sticker img{display:block;width:120px;height:120px;object-fit:contain;border-radius:10px}',
      // 一份文件 (2026-11-09 主人: "只显示文件名, 能打开的文件名都是蓝色的可以点击的")
      // 不画缩略图、不写路径: 一行蓝字就是这一条的全部
      '.lwp-file{max-width:86%;display:inline-flex;align-items:center;gap:6px;appearance:none;border:0;',
      'padding:8px 12px;border-radius:var(--dsw-radius-lg,16px);background:rgba(57,100,254,.12);',
      'color:var(--dsw-alias-state-business-primary,#3964fe);font:inherit;font-size:13px;line-height:20px;',
      'text-align:left;cursor:pointer;box-shadow:var(--dsw-elevation-panel)}',
      '.lwp-file .lwp-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.lwp-file .lwp-file-glyph{flex:none;display:inline-grid;place-items:center}',
      // 自己发的那一份也走同一个蓝: 主人要的是"能打开的都看得出能点" (2026-11-09),
      // 谁说的这件事靠左右对齐分, 不靠颜色分
      '.lwp-file[data-broken="on"]{color:var(--dsw-alias-label-secondary,#6b7280);background:rgba(15,23,42,.045)}',
      // 预览窗 (2026-11-09 主人: "一个屏幕中心的窗口, 和权限选择窗口一样大小")
      // 尺寸照 ReadyPermissionsDialog: 居中 / 左右各留 20dp / 高封 78% / 遮罩 40% 黑
      // **高度固定成 78vh, 不跟着内容缩** (2026-11-09 主人: "预览窗口应当固定大小"): 短文件也张这么大,
      // 长的那一份在卡片里自己滚 —— 窗口大小只由屏幕决定, 点开哪一份都一样
      '#lwp-preview{position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;',
      'justify-content:center;padding:0 20px;background:rgba(0,0,0,.4)}',
      '#lwp-preview[hidden]{display:none}',
      '#lwp-preview .lwp-preview-card{display:flex;flex-direction:column;width:100%;max-width:720px;',
      'box-sizing:border-box;height:78vh;max-height:78vh;overflow:hidden;',
      'border-radius:var(--dsw-radius-panel,28px);',
      'background:var(--dsw-specific-input-major,#fff);box-shadow:var(--dsw-elevation-soft);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l2)}',
      '#lwp-preview .lwp-preview-head{display:flex;align-items:center;gap:10px;flex:none;',
      'padding:14px 10px 10px 18px}',
      '#lwp-preview .lwp-preview-name{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:1.3;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#lwp-preview .lwp-preview-close{flex:none;display:grid;place-items:center;width:32px;height:32px;',
      'border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '@media (hover:hover){#lwp-preview .lwp-preview-close:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
      '#lwp-preview .lwp-preview-body{flex:1;min-height:0;overflow:auto;padding:0 18px 16px}',
      // 图: 窗是固定大小的, 图就在那一块里居中 (不贴顶、也不把窗撑高)
      '#lwp-preview .lwp-preview-body[data-kind="image"]{display:flex;align-items:center;',
      'justify-content:center;padding:0 18px 18px}',
      '#lwp-preview .lwp-preview-body img{display:block;max-width:100%;max-height:100%;margin:0 auto;border-radius:12px}',
      '#lwp-preview .lwp-preview-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;',
      'font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary)}',
      '#lwp-preview .lwp-preview-note{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-caption)}',
      '#lwp-preview .lwp-preview-note[data-error="on"]{color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '#lwp-preview .lwp-preview-open{display:inline-block;margin-top:12px;padding:8px 16px;border:0;',
      'border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}',
      // Office (2026-11-09): 正文进 shadow root (样式是 `renderOffice` 给的那一份), 这一层只给个盒子
      '#lwp-preview .lwp-preview-body[data-kind="office"]{padding:0 10px 12px}',
      '#lwp-preview .lwp-preview-doc{display:block;overflow:hidden}',
      'body.lwp-preview-open{overflow:hidden}',
      // 表情面板 (2026-11-09 主人: "表情包应该像这样在下方展出, 高度相当于一个输入法键盘的高度")
      // —— 它挂在输入卡**下面**、整宽、高度就是一块键盘: 张开会把对话区顶上去, 不盖在消息上
      '#lwp-sticker-btn{display:grid;place-items:center;flex:none;width:28px;height:28px;border:0;',
      'border-radius:999px;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);',
      'cursor:pointer}',
      '#lwp-sticker-btn[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover-solid)}',
      '@media (hover:hover){#lwp-sticker-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}}',
      // 268px 是一块键盘的常见高度 (Android 输入法 260~300dp); 屏幕矮时由 `max-height` 收到 30vh。
      // **不写 `min()`**: 那种写法在个别 WebView 上被整条丢掉, 面板就变成一个 0 高的空块 (2026-11-09 踩到)
      '#lwp-sticker-panel{flex:none;display:block;width:100%;height:268px;max-height:30vh;',
      'margin-top:8px;box-sizing:border-box;',
      'padding:10px;overflow-y:auto;border-radius:var(--dsw-radius-panel,28px);',
      'background:var(--dsw-specific-input-major,#f3f4f6);box-shadow:var(--dsw-elevation-soft);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l2)}',
      '#lwp-sticker-panel[hidden]{display:none}',
      '#lwp-sticker-panel .lwp-sticker-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}',
      '#lwp-sticker-panel .lwp-sticker-cell{display:grid;place-items:center;aspect-ratio:1;width:100%;',
      'padding:2px;border:0;border-radius:10px;background:transparent;cursor:pointer;overflow:hidden}',
      '@media (hover:hover){#lwp-sticker-panel .lwp-sticker-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
      '#lwp-sticker-panel .lwp-sticker-cell img{display:block;max-width:100%;max-height:100%;object-fit:contain}',
      '#lwp-sticker-panel .lwp-sticker-cell[data-add="on"]{color:var(--dsw-alias-label-secondary);',
      'background:rgba(15,23,42,.05)}',
      // 「正在做…」: 一轮在跑的那一行, 极轻, 与时间分段那颗药丸同一档
      '.lwp-working{align-self:center;margin:2px 0 0;padding:3px 10px;border-radius:999px;font-size:11px;',
      'color:var(--dsw-alias-label-secondary,#6b7280);background:rgba(15,23,42,.045)}',
      '@media (prefers-color-scheme:dark){.lwp-sticker,.lwp-working,.lwp-image[data-broken="on"],',
      '.lwp-file[data-broken="on"]{color:#9aa1ab;background:rgba(255,255,255,.07)}}',
      '@media (prefers-color-scheme:dark){#lwp-preview .lwp-preview-card{background:#24262b}}',
      // 时间分段: 一段一个 (2026-11-08 主人: "对话 30min 后分段, 计日期和时间")
      '.lwp-sep{display:flex;justify-content:center;margin:4px 0 -2px}',
      '.lwp-sep span{padding:3px 10px;border-radius:999px;font-size:11px;line-height:16px;',
      'color:var(--dsw-alias-label-secondary,#6b7280);background:rgba(15,23,42,.045);',
      '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}',
      '@media (prefers-color-scheme:dark){.lwp-sep span{color:#9aa1ab;background:rgba(255,255,255,.07)}}',
      // 开新对话之后那 3 秒的退路: 是流里的一块 (不是浮在消息上), 收起时 display:none 不占高度
      '#lwp-undo{align-self:center;flex:none;display:flex;align-items:center;gap:8px;margin:8px 0 0;',
      'padding:6px 10px 6px 12px;border-radius:999px;font-size:12px;',
      'color:var(--dsw-alias-label-primary,#18181b);background:var(--dsw-specific-menu,var(--lwp-glass-fill));',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}',
      '#lwp-undo[hidden]{display:none}',
      // 空态那颗「开一场」撤了 (2026-11-09 主人: "不需要用户手动点击开一场, 新界面里自动开始新对话")
      // —— 进来就自己开一场, 这一层不再摆一颗要人按的按钮

      // ── 输入区: 照 dsh 的 InputBar (`packages/client/ui-conversation/.../InputBar.module.css`) ──
      // 卡片 28px 圆角 / input-major 的实底 / soft elevation; 工具行左预设 chip、右 34px 圆钮
      '#lwp-dock{position:relative;z-index:1;flex:none;padding:0 12px 12px}',
      '#lwp-card{position:relative;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;',
      'width:100%;padding-top:8px;border:0;border-radius:var(--dsw-radius-panel,28px);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);',
      'background:var(--dsw-specific-input-major,#fff);box-shadow:var(--dsw-elevation-soft);',
      'font-size:var(--dsh-content-font-size,14px);',
      'line-height:calc(24px + var(--dsh-content-font-delta,0px))}',
      '@media (pointer:coarse){#lwp-card{font-size:max(16px,var(--dsh-content-font-size,14px))}}',
      '#lwp-input{box-sizing:border-box;min-height:36px;',
      'max-height:calc(14 * (24px + var(--dsh-content-font-delta,0px)));',
      'padding:4px 12px 0 14px;border:0;outline:none;resize:none;overflow-y:auto;background:transparent;',
      'font-family:var(--dsw-font-family);font-size:inherit;line-height:inherit;',
      'color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary)}',
      '#lwp-input::placeholder{color:var(--dsw-alias-label-caption)}',
      '#lwp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 8px 6px;',
      'min-width:0}',
      '#lwp-tools{display:flex;align-items:center;gap:8px;flex:1;min-width:0}',
      // `+`: dsh 那个 28px 的圆钮 (selector 底 + 主色字形)
      '#lwp-plus{display:grid;place-items:center;flex:none;width:28px;height:28px;border:0;',
      'border-radius:999px;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);',
      'cursor:pointer}',
      '#lwp-plus[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover-solid)}',
      '@media (hover:hover){#lwp-plus:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}}',
      // 权限 / 模型两颗 chip: 与 dsh 的 `.select` 同一套 (13/20 500, 8px 圆角, 透明底, hover 才铺底)
      '.lwp-chip{display:inline-flex;align-items:center;gap:4px;flex:none;max-width:46vw;min-height:28px;',
      'padding:0 8px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;',
      'color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;',
      'white-space:nowrap;cursor:pointer}',
      '.lwp-chip[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '@media (hover:hover){.lwp-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
      '.lwp-chip .lwp-chip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.lwp-chip[hidden]{display:none}',
      '.lwp-chevron{flex:none;color:var(--dsw-alias-label-caption)}',
      '#lwp-note{flex:1;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);min-width:0;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#lwp-note:empty{display:none}',
      '#lwp-note[data-error="on"]{color:var(--dsw-alias-state-error-primary,#b91c1c)}',
      '#lwp-send{display:grid;place-items:center;flex:none;width:34px;height:34px;border:0;',
      'border-radius:999px;background:var(--dsw-alias-button-info-fill,#3964fe);color:#fff;',
      'font:inherit;font-size:13px;cursor:pointer;transition:background-color .1s ease;',
      'transform:translateY(-2px)}',
      '@media (hover:hover){#lwp-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#4a72fe)}}',
      '#lwp-send:disabled{opacity:.4;cursor:default}',
      '#lwp-send .lwp-spin{animation:lwp-send-spin .8s linear infinite}',
      '@keyframes lwp-send-spin{to{transform:rotate(360deg)}}',

      // 预设菜单: 与 dsh 的 MenuSurface 同一套 (玻璃 + 12px 圆角 + prominent 投影)
      '#lwp-menu{position:absolute;left:8px;bottom:100%;margin-bottom:6px;min-width:180px;max-width:80vw;',
      'max-height:50vh;overflow-y:auto;padding:6px;border-radius:var(--dsw-radius-md,12px);',
      'background:var(--dsw-specific-menu,var(--lwp-glass-fill));',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);',
      'box-shadow:var(--dsw-elevation-prominent);z-index:5}',
      '#lwp-menu[hidden]{display:none}',
      '#lwp-menu button{display:flex;flex-direction:column;gap:2px;width:100%;padding:6px 8px;border:0;',
      'border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '@media (hover:hover){#lwp-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
      '#lwp-menu .lwp-menu-name{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '#lwp-menu .lwp-menu-name[data-on="on"]{font-weight:600}',
      '#lwp-menu .lwp-menu-group{font-size:11px;line-height:16px;padding:4px 8px 2px;',
      'color:var(--dsw-alias-label-caption)}',
      '#lwp-menu .lwp-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,rgba(15,23,42,.08))}',
      '#lwp-menu .lwp-menu-desc{font-size:12px;line-height:16px;color:var(--dsw-alias-label-caption);',
      'white-space:normal}',

      // 抽屉: 玻璃同参数 (原来是 bg-overlay 那块实底)。**底边跟着键盘走** —— 不然抽屉在键盘后面
      '#lwp-drawer{position:absolute;left:0;right:0;bottom:var(--lwp-ime,0px);z-index:2;max-height:72%;overflow-y:auto;',
      'background:var(--dsw-specific-menu,var(--lwp-glass-fill));',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      'border-top:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.1));',
      'border-radius:18px 18px 0 0;box-shadow:0 -12px 40px rgba(15,23,42,.18);padding:14px 16px 20px}',
      '#lwp-drawer[hidden]{display:none}',
      '#lwp-drawer h3{margin:0 0 6px;font-size:13px;font-weight:600}',
      '#lwp-drawer .lwp-kv{display:flex;gap:8px;font-size:12px;padding:3px 0;',
      'color:var(--dsw-alias-label-secondary,#6b7280)}',
      '#lwp-drawer .lwp-kv b{min-width:72px;flex:none;font-weight:500;color:var(--dsw-alias-label-primary,#18181b)}',
      '#lwp-drawer .lwp-check{display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:13px;',
      'border-top:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.06))}',
      '#lwp-drawer .lwp-check p{flex:1;margin:0;min-width:0}',
      '#lwp-drawer .lwp-check small{display:block;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px}',
      '#lwp-drawer button{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));',
      'background:transparent;color:inherit;border-radius:8px;padding:3px 8px;font:inherit;font-size:12px}',
      '#lwp-drawer .lwp-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}',
      '#lwp-drawer .lwp-actions button{padding:6px 12px}',
    ].join('')

    // ── 门户本体 ──────────────────────────────────────────────────────────────

    function createPortal(ctx) {
      var root = null
      var style = null
      var els = {}
      var mounted = false
      var chatTarget = null
      var chatUnsub = null
      var sessionUnsub = null
      var listUnsub = null
      var pollTimer = null
      var renderTimer = null
      var streamKey = ''
      var sessionId = null
      var status = null
      var drawer = ''
      var sending = false
      var bound = ''
      /**
       * 键盘那一格 (px): 宿主推过来的高度, 只在门户盖着时才有值 (2026-11-09)
       *
       * 与宿主推来的值比, 同值不写 style —— 一次起落只在**变了**的时候重排一次
       */
      var imePx = 0
      /** 这一层的脸 (背景图与浓淡), 由 `portalLook()` 交过来 */
      var look = null
      /**
       * 这一层的身份 (头像与昵称): 头栏与空态共用一份 (2026-11-10)
       *
       * `avatar` 是**已经能直接塞进 `img.src`** 的那个串 (`MARK_PNG` 或 `data:image/jpeg;base64,…`),
       * 空串只出现在还没取到 look 的那一瞬
       */
      var identity = { name: DEFAULT_NAME, avatar: '' }
      /** 历史记录窗开着没有 / 它的订阅 (`ctx.sessions.list`) */
      var historyOpen = false
      var historyUnsub = null
      var historyQuery = ''
      var noteTimer = null
      /** 正在开新对话: 连点只认第一次 */
      var navigating = false
      /** 新建之后这一小段时间不跟账本 —— 桥写不进去时也不至于被拽回旧场 */
      var ledgerHoldUntil = 0
      /**
       * 账本这一条通道上一拍读到哪一版 (2026-11-10, 方案 `Luwi-门户历史恢复被拽回-方案-2026-11-10.md`)
       *
       * 判据从"状态驱动"改成"**变化驱动**": 点历史只换视野、不写账本, 账本 `at` 没变,
       * 3 s 那一定时器就不该把界面拽回去 (见 [ledgerShouldFollow])
       */
      var lastLedgerAt = 0
      /** 「已开新对话」那条: 8 秒后自己收 */
      var undoTimer = null
      /** 上一次替谁切过工作区 (同一个工作区 5 秒内不重复切) */
      var workspaceTry = { id: '', at: 0 }
      /**
       * 选工作区那一窗 (2026-11-12 #37): 开着没有 / 它的工作区订阅 / 补齐列表的定时器
       *
       * 首启 (`pm clear` 之后) dsh 那一边可能一个工作区都没有, 而这一层把 dsh 整个盖住了 ——
       * 没有入口就等于发不出任何一句话, 所以空态自己摆一颗「选工作区」
       */
      var pickOpen = false
      var pickUnsub = null
      var pickTimer = null
      var pickTries = 0
      /** 窗里那行说明 (还在准备 / 建不起来), 有工作区时是空串 */
      var pickNote = ''
      /** 正在落进某个工作区: 连点只认第一次 (与 [navigating] 分开, 两条路可以互相接管) */
      var entering = false

      /* ── 她说的话: 那一份 jsonl (方案 §3.2–3.4) ──────────────────────────────
       *
       * 门户读 **`ChatSnapshot` 的 user 节点 + 这一份 jsonl 行**, 按时间合并; assistant 不取
       * (luwi 档里正文只是过程)。两段水位 (§3.4):
       *
       * - 打开 / 换会话: `next = 0` 拿全量, **一次画完不排队** (按 `gapMs` 重放会让打开旧会话像慢放录像)
       * - 之后: 只取 `seq > next`, 逐条按 `gapMs` 排队, 每条上屏时 `next = seq`
       *
       * 队列**不能挂在 `renderFlow` 里**: 那个函数每次 `flow.textContent = ''` 整块重建 (流式期间 120 ms
       * 一次), 队列一进去就会被重置或提前画出, 还会连带 `scrollTop` 跳到底
       */
      var outLines = []
      var outNext = 0
      var outKey = ''
      var releasedIds = {}
      /** 已经取进 `outLines` 的那些 `seq` (取水位推进了也去重一次: 见 [loadOut] 里那段注释) */
      var seenSeq = {}
      var outQueue = []
      var outTimer = null
      var outReleaseAt = 0
      /** 上一拍见过的 user 节点 `seq` (新的一条 = 新一轮 → 撤掉还没上屏的旧条) */
      var userKey = ''
      /** 上一次打出来的 档/是否画正文 记号 (只在变的时候 log 一行) */
      var shownPreset = ''
      /** 上一次打出来的节点种类串 (只在变的时候 log) */
      var shownKinds = ''
      /** 账本那一场所在的工作区路径 (冷启动时按它认门, 见 follow) */
      var ballWorkspacePath = ''
      /** 过期的账本只跟随一次 (免得每次轮询都把界面拽回去) */
      var staleFollowed = false
      /** 上一次空态诊断的记号 (items/shown 变了才打一行) */
      var flowWhy = ''
      /** 上一次画进 `#lwp-flow` 的内容签名 (见 flowSignature): 一样就整段不重画 */
      var flowSig = null
      /** 流里现在画着什么: `flow` = 消息, `hero` = 空态那张脸 */
      var flowMode = ''
      /** 已经画在流里的东西 (分段药丸 / 消息行 / 安静行), 与 flowPlan 一一对应: 前缀没变就只追加 */
      var flowRows = []
      /** 下一次画流时是否强制贴底 (换会话 / 自己发了一句 / 整段重建之后) */
      var flowForceBottom = true
      /** 增量渲染的计数 (真机读数与判据都看它, 见 tools/check-luwi-portal.mjs) */
      var flowStats = { rebuilds: 0, appends: 0, tailReplaces: 0 }
      /** 上一次打出去的那三个数: 变了才打一行 (真机验收读的就是这一行) */
      var flowStatsShown = { rebuilds: -1, appends: -1, tailReplaces: -1 }
      /**
       * 把三个计数打一行 console (2026-11-10)
       *
       * 宿主把那句 `console` 转进 logcat (`DshWebView: console …`), 于是"发一条消息 rebuilds 涨没涨"
       * 不用连着电脑也能读。**只是诊断**: 不改任何渲染行为, 计数没变就什么都不打
       */
      function logFlowStats() {
        if (flowStatsShown.rebuilds === flowStats.rebuilds
          && flowStatsShown.appends === flowStats.appends
          && flowStatsShown.tailReplaces === flowStats.tailReplaces) return
        flowStatsShown.rebuilds = flowStats.rebuilds
        flowStatsShown.appends = flowStats.appends
        flowStatsShown.tailReplaces = flowStats.tailReplaces
        console.log('[luwi-portal] stats rebuilds=' + String(flowStats.rebuilds)
          + ' appends=' + String(flowStats.appends)
          + ' tail=' + String(flowStats.tailReplaces)
          + ' rows=' + String(flowRows.length))
      }
      try {
        window.__LW_PORTAL_STATS__ = flowStats
      } catch (_noWindow) {
        // 非浏览器环境 (判据脚本里 require 这份文件) 就没有 window
      }

      /**
       * 草稿里那些文件 (2026-11-08 主人: `+` 就是上传文件的按钮, 图片与 docs 一样走这条)
       *
       * 每一项: `{kind, name, bytes, mediaType, data, status, error, path}` —— 顺序就是挑选 / 点的
       * 顺序, 画在输入框上方 (`#lwp-attach-row`)。**全部 ready 才允许发**
       */
      var attach = []
      /** 一条消息里最多带几个 (再多就该分几条发) */
      var MAX_ATTACH = 6
      /** 一份最大多少字节 (与 PortalBridge.STASH_MAX_BYTES 同一个数: 12 MB) */
      var MAX_STASH_BYTES = 12 * 1024 * 1024
      /**
       * 图片发送失败那三种说法 (落实表 #35, 2026-11-12)
       *
       * 主人报的是"选图 → 点确定 → 没反应": 三条路 (WebView 没回调 / 太大 / 等超时) 以前都是静默,
       * 人只能来群里问。**说法只有这三种** —— 页面与宿主 (logcat) 认的是同一张表
       */
      var IMAGE_FAIL = {
        /** 点了 `+` 宿主没进 `onShowFileChooser`, 或者选择器回来是空的 (那正是 issue #53 的现场) */
        noCallback: 'webview 未回调',
        /** 选出来的那一份超过 [MAX_STASH_BYTES] */
        tooBig: '文件过大',
        /** 读字节 / 落盘一直没回来 */
        timeout: '上传超时',
      }
      /** 点 `+` 到宿主回报 "选择器起来了" 之间最多等多久: 要压在判据那个 5 s 里面 */
      var PICK_WAIT_MS = 2500
      /** 选完之后读字节 + 落盘最多等多久 (12 MB 在这台机器上不到 1 s, 留足余量) */
      var UPLOAD_WAIT_MS = 10000
      /**
       * 本机那几条「图片发送失败」: `{id, at, text}` —— 画在对话流里 (`who:'error'`, 与 dsh 的
       * turn-error 同一档), **不进 dsh 的会话账**: 这是本机的现场, 不是要发给模型的内容
       */
      var imageFails = []
      /** 点 `+` 那一下的计时器 (宿主一回调就撤) */
      var pickWatch = null
      /** 表情那个方框的边长 (px): 与 CSS `.lwp-sticker img` 里的 120 是同一个数, 改一处就得改另一处 */
      var STICKER_BOX = 120
      /**
       * 自动开新对话试过没有 (2026-11-09 主人: "不需要用户手动点击开一场")
       *
       * 一次挂载只试一次: 失败时 `newConversation()` 自己会留一句说明, 反复重试只会把提示刷掉
       */
      var autoStartTried = false

      /** dsh 当前主视图那一场 (与 ui-chat 的 mainBlank 同一个判据) */
      function currentSessionId() {
        var list
        try {
          list = ctx.sessions.list.getSnapshot().byId
        } catch (_noSessions) {
          return null
        }
        var byId = list || {}
        var ids = Object.keys(byId)
        for (var i = 0; i < ids.length; i++) {
          var summary = byId[ids[i]]
          if (summary && summary.retainedBy && (summary.retainedBy.mainView || 0) > 0) return summary.id
        }
        return null
      }

      /** 这一场的摘要 (会话标题那一条 2026-11-08 撤了: 主人要"对话层不显示会话标题") */
      function summaryOf(id) {
        if (id === null || id === undefined) return undefined
        try {
          return ctx.sessions.list.getSnapshot().byId[id]
        } catch (_noList) {
          return undefined
        }
      }

      function bindingOf(id) {
        try {
          return id === null || id === undefined ? undefined : ctx.sessions.binding(id)
        } catch (_unknown) {
          return undefined
        }
      }

      /** 切到某一场: 换订阅源, 并清掉流式记账 */
      function adopt(id) {
        if (id === sessionId && chatTarget !== null) return
        // **同一场再挂一次不许清界面** (2026-11-09 真机): 冷启动时 `pollLedger` 每 3 s 就会因为
        // `chatTarget === null` 再叫一次 follow → adopt; 老写法每次都把 flow 清空重取, 而新 target 的
        // 快照一开始是空的 —— 于是界面在"气泡"与"中间那张 Luwi 图"之间来回跳, 看起来就是一直空着
        var same = id === sessionId
        if (chatUnsub !== null) {
          chatUnsub()
          chatUnsub = null
        }
        chatTarget = null
        sessionId = id
        // 画到哪一场就记住哪一场: 下次挂载先回到这里, 而不是落在 dsh 顺手开的那张空白
        rememberSession(id)
        if (!same) {
          streamKey = ''
          // 她说的话: 换会话就**重取全量** (一次画完、不排队), 上一场没上屏的条一条都不带过来
          clearOut('the conversation changed')
          // 草稿里那张图也不带过去 (它挂在上一场的会话 id 上)
          clearAttach()
          // 上一场那几条「图片发送失败」也不带过去 (落实表 #35): 它们是这一场的现场
          imageFails = []
          userKey = ''
          loadOut(true)
        }
        var binding = bindingOf(id)
        if (binding === undefined) {
          // 冷启动时这一场还没进列表 (dsh 要晚一拍才 retain): 界面先空着, 但**每 250 ms 再试** ——
          // 不试就永远停在空态 (2026-11-08 真机: 重装后门户一直停在中间那张 Luwi 图)
          retryTarget(id)
          renderFlow()
          renderMeta()
          renderModel()
          return
        }
        try {
          chatTarget = ctx.uiConversation.binding(binding).target('chat')
          chatUnsub = chatTarget.subscribe(scheduleRender)
        } catch (_noTarget) {
          chatTarget = null
        }
        // **没挂上就再试几次** (2026-11-08 真机): 刚建出来的那一场 `binding` 有了但 `target('chat')` 还会抛,
        // 于是界面停在空态、连带"发出去的消息不显示"。`restore()` 那套 250 ms × 20 次的重试只在挂载时跑,
        // 换场 / 新建之后要自己再补一遍
        if (chatTarget === null) retryTarget(id)
        renderFlow()
        renderMeta()
        // 两样跟着这一场走: 模型与权限 (权限只拨不画, 见 [ensureFullAccess]) —— 换了场就重新问一次
        loadModel()
        renderModel()
        ensureFullAccess()
        updateSendGate()
      }

      /**
       * 这一场挂在哪个工作区下 (列表里没有就回空串)
       *
       * `sessions.retain` 只认**当前工作区**加载过的会话, 属于别的工作区的会话会抛
       * `unknown session`; 那种情况得先 `openWorkspace()` 把那个工作区切过去, 再 open 才有效
       */
      function workspaceOf(id) {
        var items = workspaceItems()
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          if (!item || !Array.isArray(item.sessionIds)) continue
          if (item.sessionIds.indexOf(id) < 0) continue
          return String(item.workspaceId || item.id || '')
        }
        return ''
      }
      /** 按**路径**找那个工作区 (冷启动时账本那一场还没进任何列表, 只能从账本的 cwd 认门) */
      function workspaceByPath(path) {
        if (typeof path !== 'string' || path === '') return ''
        var items = workspaceItems()
        var want = path.replace(/\/+$/, '')
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          if (!item) continue
          var mine = String(item.path || item.directory || item.root || '').replace(/\/+$/, '')
          if (mine !== '' && mine === want) return String(item.workspaceId || item.id || '')
        }
        return ''
      }
      /** 工作区服务 (`ctx.get('workspaces')`, 与 [workspaceOf] 同一个取法; 取不到回 null) */
      function workspaceService() {
        try {
          return typeof ctx.get === 'function' ? ctx.get('workspaces') : ctx.workspaces
        } catch (_noService) {
          return null
        }
      }
      /** 现在这一屏上认得的工作区 (列表还没到就是空表: 调用方只按"有没有"分流) */
      function workspaceItems() {
        var service = workspaceService()
        if (!service || !service.list || typeof service.list.getSnapshot !== 'function') return []
        var snapshot = null
        try {
          snapshot = service.list.getSnapshot()
        } catch (_noList) {
          return []
        }
        return snapshot && Array.isArray(snapshot.items) ? snapshot.items : []
      }
      /** 工作区名: 没起过名就用路径最后一节 (dsh 的 `workspaceDisplayTitle` 与这里同一口径) */
      function workspaceTitle(item) {
        var title = item && typeof item.title === 'string' ? item.title.trim() : ''
        if (title !== '') return title
        var path = item && typeof item.path === 'string' ? item.path.replace(/[\\/]+$/, '') : ''
        if (path === '') return '工作区'
        var parts = path.split(/[\\/]/)
        var tail = parts[parts.length - 1]
        return tail === '' ? '工作区' : tail
      }
      /**
       * 那一窗里画哪几行 (纯函数: 判据 `check-luwi-portal` 抽出来真跑)
       * @param {object[]} items `ctx.get('workspaces').list.getSnapshot().items`
       * @param {string} currentWorkspaceId 这一场挂在哪个工作区下 (没有就是空串)
       * @returns {{id: string, title: string, path: string, current: boolean}[]}
       */
      function pickRows(items, currentWorkspaceId) {
        var rows = []
        var list = Array.isArray(items) ? items : []
        for (var i = 0; i < list.length; i += 1) {
          var item = list[i]
          if (!item) continue
          var id = String(item.workspaceId || item.id || '')
          if (id === '') continue
          rows.push({
            id: id,
            title: workspaceTitle(item),
            path: typeof item.path === 'string' ? item.path : '',
            current: id === currentWorkspaceId,
          })
        }
        return rows
      }
      /**
       * 空态要不要给那颗「选工作区」(2026-11-12 #37)
       *
       * 只有**这一场落不到任何地方**时才给: 有工作区也有场次时, 这一屏是"和她说话"的地方,
       * 工作区选择不画 (2026-11-08 主人定的), 首启 / `pm clear` 之后正好是前一种
       */
      function pickWanted() {
        if (workspaceItems().length === 0) return true
        return !(typeof sessionId === 'string' && sessionId !== '')
      }
      /** 让那颗按钮跟着状态走 (空态那张脸建好之后每一拍都对一次; 没有那颗按钮就什么都不做) */
      function syncHeroPick() {
        if (!els.heroPick) return
        els.heroPick.hidden = !pickWanted()
      }

      /**
      /**
       * 这一场还没挂上就再试几次 (2026-11-08 真机)
       *
       * 刚建出来 / 刚切过去的会话，"binding 有了"与"target('chat') 能建"不是同一拍：后者会抛
       * `unknown session` 一类的错，界面于是停在空态（中间那张 Luwi 图）、连带"发出去的消息不显示"。
       * `restore()` 里那套 250 ms × 20 次只在挂载时跑，换场之后要自己补一遍
       */
      function retryTarget(id) {
        var tries = 0
        function again() {
          if (!mounted || sessionId !== id || chatTarget !== null) return
          tries += 1
          if (tries > 20) {
            console.log('[luwi-portal] gave up binding ' + id)
            return
          }
          var binding = bindingOf(id)
          if (binding !== undefined) {
            try {
              chatTarget = ctx.uiConversation.binding(binding).target('chat')
              chatUnsub = chatTarget.subscribe(scheduleRender)
              renderFlow()
              return
            } catch (_noTarget) {
              chatTarget = null
            }
          }
          setTimeout(again, 250)
        }
        setTimeout(again, 250)
      }

      /**
       * 把账本那一场所在的工作区打开 (幂等, 5 秒内不重复切同一个)
       *
       * dsh 只加载**当前工作区**的场次: 别的工作区的会话连 `sessions.binding()` 都拿不到,
       * 而 `openSession` 不一定抛错 (它可能一声不响地什么也没做成)。所以跟随之前先把门打开
       * (2026-11-08 真机: 冷启动时账本那一场在 `dsh-ball`, 界面停在空态)
       */
      function openBallWorkspace(id) {
        if (bindingOf(id) !== undefined) return
        var owner = workspaceOf(id)
        if (owner === '') owner = workspaceByPath(ballWorkspacePath)
        if (owner === '') return
        if (workspaceTry.id === owner && Date.now() - workspaceTry.at <= 5000) return
        workspaceTry.id = owner
        workspaceTry.at = Date.now()
        try {
          ctx.uiWorkspace.openWorkspace(owner)
        } catch (_cannotOpen) {
          console.log('[luwi-portal] openWorkspace failed: ' + describeError(_cannotOpen))
        }
      }
      /**
       * 把这一层切到某一场上, **先轻后重**
       *
       * `adopt` 只读 binding —— 会话在列表里时就有, 门户自己画得出来; `openSession` 是让 dsh 的
       * mainView 也跟过去, 它要先 `sessions.retain()` 得住那个 id, 于是**没在当前列表里的会话会抛**
       * (2026-11-08 真机: 账本指向的历史会话一直切不过去, 门户停在空态, 因为老写法把这一次抛错
       * 当成了"别切了")。所以先试轻的, 画不出来再走重的; 还不行就找它挂在哪个工作区、把那个工作区
       * 切过去 (下一轮 pollLedger 会再试一次 open) —— 三条都不行才退回原来那一场
       *
       * `options.align` (2026-11-10, 方案 `Luwi-门户历史恢复被拽回-方案-2026-11-10.md`): 让 dsh 的
       * mainView 也搬过去 —— **只有人点的换场才传** (历史 / 新对话)。不传的几处 (账本 / 列表 /
       * 冷启动恢复) 行为一个字节不变, 那套 250 ms × 20 次的重试不能被搅乱
       */
      function follow(id, options) {
        if (typeof id !== 'string' || id === '') return false
        var align = !!(options && options.align)
        var before = sessionId
        adopt(id)
        var drawn = chatTarget !== null
        // 只画的那几条腿: 这里就完了 (align 时还得走下面, 让 mainView 一起过去)
        if (drawn && !align) return true
        try {
          ctx.uiWorkspace.openSession(id)
        } catch (error) {
          // `sessions.retain: unknown session` = 这一场没在当前工作区里加载 (归档 / 已删 / 别的工作区)
          // 先把它的工作区打开, 下一轮 pollLedger 再跟 (开门是异步的) —— 画不画已由上面那一腿保证
          openBallWorkspace(id)
          return drawn
        }
        // `replaceMain` 期间 `chatTarget` 可能被换掉: 再 adopt 一次兜住 (同 id 命中 same 分支, 不清界面)
        adopt(id)
        if (chatTarget !== null) return true
        if (typeof before === 'string' && before !== id) adopt(before)
        return false
      }

      /**
       * 账本这一拍该不该跟 (2026-11-10, 纯函数, 判据 `check-luwi-portal` 抽出来真跑)
       *
       * 真值表 (方案 §3.2):
       * - 点历史 (不写账本, `at` 不变) → false —— 翻看不被拽
       * - 球说一句 / 门户开新对话 (`at` 变大) → true
       * - 冷启动首次 (`lastAt === 0`) → true, 只一次
       * - 已经在这一场 (id 相同) → false
       */
      function ledgerShouldFollow(ledger, currentId, lastAt) {
        if (!ledger || ledger.usable !== true) return false
        if (typeof ledger.id !== 'string' || ledger.id === '') return false
        if (ledger.id === currentId) return false
        if (lastAt === 0) return true
        var at = typeof ledger.at === 'number' ? ledger.at : 0
        return at > lastAt
      }

      /**
       * 换场入口收敛 (2026-11-10, 方案 §3.3): 三个入口不再各写各的
       *
       * `source`: 'history' | 'new' | 'ledger' | 'list' | 'restore' —— 人点的 ('history' / 'new')
       * 让 mainView 一起过去, 其余三条只画. 每次切换打一行, 以后一眼定责 (这次排查就卡在
       * "不知道谁拽的")
       */
      function switchTo(id, source) {
        if (typeof id !== 'string' || id === '') return false
        console.log('[luwi-portal] switch by=' + source + ' id=' + id)
        if (source === 'history') return follow(id, { align: true })
        if (source === 'new') return follow(id, { align: true })
        // ledger / list / restore: 只画, 不反向改 dsh
        if (source === 'list') {
          // 会话表变了: 与原来那条 `adopt(id)` 行为不变 (只换订阅源, 不走重的 openSession)
          adopt(id)
          return chatTarget !== null
        }
        return follow(id)
      }

      /**
       * 开一场新对话 (2026-11-08 主人: "点击左上角 luwi 开新界面")
       *
       * `startSession()` 不带参数时落的是"这个工作区里可复用的空白场", 没有才新建 —— 所以这一下
       * 拿到的必定是一张空对话 (清空的是这一层的视野, 旧会话不删不归档)。
       *
       * 三个坑都在这里收掉:
       * 1. 它是 `void`: 新场什么时候被选中只能等 (`currentSessionId()` 变了才算数)
       * 2. 账本还指着旧场: 3 s 之后 `pollLedger` 会把界面拽回去 —— 于是当场 `portalBind`
       * 3. 桥写不进去 (没有桥 / 宿主拒了): 再拿 `ledgerHoldUntil` 兜 15 s
       */
      function newConversation() {
        if (navigating) return
        var prev = sessionId
        navigating = true
        try {
          ctx.uiWorkspace.startSession()
        } catch (_cannotStart) {
          navigating = false
          // 多半是"还没有工作区": dsh 那一屏被这一层盖着, 所以直接把选工作区那一窗张出来 (2026-11-12 #37)
          showNote('还没有工作区, 先选一个', true)
          openPick()
          return
        }
        var tries = 0
        function look() {
          tries += 1
          var id = currentSessionId()
          if (id !== null && bindingOf(id) !== undefined) {
            land(id)
            return
          }
          if (tries >= 24) {
            navigating = false
            // 这中间人可能已经从「选工作区」落进去了: 那就什么都不用说
            if (sessionId === null) {
              showNote('没开出来, 先选一个工作区', true)
              openPick()
            }
            return
          }
          setTimeout(look, 150)
        }
        function land(id) {
          navigating = false
          var same = prev !== null && prev === id
          // 三件套的第二件: 让 dsh 的 mainView 也搬到这一场 (source 'new' 自带 align)
          switchTo(id, 'new')
          bound = id
          call('portalBind', id)
          ledgerHoldUntil = Date.now() + 15000
          renderMeta()
          if (same) {
            showNote('已经是新对话了')
            return
          }
          showUndo()
        }
        setTimeout(look, 150)
      }

      /**
       * 新建之后那 8 秒的读数: 只是告诉人"这一下做了什么"
       *
       * **不做「撤销」** (2026-11-08 真机定): 上一场在切走后会被 dsh 卸载, 回来要重新 `openSession`,
       * 而 `sessions.retain` 只认当前工作区里还挂着的会话 —— 实测 `unknown session`, 重试 3.2 s 也
       * 救不回来。摆一颗按下去只回一句"打不开了"的按钮, 比没有这颗按钮更糟
       */
      function showUndo() {
        if (!els.undo) return
        els.undo.hidden = false
        if (undoTimer !== null) clearTimeout(undoTimer)
        undoTimer = setTimeout(hideUndo, 8000)
      }

      function hideUndo() {
        if (undoTimer !== null) clearTimeout(undoTimer)
        undoTimer = null
        if (els.undo) els.undo.hidden = true
      }

      function scheduleRender() {
        if (renderTimer !== null) return
        renderTimer = setTimeout(function () {
          renderTimer = null
          if (mounted) renderFlow()
        }, RENDER_MS)
      }

      /* ── 她说的话: 取 / 排队 / 放 (§3.2–3.4) ───────────────────────────────── */

      /** 桥上一个**两参**方法 (`portalOut` 要 id 与水位; [call] 只传一个) */
      function call2(method, first, second) {
        var api = bridge()
        if (api === null || typeof api[method] !== 'function') return null
        try {
          var raw = api[method](first, second)
          if (typeof raw !== 'string' || raw === '') return null
          return JSON.parse(raw)
        } catch (_bad) {
          return null
        }
      }

      /**
       * 这一场用的是哪一档预设 (读不到就回空串)
       *
       * 三处都试: 会话面自己的 `meta` / 顶层字段 / 聊天快照的 `meta` —— 上游把这一笔放在哪儿改过一次,
       * 而这里只关心"是不是 luwi"。空串按 luwi 处理 (它是默认档)
       */
      function presetOf() {
        var session = sessionOf()
        var snapshot = null
        if (chatTarget !== null) {
          try {
            snapshot = chatTarget.getSnapshot()
          } catch (_noSnapshot) {
            snapshot = null
          }
        }
        // 这一场的档到底在哪 (2026-11-08 真机核出来的): `sessions.binding()` 给的 session 上没有
        // `meta.agentPreset`, 也没有裸的 `agentPreset` —— 权威那一份在**投影**里
        // (`session.projections` 是 ProjectionValueStore: `.get(key)` / `.values()`), 由 header 初始化,
        // 之后跟着 `agent-preset/selected` 事件走。读不到投影才退 header 与快照上那几个老位置
        var candidates = [
          readProjection(session),
          session && session.meta && session.meta.agentPreset,
          session && session.agentPreset,
          session && session.header && session.header.agentPreset,
          snapshot && snapshot.meta && snapshot.meta.agentPreset,
          snapshot && snapshot.agentPreset,
        ]
        for (var i = 0; i < candidates.length; i++) {
          var one = candidates[i]
          if (typeof one === 'string' && one !== '') return one
        }
        return ''
      }

      /** 会话投影里的 `agentPreset` (ProjectionValueStore: 先 `get`, 再 `values()`) */
      function readProjection(session) {
        var store = session && session.projections
        if (!store) return undefined
        try {
          if (typeof store.get === 'function') {
            var direct = store.get('agentPreset')
            if (typeof direct === 'string' && direct !== '') return direct
          }
          if (typeof store.values === 'function') {
            var all = store.values()
            var one = all && all.agentPreset
            if (typeof one === 'string' && one !== '') return one
          }
        } catch (_noProjection) {
          return undefined
        }
        return undefined
      }

      /**
       * 这一场走不走"发言只走 lw_say"那条流
       *
       * `luwi` 与"读不到"都算走; 别的档 (custom / explore / proactive / 酒馆) 走老路 —— 那些档没有
       * `lw_say` 的规矩, 不画正文的话屏上只剩自己说的话, 看起来像她死了 (方案 §3.4 末段)
       */
      function luwiFlow() {
        var preset = presetOf()
        return preset === '' || preset === 'luwi'
      }

      /** jsonl 的一行 → 流里的一项 */
      function outItemOf(line) {
        var kind = typeof line.kind === 'string' ? line.kind : 'text'
        var item = {
          who: 'assistant',
          time: Number(line.at) || 0,
          seq: line.seq,
          // 她自己那几行的身份就是 jsonl 的 `seq` (宿主单写者, 从起来时 tail 取 max 起单调加) ——
          // 写进 `id` 是为了与 user / 兜底 / note 那三处走同一套身份 (见 [itemKey])
          id: 'out\u0001' + String(line.seq),
          kind: kind,
          text: typeof line.text === 'string' ? line.text : '',
        }
        if (kind === 'sticker') {
          item.sticker = typeof line.sticker === 'string' ? line.sticker : ''
          item.text = ''
        } else if (kind === 'image') {
          item.image = typeof line.rel === 'string' ? line.rel : ''
          // 宿主那一行带着原图的宽高: 门户拿它把比例先钉住 (解码前就有高度, 见 imageBubble)
          item.w = Number(line.w) || 0
          item.h = Number(line.h) || 0
        } else if (kind === 'file') {
          // 她递来的一份文件 (2026-11-09): 行里只有 `rel` / `name` / `bytes` —— 门户只写名字
          item.file = {
            rel: typeof line.rel === 'string' ? line.rel : '',
            name: typeof line.name === 'string' ? line.name : '',
            bytes: Number(line.bytes) || 0,
          }
        }
        return item
      }

      /**
       * 取一次
       *
       * `reset` = 重新拿全量 (打开 / 换会话, **一次画完不排队**); 否则只取 `seq > outNext` 的尾巴,
       * 逐条按 `gapMs` 排队
       */
      function loadOut(reset) {
        if (typeof sessionId !== 'string' || sessionId === '') {
          outLines = []
          outKey = ''
          outNext = 0
          releasedIds = {}
          seenSeq = {}
          outQueue = []
          return
        }
        if (reset || outKey !== sessionId) {
          outKey = sessionId
          outQueue = []
          if (outTimer !== null) clearTimeout(outTimer)
          outTimer = null
          var full = call2('portalOut', sessionId, 0)
          outLines = full && Array.isArray(full.lines) ? full.lines : []
          releasedIds = {}
          seenSeq = {}
          for (var i = 0; i < outLines.length; i++) {
            releasedIds[outLines[i].seq] = true
            seenSeq[outLines[i].seq] = true
          }
          outNext = full && typeof full.next === 'number' ? full.next : 0
          outReleaseAt = Date.now()
          // 打开 / 换一场: 一次画完, 并且把视线放到底 (接到上次那句)
          flowForceBottom = true
          return
        }
        var tail = call2('portalOut', sessionId, outNext)
        var lines = tail && Array.isArray(tail.lines) ? tail.lines : []
        if (lines.length === 0) return
        var fresh = []
        for (var k = 0; k < lines.length; k++) {
          var one = lines[k]
          if (seenSeq[one.seq] === true) continue
          seenSeq[one.seq] = true
          outLines.push(one)
          fresh.push(one)
        }
        if (fresh.length === 0) return
        // **取水位立刻推到这一批的尾**: 原来只在"上屏那一刻"推进, 于是两次 `onOut` 之间还没放完时, 第二次
        // 会把同一批再取一遍 —— 2026-11-08 真机上就是这么炸的 (一串重复的表情泡)。显示仍然只认
        // `releasedIds`, 所以"取"与"画"两件事分开, 撤队也不会让已经取过的条再冒出来
        if (Number(fresh[fresh.length - 1].seq) > outNext) outNext = Number(fresh[fresh.length - 1].seq)
        for (var j = 0; j < fresh.length; j++) outQueue.push(fresh[j])
        pumpOut()
      }

      /**
       * 队列那一拍: 到点了就放一条
       *
       * **水位只在上屏那一刻推进** (`outNext = seq`): 提前推进的话, 还没上屏的条一旦被撤队就永远
       * 读不回来了
       */
      function pumpOut() {
        if (outTimer !== null) return
        if (outQueue.length === 0) return
        var head = outQueue[0]
        var now = Date.now()
        // "到点"= 上一行上屏那一刻 + 这一行自己那个 gapMs; 上一行已经放了很久时它等于现在
        var due = outReleaseAt > 0 ? outReleaseAt + (Number(head.gapMs) || 0) : now
        var wait = due - now
        if (wait > 0) {
          outTimer = setTimeout(function () {
            outTimer = null
            pumpOut()
          }, wait)
          return
        }
        outQueue.shift()
        releasedIds[head.seq] = true
        if (Number(head.seq) > outNext) outNext = Number(head.seq)
        outReleaseAt = Date.now()
        renderFlow()
        if (outQueue.length > 0) {
          outTimer = setTimeout(function () {
            outTimer = null
            pumpOut()
          }, 0)
        }
      }

      /**
       * 撤队 + 清定时器 (**过时的话比不说更糟**, 这条口径与 `OverlayService` 那侧同一句)
       *
       * 四个事件各有一条闸: 新的 user turn ([nodesOf] 里那条指纹比较)、换会话 ([adopt])、收门户 /
       * 退到后台 ([unmount] 与 `visibilitychange`)、以及"只有一边在场"时另一处照常发 (两处各自 try,
       * 一边失败不带垮另一边)
       */
      function clearOut(reason) {
        if (outQueue.length > 0 || outTimer !== null) {
          console.log('[luwi-portal] dropped ' + outQueue.length + ' unsaid line(s): ' + reason)
        }
        outQueue = []
        if (outTimer !== null) clearTimeout(outTimer)
        outTimer = null
      }

      /** 一轮在跑吗 (复用 `lw/ball-phase.json`, 与球上那三个字同一份, 不另造) */
      function phaseThinking() {
        return !!(status && status.phase && status.phase.thinking === true)
      }

      /**
       * 这一条 user 消息里有没有图片块 (2026-11-09 改写)
       *
       * **不再从块里翻名字**: 会话落盘后 image 块只剩 `{type:'image', attachment:{attachmentId,…}}`,
       * 名字与字节都没有。附件那几个名字由 `splitAttach()` 从正文里认 (`attachLines()` 写进去的那一段),
       * 这里只回答"有没有图" —— 有图却找不到落盘那份时, 界面补一行「（图）», 不静默
       */
      function hasImageBlock(blocks) {
        if (!Array.isArray(blocks)) return false
        for (var i = 0; i < blocks.length; i += 1) {
          var block = blocks[i]
          if (!block || typeof block !== 'object') continue
          var kind = typeof block.type === 'string' ? block.type : block.kind
          if (kind === 'image') return true
        }
        return false
      }

      /**
       * 当前这一场的消息: user 节点 + 她说的话那份 jsonl, **按轮**合并 (2026-11-10)
       *
       * 两路流只按墙上时钟合并不够 (缺时间 / 同毫秒 / 宿主补句晚写都会把两条排反) —— 这里先把它们
       * 收成 `users` / `rows` / `extras` 三份, 再交给 [orderTimeline] 按"轮"排
       */
      function nodesOf() {
        if (chatTarget === null) return []
        var snapshot
        try {
          snapshot = chatTarget.getSnapshot()
        } catch (_noSnapshot) {
          return []
        }
        if (!snapshot) return []
        var legacy = snapshot.legacy || {}
        var nodes = Array.isArray(legacy.nodes) ? legacy.nodes : []
        var users = []
        var rows = []
        var extras = []
        var fingerprint = []
        var userSeqs = []
        // 这一轮到底该画正文还是画她说的话: 交给下面的"兜底"那一段判, 不在这里按档一刀切
        /** 这一轮的第一条 user 时刻 (兜底判据: 这之后有没有说出过东西) */
        var lastUserTime = 0
        /**
         * 同一条身份出现两次时给后出现的那条加一个序号
         *
         * 身份优先用 dsh 给的 id (见下面三级回退), 万一两条撞了 (同名 / 同 seq) 就让位置区分 ——
         * 方案 §6 那条"id + 位置可避免撞", 位置只在这条兜底里进 key, 正常的行不带上它
         */
        var usedIds = {}
        function uniqueId(raw) {
          if (raw === '') return ''
          var count = usedIds[raw] || 0
          usedIds[raw] = count + 1
          return count === 0 ? raw : raw + '\u0001#' + String(count)
        }
        /** luwi 档里这一轮最后一句正文 (只在"一条都没说出"时兜底画) */
        var assistantFallback = ''
        /** 兜底行属于哪一轮 (users 下标); -1 = 还没有 user 节点 */
        var assistantOwner = -1
        // 每画一次就报一行 (诊断用, 认的是"节点里到底有什么"): 档 / 节点种类 / 是否画正文
        try {
          var kinds = []
          for (var n = 0; n < nodes.length; n += 1) kinds.push(String(nodes[n] && nodes[n].kind))
          var kindsNow = kinds.join(',')
          if (shownKinds !== kindsNow) {
            shownKinds = kindsNow
            console.log('[luwi-portal] nodes=' + kindsNow + ' preset=' + presetOf() + ' out=' + String(outLines.length))
          }
        } catch (_noDiag) {
          console.log('[luwi-portal] diag failed: ' + String(_noDiag))
        }
        for (var i = 0; i < nodes.length; i += 1) {
          var node = nodes[i]
          if (!node) continue
          if (node.kind === 'user' || node.kind === 'steering') {
            lastUserTime = Number(node.time) || lastUserTime
            // 附件那一段从正文里拆出去: 气泡里只留人话, 图与文件各自画 (2026-11-09)
            var split = splitAttach(textOf(node.content))
            // **稳定身份** (2026-11-10, 方案 docs/Luwi-门户发送瞬重建-方案-2026-11-10.md §2):
            // 以前身份里放的是 `time`, 而发送那一瞬间 `time` 会从"上一轮那条"变成"这一条" ——
            // 落在非末尾位置就整块重建. dsh 快照自带三个稳定字段, 三级回退取第一个有值的:
            // `messageId` (落盘后稳定) → `source.rpcId` (回显与落盘同一个值) → `seq:N`;
            // 一个都没有才留空 (= 退到时间, 与今天的行为一样, 不会更糟)
            var stableId = node.messageId
            if (stableId === undefined || stableId === null || String(stableId) === '') {
              stableId = node.source && node.source.rpcId
            }
            if (stableId === undefined || stableId === null || String(stableId) === '') {
              stableId = node.seq === undefined || node.seq === null ? '' : 'seq:' + String(node.seq)
            }
            var userId = stableId === '' ? '' : uniqueId('user\u0001' + String(stableId))
            users.push({
              who: 'user',
              id: userId,
              time: node.time,
              seq: node.seq,
              text: split.main,
              attach: split.names,
              hasImage: hasImageBlock(node.content),
            })
            fingerprint.push(node.seq)
            userSeqs.push(node.seq)
          } else if (node.kind === 'assistant') {
            var blocks = node.blocks !== undefined ? node.blocks : node.content
            var assistantSaid = textOf(blocks)
            // (2026-11-08 真机) 两档同一套规矩: 这一轮**说得出来**就只画她说的 (lw_say 那几条),
            // 说不出来 (忘了调工具 / 这一档压根不讲 lw_say) 才把正文最后一句兜底画上 —— 否则屏上
            // 要么一个字都没有 (luwi 档), 要么同一句画两遍 (非 luwi 档又调了 lw_say)
            // 2026-11-10: 兜底行钉在**它自己那一轮**上 (`assistantOwner`), 新消息进来不再改嫁
            if (assistantSaid !== '') {
              assistantFallback = assistantSaid
              assistantOwner = users.length - 1
            }
          } else if (node.kind === 'turn-error' || node.kind === 'error') {
            var reason = node.error || {}
            var message = reason.message || node.message || '本轮运行失败'
            extras.push({ who: 'error', time: node.time, seq: node.seq, text: String(message) })
            fingerprint.push(node.seq)
          }
        }
        streamKey = fingerprint.join(',')
        // 新的一条 user 节点 = 新一轮: 还没上屏的旧条不说了 (方案 §3.4 第一条闸)
        var userKeyNow = userSeqs.join(',')
        if (userKey !== '' && userKeyNow !== userKey) {
          // 新一轮: 把视线拉回底部 (自己刚发了一句, 屏上得看见它)
          flowForceBottom = true
          if (outQueue.length > 0) clearOut('a new turn started')
        }
        userKey = userKeyNow
        // 她说的话: 只画"已放出"的行 (水位内的那些), 不再在渲染里自己排队
        for (var k = 0; k < outLines.length; k++) {
          var line = outLines[k]
          if (releasedIds[line.seq] !== true) continue
          rows.push(outItemOf(line))
        }
        // 兜底正文 (2026-11-10 收紧):
        // - `luwi` 档的正文只当过程, 宿主 turn end 已经往同一份 jsonl 补了一行 (球与门户逐字同源),
        //   所以**不再兜底** —— 以前补句还没取回来时先画一句、补句一到再换, 就是"两句并存 / 顺序跳
        //   一下"的根之一。唯一例外: 整场 jsonl 一条都没有 (宿主写不进去) 才兜一句
        // - 非 luwi 档没有 lw_say 规矩, 正文就是她说的话; 兜底钉在**它自己那一轮** (`pinnedTo`),
        //   新消息进来不再改嫁
        if (assistantFallback !== '' && !phaseThinking()) {
          var spoke = false
          // **已经取到、还没放出来的行也算"她说了"** (补句可能还在 `gapMs` 那一拍里排队)
          for (var s = 0; s < outLines.length; s += 1) {
            if (Number(outLines[s].at) >= lastUserTime) spoke = true
          }
          var allowFallback = !luwiFlow() || outLines.length === 0
          if (allowFallback && !spoke && assistantOwner >= 0) {
            extras.push({
              who: 'assistant',
              // 兜底行的身份挂在**它所依附的那条 user** 上 (方案 §2.2), 而它所依附的是
              // `assistantOwner` 那一轮的 user —— 不是"最新一条 user"
              id: users[assistantOwner].id === '' ? '' : 'fallback\u0001' + users[assistantOwner].id,
              time: Number(users[assistantOwner].time) || 0,
              text: assistantFallback,
              fallback: true,
              pinnedTo: assistantOwner,
            })
            if (shownPreset !== 'fallback') {
              shownPreset = 'fallback'
              console.log('[luwi-portal] 这一轮没有 lw_say, 正文兜底画了一句')
            }
          }
        }
        // 本机那几条「图片发送失败」 (落实表 #35, 2026-11-12): 与 dsh 的 turn-error 同一档 (`who:'error'`),
        // 按它自己那一刻归轮 —— 不进 dsh 的会话账, 也不发给模型
        for (var f = 0; f < imageFails.length; f += 1) {
          extras.push({
            who: 'error',
            id: imageFails[f].id,
            time: imageFails[f].at,
            text: imageFails[f].text,
          })
        }
        return orderTimeline(users, rows, extras)
      }

      /**
       * 把两路流按「轮」排成一条 (2026-11-10, 方案 `docs/Luwi-门户附件条与时间线-方案-2026-11-10.md`)
       *
       * 输入三份 (调用方已按各自来源的顺序放好):
       * - `users`: dsh 的 user / steering 节点, **按节点顺序**
       * - `rows`: 她的话 (jsonl 里已放出的行), 按 `seq` 升序
       * - `extras`: 兜底正文行 (带 `pinnedTo` = 它所属那一轮的 user 下标) 与 turn-error
       *
       * 四条口径:
       * 1. **轮内**: user -> 她的行 (按 seq) -> error -> 兜底; 她的行不再跟 user 比时间
       * 2. **轮边界**: 行按 `at` 归到最后一个 `turnTime < at` 的轮 (严格小于: 同一毫秒算上一轮,
       *    免得上一轮的一句掉到刚发的新消息下面)
       * 3. **缺时间**: user 的时间读不到时沉到 `maxKnown` 之后 (dsh 是追加的, 它就是最新那条);
       *    她的行 `at` 读不到时归最后一轮、沉到已知行后面
       * 4. **确定**: 最后按 `(桶, rank, seq, 原下标)` 排, 同毫秒不再靠插入顺序
       *
       * @param {object[]} users dsh 的 user / steering 节点 (按节点顺序)
       * @param {object[]} rows 她的话 (按 seq)
       * @param {object[]} extras 兜底正文行与 turn-error
       * @returns {object[]} 排好的那一串 (显示用的 `time` 原样不动)
       */
      function orderTimeline(users, rows, extras) {
        var i
        // 第一遍: 已知时间的最大值 —— 缺时间的 user 要沉到它之后, 不能排到已知时间前面
        var maxKnown = 0
        for (i = 0; i < users.length; i += 1) {
          var knownUser = Number(users[i].time) || 0
          if (knownUser > maxKnown) maxKnown = knownUser
        }
        for (i = 0; i < rows.length; i += 1) {
          var knownRow = Number(rows[i].time) || 0
          if (knownRow > maxKnown) maxKnown = knownRow
        }
        for (i = 0; i < extras.length; i += 1) {
          var knownExtra = Number(extras[i].time) || 0
          if (knownExtra > maxKnown) maxKnown = knownExtra
        }
        // 轮的边界: 单调不减; 缺时间的一条给 `maxKnown + 序号` (它是最新那条)
        var turnTime = []
        var floor = 0
        var missing = 0
        for (i = 0; i < users.length; i += 1) {
          var raw = Number(users[i].time) || 0
          var stamp
          if (raw > 0) {
            stamp = raw
            missing = 0
          } else {
            missing += 1
            stamp = maxKnown + missing
          }
          if (stamp < floor) stamp = floor
          floor = stamp
          turnTime.push(stamp)
        }
        /**
         * 一条时间落在哪一轮: 最后一个 `turnTime < at`; 落在第一轮之前 = 前奏 (主动场那种)
         *
         * 严格小于是有意的: 同一毫秒算**上一轮** (宿主的 turn end 补句就贴在轮尾, 补得慢时可能跟
         * 下一条 user 消息同一个毫秒); 但 `at` 正好等于第一轮那一刻时归第一轮, 不沉到前奏去
         */
        function turnOf(at) {
          if (turnTime.length === 0) return -1
          var mark = Number(at) || 0
          if (mark <= 0) return turnTime.length - 1
          var found = -1
          for (var b = 0; b < turnTime.length; b += 1) {
            if (turnTime[b] < mark) found = b
            else break
          }
          if (found < 0 && mark >= turnTime[0]) return 0
          return found
        }
        /** 轮内的先后: user -> 她的行 -> error -> 兜底 */
        function rankOf(item) {
          if (item.who === 'user') return 0
          if (item.who === 'error') return 2
          if (item.fallback) return 3
          return 1
        }
        function seqOf(item) {
          var value = Number(item.seq)
          return isFinite(value) ? value : 0
        }
        function sortBucket(list) {
          var wrapped = []
          for (var j = 0; j < list.length; j += 1) wrapped.push({ item: list[j], at: j })
          wrapped.sort(function (a, b) {
            var byRank = rankOf(a.item) - rankOf(b.item)
            if (byRank !== 0) return byRank
            var bySeq = seqOf(a.item) - seqOf(b.item)
            if (bySeq !== 0) return bySeq
            return a.at - b.at
          })
          var out = []
          for (var k = 0; k < wrapped.length; k += 1) out.push(wrapped[k].item)
          return out
        }
        var buckets = []
        for (i = 0; i < users.length; i += 1) buckets.push([users[i]])
        var prelude = []
        for (i = 0; i < rows.length; i += 1) {
          var where = turnOf(rows[i].time)
          if (where < 0) prelude.push(rows[i])
          else buckets[where].push(rows[i])
        }
        for (i = 0; i < extras.length; i += 1) {
          var extra = extras[i]
          var pin = Number(extra.pinnedTo)
          var bucket = extra.pinnedTo !== undefined && isFinite(pin) && pin >= 0 && pin < buckets.length
            ? pin
            : turnOf(extra.time)
          if (bucket < 0) prelude.push(extra)
          else buckets[bucket].push(extra)
        }
        var kept = []
        var head = sortBucket(prelude)
        for (i = 0; i < head.length; i += 1) kept.push(head[i])
        for (i = 0; i < buckets.length; i += 1) {
          var one = sortBucket(buckets[i])
          for (var m = 0; m < one.length; m += 1) kept.push(one[m])
        }
        return kept
      }
      /**
       * 空态: 中间那一张脸 (2026-11-08 主人: "对话界面中间显示 luwi 及其图标")
       *
       * 有消息时这一块不画 —— 那会儿屏幕中间归对话。**没有「开一场」那颗按钮**了
       * (2026-11-09 主人: "不需要用户手动点击开一场, 新界面里自动开始新对话"): 空着的时候
       * [autoStart] 已经自己开了一场, 这张脸只在这半秒里出现
       *
       * **2026-11-12 #37**: 一场都落不下去时 (首启还没有工作区) 多摆一颗「选工作区」——
       * dsh 那一屏被这一层盖着, 没有这颗按钮就没有任何入口, 发什么也发不出去
       */
      function heroNode() {
        var hero = h('div')
        hero.id = 'lwp-hero'
        var wrap = h('div', 'lwp-hero-mark')
        // 自定义头像才加那圈描边 (品牌图自带留白, 再套一圈只会显脏)
        wrap.setAttribute('data-photo', identity.avatar !== '' && identity.avatar !== MARK_PNG ? 'on' : 'off')
        els.heroMark = wrap
        var img = document.createElement('img')
        // 空态那张脸与头栏用同一份身份 (2026-11-10: 外观里改完这两处一起变)
        img.src = identity.avatar === '' ? MARK_PNG : identity.avatar
        img.alt = ''
        els.heroImg = img
        wrap.appendChild(img)
        hero.appendChild(wrap)
        els.heroName = h('div', 'lwp-hero-name', identity.name === '' ? DEFAULT_NAME : identity.name)
        hero.appendChild(els.heroName)
        hero.appendChild(h('div', 'lwp-hero-line', sessionId === null
          ? (workspaceItems().length === 0 ? '还没有工作区，先选一个' : '正在开一场新的')
          : '在的，说吧'))
        // 原生 `<button>`: 无障碍树里就是一颗可点的按钮 (真机 uiautomator 读 clickable=true)
        var pick = h('button', 'lwp-hero-pick', '选工作区')
        pick.id = 'lwp-pick-workspace'
        pick.type = 'button'
        pick.setAttribute('aria-label', '选工作区')
        pick.onclick = function () { openPick() }
        els.heroPick = pick
        hero.appendChild(pick)
        syncHeroPick()
        return hero
      }

      /**
       * 进来就自己开一场 (2026-11-09 主人: "不需要用户手动点击开一场, 新界面里自动开始新对话")
       *
       * **只试一次**: `newConversation()` 自己会把失败说清楚 (没有工作区 / 没开出来), 这里再重试
       * 只会把那条提示刷掉。`sessionId` 已经有值就一个字节都不动 —— 那是"回来接着聊", 不是新开一场;
       * `restore()` 恢复的那一场也算有值
       */
      function autoStart() {
        if (autoStartTried) return
        autoStartTried = true
        if (typeof sessionId === 'string' && sessionId !== '') return
        newConversation()
      }

      /**
       * 段落切分: 相邻两条隔 30 分钟以上, 或者跨了一天, 就另起一段
       *
       * 时间读不到 (0 / 缺字段) 的那条不参与比较, 只跟着上一段走 —— 拿 1970 去比会切出一堆段
       */
      function sectionsOf(items) {
        var sections = []
        var current = null
        var last = 0
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          var time = Number(item.time)
          var known = isFinite(time) && time > 0
          var fresh = current === null
            || (known && last > 0 && time - last > SECTION_GAP_MS)
            || (known && last > 0 && dayKey(time) !== dayKey(last))
          if (fresh) {
            current = { time: known ? time : 0, items: [] }
            sections.push(current)
          }
          current.items.push(item)
          if (known) last = time
        }
        return sections
      }

      /**
       * 先把解码排上, 再让这一行上屏
       *
       * **占位宽度已经写死在 CSS 里** (`.lwp-sticker img` 是 120×120 的方框), 所以就算还没解完,
       * 行高也是最终那个高度 —— 这一步只是把"第一帧空框、第二帧才冒出图"那一下省掉。
       * 解不开就交给 `img.onerror` 那条路 (取不到的表情本来就要说一句)
       */
      function settleDecode(img) {
        if (!img || typeof img.decode !== 'function') return
        var pending
        try {
          pending = img.decode()
        } catch (_noDecode) {
          return
        }
        if (pending && typeof pending.catch === 'function') {
          pending.catch(function () {
            // 失败由 onerror 兜: 这里再抛一次只会变成一条没人看的 unhandled rejection
          })
        }
      }

      /**
       * 一张表情: 能取到就画那张小图 (走 `/lw-out/stickers/<名字>`, 宿主按裸名字在 `lw/stickers` 里找),
       * 取不到就退回一行「（表情：名字）」—— 不静默, 也不假装贴过
       */
      function stickerBubble(name) {
        var wrap = h('div', 'lwp-sticker')
        var img = document.createElement('img')
        img.alt = ''
        // 先占位再解码: 宽高写在属性上 (CSS 也钉成 120 的方框), 行高在解码前后一模一样
        img.width = STICKER_BOX
        img.height = STICKER_BOX
        if ('decoding' in img) img.decoding = 'async'
        // 行里给的名字可能带扩展名 (`开心.png`), 而这条路按裸名字找 —— 两头都收
        img.src = '/lw-out/stickers/' + encodeURIComponent(stemOf(name))
        img.onerror = function () {
          wrap.setAttribute('data-broken', 'on')
          wrap.textContent = '（表情：' + name + '）'
        }
        wrap.appendChild(img)
        settleDecode(img)
        return wrap
      }

      /**
       * 一张图 (她说过的图走宿主那条只读路由, 同源; 取不到就照实说一句)
       *
       * **点一下 = 预览窗** (2026-11-09 主人: "点击可用预览窗口查看"): 框里那张图有 60vh 上限,
       * 看全要靠那一窗。`rel` 与 `name` 一起带过去 —— 预览窗按名字分路 (图 / 文本 / PDF / 办公)
       */
      function imageBubble(item) {
        var wrap = h('div', 'lwp-image')
        var img = document.createElement('img')
        img.alt = ''
        var rel = String(item && item.image ? item.image : '')
        // 行里带 `w`/`h` 就把比例先钉住 (解码前就有高度, 下面那条不会被顶一下)
        var iw = Number(item && item.w ? item.w : 0)
        var ih = Number(item && item.h ? item.h : 0)
        if (iw > 0 && ih > 0) {
          img.width = iw
          img.height = ih
          img.style.aspectRatio = String(iw) + ' / ' + String(ih)
        }
        if ('decoding' in img) img.decoding = 'async'
        img.src = '/lw-out/' + rel
        img.onerror = function () {
          // **不静默**: "她说过的图没了"与"图没传上来"是两件事, 界面上得分得开 (§4.5)
          wrap.setAttribute('data-broken', 'on')
          wrap.textContent = '图没取到'
          wrap.onclick = null
        }
        wrap.appendChild(img)
        settleDecode(img)
        var leaf = rel.substring(rel.lastIndexOf('/') + 1)
        wrap.onclick = function () { openPreview({ rel: rel, name: leaf, bytes: 0 }) }
        return wrap
      }

      /**
       * 一份文件: **只写文件名** (2026-11-09 主人: "只显示文件名, 能打开的文件名都是蓝色的可以点击")
       *
       * `file.rel` 是 `/lw-out/` 后面那一段 (`assets/…` 是她递来的, `in/…` 是自己发上去的);
       * 点开就是预览窗。字节数只进 `title`, 不占屏上一格
       */
      function fileChip(file, side) {
        var wrap = h('button', 'lwp-file')
        wrap.type = 'button'
        if (side !== undefined) wrap.setAttribute('data-side', String(side))
        var name = String(file && file.name ? file.name : '文件')
        var bytes = Number(file && file.bytes ? file.bytes : 0)
        var size = sizeText(bytes)
        if (size !== '') wrap.title = name + ' · ' + size
        var glyph = h('span', 'lwp-file-glyph')
        glyph.innerHTML = FILE_ICON
        wrap.appendChild(glyph)
        wrap.appendChild(h('span', 'lwp-file-name', name))
        wrap.onclick = function () { openPreview(file) }
        return wrap
      }

      /* ── 预览窗 (2026-11-09 主人: "点击文件名后弹出预览窗口, 和权限选择窗口一样大小") ─── */

      /**
       * 打开预览
       *
       * 尺寸照 `ReadyPermissionsDialog` 那一窗: 居中 / 左右各留 20dp / 高封 78% / 遮罩 40% 黑,
       * 见样式里的 `#lwp-preview`。内容分四路 —— 图给图, 文本给 `<pre>`, Office 交给
       * `lw-docx-preview` 的 `renderOffice` 进 shadow root (2026-11-09 主人: "docx，pptx 等办公
       * 文件能在预览界面里显示"), 其它照实说一句再给一颗"交给系统里接它的应用"
       */
      function openPreview(file) {
        if (!els.preview) return
        var rel = String(file && file.rel ? file.rel : '')
        var name = String(file && file.name ? file.name : '文件')
        var bytes = Number(file && file.bytes ? file.bytes : 0)
        els.previewName.textContent = name
        els.previewBody.textContent = ''
        // 上一份可能是 Office (那一档会改内边距); 换一档就把它摘掉
        els.previewBody.removeAttribute('data-kind')
        if (rel === '') {
          els.previewBody.appendChild(h('div', 'lwp-preview-note', '这一份没有留下路径, 打不开'))
        } else if (isImageName(name)) {
          var img = document.createElement('img')
          img.alt = ''
          img.src = '/lw-out/' + rel
          img.onerror = function () {
            els.previewBody.textContent = ''
            els.previewBody.appendChild(h('div', 'lwp-preview-note', '这个文件现在取不到'))
          }
          els.previewBody.appendChild(img)
          // 图在固定大小的窗里居中 (样式见 data-kind="image" 那一条)
          els.previewBody.setAttribute('data-kind', 'image')
        } else if (isTextName(name)) {
          var note = h('div', 'lwp-preview-note', '正在取…')
          els.previewBody.appendChild(note)
          fetch('/lw-out/' + rel, { cache: 'no-store' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            var cut = res.headers.get('X-Lw-Truncated') === '1'
            return res.text().then(function (text) { return { text: text, cut: cut } })
          }).then(function (got) {
            els.previewBody.textContent = ''
            els.previewBody.appendChild(h('pre', 'lwp-preview-text', got.text === '' ? '(空文件)' : got.text))
            if (got.cut) els.previewBody.appendChild(h('div', 'lwp-preview-note', '后面还有, 没全显示'))
          }).catch(function (error) {
            els.previewBody.textContent = ''
            var trouble = h('div', 'lwp-preview-note', '这个文件现在取不到: ' + describeError(error))
            trouble.setAttribute('data-error', 'on')
            els.previewBody.appendChild(trouble)
          })
        } else if (isOfficeName(name)) {
          openOfficePreview(rel, name)
        } else {
          // 这一层解不开 (zip / 老格式 doc / ppt / xls …): 照实说一句, 再给一颗"交给系统里的应用"
          var size = sizeText(bytes)
          var line = size === ''
            ? name + ' · 这类文件在这里看不了内容'
            : name + ' · ' + size + ' · 这类文件在这里看不了内容'
          els.previewBody.appendChild(h('div', 'lwp-preview-note', line + ', 可以交给系统里的应用打开'))
          var openBtn = h('button', 'lwp-preview-open', '用其它应用打开')
          openBtn.type = 'button'
          openBtn.onclick = function () { openWithSystem(rel) }
          els.previewBody.appendChild(openBtn)
        }
        els.preview.hidden = false
        document.body.classList.add('lwp-preview-open')
      }

      /**
       * Office 那一档 (2026-11-09): 取字节 -> `renderOffice` -> 进 shadow root
       *
       * 失败三档分开说, 一句都不含混: 取不到 (宿主 404 / 413) / 太大 (10 MB 闸) / 解不开 (文件坏了,
       * 或者预览模块没挂上)。**失败之后一样留一颗"用其它应用打开"**, 界面不停在"正在解…"
       * @param {string} rel `/lw-out/` 后面那一段
       * @param {string} name 文件名 (判哪一档、也交给渲染器判后缀)
       */
      function openOfficePreview(rel, name) {
        els.previewBody.setAttribute('data-kind', 'office')
        els.previewBody.appendChild(h('div', 'lwp-preview-note', '正在解…'))
        /** 失败: 一句红字 + 那颗交给系统的按钮 */
        var fail = function (text) {
          els.previewBody.textContent = ''
          var line = h('div', 'lwp-preview-note', text)
          line.setAttribute('data-error', 'on')
          els.previewBody.appendChild(line)
          var openBtn = h('button', 'lwp-preview-open', '用其它应用打开')
          openBtn.type = 'button'
          openBtn.onclick = function () { openWithSystem(rel) }
          els.previewBody.appendChild(openBtn)
        }
        fetch('/lw-out/' + rel, { cache: 'no-store' }).then(function (res) {
          if (res.status === 413) throw new Error('too-large')
          if (res.status === 404) throw new Error('missing')
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.arrayBuffer()
        }).then(function (buffer) {
          var api = officeRenderer()
          if (api === null) throw new Error('no-renderer')
          var raw = new Uint8Array(buffer)
          var limit = typeof api.MAX_BYTES === 'number' ? api.MAX_BYTES : 10 * 1024 * 1024
          if (raw.byteLength > limit) throw new Error('too-large')
          // 先把「正在解…」画一帧再解: docx-preview 是同步排版的, 同一帧里做会白一下
          return new Promise(function (resolve) {
            requestAnimationFrame(function () { resolve(api.renderOffice(raw, name)) })
          })
        }).then(function (rendered) {
          els.previewBody.textContent = ''
          var host = h('div', 'lwp-preview-doc')
          els.previewBody.appendChild(host)
          var shadow = typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'open' }) : null
          if (shadow === null) throw new Error('no-shadow')
          // 正文与样式都关在 shadow root 里, 宿主那一页一点不受影响 (与右栏同一个做法)
          shadow.innerHTML = '<style>' + rendered.style + '</style>' + rendered.body
        }).catch(function (error) {
          var reason = describeError(error)
          if (reason === 'too-large') fail('文件太大（超过 10 MB），请在电脑上打开')
          else if (reason === 'missing') fail('这个文件现在取不到')
          else if (reason === 'no-renderer') fail('预览模块没挂上，这一份解不开')
          else fail('这份文件读不了：' + reason)
        })
      }

      function closePreview() {
        if (!els.preview) return
        els.preview.hidden = true
        document.body.classList.remove('lwp-preview-open')
      }

      /* ── 历史记录窗 (2026-11-10 主人: "左边再加上历史记录, 记录每次新对话的历史 … 点击历史可以恢复
       * 历史对话, 下方加开始新的对话按钮。从上到下, 从新到旧, 最新要显示当前对话")
       *
       * 数据只有一处: dsh 自己的会话表 (`ctx.sessions.list` 的快照)。这一层**不新建任何历史文件** ——
       * 每一场的标题 (`displayTitle`) 与最后一次改动 (`updatedAt`) 都在那份快照里, 门户只是把它画出来
       */

      /**
       * 快照 → 那一列历史 (纯函数, 判据 `check-luwi-portal.mjs` 抽出来真跑)
       *
       * 四条口径:
       *  - **搜索框空着时**当前那场钉在最前 (主人: "最新要显示当前对话"); 一输字就严格过滤 ——
       *    搜"上周"却看见当前这场, 那才叫奇怪;
       *  - 过滤大小写不敏感, 命中 `displayTitle` 或 id 尾巴都算;
       *  - 从没说过话的空白场不进列表 —— 它们不是"历史", 是 dsh 复用的一纸草稿 (当前那场除外);
       *  - 时间读不到 (`updatedAt` 缺失/0) 的排在有时间的后面, 不拿 1970 去比。
       *
       * @param {object} snapshot `ctx.sessions.list.getSnapshot()` (只有 `byId` 被用到)
       * @param {string} query 搜索框里的字
       * @param {string|null} currentId 当前画着的那一场
       * @returns {{id: string, title: string, at: number, current: boolean, blank: boolean}[]}
       */
      function historyRows(snapshot, query, currentId) {
        var byId = snapshot && typeof snapshot === 'object' && snapshot.byId ? snapshot.byId : {}
        var ids = Object.keys(byId)
        var needle = String(query === undefined || query === null ? '' : query).trim().toLowerCase()
        /** 只有搜索框空着时才把当前那场钉在最前 */
        var pinCurrent = needle === ''
        var rows = []
        for (var i = 0; i < ids.length; i += 1) {
          var summary = byId[ids[i]]
          if (!summary || typeof summary !== 'object') continue
          var id = typeof summary.id === 'string' && summary.id !== '' ? summary.id : String(ids[i])
          var current = id === currentId
          var blank = summary.blank === true
          if (blank && !current) continue
          var title = typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : ''
          if (title === '') title = blank ? '空白对话' : '新对话'
          if (needle !== '') {
            var haystack = (title + ' ' + id).toLowerCase()
            if (haystack.indexOf(needle) < 0) continue
          }
          rows.push({
            id: id,
            title: title,
            at: Number(summary.updatedAt) || 0,
            current: current,
            blank: blank,
          })
        }
        rows.sort(function (a, b) {
          // 当前那场钉在最前 (只在没搜索时); 其余按最后一次改动倒序, 没有时间的一律沉底
          if (pinCurrent && a.current !== b.current) return a.current ? -1 : 1
          if (a.at === b.at) return a.id < b.id ? 1 : -1
          return b.at - a.at
        })
        return rows
      }

      /** 列表里那一行 */
      function historyRow(node) {
        var row = h('button', 'lwp-history-row')
        row.type = 'button'
        row.setAttribute('data-current', node.current ? 'on' : 'off')
        var name = h('div', 'lwp-history-name', (node.current ? '当前 · ' : '') + node.title)
        row.appendChild(name)
        var when = h('div', 'lwp-history-when', node.at > 0 ? stamp(node.at) : '时间不明')
        row.appendChild(when)
        row.onclick = function () { pickHistory(node.id) }
        return row
      }

      /** 把这一窗按当前搜索词重画 (窗口开着才会被调到) */
      function renderHistory() {
        if (!els.historyList) return
        var snapshot = null
        try {
          snapshot = ctx.sessions.list.getSnapshot()
        } catch (_noList) {
          snapshot = null
        }
        var rows = historyRows(snapshot, historyQuery, sessionId)
        els.historyList.textContent = ''
        if (rows.length === 0) {
          els.historyList.appendChild(h('div', 'lwp-history-empty', historyQuery.trim() === ''
            ? '还没有历史对话'
            : '没有匹配的对话'))
          return
        }
        for (var i = 0; i < rows.length; i += 1) els.historyList.appendChild(historyRow(rows[i]))
      }

      function openHistory() {
        if (!els.history) return
        historyOpen = true
        historyQuery = ''
        if (els.historyQuery) els.historyQuery.value = ''
        els.history.hidden = false
        renderHistory()
        // 列表是活的: 会话表一变 (新开一场 / 别处发了一句) 就重画, 关窗时退订
        if (historyUnsub === null) {
          try {
            historyUnsub = ctx.sessions.list.subscribe(function () {
              if (historyOpen) renderHistory()
            })
          } catch (_noList) {
            historyUnsub = null
          }
        }
        // 键盘弹出来时这一窗也要让位: 与输入卡同一套 (`--lwp-ime` 由 applyIme 写在 root 上)
        if (els.historyQuery) {
          setTimeout(function () {
            if (!historyOpen || !els.historyQuery) return
            try { els.historyQuery.focus() } catch (_noFocus) { /* 老 WebView 不给焦点就算了 */ }
          }, 60)
        }
      }

      function closeHistory() {
        historyOpen = false
        if (els.history) els.history.hidden = true
        if (historyUnsub !== null) {
          historyUnsub()
          historyUnsub = null
        }
      }

      /**
        * 点中一条历史: 先关窗, 再**走收敛后的 `switchTo(id, 'history')`**
        *
        * 2026-11-10 起这一条**带着 `align`** (让 dsh 的 mainView 一起过去) —— 原来只调 `follow(id)`,
        * 视野换了而 mainView 没换, 3 s 之后 `pollLedger` 把界面拽回门户自动开的那张空场
        * (方案 `Luwi-门户历史恢复被拽回-方案-2026-11-10.md`)。打不开时还是**不动**当前场, 只留一句话
        */
      function pickHistory(id) {
        if (typeof id !== 'string' || id === '') return
        closeHistory()
        if (id === sessionId) return
        if (!switchTo(id, 'history')) {
          showNote('这一场现在打不开, 先在 dsh 里切一下工作区再回来', true)
        }
      }

      /* ── 选工作区 (2026-11-12 #37) ────────────────────────────────────────────
       *
       * 首启 / `pm clear` 之后 dsh 那一边可能一个工作区都还没有, 而这一层盖住了它整个界面:
       * 没有入口就没有任何一句话发得出去 —— 所以空态摆一颗「选工作区」, 点开是这一份列表。
       * 一条工作区都没认出来时**请应用把 `Luwi` 那条目录备好** (桥上的 `portalWorkspace`),
       * 再让 dsh 认它 (`workspaces.create`): 那条路不碰系统 Documents —— dsh 自己那条首启
       * 缺省工作区在安卓上必失败 (`system Documents directory is unavailable`)
       */

      /** 把那一窗按现在的工作区表重画 (窗开着才会被调到) */
      function renderPick() {
        if (!els.pickList) return
        var here = sessionId === null ? '' : workspaceOf(sessionId)
        var rows = pickRows(workspaceItems(), here)
        els.pickList.textContent = ''
        if (rows.length === 0) {
          els.pickList.appendChild(h('div', 'lwp-pick-empty', pickNote === ''
            ? '正在找可用的工作区…'
            : pickNote))
          return
        }
        for (var i = 0; i < rows.length; i += 1) els.pickList.appendChild(pickRow(rows[i]))
      }

      /** 列表里那一行 (整行可点 = 切过去; 名字说"当前"那一场落在这里) */
      function pickRow(row) {
        var node = h('button', 'lwp-pick-row')
        node.type = 'button'
        node.setAttribute('data-current', row.current ? 'on' : 'off')
        node.appendChild(h('div', 'lwp-pick-name', (row.current ? '当前 · ' : '') + row.title))
        node.appendChild(h('div', 'lwp-pick-path', row.path))
        node.onclick = function () { pickWorkspace(row.id) }
        return node
      }

      function openPick() {
        if (!els.pick) return
        pickOpen = true
        pickNote = ''
        els.pick.hidden = false
        renderPick()
        // 列表是活的: 工作区一出现就重画 (宿主备好默认那个 / 别处加了, 都在这一条上)
        if (pickUnsub === null) {
          var service = workspaceService()
          if (service && service.list && typeof service.list.subscribe === 'function') {
            try {
              pickUnsub = service.list.subscribe(function () { if (pickOpen) renderPick() })
            } catch (_noList) {
              pickUnsub = null
            }
          }
        }
        ensureWorkspaces()
      }

      function closePick() {
        pickOpen = false
        if (els.pick) els.pick.hidden = true
        stopPickPoll()
        if (pickUnsub !== null) {
          pickUnsub()
          pickUnsub = null
        }
      }

      function stopPickPoll() {
        if (pickTimer === null) return
        clearInterval(pickTimer)
        pickTimer = null
      }

      /**
       * 列表还空着时补几拍再看 (250 ms × 12 拍 —— 与"3 s 内列出"那条口径对齐)
       *
       * 订阅漏了事件 (宿主建完工作区那一刻列表还没推过来) 时, 这里是唯一的兜底
       */
      function startPickPoll() {
        if (pickTimer !== null) return
        pickTries = 0
        pickTimer = setInterval(function () {
          pickTries += 1
          if (!pickOpen) {
            stopPickPoll()
            return
          }
          if (workspaceItems().length > 0) {
            stopPickPoll()
            pickNote = ''
            renderPick()
            return
          }
          if (pickTries >= 12) {
            stopPickPoll()
            pickNote = '没等到工作区列表, 再点一次「选工作区」'
            renderPick()
          }
        }, 250)
      }

      /**
       * 一个工作区都没有: 把「Luwi」那条目录备好, 再让 dsh 认它
       *
       * **不走 `initializeDefault`** (2.8.0 #37): 它那条首启缺省工作区是
       * `<系统 Documents>/deepseek-harness/default-workspace`, 安卓上必失败
       * (`system Documents directory is unavailable`), 首启于是停在空态、一句也发不出去。
       * 工作区目录本来就由应用三档解析 (`Workspace.resolve`), 桥上的 `portalWorkspace(true)`
       * 把它备好, 这里只负责让 dsh 认这一份 (`workspaces.create({path})`, 幂等 —— 已注册就把
       * 原来那条还回来)
       */
      function ensureWorkspaces() {
        if (workspaceItems().length > 0) return
        var made = call('portalWorkspace', true)
        var path = made && typeof made.path === 'string' ? made.path : ''
        if (path === '' || made.exists !== true) {
          pickNote = '这台还没有工作区目录, 先建一个'
          renderPick()
          return
        }
        var service = workspaceService()
        if (!service || typeof service.create !== 'function') {
          pickNote = '这一版没有工作区服务, 建不起来'
          renderPick()
          return
        }
        pickNote = '正在准备第一个工作区…'
        renderPick()
        var pending = null
        try {
          pending = service.create({ path: path })
        } catch (error) {
          pickNote = '没建起来: ' + describeError(error)
          renderPick()
          return
        }
        if (!pending || typeof pending.then !== 'function') {
          startPickPoll()
          return
        }
        pending.then(function () {
          if (!pickOpen) return
          pickNote = ''
          renderPick()
          if (workspaceItems().length === 0) startPickPoll()
        }, function (error) {
          if (!pickOpen) return
          pickNote = '没建起来: ' + describeError(error)
          renderPick()
        })
      }

      /** 点中一行: 先关窗, 再落到那个工作区的一场里 */
      function pickWorkspace(id) {
        if (typeof id !== 'string' || id === '') return
        closePick()
        enterWorkspace(id)
      }

      /**
       * 切到某个工作区并落进它的一场
       *
       * `openWorkspace` 自己会复用 / 新建一张空白草稿并把它挂到 dsh 的 mainView 上, 所以这里
       * 只等 `currentSessionId()` 落到那一场 (与 [newConversation] 同一套 150 ms × 24 次);
       * 落到就 `switchTo(id, 'new')` + `portalBind` + 15 s 不跟账本 —— 三件都做完, 下一句话
       * 才发得出去、才不会被账本拽走
       */
      function enterWorkspace(workspaceId) {
        if (entering) return
        entering = true
        var opening = null
        try {
          opening = ctx.uiWorkspace.openWorkspace(workspaceId)
        } catch (error) {
          entering = false
          showNote('这个工作区打不开: ' + describeError(error), true)
          openPick()
          return
        }
        if (opening && typeof opening.catch === 'function') {
          opening.catch(function (reason) {
            console.log('[luwi-portal] openWorkspace failed: ' + describeError(reason))
          })
        }
        var tries = 0
        function look() {
          tries += 1
          var id = currentSessionId()
          if (id !== null && bindingOf(id) !== undefined) {
            landIn(id)
            return
          }
          if (tries >= 24) {
            entering = false
            showNote('没开出来, 再点一次「选工作区」', true)
            return
          }
          setTimeout(look, 150)
        }
        function landIn(id) {
          entering = false
          // 人点的那一条: 让 dsh 的 mainView 也搬到这一场 (source 'new' 自带 align)
          switchTo(id, 'new')
          bound = id
          call('portalBind', id)
          ledgerHoldUntil = Date.now() + 15000
          renderMeta()
          renderFlow()
        }
        setTimeout(look, 150)
      }

      /** 底部那颗「开始新的对话」: 与头栏那块身份同一个入口 */
      function startFromHistory() {
        closeHistory()
        newConversation()
      }

      /* ── 键盘那一格 (2026-11-09 主人: "呼出键盘时不应整个界面上移, 只要输入框和聊天记录向上移") ── */

      /**
       * 键盘高度: 只改这一层的 padding, 别的一律不动
       *
       * **WebView 尺寸不变** (宿主那一侧门户盖着时不缩), 所以背景图、头栏、底下的 dsh 页面全都不动;
       * 变的是 `#lwp-root` 的 `padding-bottom` —— 对话区跟着少一段, 输入卡整块上移。一次起落只写
       * **一处** style, 不重建 DOM, 也不触发 `renderFlow`
       *
       * 高度一变, 底就换位置了: 正贴着底看的时候要把最新那句继续钉在视野里 (否则屏幕上会跳一下)
       * @param {number} px 让出的高度 (CSS px, 宿主按 ime - nav 算好再推过来)
       */
      function applyIme(px) {
        // 上限按视口的 75% 夹一下: 万一单位又搞错 (922 设备像素当 CSS px 写下去过一次), 最坏是"抬多了",
        // 不是整块输入区被顶到顶栏下面
        var viewport = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 0
        var raw = Math.max(0, Math.round(Number(px) || 0))
        var next = viewport > 0 ? Math.min(raw, Math.round(viewport * 0.75)) : raw
        if (next !== raw) console.log('[luwi-portal] ime lift clamped ' + String(raw) + ' -> ' + String(next))
        if (next === imePx) return
        var flow = els.flow
        var pinned = flow !== undefined && flow !== null
          && flow.scrollTop + flow.clientHeight >= flow.scrollHeight - 8
        imePx = next
        if (root !== null) {
          root.style.setProperty('--lwp-ime', String(next) + 'px')
          // 键盘抬着时停掉头像那支浮动动画: 少一条每帧的合成
          if (next > 0) root.setAttribute('data-ime', 'on')
          else root.removeAttribute('data-ime')
        }
        if (pinned && flow) flow.scrollTop = flow.scrollHeight
      }

      /**
       * 交给系统里接这个类型的那个应用 (2026-11-09 主人: "doc 这些文档打不开, 补一下")
       *
       * 网页这一侧拿不到 FileProvider, 也不该拿到一条 `startActivity` 的路 —— 走那条窄通道:
       * `luwi-open://file?path=<绝对路径>`, 由 HostScreen 换成 `content://` (见 `OpenFile`)。
       * 绝对路径从桥上问 (`portalAbsPath`), 而能不能交出去仍由 `OpenFile.allowed` 判
       */
      function openWithSystem(rel) {
        var got = call('portalAbsPath', String(rel || ''))
        if (!got || got.ok !== true || typeof got.path !== 'string' || got.path === '') {
          showNote(got && got.error ? String(got.error) : '这一份打不开', true)
          return
        }
        location.href = 'luwi-open://file?path=' + encodeURIComponent(got.path)
      }

      /* ── 表情包 (2026-11-09 主人: "`+` 的右边增加表情包图标, 点击弹出表情包选择") ─── */

      /**
       * 面板里那一格: 一张表情
       *
       * **只有图, 没有字** (主人的原话: "不能有文字") —— 所以取不到那张就不占格子 (`hidden`),
       * 而不是冒一行文件名出来
       */
      function stickerCell(name) {
        var cell = h('button', 'lwp-sticker-cell')
        cell.type = 'button'
        cell.title = ''
        var img = document.createElement('img')
        img.alt = ''
        img.src = '/lw-out/stickers/' + encodeURIComponent(stemOf(name))
        img.onerror = function () { cell.hidden = true }
        cell.appendChild(img)
        // 点一下 = 进输入框上方的待发栏 (2026-11-10), 不直接发
        cell.onclick = function () { stageSticker(name) }
        return cell
      }

      /**
       * 重拉一次表情目录
       *
       * 名单只从 `portalStickers()` 来 (= `$DSH_HOME/lw/stickers`, 与宿主 `lw_sticker op=list`
       * 同一个目录), 这一层不缓存: 主人在文件管理器里放一张, 再点开面板就该看见
       */
      function loadStickers() {
        if (!els.stickerGrid) return
        var got = call('portalStickers')
        var names = got && Array.isArray(got.names) ? got.names : []
        console.log('[luwi-portal] stickers: ' + String(names.length) + ' in the folder')
        els.stickerGrid.textContent = ''
        // 加号在第一格 (与 QQ 那一套同一个位置): 表情再多, "加一张"也不用滚到最后去找
        var add = h('button', 'lwp-sticker-cell')
        add.type = 'button'
        add.setAttribute('data-add', 'on')
        add.setAttribute('aria-label', '添加表情')
        add.innerHTML = PLUS_ICON
        add.onclick = function () { pickSticker() }
        els.stickerGrid.appendChild(add)
        for (var i = 0; i < names.length; i += 1) els.stickerGrid.appendChild(stickerCell(String(names[i])))
      }

      function openStickerPanel() {
        if (!els.stickerPanel) return
        if (menuKind !== '') closeMenu()
        els.stickerPanel.hidden = false
        if (els.stickerBtn) els.stickerBtn.setAttribute('aria-expanded', 'true')
        loadStickers()
        // 面板是往下撑开的: 把最新那句留在视野里 (与键盘弹起时同一手感)
        if (els.flow) els.flow.scrollTop = els.flow.scrollHeight
        // 一行读数: 真机上"点了没开"要靠它分清是样式没生效还是被别的东西盖住了 (2026-11-09)
        try {
          var box = els.stickerPanel.getBoundingClientRect()
          console.log('[luwi-portal] sticker panel ' + Math.round(box.width) + 'x' + Math.round(box.height)
            + ' at ' + Math.round(box.top))
        } catch (_noBox) {
          console.log('[luwi-portal] sticker panel has no box')
        }
      }

      function closeStickerPanel() {
        if (!els.stickerPanel) return
        els.stickerPanel.hidden = true
        if (els.stickerBtn) els.stickerBtn.setAttribute('aria-expanded', 'false')
      }

      function toggleStickerPanel() {
        if (!els.stickerPanel) {
          console.log('[luwi-portal] sticker panel missing (els.stickerPanel is null)')
          return
        }
        // 一行读数: 真机上"点了没开"只能靠它分清是没点到、还是开了又被关 (2026-11-09)
        console.log('[luwi-portal] sticker toggle, hidden=' + String(els.stickerPanel.hidden))
        if (els.stickerPanel.hidden) openStickerPanel()
        else closeStickerPanel()
      }

      /** 选一张本地图加进 `lw/stickers` (与 she 用的同一个目录, 加完她就能贴) */
      function pickSticker() {
        if (!els.stickerFile) return
        els.stickerFile.value = ''
        els.stickerFile.click()
      }

      function onStickerChosen(files) {
        var file = files && files.length > 0 ? files[0] : null
        if (!file) return
        if (typeof FileReader !== 'function') {
          showNote('这个 WebView 读不了本地文件', true)
          return
        }
        var reader = new FileReader()
        reader.onerror = function () { showNote('读不动这张图', true) }
        reader.onload = function () {
          var buffer = reader.result
          var bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : null
          if (bytes === null || bytes.length === 0) {
            showNote('读出来是空的', true)
            return
          }
          var answer = call('portalStickerAdd', JSON.stringify({
            name: file.name ? String(file.name) : 'sticker.png',
            data: base64Of(bytes),
          }))
          if (!answer || answer.ok !== true) {
            showNote(answer && answer.error ? String(answer.error) : '加不进表情包', true)
            return
          }
          loadStickers()
        }
        reader.readAsArrayBuffer(file)
      }

      /**
       * 点一张表情 = **放进输入框上方的待发栏** (2026-11-10 主人: "发表情包, 应该要在输入框上方显示")
       *
       * 与图片同一个落点 (`lw-in/`) 与同一条正文段: 她那一侧 `read_image` 打开, 自己这一侧靠那段路径
       * 画回来。**先 push 占位再取字节** —— 连点几张时顺序就是手指点的顺序, 不会因为谁先 fetch 完而翻;
       * 面板随即收起, 发送仍由那颗发送钮说了算 (发不出去就留一颗红框, 撤得掉)
       */
      function stageSticker(name) {
        if (typeof sessionId !== 'string' || sessionId === '') {
          showNote('先开一场对话', true)
          return
        }
        if (attach.length >= MAX_ATTACH) {
          showNote('附件最多 ' + MAX_ATTACH + ' 个', true)
          return
        }
        var one = {
          kind: 'image',
          name: String(name),
          bytes: 0,
          mediaType: mimeOfName(name),
          data: '',
          status: 'reading',
          error: '',
          path: '',
          lastLogged: '',
        }
        attach.push(one)
        renderAttach()
        closeStickerPanel()
        fetch('/lw-out/stickers/' + encodeURIComponent(stemOf(name)), { cache: 'force-cache' })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.blob()
          })
          .then(function (blob) {
            return new Promise(function (resolve, reject) {
              var reader = new FileReader()
              reader.onerror = function () { reject(new Error('读不动这张表情')) }
              reader.onload = function () { resolve(reader.result) }
              reader.readAsArrayBuffer(blob)
            })
          })
          .then(function (buffer) {
            var bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : null
            if (bytes === null || bytes.length === 0) throw new Error('这张表情是空的')
            one.bytes = bytes.length
            one.data = base64Of(bytes)
            // 同一份落进工作区 `lw-in/` —— 她读的与门户画的都是这一份; 没落好就不许发
            var stash = call('portalStash', JSON.stringify({ name: one.name, data: one.data }))
            if (!stash || stash.ok !== true) {
              throw new Error(stash && stash.error ? String(stash.error) : '存不进去')
            }
            one.path = String(stash.path || '')
            one.name = String(stash.name || one.name)
            one.status = 'ready'
            renderAttach()
          })
          .catch(function (error) {
            one.status = 'error'
            one.error = describeError(error)
            renderAttach()
            showNote('这张表情没进来: ' + one.error, true)
          })
      }

      /**
       * 流的内容签名: 只看"画出来的东西变了没有"
       *
       * 流式与账本轮询会在**没有新话**的时候也走到 [renderFlow] (快照变了 / 3 s 一拍), 而那一段
       * 现在是把整棵 `#lwp-flow` 拆了重建 —— 键盘起落、滚动时撞上它就白掉一帧。签名一样就整段跳过
       *
       * **签名与身份是同一套键** (2026-11-10, 方案 §2.2 第三条): 以前这里逐条拼 `who/time/text`,
       * 而 [itemKey] 拼的是另一套 —— 于是出现过"签名说不重要、身份说变了"的错位。现在两边都走
       * [itemKey], 一条消息的看法只有一个
       * @param {object[]} items 已经过筛的那几条
       * @returns {string} 一条能比的串
       */
      function flowSignature(items) {
        var parts = []
        for (var i = 0; i < items.length; i += 1) parts.push(itemKey(items[i]))
        return (phaseThinking() ? 'T' : 'F') + '\u0002' + parts.join('\u0002')
      }

      /**
       * 一条消息在流里的身份: 内容变了才换 key (换了就整行重建, 没换就原地留着)
       *
       * 2026-11-10 起**先用 `id`** (那一条的稳定身份, 见 [nodesOf] 的三级回退), 没有 `id` 才退回
       * `seq` / `time` —— 退回去就是今天的行为, 不会更糟。`time` 只参与 30 分钟分段与排序, 不再
       * 进身份: 它正是"发送那一瞬间整屏重建"的根 (§1.2)
       */
      function itemKey(item) {
        return [
          item.who,
          item.id || '',
          item.id ? '' : item.seq,
          item.id ? '' : item.time,
          item.text,
          item.image || '', item.sticker || '',
          item.file ? String(item.file.name) + '|' + String(item.file.rel) : '',
          item.attach ? item.attach.join(',') : '',
          item.hasImage ? '1' : '', item.fallback ? '1' : '',
        ].join('\u0001')
      }

      /**
       * 一条消息 → 一行 DOM
       *
       * 纯图 / 表情 / 文件那一行正文是空串 —— 它不是"没话说", 是"话在东西上" (以前这里会整条丢掉)。
       * 从 [renderFlow] 里抽出来, 是为了增量渲染能只重建"变了的"那一行
       */
      function buildRow(item) {
        var row = h('div', 'lwp-row')
        row.setAttribute('data-who', item.who)
        if (item.who === 'user' && item.hasImage && !(item.attach && item.attach.length > 0)) {
          // 有图块却没有落盘那份 (stash 失败 / 旧消息): 补一行「（图）」, 不假装贴过也不整条丢掉
          var lostOnly = h('div', 'lwp-image', '（图）')
          lostOnly.setAttribute('data-broken', 'on')
          row.appendChild(lostOnly)
          if (item.text !== '') row.appendChild(h('div', 'lwp-bubble', item.text))
        } else if (item.attach && item.attach.length > 0) {
          // 自己发过的图与文件 (2026-11-09): 字节落在工作区 `lw-in/`, 名字在正文那一段里。
          // **话在上、附件在下** (与她那侧同一条): 先说的话, 再是图与文件
          if (item.text !== '') row.appendChild(h('div', 'lwp-bubble', item.text))
          var drew = false
          for (var a = 0; a < item.attach.length; a += 1) {
            var attached = item.attach[a]
            if (isImageName(attached)) {
              row.appendChild(imageBubble({ image: 'in/' + encodeURIComponent(attached) }))
              drew = true
            } else {
              row.appendChild(fileChip({ rel: 'in/' + encodeURIComponent(attached), name: attached }, 'in'))
            }
          }
          // 有图块却没有落盘那份 (旧消息 / 存不下): 补一行「（图）」, 不假装贴过
          if (!drew && item.hasImage) {
            var lost = h('div', 'lwp-image', '（图）')
            lost.setAttribute('data-broken', 'on')
            row.appendChild(lost)
          }
        } else if (item.image) {
          row.appendChild(imageBubble(item))
          if (item.text !== '') row.appendChild(h('div', 'lwp-bubble', item.text))
        } else if (item.sticker) {
          // 表情在 `lw/stickers` 里, 走 `/lw-out/stickers/<名字>` 那条只读路由取 (取不到就一行说明)
          row.appendChild(stickerBubble(item.sticker))
        } else if (item.file) {
          // 她递来的文件 (2026-11-09): 只写文件名, 蓝字, 点开预览。
          // **话在上、文件在下** (主人 2026-11-09: "应该在句子下方") —— 与球那一侧同一条口径
          if (item.text !== '') row.appendChild(h('div', 'lwp-bubble', item.text))
          row.appendChild(fileChip(item.file, 'out'))
        } else {
          row.appendChild(h('div', 'lwp-bubble', item.text))
        }
        var when = Number(item.time)
        if (isFinite(when) && when > 0) row.appendChild(h('span', 'lwp-time', clock(when)))
        return row
      }

      /** 分段药丸 (`今天 22:29`) */
      function sectionLine(label) {
        var sep = h('div', 'lwp-sep')
        sep.appendChild(h('span', null, label))
        return sep
      }

      /**
       * 流里该有的东西, 按画出来的顺序排好: 分段药丸 + 消息行
       *
       * 增量渲染拿它跟 `flowRows` 比前缀: 一致就只 append 多出来的那几条, 不一致才整段重建
       * (2026-11-09: 以前每放出一条就 `textContent = ''` 重建, 屏上是"贴图压在字上"的中间帧)
       */
      function flowPlan(shown) {
        var plan = []
        var sections = sectionsOf(shown)
        for (var s = 0; s < sections.length; s += 1) {
          var section = sections[s]
          var label = stamp(section.time)
          if (label !== '') plan.push({ kind: 'sep', key: 'sep\u0001' + label, label: label })
          for (var k = 0; k < section.items.length; k += 1) {
            var item = section.items[k]
            plan.push({ kind: 'row', key: 'row\u0001' + itemKey(item), item: item })
          }
        }
        return plan
      }

      function buildPlanNode(entry) {
        if (entry.kind === 'sep') return sectionLine(entry.label)
        return buildRow(entry.item)
      }

      /**
       * 贴在底部 (连钉两帧)
       *
       * 发出去那一下会连着改两次高度: 输入框清空 → 卡片变矮 → 对话区变高, 然后是键盘收起那一整段动画。
       * 只在渲染那一拍写一次 `scrollTop` 是钉不住的 —— 下一帧布局一变, 内容就"跳一格", 看着像整屏
       * 重排了一下 (2026-11-09 主人: "一瞬间还是会有这个现象")。所以贴底这件事**跟着布局走**:
       * `#lwp-flow` 上一把 `ResizeObserver` ([flowStickObserver]), 每次尺寸变化都重钉一次
       */
      var stickOn = true
      var stickRaf = 0

      function stickFlow() {
        if (!els.flow || !stickOn) return
        if (stickRaf !== 0) return
        var pin = function () {
          stickRaf = 0
          if (!els.flow || !stickOn) return
          els.flow.scrollTop = els.flow.scrollHeight
        }
        if (typeof requestAnimationFrame === 'function') {
          stickRaf = requestAnimationFrame(function () { requestAnimationFrame(pin) })
        } else {
          pin()
        }
      }

      /**
       * 现在是不是贴着底
       *
       * **只认"用户自己的意图"**: `stickOn` 只由手指拖动那一类手势改 (见下面那个 scroll 监听),
       * 布局变化 (键盘起落 / 卡片涨高 / 输入框清空) 引起的滚动一律不改它 —— 否则发出去那一下
       * `clientHeight` 一变, "离底超过 48" 就把贴底关了, 后面几帧内容就自己往上飘 (2026-11-09)
       */
      function flowAtBottom() {
        if (!els.flow) return true
        if (flowForceBottom) {
          flowForceBottom = false
          stickOn = true
          return true
        }
        // 还没排版出来 (第一帧 clientHeight = 0) 时按"贴底"算, 否则开一场旧会话不会跳到底
        if (els.flow.clientHeight === 0) return true
        return stickOn
      }

      /** 整段清掉: 只在换会话 / 顺序真的变了 / 空态与消息流互换时走 */
      function resetFlow() {
        if (els.flow) els.flow.textContent = ''
        flowRows = []
        flowMode = 'flow'
        flowForceBottom = true
      }

      function renderFlow() {
        if (!els.flow) return
        // 每画一次流就顺手对一次那颗点: "正在做…"那一行与它是同一个判据, 不该一个亮一个不亮
        renderMeta()
        // 空态那颗「选工作区」跟着"落不落得下去"走 (2026-11-12 #37); 签名没变的几拍也照样对一次
        syncHeroPick()
        var items = nodesOf()
        var shown = []
        for (var i = 0; i < items.length; i++) {
          var one = items[i]
          // 纯图 / 表情 / 文件那一行正文是空串 —— 它不是"没话说", 是"话在东西上" (以前这里会整条丢掉)
          if (one.text !== '' || one.image || one.sticker || one.file || one.hasImage
            || (one.attach && one.attach.length > 0)) shown.push(one)
        }
        // 内容没变就不动 DOM (见 flowSignature): 空态与消息流走同一条闸
        var sig = flowSignature(shown)
        if (sig === flowSig) return
        flowSig = sig
        var thinking = phaseThinking()
        var follow = flowAtBottom()
        if (shown.length === 0 && !thinking) {
          // 诊断 (2026-11-08 深夜): 空态时把"为什么空"说清楚 —— 节点几个 / 上屏几条 / 有没有在跑
          var whyNow = String(items.length) + '/' + String(shown.length) + '/' + String(chatTarget === null)
          if (flowWhy !== whyNow) {
            flowWhy = whyNow
            console.log('[luwi-portal] hero: items=' + String(items.length) + ' shown=' + String(shown.length)
              + ' target=' + String(chatTarget === null) + ' session=' + String(sessionId))
          }
          if (flowMode !== 'hero' || els.flow.firstChild === null) {
            els.flow.textContent = ''
            flowRows = []
            flowMode = 'hero'
            els.flow.appendChild(heroNode())
          }
          // 空场 = 新对话: 那颗点回绿 (正在跑的时候仍由 [updateBusy] 判成黄)
          updateBusy()
          return
        }
        var plan = flowPlan(shown)
        // 前缀没变 → 只追加尾巴。放一条新话不该把整屏拆一遍 (那是抖动的来源)
        //
        // 2026-11-10 (方案 docs/Luwi-门户发送瞬重建-方案-2026-11-10.md §3): 光有"前缀没变"还不够 ——
        // 发送那一瞬间末尾那一两行会就地换身份 (兜底行 / 新一轮那条 user), 于是前缀比到
        // 那里就失败, 整屏重建一次。这里改成先求**最长公共前缀长度** `common`, 只在末尾 1~2 行上
        // 让一步: 那几行换成新的, 上面的不动。真要整块换 (换场 / 删消息 / 30 分钟分段挪位) 仍走 resetFlow
        var common = 0
        if (flowMode === 'flow') {
          var limit = Math.min(plan.length, flowRows.length)
          while (common < limit && flowRows[common].key === plan[common].key) common += 1
        }
        var sameHead = flowMode === 'flow' && common === flowRows.length && plan.length >= flowRows.length
        // 尾部替换: 只有末尾 1~2 行变了, 且上面那一段一个不差
        var tailOnly = flowMode === 'flow' && !sameHead && common >= flowRows.length - 2
          && plan.length >= common && plan.length - common <= 2
        if (!sameHead && !tailOnly) {
          resetFlow()
          flowStats.rebuilds += 1
          follow = true
        } else if (sameHead && plan.length > flowRows.length) {
          flowStats.appends += 1
        } else if (tailOnly) {
          // 先把变掉的那几行从 DOM 上摘掉 (通常就一行), 再把新的接在后面
          for (var t = common; t < flowRows.length; t += 1) {
            if (flowRows[t].el.parentNode === els.flow) els.flow.removeChild(flowRows[t].el)
          }
          flowRows.length = Math.min(flowRows.length, common)
          flowStats.tailReplaces += 1
          if (plan.length === common + 1) flowStats.appends += 1
        }
        flowMode = 'flow'
        for (var n = flowRows.length; n < plan.length; n += 1) {
          var node = buildPlanNode(plan[n])
          els.flow.appendChild(node)
          flowRows.push({ key: plan[n].key, el: node })
        }
        // 由空场变成有话, 那颗点从绿换蓝 (黄只表"正在做", 判据见 [updateBusy])
        updateBusy()
        // 「一轮在跑」那一行不再挂在流末尾 (2026-11-10 主人: "正在做的标识改成右上角加黄色点表示"):
        // 状态只剩头栏那颗点 (绿/蓝/黄), 由 [updateBusy] 按同一个 [phaseThinking] 点亮
        logFlowStats()
        if (follow) stickFlow()
      }

      /**
       * 顶条那行读数: **只剩账本那一句** (2026-11-08 主人: "对话层不显示会话标题")
       *
       * 会话自己的标题与 id 都不再冒上来 —— 这一层是"和她说的话", 不是会话管理器。`没有会话` 这一句
       * 留着, 因为真空着的时候得说清为什么底下没有对话
       */
      /**
       * 顶条那行读数 (`球的场 剩 N 分` / `账本过期` / `球还没有场`) 不画: 这一层是"和她说的
       * 话", 不是账本看板。账本本身照读 (`call('portalSession')`) —— `pollLedger` 靠它跟随场次
       *
       * 原来那两处旧标识 (左上角会变蓝的点 / 流末尾「正在做…」) 已经并进下面那颗点 (2026-11-10)
       */
      /**
       * 那颗状态点 (2026-11-10)
       *
       * 贴在头像右下角, 用颜色说三件事 —— **绿 = 新对话 (空场)**, **蓝 = 对话中**, **黄 = 正在做**
       * (与 `ball-phase.json` 同一份 [phaseThinking], 保留呼吸光晕)。判据全部是已经算好的状态:
       * `flowMode === 'hero'` 就是空场, 不另造一个"空不空"的账
       */
      function updateBusy() {
        var busy = phaseThinking()
        var state = busy ? 'busy' : (flowMode === 'hero' ? 'new' : 'chat')
        if (!els.busy) return
        els.busy.setAttribute('data-state', state)
        els.busy.setAttribute('data-on', busy ? 'on' : 'off')
      }

      function renderMeta() {
        updateBusy()
        // 旧元素留着但不进屏 (样式里 `display:none`): 有几条判据还认 `lwp-meta` 这个名字
        if (els.meta) els.meta.textContent = ''
      }

      /**
       * 输入卡上那一行小字 (读数 / 出错): 2.6 s 后自己收
       *
       * 从 2026-11-08 的输入卡改版起 `#lwp-note` 就在了, 但写它的函数没跟着进来 —— 权限 / 模型
       * 换失败那几句其实一直在抛 `ReferenceError`, 被 Promise 的 catch 吃掉, 界面上什么都不出现。
       * 这里补上, 顺手给「开新对话」那三条用
       */
      function showNote(text, isError) {
        if (!els.note) return
        els.note.textContent = text === undefined || text === null ? '' : String(text)
        els.note.setAttribute('data-error', isError === true ? 'on' : 'off')
        if (noteTimer !== null) clearTimeout(noteTimer)
        noteTimer = null
        if (els.note.textContent === '') return
        noteTimer = setTimeout(function () {
          noteTimer = null
          if (els.note) {
            els.note.textContent = ''
            els.note.setAttribute('data-error', 'off')
          }
        }, 2600)
      }

      // ── 这一层的脸 (背景 + 浓淡 + 头像 + 昵称, 设置 → 外观) ──────────────────

      /**
       * 取一份 look
       *
       * **图只在"版本对不上缓存"时才要**: 每次挂载都会问一次读数 (几十字节), 而 base64 一张图几万字
       * 行 —— 只有换过图 (文件名变了) 那一次才真搬。头像走同一套 (2026-11-10), 只是它的缓存键
       * 单独一份 (`AVATAR_CACHE`): 换头像不该让背景那张跟着重搬
       */
      function fetchLook() {
        var meta = call('portalLook', false)
        if (!meta || typeof meta !== 'object') return null
        var ver = typeof meta.ver === 'string' ? meta.ver : ''
        var avatarVer = typeof meta.avatarVer === 'string' ? meta.avatarVer : ''
        var cachedWall = ver === '' ? null : readStored(WALL_CACHE)
        var cachedAvatar = avatarVer === '' ? null : readStored(AVATAR_CACHE)
        var wallReady = cachedWall && cachedWall.ver === ver && typeof cachedWall.url === 'string'
          && cachedWall.url !== ''
        var avatarReady = cachedAvatar && cachedAvatar.ver === avatarVer
          && typeof cachedAvatar.url === 'string' && cachedAvatar.url !== ''
        if (ver !== '') meta.wall = wallReady ? cachedWall.url : ''
        if (avatarVer !== '') meta.avatar = avatarReady ? cachedAvatar.url : ''
        if ((ver !== '' && !wallReady) || (avatarVer !== '' && !avatarReady)) {
          var full = call('portalLook', true)
          if (full && typeof full.wall === 'string') meta.wall = full.wall
          if (full && typeof full.avatar === 'string') meta.avatar = full.avatar
        }
        return meta
      }

      /** 把 `portalLook()` 那一份落到 DOM 上: 背景那两处 + 身份那一份 */
      function applyLook(data) {
        if (!data || typeof data !== 'object') {
          // 桥没给东西时留一行读数: 与 app 那一侧的 `portalLook` 日志对着看就知道断在哪一头
          console.log('[luwi-portal] look missing')
          return
        }
        look = data
        console.log('[luwi-portal] look alpha=' + String(data.alpha) + ' ver=' + String(data.ver)
          + ' wall=' + String(data.wall === undefined ? 0 : String(data.wall).length)
          + ' name=' + String(data.name === undefined ? '' : data.name)
          + ' avatar=' + String(data.avatarVer === undefined ? '-' : data.avatarVer)
          + ' avatarBytes=' + String(data.avatar === undefined ? 0 : String(data.avatar).length))
        applyIdentity(data)
        if (root !== null) root.style.setProperty('--lwp-wall-alpha', String(clampAlpha(data.alpha)))
        if (!els.wall) return
        var ver = typeof data.ver === 'string' ? data.ver : ''
        var url = ''
        if (ver !== '' && typeof data.wall === 'string' && data.wall !== '') {
          url = data.wall
          writeStored(WALL_CACHE, { ver: ver, url: url })
        }
        if (url === '') {
          els.wall.hidden = true
          els.wall.style.backgroundImage = 'none'
        } else {
          els.wall.hidden = false
          els.wall.style.backgroundImage = 'url("' + url + '")'
        }
      }

      /**
       * 头像与昵称 (2026-11-10 主人: "对话层的 luwi 图标和 luwi 名可在外观设置中修改")
       *
       * 两处用同一份: 头栏那块身份、空态中间那张脸。**头像换了头像那张图就换**, 昵称换了字就换;
       * 没配就落回品牌标记与 `Luwi` —— 一份没配过的 face.json 必须画得跟以前一模一样
       */
      function applyIdentity(data) {
        var name = typeof data.name === 'string' ? data.name.trim() : ''
        if (name === '') name = DEFAULT_NAME
        var avatarVer = typeof data.avatarVer === 'string' ? data.avatarVer : ''
        var avatar = ''
        if (avatarVer !== '' && typeof data.avatar === 'string' && data.avatar !== '') {
          avatar = data.avatar
          writeStored(AVATAR_CACHE, { ver: avatarVer, url: avatar })
        }
        var src = avatar === '' ? MARK_PNG : avatar
        if (els.brandName) els.brandName.textContent = name
        if (els.markImg) els.markImg.src = src
        // 空态那张脸是"重新画一遍"的: 它只在没有消息时存在, 所以这里顺手把已经画着的那张也改掉
        if (els.heroName) els.heroName.textContent = name
        if (els.heroImg) els.heroImg.src = src
        if (els.heroMark) els.heroMark.setAttribute('data-photo', avatar === '' ? 'off' : 'on')
        identity = { name: name, avatar: src }
      }

      /** 设置页改完推过来的那一下: 重取一份 (没挂载时什么都不用做, 下一次挂载自己会取) */
      function reloadLook() {
        if (!mounted) return
        applyLook(fetchLook())
      }

      // ── 工具行: 模型 chip (权限选择已撤, 见下) ────────────────────────────────

      /** 「默认完全权限」(2026-11-08 主人): 这一层落到一场上就把权限拨到这一档 */
      var FULL_ACCESS = 'danger-full-access'

      var modelDirectory = null
      var modelState = null
      /** 已经拨过完全权限的那几场 (每场只拨一次, 之后主人自己选的档不被改回来) */
      var permsEnsured = {}
      var menuKind = ''

      /** 这一场的会话面 (命令与 projection 都挂在它上面) */
      function sessionOf() {
        var binding = bindingOf(sessionId)
        return binding && binding.session ? binding.session : null
      }

      /** 当前这一场的权限档; 读不到就回空串 (只给 ensureFullAccess 判"要不要拨", 不再画 chip) */
      function currentPermValue() {
        var session = sessionOf()
        var faces = session && session.projections
        if (!faces || typeof faces.faceOf !== 'function') return ''
        try {
          var snapshot = faces.faceOf('permissions').getSnapshot()
          return snapshot && typeof snapshot.currentValue === 'string' ? snapshot.currentValue : ''
        } catch (_noFace) {
          return ''
        }
      }

      /**
       * 「默认完全权限」: 这一场第一次落到门户上时, 权限还不是完全访问就拨过去
       *
       * 每场只拨一次: 之后主人自己拨回去的档不会被这一层再改回来 —— 默认是默认, 不是强制。
       * **权限选择那颗 chip 已经撤掉** (2026-11-08 主人: "权限选择也删掉"), 所以这里只拨不画;
       * 换档要走 dsh 原生界面
       */
      /**
       * 「默认完全权限」: 这一场第一次落到门户上时, 权限还不是完全访问就拨过去: 这一场第一次落到门户上时, 权限还不是完全访问就拨过去
       *
       * 每场只拨一次: 之后主人自己拨回去的档不会被这一层再改回来 —— 默认是默认, 不是强制
       */
      function ensureFullAccess() {
        if (sessionId === null || permsEnsured[sessionId] === true) return
        var session = sessionOf()
        if (!session || typeof session.command !== 'function') return
        var value = currentPermValue()
        if (value === '') return
        permsEnsured[sessionId] = true
        if (value === FULL_ACCESS) return
        settle(function () { return session.command('/permission ' + FULL_ACCESS) }).catch(function () {
          // 拨不动就记一行: 没有 chip 可以显示实情了 (权限选择已撤), 至少日志里留得住
          console.log('[luwi-portal] could not switch this session to full access')
        })
      }

      // ── 模型 ────────────────────────────────────────────────────────────────

      function modelService() {
        try {
          return ctx.modelDirectories
        } catch (_noService) {
          return undefined
        }
      }

      function loadModel() {
        if (sessionId === null) {
          modelDirectory = null
          modelState = null
          renderModel()
          return
        }
        var service = modelService()
        if (!service || typeof service.directoryFor !== 'function') {
          modelDirectory = null
          modelState = null
          renderModel()
          return
        }
        try {
          modelDirectory = service.directoryFor(sessionId)
        } catch (_noDirectory) {
          modelDirectory = null
        }
        if (modelDirectory === null) {
          modelState = null
          renderModel()
          return
        }
        settle(function () { return modelDirectory.load() }).then(function (state) {
          modelState = state
          renderModel()
        }).catch(function () {
          modelState = null
          renderModel()
        })
      }

      /** chip 上那个名字: 目录里查得到就用它的名字, 查不到就用模型 id */
      function modelLabel() {
        if (modelState === null || !modelState.current) return ''
        var groups = Array.isArray(modelState.groups) ? modelState.groups : []
        for (var i = 0; i < groups.length; i++) {
          var models = Array.isArray(groups[i].models) ? groups[i].models : []
          for (var j = 0; j < models.length; j++) {
            if (models[j].id === modelState.current.model) {
              return String(models[j].name || models[j].id)
            }
          }
        }
        return String(modelState.current.model)
      }

      function renderModel() {
        if (!els.model) return
        var label = modelLabel()
        els.model.hidden = label === ''
        if (els.modelLabel) els.modelLabel.textContent = label
        if (menuKind === 'model') renderMenu()
      }

      function pickModel(provider, model) {
        closeMenu()
        if (modelDirectory === null || typeof modelDirectory.select !== 'function') return
        showNote('', false)
        settle(function () { return modelDirectory.select({ provider: provider, model: model }) }).then(function (result) {
          if (result && result.ok === false) {
            var reason = result.error && result.error.message ? result.error.message : '换不了模型'
            showNote(reason, true)
            return
          }
          loadModel()
        }).catch(function (error) {
          showNote(error && error.message ? error.message : '换不了模型', true)
        })
      }

      // ── 那张菜单 (三个 chip 共用) ────────────────────────────────────────────

      function menuAnchors(kind) {
        if (kind === 'model') return els.model
        return null
      }

      function renderMenu() {
        if (!els.menu) return
        els.menu.textContent = ''
        if (menuKind === 'model') {
          var groups = modelState && Array.isArray(modelState.groups) ? modelState.groups : []
          for (var g = 0; g < groups.length; g++) {
            var group = groups[g]
            if (g > 0) els.menu.appendChild(h('div', 'lwp-menu-sep'))
            els.menu.appendChild(h('div', 'lwp-menu-group', String(group.name || group.id)))
            var models = Array.isArray(group.models) ? group.models : []
            for (var m = 0; m < models.length; m++) {
              var one = models[m]
              if (!one || typeof one.id !== 'string') continue
              var modelRow = h('button')
              modelRow.type = 'button'
              var modelName = h('span', 'lwp-menu-name', String(one.name || one.id))
              if (modelState !== null && modelState.current && modelState.current.model === one.id) modelName.setAttribute('data-on', 'on')
              modelRow.appendChild(modelName)
              modelRow.onclick = function (provider, model) {
                return function () { pickModel(provider, model) }
              }(group.id, one.id)
              els.menu.appendChild(modelRow)
            }
          }
        }
        els.menu.hidden = els.menu.childNodes.length === 0
      }

      function openMenu(kind) {
        if (!els.menu) return
        if (menuKind === kind) {
          closeMenu()
          return
        }
        closeMenu()
        // 菜单与表情面板互斥: 两个都从卡片上方弹, 同时开着会叠在一起
        closeStickerPanel()
        menuKind = kind
        var anchor = menuAnchors(kind)
        if (anchor) anchor.setAttribute('aria-expanded', 'true')
        renderMenu()
      }

      function closeMenu() {
        menuKind = ''
        if (els.model) els.model.setAttribute('aria-expanded', 'false')
        if (els.plus) els.plus.setAttribute('aria-expanded', 'false')
        if (els.menu) els.menu.hidden = true
      }


      /** 发送钮的两副面孔 (空草稿时是四成透明的那颗, 与 dsh 的 `.primary` 同一个读数) */
      function setSendBusy(busy) {
        if (!els.send) return
        els.send.innerHTML = busy ? SPIN_ICON : SEND_ICON
        els.send.disabled = busy
      }

      /** 空草稿 / 没有会话时发送钮按不动 (带了一张传好的图时, 文字可以为空) */
      function updateSendGate() {
        if (!els.send || sending) return
        var text = els.input ? String(els.input.value || '').trim() : ''
        var ready = attach.length > 0 && attachReady()
        // 没有会话时不再把发送钮锁上: 它的禁用态只是 0.4 透明度, 看着还能点, 点了又什么都没发生,
        // 于是用户以为界面坏了. 现在让它能点, 由 send() 用一句话说清"先开一场对话"
        els.send.disabled = text === '' && !ready
      }

      function kv(key, value) {
        var row = h('div', 'lwp-kv')
        row.appendChild(h('b', null, key))
        row.appendChild(h('span', null, value === undefined || value === null || value === '' ? '—' : String(value)))
        return row
      }

      function openDrawer(which) {
        drawer = drawer === which ? '' : which
        renderDrawer()
      }

      /**
       * 「···」那张菜单 (2026-11-10 主人: "右上角判断层和工作合成一个按钮, 改成 ··· 表示更多")
       *
       * 三行: 判断层 / 工作 / 收起。点进去沿用原来那两个面板 (内容一个字节没改), 面板顶上多一行
       * 「‹ 返回」回到这张菜单 —— 这样 `#lwp-drawer` 只有一处, 不必给每个面板再造一扇窗
       */
      function renderMenuDrawer() {
        els.drawer.appendChild(h('h3', null, '更多'))
        var items = [
          ['router', '判断层', '她什么时候开口那一套读数'],
          ['work', '工作', '探索排期与上一次摘要'],
        ]
        for (var i = 0; i < items.length; i += 1) {
          (function (which, label, note) {
            var row = h('button', 'lwp-menu-row')
            row.type = 'button'
            var text = h('div', null, '')
            text.style.display = 'flex'
            text.style.flexDirection = 'column'
            text.style.minWidth = '0'
            text.appendChild(h('span', null, label))
            text.appendChild(h('em', null, note))
            row.appendChild(text)
            row.appendChild(h('span', null, '›'))
            row.onclick = function () { openDrawer(which) }
            els.drawer.appendChild(row)
          }(items[i][0], items[i][1], items[i][2]))
        }
        var close = h('button', 'lwp-menu-row', '收起')
        close.type = 'button'
        close.onclick = function () { openDrawer('') }
        els.drawer.appendChild(close)
      }

      function renderDrawer() {
        if (!els.drawer) return
        if (drawer === '') {
          els.drawer.hidden = true
          els.drawer.textContent = ''
        } else {
          els.drawer.hidden = false
          els.drawer.textContent = ''
          // 进面板时先给一行「返回」: 菜单是两层的, 没有回头的路就得先收起再点一次 `⋯`
          if (drawer !== 'menu') {
            var back = h('button', 'lwp-menu-row lwp-menu-back', '‹ 返回')
            back.type = 'button'
            back.onclick = function () { openDrawer('menu') }
            els.drawer.appendChild(back)
          }
          if (drawer === 'menu') renderMenuDrawer()
          else if (drawer === 'router') renderRouterDrawer()
          else renderWorkDrawer()
        }
        if (els.moreButton) els.moreButton.setAttribute('data-on', drawer === '' ? 'off' : 'on')
      }

      function renderRouterDrawer() {
        var data = status || {}
        var router = data.router || {}
        var last = router.last || {}
        els.drawer.appendChild(h('h3', null, '判断层'))
        els.drawer.appendChild(kv('上一次判断', last.say === true
          ? '开口了' + (last.kind ? ' (' + last.kind + ')' : '')
          : (last.why || '还没判过')))
        els.drawer.appendChild(kv('上一次开口', router.lastSpokenAt ? clock(router.lastSpokenAt) : '—'))
        els.drawer.appendChild(kv('静默窗口', router.quiet && router.quiet.enabled === true
          ? router.quiet.from + '-' + router.quiet.to
          : '关着'))
        els.drawer.appendChild(kv('冷却', router.rules && router.rules.cooldownMs
          ? Math.round(Number(router.rules.cooldownMs) / 60000) + ' 分'
          : '—'))
        els.drawer.appendChild(kv('沉睡前等待', router.rules && router.rules.preSleepWaitMs
          ? Math.round(Number(router.rules.preSleepWaitMs) / 60000) + ' 分'
          : '—'))
        els.drawer.appendChild(kv('敲钟', router.tick && router.tick.enabled === true ? '开着 (25-55 分一次)' : '关着'))

        var checks = Array.isArray(router.checks) ? router.checks : []
        els.drawer.appendChild(h('h3', null, 'checks (' + checks.length + ' / 3)'))
        if (checks.length === 0) {
          els.drawer.appendChild(kv('内容', '探索还没交来'))
        }
        for (var i = 0; i < checks.length; i++) {
          var one = checks[i] || {}
          var line = h('div', 'lwp-check')
          var body = h('p', null, one.what || one.label || '一条检测项')
          // 判法那一行是给人看的读数: `when.kind` 与门槛分钟数 (与宿主 routerCheckHit 同一套说法)
          var when = one.when || {}
          var detail = []
          if (when.kind) detail.push(String(when.kind))
          if (one.minutes) detail.push(String(one.minutes) + ' 分')
          if (one.packageName) detail.push(String(one.packageName))
          if (detail.length > 0) body.appendChild(h('small', null, detail.join(' · ')))
          line.appendChild(body)
          var done = h('button', null, '已处理')
          done.onclick = function (id) {
            return function () {
              call('portalCheckDone', id)
              refresh()
            }
          }(String(one.id || one.what || ''))
          line.appendChild(done)
          els.drawer.appendChild(line)
        }

        var actions = h('div', 'lwp-actions')
        var tick = h('button', null, '敲一下钟')
        tick.onclick = function () {
          call('portalTick')
          setTimeout(refresh, 600)
        }
        actions.appendChild(tick)
        var toggle = h('button', null, router.tick && router.tick.enabled === true ? '关掉敲钟' : '打开敲钟')
        toggle.onclick = function () {
          call('portalTickEnabled', !(router.tick && router.tick.enabled === true))
          setTimeout(refresh, 300)
        }
        actions.appendChild(toggle)
        els.drawer.appendChild(actions)
      }

      function renderWorkDrawer() {
        var data = status || {}
        var explore = data.explore || {}
        els.drawer.appendChild(h('h3', null, '工作'))
        els.drawer.appendChild(kv('下一趟', explore.nextTask || '还没有排'))
        els.drawer.appendChild(kv('上次摘要', explore.lastSummaryAt ? clock(explore.lastSummaryAt) : '—'))
        els.drawer.appendChild(kv('探索时刻', explore.schedule || '—'))
        var actions = h('div', 'lwp-actions')
        var start = h('button', null, '开始这一趟')
        start.onclick = function () {
          call('portalExplore')
          setTimeout(refresh, 600)
        }
        actions.appendChild(start)
        var again = h('button', null, '刷新')
        again.onclick = refresh
        actions.appendChild(again)
        els.drawer.appendChild(actions)
      }

      function refresh() {
        status = call('portalStatus')
        renderDrawer()
        renderMeta()
        if (mounted) renderFlow()
      }

      /* ── 上传文件 (主人 2026-11-08: `+` 就是上传文件的按钮, 图片与 docs 一样走这条) ──
       *
       * 两条落点, 都跟 dsh 自己那条路对齐:
       *
       * - **图片**: 直接编成 prompt 里的 `image` 块 (`{ type:'image', mediaType, data, name }`,
       *   与 dsh 的 `encodeImage()` 同一个形状) —— 走 `session.prompt(content)` 这一条, 与 dsh 原生
       *   输入框发图**同一份 wire format**。为什么不用 `conversation.sendSession`: 真机上它回
       *   `kind:'error'` (那一套要走输入框的草稿与回显), 而 `session.prompt` 是通的 (文字那条一直在用)。
       * - **其它文件** (pdf/docx/…): dsh 的附件只认上传回执, 而那条上传路由在安卓上必挂
       *   (`dsh-attachment-local` 落盘前要 fsync 每一层祖先目录, DAC 不让) —— 所以落到
       *   `<工作区>/lw-in/`, 路径写进正文, 她拿 fs 工具自己读
       */

      /**
       * 把一条「图片发送失败：<原因>」塞进对话流 (落实表 #35, 2026-11-12)
       *
       * 落点是门户自己的时间线: `who:'error'` 与 dsh 的 turn-error 同一个画法 (红字玻璃气泡), 排在
       * 它自己那一刻所在的轮尾。**只认 [IMAGE_FAIL] 那三种说法**, 别的一律按「上传超时」说 —— 宁可
       * 含糊, 也不在屏上写一句没人对得上的话
       *
       * @param {string} reason 三种说法之一 (页面内部只传常量, 宿主那侧不必认识这些字)
       */
      function imageFail(reason) {
        var text = String(reason === undefined || reason === null ? '' : reason)
        if (text !== IMAGE_FAIL.noCallback && text !== IMAGE_FAIL.tooBig && text !== IMAGE_FAIL.timeout) {
          text = IMAGE_FAIL.timeout
        }
        var at = Date.now()
        imageFails.push({
          id: 'imagefail\u0001' + String(at) + '\u0001' + String(imageFails.length),
          at: at,
          text: '图片发送失败：' + text,
        })
        // 只留最近三条: 连着失败十次不该把整段对话顶走
        while (imageFails.length > 3) imageFails.shift()
        console.log('[luwi-portal] image send failed: ' + text)
        // 读数那一半归宿主: 机型与 WebView 版本各一行进 logcat, 同一时刻与这条气泡对上 (判据就认这两行)
        call('portalImageFail', text)
        renderFlow()
      }

      /** 撤掉"WebView 没回调"那个计时器 (宿主真回调了就撤) */
      function disarmPickWatch() {
        if (pickWatch === null) return
        clearTimeout(pickWatch)
        pickWatch = null
      }

      /** 点 `+` 之后先假定"WebView 没回调": 宿主那侧一行 `pickState` 回来就撤掉它 */
      function armPickWatch() {
        disarmPickWatch()
        pickWatch = setTimeout(function () {
          pickWatch = null
          imageFail(IMAGE_FAIL.noCallback)
        }, PICK_WAIT_MS)
      }

      /**
       * 宿主那侧对这次选择的回话 (见 `HostScreen.onShowFileChooser` 与那个选择器的回调)
       *
       * - `shown`: `onShowFileChooser` 真的进来了 —— 选择器起来了, 撤掉计时器
       * - `picked`: 选好的文件已经交回页面 (随后就到了 change)
       * - `empty` / `none`: 选择器回来是空的 / 起不来 —— 这两种在页面上与"没回调"一样是**没有反应**,
       *   也就是 issue #53 报的那一下, 直接说清
       * @param {string} state 宿主给的那一个词
       */
      function pickState(state) {
        var what = String(state === undefined || state === null ? '' : state)
        disarmPickWatch()
        if (what === 'shown' || what === 'picked') return
        imageFail(IMAGE_FAIL.noCallback)
      }

      /**
       * 一条待发附件等字节的最长时间 (超了就地作废这一条, 并报「上传超时」)
       *
       * 计时器挂在条目自己身上 (`one.watch`), 收尾时由 [renderAttach] 顺手清掉 —— 状态不再是
       * `reading` 就是已经有结论了
       */
      function armUploadWatch(one) {
        one.gaveUp = false
        one.watch = setTimeout(function () {
          one.watch = undefined
          if (one.status !== 'reading') return
          one.gaveUp = true
          one.status = 'error'
          one.error = '等太久了'
          renderAttach()
          imageFail(IMAGE_FAIL.timeout)
        }, UPLOAD_WAIT_MS)
      }

      /** 弹选择器: 走 `<input type=file>`, 也就是 `HostScreen.onShowFileChooser` 那条路 */
      function pickFile() {
        if (els.file === undefined || els.file === null) return
        if (typeof sessionId !== 'string' || sessionId === '') {
          showNote('先开一场对话', true)
          return
        }
        // 这一下以前是静默的: WebView 不回调就没有任何反应 (落实表 #35)
        armPickWatch()
        els.file.click()
      }

      /** 一个文件多少大, 说人话 */
      function sizeText(bytes) {
        var n = Number(bytes)
        if (!isFinite(n) || n <= 0) return ''
        if (n < 1024) return n + ' B'
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
        return (n / (1024 * 1024)).toFixed(1) + ' MB'
      }

      /** bytes → base64 (分块拼, 几 MB 的文件直接 `apply` 会爆栈) */
      function base64Of(bytes) {
        var chunk = 0x8000
        var parts = []
        for (var i = 0; i < bytes.length; i += chunk) {
          parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)))
        }
        return btoa(parts.join(''))
      }

      /** 选好的文件: 图片读成 base64 (等会儿跟 prompt 一起发), 别的落到盘上给路径 */
      function onFilesChosen(files) {
        if (typeof sessionId !== 'string' || sessionId === '') {
          showNote('先开一场对话', true)
          return
        }
        for (var i = 0; i < files.length && attach.length < MAX_ATTACH; i += 1) {
          var file = files[i]
          var type = file && typeof file.type === 'string' ? file.type : ''
          // 太大在**读字节之前**就说: 读进来再报错, 那几秒的卡顿本身就是一条"没反应" (落实表 #35)
          if (Number(file && file.size ? file.size : 0) > MAX_STASH_BYTES) {
            imageFail(IMAGE_FAIL.tooBig)
            continue
          }
          if (type.indexOf('image/') === 0) readImage(file)
          else stashOne(file)
        }
        renderAttach()
      }

      /** 一张图: 读字节 → base64 → 记成一条 `image` 块 (发送时与文字一起进 prompt) */
      function readImage(file) {
        var one = {
          kind: 'image',
          name: file && file.name ? String(file.name) : '图',
          bytes: file && file.size ? Number(file.size) : 0,
          mediaType: file && file.type ? String(file.type) : 'image/png',
          data: '',
          status: 'reading',
          error: '',
          path: '',
          lastLogged: '',
        }
        attach.push(one)
        renderAttach()
        if (typeof FileReader !== 'function') {
          one.status = 'error'
          one.error = '这个 WebView 读不了本地文件'
          renderAttach()
          return
        }
        var reader = new FileReader()
        armUploadWatch(one)
        reader.onerror = function () {
          if (one.gaveUp === true) return
          one.status = 'error'
          one.error = '读不动这张图'
          renderAttach()
        }
        reader.onload = function () {
          if (one.gaveUp === true) return
          var buffer = reader.result
          var bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : null
          if (bytes === null || bytes.length === 0) {
            one.status = 'error'
            one.error = '读出来是空的'
            renderAttach()
            return
          }
          one.bytes = bytes.length
          one.data = base64Of(bytes)
          // 同一份字节落到工作区 `lw-in/` (2026-11-09): 图片不再走 dsh 的 attachment (安卓上必失败),
          // 她读的就是这一份 —— **没落好就不许发** (否则屏上有一张, 她那边什么都没有)
          var stash = call('portalStash', JSON.stringify({ name: one.name, data: one.data }))
          if (!stash || stash.ok !== true) {
            one.status = 'error'
            one.error = stash && stash.error ? String(stash.error) : '存不进去'
            renderAttach()
            return
          }
          one.path = String(stash.path || '')
          one.name = String(stash.name || one.name)
          one.status = 'ready'
          renderAttach()
        }
        reader.readAsArrayBuffer(file)
      }

      /** 其它文件: 读字节 → base64 → 桥 → 回一个盘上的绝对路径 (`<工作区>/lw-in/`) */
      function stashOne(file) {
        var one = {
          kind: 'stashed',
          name: file && file.name ? String(file.name) : '文件',
          bytes: file && file.size ? Number(file.size) : 0,
          mediaType: '',
          data: '',
          status: 'reading',
          error: '',
          path: '',
          lastLogged: '',
        }
        attach.push(one)
        renderAttach()
        if (typeof FileReader !== 'function') {
          one.status = 'error'
          one.error = '这个 WebView 读不了本地文件'
          renderAttach()
          return
        }
        var reader = new FileReader()
        armUploadWatch(one)
        reader.onerror = function () {
          if (one.gaveUp === true) return
          one.status = 'error'
          one.error = '读不动这个文件'
          renderAttach()
        }
        reader.onload = function () {
          if (one.gaveUp === true) return
          var buffer = reader.result
          var bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : null
          if (bytes === null) {
            one.status = 'error'
            one.error = '读出来是空的'
            renderAttach()
            return
          }
          if (bytes.length > MAX_STASH_BYTES) {
            one.status = 'error'
            one.error = '太大了 (一次最多 ' + Math.round(MAX_STASH_BYTES / (1024 * 1024)) + ' MB)'
            renderAttach()
            return
          }
          var answer = call('portalStash', JSON.stringify({ name: one.name, data: base64Of(bytes) }))
          if (!answer || answer.ok !== true) {
            one.status = 'error'
            one.error = answer && answer.error ? String(answer.error) : '存不进去'
            renderAttach()
            return
          }
          one.path = String(answer.path || '')
          one.name = String(answer.name || one.name)
          one.bytes = Number(answer.bytes) || one.bytes
          one.status = 'ready'
          renderAttach()
        }
        reader.readAsArrayBuffer(file)
      }

      /**
       * 待发附件那一行重画 (2026-11-10)
       *
       * 图与表情画成 64px 缩略图 (照 dsh 的 `ComposerAttachments`), 角上一颗 `×` 撤掉; 非图片文件
       * 仍是一颗 chip (名字 + 大小 + 状态)。**顺序就是挑选 / 点的顺序** (`attach` 数组), 全部 ready
       * 才允许发 —— 这一行在输入框上面, 发之前看得见自己贴了什么
       */
      function renderAttach() {
        if (!els.attachRow) return
        els.attachRow.textContent = ''
        els.attachRow.hidden = attach.length === 0
        for (var i = 0; i < attach.length; i += 1) {
          var one = attach[i]
          // 已经有结论 (ready / error) 的那条不该再等着超时: 计时器挂在条目自己身上 (见 [armUploadWatch])
          if (one.watch !== undefined && one.status !== 'reading') {
            clearTimeout(one.watch)
            one.watch = undefined
          }
          els.attachRow.appendChild(one.kind === 'image' ? attachThumb(one) : attachChip(one))
          // 一行读数: 真机上"文件进没进 prompt"只能看这一行 —— 变了才写, 不刷屏
          if (one.lastLogged !== one.status) {
            one.lastLogged = one.status
            console.log('[luwi-portal] attach ' + one.name + ' -> ' + one.status
              + (one.error === '' ? '' : ' (' + one.error + ')')
              + (one.path === '' ? '' : ' ' + one.path))
          }
        }
        updateSendGate()
      }

      /** 一张待发图 / 表情的缩略图 (64px 方框, 角上一颗 `×`; 读着的那一帧有扫光) */
      function attachThumb(one) {
        var box = h('div', 'lwp-attach-thumb')
        box.setAttribute('data-state', one.status)
        box.title = one.status === 'error'
          ? (one.error === '' ? '没成' : one.error)
          : (one.path === '' ? one.name : one.path)
        var src = attachSrc(one)
        if (src !== '') {
          var img = document.createElement('img')
          img.alt = ''
          img.src = src
          box.appendChild(img)
        }
        var x = h('button', 'lwp-attach-x', '×')
        x.type = 'button'
        x.setAttribute('aria-label', '撤掉 ' + String(one.name || '附件'))
        x.onclick = function (event) {
          // 缩略图本身不是钮, 点角上这一颗才撤 (与 dsh 的 `.remove` 同一个位置)
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
          attachTap(one)
        }
        box.appendChild(x)
        return box
      }

      /**
       * 缩略图的 `src`
       *
       * 落过盘的那一份走宿主的只读路由 (`/lw-out/in/<名字>`, 与消息气泡里那张图同一串); 还在读的用
       * 已经拿到的字节 (data URL), 免得解码前空一帧。两样都没有就留一个带扫光的空格子
       */
      function attachSrc(one) {
        if (one.status === 'ready' && typeof one.path === 'string' && one.path !== '') {
          return '/lw-out/in/' + encodeURIComponent(String(one.name || baseNameOf(one.path)))
        }
        if (typeof one.data === 'string' && one.data !== '') {
          return 'data:' + (one.mediaType || mimeOfName(one.name)) + ';base64,' + one.data
        }
        return ''
      }

      /** 非图片文件那一颗 chip (名字 + 大小 + 状态), 点一下撤掉 */
      function attachChip(one) {
        var size = sizeText(one.bytes)
        var label = one.name + (size === '' ? '' : ' · ' + size)
        if (one.status === 'reading') label += ' · 读着…'
        else if (one.status === 'error') label += ' · 没成, 点一下撤掉'
        else label += ' ×'
        var chip = h('span', null, label)
        chip.id = 'lwp-attach'
        chip.setAttribute('data-state', one.status)
        chip.title = one.status === 'error' ? one.error : (one.path === '' ? one.name : one.path)
        chip.onclick = function () { attachTap(one) }
        return chip
      }

      /** 点一颗读数: 撤掉这个文件 */
      function attachTap(item) {
        if (!item) return
        var rest = []
        for (var i = 0; i < attach.length; i += 1) {
          if (attach[i] !== item) rest.push(attach[i])
        }
        attach = rest
        renderAttach()
      }

      /** 撤掉全部 (换会话 / 收门户时; 盘上那些文件留着, 她下次还能读) */
      function clearAttach() {
        attach = []
        renderAttach()
      }

      /** 这些能不能发: 有, 而且全部就绪 */
      function attachReady() {
        if (attach.length === 0) return false
        for (var i = 0; i < attach.length; i += 1) {
          if (attach[i].status !== 'ready') return false
        }
        return true
      }

      /**
       * 附件那一段正文
       *
       * 落过盘的（非图片文件，以及 2026-11-09 起的图片）都写一行路径 —— 她拿 fs 工具能直接读,
       * 而门户这一侧靠这一段把"自己发过的那张图"认回来 (`splitAttach()`): 会话里只留 attachment
       * 引用, 这份路径是唯一还能找到字节的线索
       */
      function attachLines() {
        var rows = []
        for (var i = 0; i < attach.length; i += 1) {
          var one = attach[i]
          if (one.path === '') continue
          if (one.kind !== 'stashed' && one.kind !== 'image') continue
          rows.push((rows.length + 1) + '. ' + one.path)
        }
        if (rows.length === 0) return ''
        // 抬头那句是给她看的路标: 图走 `read_image`, 文档直接读 —— 图片不再走 image 块 (见 imageBlocks)
        return '\n\n[附件 ' + rows.length + ' 个, 图片用 read_image 打开]\n' + rows.join('\n')
      }

      /**
       * prompt 里的 image 块
       *
       * **安卓上不发 image 块** (2026-11-09 真机读数): dsh 的 `dsh-attachment-local` 落盘前要把
       * 目标目录逐层 fsync 再硬链接, 这台设备上必失败 —— `session/attachment-invalid: Unable to
       * persist attachment: ENOENT .../attachments/v1/tmp/<uuid>`, 整条 prompt 跟着被拒, 一张图都
       * 发不出去。所以图与文件走同一条路: `portalStash` 落到工作区 `lw-in/`, 路径写进正文, 她拿
       * `read_image` 自己打开 (与 `logs.txt` 那条早就验过的路一致)
       */
      function imageBlocks() {
        return []
      }
      /** 交给 dsh 自己投递: 与输入框同一条路 (beginSubmission 的 echo 让"发送中"也能画) */
      function send(mode) {
        if (sending) return
        var text = String(els.input.value || '').trim()
        if (sessionId === null) {
          // 以前这里是直接 return: 发送钮看着是能点的, 点了什么都不发生, 用户以为坏了
          showNote('还没有对话: 先点「历史」开一场, 或者先在 dsh 里选一个工作区', true)
          return
        }
        // 带图的那一路: 文字可以为空 (只发一张图), 但图必须已经落好盘
        if (attach.length > 0) {
          if (!attachReady()) {
            // 有错就说那一句 (存不下 / 太大), 别拿"还在传"糊过去 —— 那种情况下它永远不会 ready
            var bad = ''
            for (var b = 0; b < attach.length; b += 1) {
              if (attach[b].status === 'error' && attach[b].error !== '') bad = attach[b].error
            }
            showNote(bad === '' ? '文件还在传, 等一下再发' : bad, true)
            return
          }
        } else if (text === '') {
          return
        }
        var binding = bindingOf(sessionId)
        if (binding === undefined) {
          // 这一场还没挂上 (dsh 的 retain 有延迟 / 这一场已经不在当前工作区里): 说一句, 不静默吞掉
          console.log('[luwi-portal] send skipped: no binding for ' + sessionId)
          showNote('这一场还没挂上, 等一下再发', true)
          return
        }
        var session = binding.session
        sending = true
        setSendBusy(true)
        els.input.value = ''
        // 第一句之后把这一场写进账本: 球接下来 10 分钟接的就是这一场
        if (bound !== sessionId) {
          bound = sessionId
          call('portalBind', sessionId)
        }
        // 附件: 图片编成 prompt 里的 `image` 块 (与 dsh 的 encodeImage 同一个形状), 落盘的文件把路径
        // 写进正文 —— 她拿 fs 工具直接读那几条
        var full = text + attachLines()
        var blocks = imageBlocks()
        if (full !== '') blocks.push({ type: 'text', text: full })
        var requestId
        try {
          if (typeof session.beginSubmission === 'function') {
            var handle = session.beginSubmission({ mode: mode, text: full, attachments: [] })
            requestId = handle && handle.requestId
          }
        } catch (_noEcho) {
          requestId = undefined
        }
        var started = Promise.resolve(session.prompt(blocks, mode, undefined, requestId)).then(function (result) {
          // `prompt()` 回的是 `{ ok, value | error }` —— 不看它就会**静默失败** (2026-11-08 真机上就是这么
          // "点了发送没反应"的: 图片块被拒, 而 Promise 照样 resolve)
          if (result && result.ok === false) {
            var reason = result.error ? (result.error.code + ': ' + result.error.message) : '这一轮没被接受'
            console.log('[luwi-portal] prompt rejected: ' + reason)
            throw new Error(reason)
          }
          clearAttach()
          return result
        })
        started
          .catch(function (error) {
            // 失败由会话自己的错误节点显示, 这里只把草稿还回去
            console.log('[luwi-portal] send failed: ' + describeError(error))
            if (els.input && els.input.value === '') els.input.value = text
            if (attach.length > 0) showNote('这些文件没发出去: ' + describeError(error), true)
          })
          .then(function () {
            sending = false
            setSendBusy(false)
            updateSendGate()
            scheduleRender()
          })
      }

      /** 账本换了场就跟着走 (球超时另开一场时, 门户不该还停在旧的) */
      function pollLedger() {
        // 这一拍顺便兜一件事: FileObserver 漏了事件时把她说的话补读回来
        var wasThinking = phaseThinking()
        status = call('portalStatus')
        loadOut(false)
        if (phaseThinking() !== wasThinking) renderFlow()
        var ledger = call('portalSession')
        if (ledger && typeof ledger.workspacePath === 'string') ballWorkspacePath = ledger.workspacePath
        var ledgerAt = ledger && typeof ledger.at === 'number' ? ledger.at : 0
        // 已经在这一场: 记下账本这一版, 下一拍不再判它 (同一场继续说不动界面)
        if (ledger && typeof ledger.id === 'string' && ledger.id === sessionId) {
          lastLedgerAt = ledgerAt
        }
        // 刚点过"开新对话"的那 15 秒: 账本还可能是旧场, 这会儿跟随等于把刚清空的界面拽回去
        if (Date.now() < ledgerHoldUntil) {
          renderMeta()
          return
        }
        // 账本过期 (她 10 分钟没说话) 时也跟随一次: 打开应用是想看刚聊过的那一场, 不是想落在一张空 draft 上
        // **跟成功才落记号** (2026-11-08 23:4x 真机: 落早了就只跟一次, 那一次正好赶上工作区还没开 → 永远空态)
        if (ledger && typeof ledger.id === 'string' && ledger.id !== '' && ledger.usable !== true && !staleFollowed) {
          // 先把它所在的工作区打开 —— dsh 只加载当前工作区, 别的工作区的场次连 binding 都拿不到,
          // 而 `openSession` 不一定抛 (它可能一声不响地什么也没做成)
          openBallWorkspace(ledger.id)
          if (switchTo(ledger.id, 'ledger')) staleFollowed = true
        }
        // 2026-11-10: 只有账本**被重写过** (`at` 变大) 才跟 —— 点历史不写账本, 于是不再被 3 s 定时器拽回
        if (ledgerShouldFollow(ledger, sessionId, lastLedgerAt)) {
          if (switchTo(ledger.id, 'ledger')) {
            lastLedgerAt = ledgerAt
          } else {
            // 那一场开不出来: 15 s 后再试一次 (这中间 openWorkspace 可能已经把工作区切过去了)
            ledgerHoldUntil = Date.now() + 15000
          }
        }
        renderMeta()
      }

      function build() {
        style = document.createElement('style')
        style.setAttribute('data-luwi-portal', '1')
        style.textContent = CSS
        document.head.appendChild(style)

        // **把 dsh 那一层整块藏起来**: 覆盖层再怎么 z-index 高, 底下的宽度控制与上下文滑杆仍会透出来
        // (它们在 dsh 的层叠里各有各的值), 而这一层要的就是"只有这张脸"。用 visibility 而不是 display:
        // 树还在、尺寸还算得出来, 会话与订阅一个都不动
        var shellRoot = document.getElementById('root')
        if (shellRoot !== null) shellRoot.style.visibility = 'hidden'

        root = h('div')
        root.id = 'lwp-root'

        // 背景层在最底下: 一整张铺满, 浓淡由 root 上的 `--lwp-wall-alpha` 说 (设置 → 外观)
        els.wall = h('div')
        els.wall.id = 'lwp-wall'
        els.wall.hidden = true
        root.appendChild(els.wall)

        var head = h('div')
        head.id = 'lwp-head'
        // 左边那一块 = 身份 (头像 + 昵称): 整块可点 = 开一场新对话 (2026-11-08 的规矩留着);
        // 头像与昵称由 `applyIdentity()` 从 `portalLook` 那一份里填 (2026-11-10 起可在外观里改)
        els.brand = h('button')
        els.brand.id = 'lwp-brand'
        els.brand.type = 'button'
        els.brand.setAttribute('aria-label', '开一个新对话')
        var mark = h('span', 'lwp-mark')
        els.markImg = document.createElement('img')
        els.markImg.src = MARK_PNG
        els.markImg.alt = ''
        mark.appendChild(els.markImg)
        // 状态点挂在头像右下角 (2026-11-10 主人: "状态的标识点应该在头像右下角而不应该是右边"),
        // 一顆点三态见 CSS: 绿 = 新对话, 蓝 = 对话中, 黄 = 正在做
        els.busy = h('span')
        els.busy.id = 'lwp-busy'
        els.busy.setAttribute('aria-hidden', 'true')
        els.busy.setAttribute('data-state', 'new')
        els.busy.setAttribute('data-on', 'off')
        mark.appendChild(els.busy)
        els.brand.appendChild(mark)
        var brandText = h('span', 'lwp-brand-text')
        els.brandName = h('span', 'lwp-brand-name', DEFAULT_NAME)
        brandText.appendChild(els.brandName)
        els.meta = h('span', 'lwp-meta', '')
        brandText.appendChild(els.meta)
        els.brand.appendChild(brandText)
        els.brand.onclick = function () { newConversation() }
        head.appendChild(els.brand)
        // 右边: 历史 → 更多 (`⋯`)
        els.historyButton = h('button', 'lwp-tab', '历史')
        els.historyButton.id = 'lwp-history-btn'
        els.historyButton.type = 'button'
        els.historyButton.onclick = function () { openHistory() }
        head.appendChild(els.historyButton)
        els.moreButton = h('button', 'lwp-tab lwp-more', '⋯')
        els.moreButton.id = 'lwp-more-btn'
        els.moreButton.type = 'button'
        els.moreButton.setAttribute('aria-label', '更多')
        els.moreButton.onclick = function () { openDrawer(drawer === '' ? 'menu' : '') }
        head.appendChild(els.moreButton)
        root.appendChild(head)

        // 「已开新对话」: head 与 flow 之间的一块 (流里的, 不遮消息), 8 秒后自己收
        els.undo = h('div')
        els.undo.id = 'lwp-undo'
        els.undo.hidden = true
        els.undo.setAttribute('role', 'status')
        els.undo.setAttribute('aria-live', 'polite')
        els.undo.appendChild(h('span', null, '已开新对话'))
        root.appendChild(els.undo)

        els.flow = h('div')
        els.flow.id = 'lwp-flow'
        root.appendChild(els.flow)
        // **贴底跟着布局走** (2026-11-09): 输入框清空 / 键盘起落都会改这块的高度, 只在渲染那一拍写
        // 一次 `scrollTop` 钉不住 —— 钉两帧是 `stickFlow()` 自己的事, 这里只负责"尺寸一变就叫它"
        //
        // `stickOn` 只由**手指拖动**改: 布局引起的 scroll 事件也走这里, 拿它判"离底多远"会把贴底
        // 自己关掉 (发出去那一下正是布局连续变化的时候)
        var dragging = false
        var dragTimer = 0
        var noteDrag = function () {
          dragging = true
          if (dragTimer !== 0) clearTimeout(dragTimer)
          dragTimer = setTimeout(function () {
            dragTimer = 0
            dragging = false
          }, 260)
        }
        els.flow.addEventListener('touchstart', noteDrag, { passive: true })
        els.flow.addEventListener('touchmove', noteDrag, { passive: true })
        els.flow.addEventListener('wheel', noteDrag, { passive: true })
        els.flow.addEventListener('scroll', function () {
          if (!dragging && dragTimer === 0) return
          stickOn = (els.flow.scrollHeight - els.flow.scrollTop - els.flow.clientHeight) < 48
        })
        if (typeof ResizeObserver === 'function') {
          try {
            var flowStickObserver = new ResizeObserver(function () { stickFlow() })
            flowStickObserver.observe(els.flow)
          } catch (_noObserver) {
            // 老 WebView 没有 ResizeObserver: 退回"只在渲染那一拍贴底"的老行为
          }
        }

        // **输入区照 dsh 的 InputBar**: 一张 28px 圆角的卡 (input-major 的实底 + soft elevation),
        // 卡里先是文本区, 再是底部那一行 —— 左边预设 chip、右边 34px 的圆钮。工作区选择不画
        var dock = h('div')
        dock.id = 'lwp-dock'

        var card = h('div')
        card.id = 'lwp-card'

        els.input = h('textarea')
        els.input.id = 'lwp-input'
        els.input.placeholder = '说点什么'
        els.input.rows = 1
        els.input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send('queue')
          }
        })
        els.input.addEventListener('input', function () {
          updateSendGate()
          // 高度跟着内容长, 上限那一档写在 CSS 的 max-height 里 (14 行)
          els.input.style.height = 'auto'
          els.input.style.height = String(els.input.scrollHeight) + 'px'
        })
        // 待发附件那一行 **在文本区上面** (2026-11-10 主人: "附件发图片和发表情包, 应该要在输入框
        // 上方显示, 像 dsh 原生那样") —— dsh 的 `InputBar` 里 `conversation.input.attachments` slot
        // 就在 DraftEditor 之前, 所以卡里的行序照它: 附件行 -> 文本区 -> 底部工具行
        els.attachRow = h('div')
        els.attachRow.id = 'lwp-attach-row'
        els.attachRow.hidden = true
        card.appendChild(els.attachRow)
        card.appendChild(els.input)

        var row = h('div')
        row.id = 'lwp-row'

        var tools = h('div')
        tools.id = 'lwp-tools'
        /* ── `+` = 上传文件 (2026-11-08 主人: "输入框左边 + 改成上传文件的按钮, 包括图片, docs 等文件,
         * 取消原来的选择命令的功能") ────────────────────────────────────────────────
         *
         * **不能用 `ACTION_PICK_IMAGES`**: 门户是 WebView 里的页面, Android 那条路拿不到结果;
         * `HostScreen` 的 `onShowFileChooser` 已经实现选择器, 所以老老实实用 `<input type=file>`。
         *
         * 选完的文件走桥上的 `portalStash` 落到 `$DSH_HOME/lw/up/` (她读得到的地方; dsh 自己那条
         * attachment 上传在安卓上必失败 —— 见 `PortalBridge.portalStash` 的注释)。**没落好不许发**
         */
        els.plus = h('button')
        els.plus.id = 'lwp-plus'
        els.plus.type = 'button'
        els.plus.setAttribute('aria-label', '上传文件')
        els.plus.innerHTML = PLUS_ICON
        els.plus.onclick = function () { pickFile() }
        tools.appendChild(els.plus)

        /* ── 表情那颗 (2026-11-09 主人: "`+` 的右边增加表情包图标, 点击弹出表情包选择") ──────
         *
         * 面板里列的就是 `$DSH_HOME/lw/stickers` —— 那正是她的表情包文件夹, 主人放进去的与她贴出来
         * 的是同一批。点一张就把这张图发给她; 最后一格是"加一张" (只有图标, 一个字都没有)
         */
        els.stickerBtn = h('button')
        els.stickerBtn.id = 'lwp-sticker-btn'
        els.stickerBtn.type = 'button'
        els.stickerBtn.setAttribute('aria-label', '表情')
        els.stickerBtn.setAttribute('aria-expanded', 'false')
        els.stickerBtn.innerHTML = STICKER_ICON
        els.stickerBtn.onclick = function () { toggleStickerPanel() }
        tools.appendChild(els.stickerBtn)

        els.stickerFile = document.createElement('input')
        els.stickerFile.type = 'file'
        els.stickerFile.accept = 'image/png,image/gif,image/webp,image/jpeg'
        els.stickerFile.hidden = true
        els.stickerFile.addEventListener('change', function () {
          var files = els.stickerFile && els.stickerFile.files ? els.stickerFile.files : null
          if (files && files.length > 0) onStickerChosen(files)
          if (els.stickerFile) els.stickerFile.value = ''
        })
        tools.appendChild(els.stickerFile)

        els.file = document.createElement('input')
        els.file.type = 'file'
        // 图片 + 常见文档: 认不出的也放进来 (`*/*` 兜住 .log / .csv / 压缩包这类)
        els.file.accept = [
          'image/*',
          '.pdf', '.txt', '.md', '.json', '.csv', '.log',
          '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
          '.zip', '.apk',
        ].join(',')
        els.file.multiple = true
        els.file.hidden = true
        els.file.addEventListener('change', function () {
          var files = els.file && els.file.files ? els.file.files : null
          if (files && files.length > 0) onFilesChosen(files)
          // 同一个文件连选两次也要真的触发一次 change
          if (els.file) els.file.value = ''
        })
        tools.appendChild(els.file)

        els.note = h('span', null, '')
        els.note.id = 'lwp-note'
        tools.appendChild(els.note)
        row.appendChild(tools)

        // 模型 chip: 与 dsh 那颗共用 `ctx.modelDirectories` 的那一份目录
        els.model = h('button', 'lwp-chip')
        els.model.id = 'lwp-model'
        els.model.type = 'button'
        els.model.hidden = true
        els.model.setAttribute('aria-haspopup', 'menu')
        els.model.setAttribute('aria-expanded', 'false')
        els.model.innerHTML = '<span class="lwp-chip-label"></span>' + CHEVRON_ICON
        els.modelLabel = els.model.querySelector('.lwp-chip-label')
        els.model.onclick = function () { openMenu('model') }
        row.appendChild(els.model)

        els.send = h('button')
        els.send.id = 'lwp-send'
        els.send.type = 'button'
        els.send.setAttribute('aria-label', '发送')
        els.send.innerHTML = SEND_ICON
        els.send.disabled = true
        var longPress
        els.send.addEventListener('pointerdown', function () {
          longPress = setTimeout(function () {
            longPress = undefined
            send('steer')
          }, 550)
        })
        els.send.addEventListener('pointerup', function () {
          if (longPress !== undefined) {
            clearTimeout(longPress)
            longPress = undefined
            send('queue')
          }
        })
        els.send.addEventListener('pointercancel', function () {
          if (longPress !== undefined) clearTimeout(longPress)
          longPress = undefined
        })
        row.appendChild(els.send)

        card.appendChild(row)

        // 那张菜单挂在卡片上 (`bottom:100%` 弹到卡片上方, 与 dsh 的 MenuSurface 同一个位置关系)
        els.menu = h('div')
        els.menu.id = 'lwp-menu'
        els.menu.hidden = true
        card.appendChild(els.menu)

        // 表情面板 (2026-11-09 主人: "在下方展出, 高度相当于一个输入法键盘")
        // 建在这里, 挂到 `dock` 下面 (cards 之后) —— 见下面 `dock.appendChild(els.stickerPanel)`
        els.stickerPanel = h('div')
        els.stickerPanel.id = 'lwp-sticker-panel'
        els.stickerPanel.hidden = true
        els.stickerGrid = h('div', 'lwp-sticker-grid')
        els.stickerPanel.appendChild(els.stickerGrid)

        dock.appendChild(card)
        // 表情面板挂在输入卡**下面**: 一块键盘的位置, 张开始终在消息区下方 (2026-11-09 主人)
        dock.appendChild(els.stickerPanel)
        root.appendChild(dock)

        els.drawer = h('div')
        els.drawer.id = 'lwp-drawer'
        els.drawer.hidden = true
        root.appendChild(els.drawer)

        /* ── 预览窗 (2026-11-09 主人: "点击文件名后弹出预览窗口, 和权限选择窗口一样大小") ───
         *
         * `position:fixed` 铺满视口, 卡片居中: 宽 = 屏宽 - 40dp, 高封 78%, 遮罩 40% 黑 ——
         * 与 `ReadyPermissionsDialog` 那一窗同一口径。默认 `hidden`, 点文件名才张
         */
        els.preview = h('div')
        els.preview.id = 'lwp-preview'
        els.preview.hidden = true
        var previewCard = h('div', 'lwp-preview-card')
        var previewHead = h('div', 'lwp-preview-head')
        els.previewName = h('div', 'lwp-preview-name', '')
        previewHead.appendChild(els.previewName)
        var previewClose = h('button', 'lwp-preview-close')
        previewClose.type = 'button'
        previewClose.setAttribute('aria-label', '关闭')
        previewClose.innerHTML = CLOSE_ICON
        previewClose.onclick = function () { closePreview() }
        previewHead.appendChild(previewClose)
        previewCard.appendChild(previewHead)
        els.previewBody = h('div', 'lwp-preview-body')
        previewCard.appendChild(els.previewBody)
        els.preview.appendChild(previewCard)
        // 点遮罩关掉; 落在卡片里不算 (与那一窗的 "点空白关" 同一条手感)
        els.preview.onclick = function (event) {
          if (event.target === els.preview) closePreview()
        }
        root.appendChild(els.preview)

        /* ── 历史记录窗 (2026-11-10) ──────────────────────────────────────────
         *
         * 一样是 `position:fixed` 盖满视口的一层: 天花板 78%、圆角 28、左右 20dp —— 与预览窗同一套
         * 口径。默认 `hidden`, 点头栏那颗「历史」才张
         */
        els.history = h('div')
        els.history.id = 'lwp-history'
        els.history.hidden = true
        var historyCard = h('div', 'lwp-history-card')
        var historyHead = h('div', 'lwp-history-head')
        historyHead.appendChild(h('div', 'lwp-history-title', '历史对话'))
        var historyClose = h('button', 'lwp-history-close', '×')
        historyClose.type = 'button'
        historyClose.setAttribute('aria-label', '关闭')
        historyClose.onclick = function () { closeHistory() }
        historyHead.appendChild(historyClose)
        historyCard.appendChild(historyHead)
        els.historyQuery = document.createElement('input')
        els.historyQuery.type = 'search'
        els.historyQuery.id = 'lwp-history-q'
        els.historyQuery.placeholder = '搜索历史对话'
        els.historyQuery.setAttribute('autocomplete', 'off')
        els.historyQuery.addEventListener('input', function () {
          historyQuery = els.historyQuery.value
          renderHistory()
        })
        historyCard.appendChild(els.historyQuery)
        els.historyList = h('div', 'lwp-history-list')
        historyCard.appendChild(els.historyList)
        els.historyNew = h('button', 'lwp-history-new', '开始新的对话')
        els.historyNew.type = 'button'
        els.historyNew.onclick = function () { startFromHistory() }
        historyCard.appendChild(els.historyNew)
        els.history.appendChild(historyCard)
        // 点遮罩关掉 (落在卡片里不算), 与预览窗同一条手感
        els.history.onclick = function (event) {
          if (event.target === els.history) closeHistory()
        }
        root.appendChild(els.history)

        /* ── 选工作区窗 (2026-11-12 #37) ──────────────────────────────────────
         *
         * 外壳与历史窗 / 预览窗同一套 (居中 / 左右 20dp / 高封 78% / 圆角 28 / 遮罩 40% 黑),
         * 里面只有一份工作区表: 首启那颗「选工作区」张的就是它
         */
        els.pick = h('div')
        els.pick.id = 'lwp-pick'
        els.pick.hidden = true
        var pickCard = h('div', 'lwp-pick-card')
        var pickHead = h('div', 'lwp-pick-head')
        pickHead.appendChild(h('div', 'lwp-pick-title', '选工作区'))
        var pickClose = h('button', 'lwp-pick-close', '×')
        pickClose.type = 'button'
        pickClose.setAttribute('aria-label', '关闭')
        pickClose.onclick = function () { closePick() }
        pickHead.appendChild(pickClose)
        pickCard.appendChild(pickHead)
        els.pickList = h('div', 'lwp-pick-list')
        els.pickList.id = 'lwp-pick-list'
        pickCard.appendChild(els.pickList)
        els.pick.appendChild(pickCard)
        // 点遮罩关掉 (落在卡片里不算), 与另外两扇窗同一条手感
        els.pick.onclick = function (event) {
          if (event.target === els.pick) closePick()
        }
        root.appendChild(els.pick)

        document.body.appendChild(root)
        // **每次挂载都重新问一次**: 设置里改过的背景/浓淡可能比这一层活得久 (收起门户再回来是
        // 最普通的一步), 拿上一次的读数重画会让"改了没生效"
        applyLook(fetchLook())
        updateSendGate()
        // 一次性读数 (2026-11-09 真机): 底部那两颗钮到底落在哪 —— "点了没反应"时先看这一行,
        // 才知道是坐标打空了还是 onclick 没绑上
        setTimeout(function () {
          try {
            var b = els.stickerBtn ? els.stickerBtn.getBoundingClientRect() : null
            var c = els.plus ? els.plus.getBoundingClientRect() : null
            console.log('[luwi-portal] btn rect sticker='
              + (b ? Math.round(b.left) + ',' + Math.round(b.top) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) : 'none')
              + ' plus=' + (c ? Math.round(c.left) + ',' + Math.round(c.top) : 'none')
              + ' viewport=' + Math.round(window.innerWidth) + 'x' + Math.round(window.innerHeight))
          } catch (error) {
            console.log('[luwi-portal] btn rect failed: ' + describeError(error))
          }
        }, 1500)
      }

      /** 点空白处收起: 捕获阶段判一次, 落在菜单 / 表情面板 / 那几颗钮里才放过 */
      function onDocPointerDown(event) {
        var target = event.target
        // 「···」那张抽屉: 点到它自己与那颗按钮之外就收起 (与下面那颗输入卡菜单同一条手感)
        if (drawer !== '' && els.drawer && els.moreButton
          && !(target instanceof Node && els.drawer.contains(target))
          && !(target instanceof Node && els.moreButton.contains(target))) {
          openDrawer('')
        }
        // 表情面板先判 (它开着时 menuKind 可能是空串, 那条 return 不该把面板留在屏上)
        if (els.stickerPanel && !els.stickerPanel.hidden) {
          if (target instanceof Node && els.stickerPanel.contains(target)) return
          if (els.stickerBtn && target instanceof Node && els.stickerBtn.contains(target)) return
          closeStickerPanel()
        }
        if (menuKind === '') return
        if (els.menu && target instanceof Node && els.menu.contains(target)) return
        if (els.plus && target instanceof Node && els.plus.contains(target)) return
        if (els.stickerBtn && target instanceof Node && els.stickerBtn.contains(target)) return
        if (els.model && target instanceof Node && els.model.contains(target)) return
        closeMenu()
      }

      /**
       * 退到后台: 清队
       *
       * 应用退到后台后 Chromium 会把 `setTimeout` 压到秒级甚至更慢 —— 攒住的条会在回来的一瞬间齐出。
       * 所以"退后台清队"既是手感也是技术必要 (方案 §10 第 4 条)
       */
      function onHidden() {
        if (document.hidden) clearOut('the page went to the background')
      }

      function unmount() {
        mounted = false
        // 撤掉之后 DOM 是新的: 记着的那个高度不再对应当前那一层, 挂载时由 `portalIme` 重新问
        imePx = 0
        // 同理, 内容签名也要作废 —— 否则重挂之后同样的内容会被判成"画过了", 流一直是空的
        flowSig = null
        call('portalVisible', false)
        // 收门户: 撤队 + 清定时器, 回来**不补播** (过时的话比不说更糟)
        clearOut('the portal was closed')
        // 草稿里那张图也一起放掉 (dsh 那边留着预览 URL 会一直挂着)
        clearAttach()
        if (renderTimer !== null) clearTimeout(renderTimer)
        renderTimer = null
        if (pollTimer !== null) clearInterval(pollTimer)
        pollTimer = null
        if (noteTimer !== null) clearTimeout(noteTimer)
        noteTimer = null
        if (undoTimer !== null) clearTimeout(undoTimer)
        undoTimer = null
        closeMenu()
        closeStickerPanel()
        closePreview()
        closeHistory()
        closePick()
        // 下一次挂载是新的 DOM: 落进工作区那条腿若正等着, 让它自然超时 (不跨挂载落地)
        entering = false
        document.removeEventListener('pointerdown', onDocPointerDown, true)
        document.removeEventListener('visibilitychange', onHidden, false)
        if (chatUnsub !== null) chatUnsub()
        chatUnsub = null
        chatTarget = null
        if (sessionUnsub !== null) sessionUnsub()
        sessionUnsub = null
        if (listUnsub !== null) listUnsub()
        listUnsub = null
        if (root !== null && root.parentNode !== null) root.parentNode.removeChild(root)
        if (style !== null && style.parentNode !== null) style.parentNode.removeChild(style)
        var shellRoot = document.getElementById('root')
        if (shellRoot !== null) shellRoot.style.visibility = ''
        root = null
        style = null
        els = {}
      }

      /**
       * 收起门户, 并落进 dsh 的**新对话界面** (2026-11-08 主人: "返回 dsh 时改成进入 dsh 的新对话界面")
       *
       * 原生界面一直在下面等着, 但收起来要落到"能直接说话"的那一屏, 而不是落回门户刚刚映射的
       * 那一场 (那一场门户已经画过一遍, 收起来再看一次没有意义)。`startSession()` 不带参数时由
       * dsh 自己决定工作区并复用已有的空白草稿 —— 这里的"新"是"一张空对话", 不是每收一次就多
       * 一场空会话 (见 `ui-workspace` 的 `StartSessionOptions`)
       *
       * 开不出来 (工作区还没选 / 宿主拒了) 就照旧落回原来那一场: 收起门户这件事本身不该失败
       */
      function hide() {
        try {
          ctx.uiWorkspace.startSession()
        } catch (_cannotStart) {
          // 落回原来那一场, 门户该收还是收
        }
        writeSwitch('off')
        unmount()
      }

      /**
       * 挂载时先回到"上次画的那一场" (2026-11-08 主人: "下次会话还在这个界面, 可看见之前的对话")
       *
       * 记忆里那一场还在 (binding 拿得到) 就用它; 不在就清掉记忆、落回 dsh 当前那一场 —— 于是
       * "换一场"只剩点左上角那一条路。打开是异步的: binding 有了不代表快照到了, 于是再补几次
       * `adopt` (它在 `chatTarget` 还在时直接返回, 重试不会抖)
       */
      function restore() {
        var remembered = recallSession()
        var current = currentSessionId()
        var byId = {}
        var ready = false
        try {
          var snapshot = ctx.sessions.list.getSnapshot()
          byId = snapshot && snapshot.byId ? snapshot.byId : {}
          ready = snapshot !== null && snapshot !== undefined && snapshot.phase === 'ready'
        } catch (_noList) {
          // 列表还没挂上: 下面按"未知"走, 不据此清记忆
        }
        var target = current
        if (remembered !== '') {
          if (Object.prototype.hasOwnProperty.call(byId, remembered)) {
            target = remembered
          } else if (!ready) {
            // 列表还在加载: 先照记忆开, 真的不在时下一轮再清 (清早了这一层就永远回不去了)
            target = remembered
          } else {
            forgetSession()
          }
        }
        if (target !== null) switchTo(target, 'restore')
        else adopt(null)
        var tries = 0
        function again() {
          tries += 1
          if (!mounted || tries > 20) return
          if (chatTarget === null && sessionId !== null) {
            // 前两秒走"重"的那条 (会话可能还没加载, openSession 才有用); 之后只补轻的, 免得刷日志
            if (tries <= 8) follow(sessionId)
            else adopt(sessionId)
          }
          setTimeout(again, 250)
        }
        setTimeout(again, 250)
      }

      function mount() {
        if (mounted) return
        try {
          build()
        } catch (error) {
          console.log('[luwi-portal] build threw: ' + (error && error.stack ? error.stack : String(error)))
          return
        }
        mounted = true
        // **门户盖上了** (2026-11-07 那条菜单方向, 2026-11-09 起键盘让位也靠它): 原来只有收起时报
        // `false`, 一次 `true` 都没有 —— 于是宿主一直以为门户没开, 菜单永远写「回到对话层」, 键盘也
        // 一直走"缩 WebView"那条旧路。挂上就报一次, 收起时 unmount() 再报 false
        call('portalVisible', true)
        staleFollowed = false
        try {
          restore()
          status = call('portalStatus')
          renderDrawer()
          refresh()
          // 模型是异步的: 先把界面立起来, 数据到了再补 (拿不到就不画)
          loadModel()
        } catch (error) {
          console.log('[luwi-portal] adopt threw: ' + (error && error.stack ? error.stack : String(error)))
        }
        document.addEventListener('pointerdown', onDocPointerDown, true)
        document.addEventListener('visibilitychange', onHidden, false)
        try {
          listUnsub = ctx.sessions.list.subscribe(function () {
            var id = currentSessionId()
            if (id !== sessionId) switchTo(id, 'list')
            else {
              renderModel()
              // 投影可能是后到的: 每一帧都再问一次「拨过没」, 拨过就什么都不做
              ensureFullAccess()
            }
          })
        } catch (_noList) {
          listUnsub = null
        }
        pollTimer = setInterval(pollLedger, LEDGER_POLL)
        pollLedger()
        // 空态就自己开一场 (2026-11-09): 等第一拍账本落定再判, 免得把 restore 出来的那一场挤掉
        setTimeout(autoStart, 800)
        // 键盘那一格 (2026-11-09): 页面刷新 / 收起再张之后, 这一层先要知道现在是多高 ——
        // 宿主的推是"变了才推", 而这一次挂载正好错过了那一下 (幂等, 取不到就当 0)
        var ime = call('portalIme')
        if (ime && typeof ime.px === 'number') applyIme(ime.px)
      }

      return {
        mount: mount,
        unmount: unmount,
        hide: hide,
        reloadLook: reloadLook,
        /** 宿主推的键盘高度 (2026-11-09): 只改这一层的 padding, 不动 WebView 尺寸 */
        setKeyboard: applyIme,
        /**
         * 宿主对"选图"那一下的回话 (2026-11-12, 落实表 #35)
         *
         * `shown` / `picked` 是"选择器起来了 / 文件交回来了", 撤计时器就完事; `empty` / `none` 是
         * "选了但 WebView 没回调" 与 "选择器起不来" —— 这两种在屏上都是**什么都没发生**, 所以直接
         * 报一句带上原因
         */
        pickState: pickState,
        /**
         * 宿主说"她说的话变了": 取增量入队 (方案 §3.4 的**触发源**)
         *
         * jsonl 不是 dsh 的快照, `chatTarget.subscribe` 不会因为它变化而触发 —— 没有这一条, 一轮工具
         * 跑完或者她主动开口时门户根本不会重画, 那些话就永远不上屏。推它的是宿主那一侧
         * `PortalBridge` 的 `FileObserver` (与球共用同一个 observer)
         */
        onOut: function () {
          if (!mounted) return
          loadOut(false)
        },
        isOpen: function () { return mounted },
      }
    }

    /**
     * Luwi 菜单 (右上那颗 Tune) 进出这一层的唯一把手
     *
     * 界面上不再放进出这两层的按钮: 那两个动作都在 Kotlin 那一侧的菜单里, 它调的就是
     * 这两个函数 (见 HostScreen.kt 的 PortalState 与 mainMenu)
     */
    function expose(portal) {
      if (typeof window === 'undefined') return
      window.__LUWI_PORTAL__ = {
        show: function () {
          writeSwitch('on')
          if (!portal.isOpen()) portal.mount()
        },
        hide: function () { portal.hide() },
        // 设置页那一侧用的 (2026-11-08): 外观里改完背景或透明度, 原生那页 evaluateJavascript 推一句
        reloadLook: function () { portal.reloadLook() },
        // 宿主那侧 `PortalBridge` 的 FileObserver 推的 (2026-11-08): 她说的话变了, 自己取增量
        onOut: function () { portal.onOut() },
        // 宿主推的键盘高度 (2026-11-09): 门户盖着时 WebView 不缩放, 由这一层自己让出底部那一段
        setKeyboard: function (px) { portal.setKeyboard(px) },
        /**
         * 宿主对"选图"那一下的回话 (2026-11-12, 落实表 #35): `shown` / `picked` / `empty` / `none`
         *
         * 没有这一句, 页面上就分不清"还在等选择器"与"选了但 WebView 没回调" —— 后者正是 issue #53
         */
        pickState: function (state) { portal.pickState(state) },
      }
    }

    function apply(ctx) {
      // 一层挂不上不该把别的插件一起带走 (dsh 的日志只有一句 "1 entry did not activate"),
      // 所以这里自己接住并留一行带 stack 的读数 —— 出问题时那一行就是唯一的现场
      try {
        var portal = createPortal(ctx)
        expose(portal)
        // 「默认完全权限」的全局那一半: 只写一次, 写不上就算了
        ensureDefaultPermission(ctx)
        // 边缘划入的接管: 与门户开不开无关, 只要这页是手机壳那一档就装上
        if (typeof window !== 'undefined') setTimeout(function () { installEdgeSwipe(ctx) }, 1500)
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            if (readSwitch() === 'on') portal.mount()
            return function () {
              // 只摘这一层自己的节点, 原生界面一个字节都不动
              portal.unmount()
            }
          })
        } else if (readSwitch() === 'on') {
          portal.mount()
        }
      } catch (error) {
        console.log('[luwi-portal] apply threw: ' + (error && error.stack ? error.stack : String(error)))
      }
    }

    exports.apply = apply
    exports.inject = [
      'sessions', 'uiWorkspace', 'uiConversation', 'slots', 'locale',
      // 工具行那三样靠这几个服务: dsh 的 ctx 只把"声明过 inject 的"服务给它用 —— 没声明时
      // `ctx.get` / `ctx.xxx` 直接抛 `cannot get property "…" without inject` (2026-11-08 踩到)
      'remote', 'remote.settings', 'modelDirectories',
      // 按"这一场挂在哪个工作区"去切: `sessions.retain` 只认当前工作区加载过的会话 (2026-11-08)
      'workspaces',
      // 发图那一条 (2026-11-08): 草稿附件与投递都在 `conversation` 那一个服务上
    ]
    return module.exports
  },
})




