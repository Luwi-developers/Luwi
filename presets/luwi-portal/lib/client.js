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
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports

    /** 开关: `on` / `off`; 关掉之后右下角留一个小圆点可以再打开 */
    var SWITCH = 'dsh.luwi.portal'
    /** 账本轮询间隔: 球的 10 分钟窗口一过就会换场, 门户要跟过去 */
    var LEDGER_POLL = 3000
    /** 重绘节流: 流式期间快照会连着变 */
    var RENDER_MS = 120
    /** `lw/face.json` 的缓存键: 背景图一次几百 KB, 换一张才搬一次 */
    var WALL_CACHE = 'dsh.luwi.portal.wall'
    /** 还没开场时选中的那一档预设 (下一场生效), 与 `Appearance` 那两行无关 */
    var STAGED_PRESET = 'dsh.luwi.portal.preset'

    /**
     * 预设 chip 上那两个图标: **dsh 的 `IconAgentPresetOutlineRegular` 与
     * `IconChevronDownOutlineRegular` 的几何**, 逐字搬过来 (不引组件, 这一层是手写 DOM)
     *
     * 与 `presets/ui-fix` 同一条分寸: 只借形状, 不复制组件; 上游改图形时这一份要跟着看一眼
     */
    var PRESET_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke-width="1" class="lwp-chip-icon"><path d="M6.51867 12.3282C7.29816 12.6011 8.16475 12.6514 9.02269 12.4216C9.57879 12.2726 10.0784 12.0185 10.5087 11.6888C10.7819 12.0555 11.1606 12.3304 11.5913 12.4805C10.9688 13.029 10.2149 13.4478 9.35911 13.6771C8.13946 14.0038 6.90632 13.8971 5.82126 13.4533C6.15821 13.1562 6.4021 12.7652 6.51867 12.3282ZM9.17629 2.89409C11.1101 3.34433 12.739 4.81872 13.2889 6.87043C13.4219 7.3665 13.4811 7.8649 13.4774 8.35466C13.0924 8.13213 12.6422 8.01837 12.1741 8.05276L12.1711 8.05257C12.1539 7.77199 12.109 7.48889 12.0334 7.20684C11.6363 5.72533 10.5048 4.6372 9.13549 4.22844C9.25559 3.87667 9.29214 3.49087 9.22309 3.09892C9.2108 3.02922 9.19451 2.96108 9.17629 2.89409ZM4.7311 3.89107L4.78302 4.11879C4.87648 4.4488 5.04146 4.74263 5.25579 4.98896C3.98078 6.01355 3.35848 7.72904 3.8089 9.41059C3.81828 9.44559 3.82866 9.48025 3.83885 9.51479C3.38217 9.61268 2.98548 9.84137 2.68107 10.1556C2.63414 10.022 2.5897 9.88632 2.55244 9.74726C1.93301 7.43489 2.86717 5.07173 4.71504 3.76697L4.7311 3.89107Z" fill="currentColor"></path><path d="M7.99136 5.28105C8.87501 5.28105 9.59136 4.56471 9.59136 3.68105C9.59136 2.7974 8.87501 2.08105 7.99136 2.08105C7.1077 2.08105 6.39136 2.7974 6.39136 3.68105C6.39136 4.56471 7.1077 5.28105 7.99136 5.28105Z" stroke="currentColor"></path><path d="M3.94009 12.9417C4.82374 12.9417 5.54009 12.2254 5.54009 11.3417C5.54009 10.458 4.82374 9.7417 3.94009 9.7417C3.05643 9.7417 2.34009 10.458 2.34009 11.3417C2.34009 12.2254 3.05643 12.9417 3.94009 12.9417Z" stroke="currentColor"></path><path d="M12.0851 12.9417C12.9688 12.9417 13.6851 12.2254 13.6851 11.3417C13.6851 10.458 12.9688 9.7417 12.0851 9.7417C11.2015 9.7417 10.4851 10.458 10.4851 11.3417C10.4851 12.2254 11.2015 12.9417 12.0851 12.9417Z" stroke="currentColor"></path></svg>'

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
      'font:14px/1.6 system-ui,-apple-system,"Noto Sans CJK SC",sans-serif}',
      '@media (prefers-color-scheme:dark){#lwp-root{background:#16181c}}',
      '#lwp-root[hidden]{display:none}',

      // 背景层: 一整张铺满, 浓淡由 --lwp-wall-alpha 说 (0 = 只剩底色)。它在最底下, 上面几块都
      // 抬到 z-index:1, 否则 absolute 的那一层会盖住正常流的兄弟
      '#lwp-wall{position:absolute;inset:0;z-index:0;pointer-events:none;',
      'background-position:center;background-repeat:no-repeat;background-size:cover;',
      'opacity:var(--lwp-wall-alpha,0);transition:opacity .18s ease}',
      '#lwp-wall[hidden]{display:none}',

      '#lwp-head{position:relative;z-index:1;display:flex;align-items:center;gap:8px;padding:10px 14px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.1));flex:none}',
      '#lwp-head .lwp-brand{font-weight:600;letter-spacing:.01em}',
      '#lwp-head .lwp-meta{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#lwp-head button{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));',
      'background:transparent;color:inherit;border-radius:999px;padding:4px 10px;font:inherit;font-size:12px}',
      '#lwp-head button[data-on="on"]{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff;border-color:transparent}',

      '#lwp-flow{position:relative;z-index:1;flex:1;min-height:0;overflow-y:auto;padding:16px 14px 8px;',
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
      '.lwp-empty{margin:auto;color:var(--dsw-alias-label-secondary,#9ca3af);font-size:13px;text-align:center;line-height:1.8}',

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
      '#lwp-tools{display:flex;align-items:center;gap:12px;flex:1;min-width:0}',
      '#lwp-preset{display:inline-flex;align-items:center;gap:4px;max-width:60vw;min-height:28px;',
      'padding:0 8px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;font-weight:500;',
      'white-space:nowrap;cursor:pointer}',
      '#lwp-preset[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '@media (hover:hover){#lwp-preset:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
      '#lwp-preset .lwp-preset-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#lwp-preset[hidden]{display:none}',
      '.lwp-chip-icon{flex:none;color:var(--dsw-alias-label-primary)}',
      '.lwp-chevron{flex:none;color:var(--dsw-alias-label-caption)}',
      '#lwp-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);min-width:0;',
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
      '#lwp-menu .lwp-menu-desc{font-size:12px;line-height:16px;color:var(--dsw-alias-label-caption);',
      'white-space:normal}',

      // 抽屉: 玻璃同参数 (原来是 bg-overlay 那块实底)
      '#lwp-drawer{position:absolute;left:0;right:0;bottom:0;z-index:2;max-height:72%;overflow-y:auto;',
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
      /** 这一层的脸 (背景图与浓淡), 由 `portalLook()` 交过来 */
      var look = null
      /** 那一档预设的名单 (`remote.agentPresets.list()`); 拉不到就是空的, chip 就不画 */
      var presets = []
      var presetSvc = null
      /** 还没开场时选中的那一档 (下一场生效), 与 chip 上显示的那个是两件事 */
      var staged = readStagedPreset()
      var menuOpen = false
      var noteTimer = null

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

      /** 还没开场时选中的那一档: 记在 localStorage 里, 换一次文档/重启应用都还在 */
      function readStagedPreset() {
        var value = readStored(STAGED_PRESET)
        return typeof value === 'string' ? value : ''
      }

      function writeStagedPreset(id) {
        staged = id
        writeStored(STAGED_PRESET, id)
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
        if (chatUnsub !== null) {
          chatUnsub()
          chatUnsub = null
        }
        chatTarget = null
        sessionId = id
        streamKey = ''
        var binding = bindingOf(id)
        if (binding === undefined) {
          renderFlow()
          renderMeta()
          renderPreset()
          return
        }
        try {
          chatTarget = ctx.uiConversation.binding(binding).target('chat')
          chatUnsub = chatTarget.subscribe(scheduleRender)
        } catch (_noTarget) {
          chatTarget = null
        }
        renderFlow()
        renderMeta()
        renderPreset()
      }

      /**
       * 开一场: 不点名工作区就落 dsh 的默认那个 (球那场就在 `dsh-ball` 里, 见宿主的 ensureBallWorkspace)
       *
       * 选过预设的话把那一档带进去 (与 dsh 新会话屏那颗 chip 同一条路: `StartSessionOptions.agentPreset`)
       */
      function startSession() {
        try {
          if (staged !== '') ctx.uiWorkspace.startSession(undefined, { agentPreset: staged })
          else ctx.uiWorkspace.startSession()
        } catch (_cannotStart) {
          return
        }
        setTimeout(function () {
          adopt(currentSessionId())
          renderMeta()
        }, 400)
      }

      function scheduleRender() {
        if (renderTimer !== null) return
        renderTimer = setTimeout(function () {
          renderTimer = null
          if (mounted) renderFlow()
        }, RENDER_MS)
      }

      /** 当前这一场的消息: 只留人话, 失败提示也算人话 */
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
        var kept = []
        var fingerprint = []
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i]
          if (!node) continue
          if (node.kind === 'user' || node.kind === 'steering') {
            kept.push({ who: 'user', time: node.time, text: textOf(node.content) })
            fingerprint.push(node.seq)
          } else if (node.kind === 'assistant') {
            kept.push({ who: 'assistant', time: node.time, text: textOf(node.blocks) })
            fingerprint.push(node.seq)
          } else if (node.kind === 'turn-error' || node.kind === 'error') {
            var reason = node.error || {}
            var message = reason.message || node.message || '本轮运行失败'
            kept.push({ who: 'error', time: node.time, text: String(message) })
            fingerprint.push(node.seq)
          }
        }
        streamKey = fingerprint.join(',')
        return kept
      }

      function renderFlow() {
        if (!els.flow) return
        var items = nodesOf()
        els.flow.textContent = ''
        if (items.length === 0) {
          var empty = h('div', 'lwp-empty')
          empty.textContent = sessionId === null
            ? '这一层要一场会话来落脚'
            : '这一场还没有对话'
          els.flow.appendChild(empty)
          if (sessionId === null) {
            // 覆盖层盖住了 dsh 自己的"选工作区"那一屏, 所以这一步得由门户自己做
            var start = h('button', null, '开一场')
            start.style.margin = '10px auto 0'
            start.style.padding = '8px 18px'
            start.onclick = function () { startSession() }
            els.flow.appendChild(start)
          }
          return
        }
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          if (item.text === '') continue
          var row = h('div', 'lwp-row')
          row.setAttribute('data-who', item.who)
          row.appendChild(h('div', 'lwp-bubble', item.text))
          row.appendChild(h('span', 'lwp-time', clock(item.time)))
          els.flow.appendChild(row)
        }
        els.flow.scrollTop = els.flow.scrollHeight
      }

      /**
       * 顶条那行读数: **只剩账本那一句** (2026-11-08 主人: "对话层不显示会话标题")
       *
       * 会话自己的标题与 id 都不再冒上来 —— 这一层是"和她说的话", 不是会话管理器。`没有会话` 这一句
       * 留着, 因为真空着的时候得说清为什么底下没有对话
       */
      function renderMeta() {
        if (!els.meta) return
        var ledger = call('portalSession')
        var parts = []
        if (sessionId === null) parts.push('没有会话')
        if (ledger && ledger.usable === true) {
          var left = Math.max(0, Math.round((Number(ledger.remainMs) || 0) / 60000))
          parts.push('球的场 剩 ' + left + ' 分')
        } else if (ledger && ledger.id) {
          parts.push('账本过期')
        } else {
          parts.push('球还没有场')
        }
        els.meta.textContent = parts.join(' · ')
      }

      // ── 这一层的脸 (背景 + 浓淡, 设置 → 外观) ────────────────────────────────

      /** 把 `portalLook()` 那一份落到 DOM 上: 只改两个地方 (root 上的变量、背景层上的图) */
      function applyLook(data) {
        if (!data || typeof data !== 'object') return
        look = data
        if (root !== null) root.style.setProperty('--lwp-wall-alpha', String(clampAlpha(data.alpha)))
        if (!els.wall) return
        var ver = typeof data.ver === 'string' ? data.ver : ''
        var url = ''
        if (ver !== '') {
          var cached = readStored(WALL_CACHE)
          if (cached && cached.ver === ver && typeof cached.url === 'string' && cached.url !== '') {
            url = cached.url
          } else if (typeof data.wall === 'string' && data.wall !== '') {
            url = data.wall
            writeStored(WALL_CACHE, { ver: ver, url: url })
          }
        }
        if (url === '') {
          els.wall.hidden = true
          els.wall.style.backgroundImage = 'none'
        } else {
          els.wall.hidden = false
          els.wall.style.backgroundImage = 'url("' + url + '")'
        }
      }

      /** 设置页改完推过来的那一下: 重取一份 (没挂载时什么都不用做, 下一次挂载自己会取) */
      function reloadLook() {
        if (!mounted) return
        applyLook(call('portalLook'))
      }

      // ── 预设 (标准模式 / Luwi …) ───────────────────────────────────────────────

      /** 内置四档的显示名与说明在 dsh 自己的字典里 (`ui-agent-preset` 的 `settings.agentPreset`) */
      var PRESET_NAME_KEYS = {
        standard: 'presetStandardName',
        ptc: 'presetPtcName',
        minimal: 'presetMinimalName',
        cordis: 'presetCordisName',
      }
      var PRESET_DESC_KEYS = {
        standard: 'presetStandardDescription',
        ptc: 'presetPtcDescription',
        minimal: 'presetMinimalDescription',
        cordis: 'presetCordisDescription',
      }

      function presetLocale() {
        try {
          if (ctx.locale && typeof ctx.locale.bind === 'function') return ctx.locale.bind('settings.agentPreset')
        } catch (_noLocale) {
          // 字典没挂上也照画: 下面会回落到预设自己发布的名字或 id
        }
        return null
      }

      /** 一档预设给人看的名字: 内置档走字典, 自定义档用它自己发布的名字, 都没有就用 id */
      function presetText(preset) {
        var translate = presetLocale()
        var key = PRESET_NAME_KEYS[preset.id]
        if (key && translate) {
          var one
          try {
            one = translate(key)
          } catch (_noKey) {
            one = undefined
          }
          if (typeof one === 'string' && one !== '' && one !== key) return one
        }
        return typeof preset.name === 'string' && preset.name !== '' ? preset.name : preset.id
      }

      function presetDesc(preset) {
        var translate = presetLocale()
        var key = PRESET_DESC_KEYS[preset.id]
        if (key && translate) {
          var one
          try {
            one = translate(key)
          } catch (_noKey) {
            one = undefined
          }
          if (typeof one === 'string' && one !== '' && one !== key) return one
        }
        return typeof preset.description === 'string' ? preset.description : ''
      }

      /** 名单服务: 可选 (`ctx.get`) —— 没装那一档时安静地不画 chip, 不让整层挂不上 */
      function presetService() {
        if (presetSvc !== null) return presetSvc
        try {
          presetSvc = typeof ctx.get === 'function' ? ctx.get('remote.agentPresets') : undefined
        } catch (_noService) {
          presetSvc = undefined
        }
        return presetSvc
      }

      /** 这一场现在跑的是哪一档; 没有会话时回 empty, 显示那一格就用 staged */
      function currentPresetId() {
        var summary = summaryOf(sessionId)
        var values = summary && summary.projectionValues ? summary.projectionValues : {}
        return typeof values.agentPreset === 'string' ? values.agentPreset : ''
      }

      /** 拉一次名单 (拉不到就当空: chip 不画) */
      function loadPresets() {
        var service = presetService()
        if (!service || typeof service.list !== 'function') {
          presets = []
          renderPreset()
          return
        }
        Promise.resolve(service.list()).then(function (result) {
          var value = result && result.ok === true ? result.value : undefined
          var rows = value && Array.isArray(value.presets) ? value.presets : []
          presets = rows.filter(function (one) { return one && typeof one.id === 'string' && one.broken === undefined })
          renderPreset()
        }).catch(function () {
          presets = []
          renderPreset()
        })
      }

      /** chip 上的字与它在不在: 名单空 / 这一场没档时整颗不画, 行里只剩发送钮 */
      function renderPreset() {
        if (!els.preset) return
        var id = currentPresetId() || staged
        var chosen = null
        for (var i = 0; i < presets.length; i++) {
          if (presets[i].id === id) chosen = presets[i]
        }
        var label = id === '' ? '' : (chosen === null ? id : presetText(chosen))
        var usable = presets.length > 0 && label !== ''
        els.preset.hidden = !usable
        if (els.presetLabel) els.presetLabel.textContent = label
        if (!usable) closeMenu()
        else if (menuOpen) renderMenu()
      }

      /** 一张小菜单: 名字一行、说明一行 (与 dsh 那颗 chip 的菜单同一套内容) */
      function renderMenu() {
        if (!els.menu) return
        els.menu.textContent = ''
        var current = currentPresetId() || staged
        for (var i = 0; i < presets.length; i++) {
          var preset = presets[i]
          var row = h('button')
          row.type = 'button'
          row.setAttribute('data-preset', preset.id)
          var name = h('span', 'lwp-menu-name', presetText(preset))
          if (preset.id === current) name.setAttribute('data-on', 'on')
          row.appendChild(name)
          var desc = presetDesc(preset)
          if (desc !== '') row.appendChild(h('span', 'lwp-menu-desc', desc))
          row.onclick = function (pid) {
            return function () { pickPreset(pid) }
          }(preset.id)
          els.menu.appendChild(row)
        }
        els.menu.hidden = false
      }

      function openMenu() {
        if (presets.length === 0 || !els.menu) return
        menuOpen = true
        els.preset.setAttribute('aria-expanded', 'true')
        renderMenu()
      }

      function closeMenu() {
        menuOpen = false
        if (els.preset) els.preset.setAttribute('aria-expanded', 'false')
        if (els.menu) els.menu.hidden = true
      }

      /** 一行小字 (下一场生效 / 宿主拒绝的原文), 三秒后自己收; 错误那一档不自动收 */
      function showNote(text, isError) {
        if (noteTimer !== null) {
          clearTimeout(noteTimer)
          noteTimer = null
        }
        if (!els.note) return
        els.note.textContent = text
        if (isError) els.note.setAttribute('data-error', 'on')
        else els.note.removeAttribute('data-error')
        if (text !== '' && !isError) {
          noteTimer = setTimeout(function () {
            noteTimer = null
            if (els.note) els.note.textContent = ''
          }, 3000)
        }
      }

      /**
       * 选中一档
       *
       * **只在还没跑过一轮的会话上真换** (宿主对已开场的会话会拒绝换档, 这是 dsh 自己的规矩): 那时写进
       * staged, 下一场「开一场」时带过去 —— 这里不假装换成功了
       */
      function pickPreset(id) {
        closeMenu()
        var summary = summaryOf(sessionId)
        var service = presetService()
        var blank = summary !== undefined && summary !== null && summary.blank === true
        if (!blank || !service || typeof service.select !== 'function') {
          writeStagedPreset(id)
          renderPreset()
          showNote('下一场生效', false)
          return
        }
        showNote('', false)
        Promise.resolve(service.select(sessionId, id)).then(function (result) {
          if (result && result.ok === false) {
            var reason = result.error && result.error.message ? result.error.message : '宿主没让换这一档'
            showNote(reason, true)
            return
          }
          writeStagedPreset('')
          renderPreset()
        }).catch(function (error) {
          showNote(error && error.message ? error.message : '换不了这一档', true)
        })
      }

      /** 发送钮的两副面孔 (空草稿时是四成透明的那颗, 与 dsh 的 `.primary` 同一个读数) */
      function setSendBusy(busy) {
        if (!els.send) return
        els.send.innerHTML = busy ? SPIN_ICON : SEND_ICON
        els.send.disabled = busy
      }

      /** 空草稿 / 没有会话时发送钮按不动 */
      function updateSendGate() {
        if (!els.send || sending) return
        var text = els.input ? String(els.input.value || '').trim() : ''
        els.send.disabled = text === '' || sessionId === null
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

      function renderDrawer() {
        if (!els.drawer) return
        if (drawer === '') {
          els.drawer.hidden = true
          els.drawer.textContent = ''
        } else {
          els.drawer.hidden = false
          els.drawer.textContent = ''
          if (drawer === 'router') renderRouterDrawer()
          else renderWorkDrawer()
        }
        if (els.routerButton) els.routerButton.setAttribute('data-on', drawer === 'router' ? 'on' : 'off')
        if (els.workButton) els.workButton.setAttribute('data-on', drawer === 'work' ? 'on' : 'off')
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
      }

      /** 交给 dsh 自己投递: 与输入框同一条路 (beginSubmission 的 echo 让"发送中"也能画) */
      function send(mode) {
        if (sending) return
        var text = String(els.input.value || '').trim()
        if (text === '' || sessionId === null) return
        var binding = bindingOf(sessionId)
        if (binding === undefined) return
        var session = binding.session
        sending = true
        setSendBusy(true)
        els.input.value = ''
        var requestId
        try {
          if (typeof session.beginSubmission === 'function') {
            var handle = session.beginSubmission({ mode: mode, text: text, attachments: [] })
            requestId = handle && handle.requestId
          }
        } catch (_noEcho) {
          requestId = undefined
        }
        Promise.resolve(session.prompt([{ type: 'text', text: text }], mode, undefined, requestId))
          .catch(function () {
            // 失败由会话自己的错误节点显示, 这里只把草稿还回去
            if (els.input && els.input.value === '') els.input.value = text
          })
          .then(function () {
            sending = false
            setSendBusy(false)
            updateSendGate()
            scheduleRender()
          })
        // 第一句之后把这一场写进账本: 球接下来 10 分钟接的就是这一场
        if (bound !== sessionId) {
          bound = sessionId
          call('portalBind', sessionId)
        }
      }

      /** 账本换了场就跟着走 (球超时另开一场时, 门户不该还停在旧的) */
      function pollLedger() {
        var ledger = call('portalSession')
        if (ledger && ledger.usable === true && typeof ledger.id === 'string' && ledger.id !== '') {
          if (ledger.id !== sessionId) {
            try {
              ctx.uiWorkspace.openSession(ledger.id)
            } catch (_cannotOpen) {
              return
            }
            adopt(ledger.id)
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
        head.appendChild(h('span', 'lwp-brand', 'Luwi'))
        els.meta = h('span', 'lwp-meta', '')
        head.appendChild(els.meta)
        els.routerButton = h('button', null, '判断层')
        els.routerButton.onclick = function () { openDrawer('router') }
        head.appendChild(els.routerButton)
        els.workButton = h('button', null, '工作')
        els.workButton.onclick = function () { openDrawer('work') }
        head.appendChild(els.workButton)
        root.appendChild(head)

        els.flow = h('div')
        els.flow.id = 'lwp-flow'
        root.appendChild(els.flow)

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
        card.appendChild(els.input)

        var row = h('div')
        row.id = 'lwp-row'

        var tools = h('div')
        tools.id = 'lwp-tools'
        els.preset = h('button')
        els.preset.id = 'lwp-preset'
        els.preset.type = 'button'
        els.preset.hidden = true
        els.preset.setAttribute('aria-haspopup', 'menu')
        els.preset.setAttribute('aria-expanded', 'false')
        els.preset.innerHTML = PRESET_ICON + '<span class="lwp-preset-label"></span>' + CHEVRON_ICON
        els.presetLabel = els.preset.querySelector('.lwp-preset-label')
        els.preset.onclick = function () {
          if (menuOpen) closeMenu()
          else openMenu()
        }
        tools.appendChild(els.preset)
        els.note = h('span', null, '')
        els.note.id = 'lwp-note'
        tools.appendChild(els.note)
        row.appendChild(tools)

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

        // 预设菜单挂在卡片上 (`bottom:100%` 弹到卡片上方, 与 dsh 的 MenuSurface 同一个位置关系)
        els.menu = h('div')
        els.menu.id = 'lwp-menu'
        els.menu.hidden = true
        card.appendChild(els.menu)

        dock.appendChild(card)
        root.appendChild(dock)

        els.drawer = h('div')
        els.drawer.id = 'lwp-drawer'
        els.drawer.hidden = true
        root.appendChild(els.drawer)

        document.body.appendChild(root)
        applyLook(look !== null ? look : call('portalLook'))
        updateSendGate()
      }

      /** 点菜单外面就收起: 捕获阶段判一次, 落在菜单与 chip 里才放过 */
      function onDocPointerDown(event) {
        if (!menuOpen) return
        var target = event.target
        if (els.menu && target instanceof Node && els.menu.contains(target)) return
        if (els.preset && target instanceof Node && els.preset.contains(target)) return
        closeMenu()
      }

      function unmount() {
        mounted = false
        call('portalVisible', false)
        if (renderTimer !== null) clearTimeout(renderTimer)
        renderTimer = null
        if (pollTimer !== null) clearInterval(pollTimer)
        pollTimer = null
        if (noteTimer !== null) clearTimeout(noteTimer)
        noteTimer = null
        menuOpen = false
        document.removeEventListener('pointerdown', onDocPointerDown, true)
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

      function mount() {
        if (mounted) return
        build()
        mounted = true
        call('portalVisible', true)
        adopt(currentSessionId())
        status = call('portalStatus')
        renderDrawer()
        refresh()
        // 名单与那一张脸都是异步的: 先把界面立起来, 数据到了再补 (拿不到就不画)
        loadPresets()
        document.addEventListener('pointerdown', onDocPointerDown, true)
        try {
          listUnsub = ctx.sessions.list.subscribe(function () {
            var id = currentSessionId()
            if (id !== sessionId) adopt(id)
            else renderPreset()
          })
        } catch (_noList) {
          listUnsub = null
        }
        pollTimer = setInterval(pollLedger, LEDGER_POLL)
        pollLedger()
      }

      return {
        mount: mount,
        unmount: unmount,
        hide: hide,
        reloadLook: reloadLook,
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
      }
    }

    function apply(ctx) {
      var portal = createPortal(ctx)
      expose(portal)
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
    }

    exports.apply = apply
    exports.inject = ['sessions', 'uiWorkspace', 'uiConversation', 'slots', 'locale']
    return module.exports
  },
})
