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

    // ── 小工具 ────────────────────────────────────────────────────────────────

    function h(tag, cls, text) {
      var node = document.createElement(tag)
      if (cls) node.className = cls
      if (text !== undefined && text !== null) node.textContent = String(text)
      return node
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

    var CSS = [
      // 底色用硬值而不是只靠 `--dsw-alias-bg-base`: 变量解析不出来时那一条 background 会整条失效,
      // 覆盖层就变透明, 底下的 dsh 界面 (上下文滑杆、宽度控制) 会透上来
      '#lwp-root{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;',
      'background:#f7f7f8;background:var(--dsw-alias-bg-base,#f7f7f8);',
      'color:var(--dsw-alias-label-primary,#18181b);',
      'font:14px/1.6 system-ui,-apple-system,"Noto Sans CJK SC",sans-serif}',
      '@media (prefers-color-scheme:dark){#lwp-root{background:#16181c}}',
      '#lwp-root[hidden]{display:none}',
      '#lwp-head{display:flex;align-items:center;gap:8px;padding:10px 14px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.1));flex:none}',
      '#lwp-head .lwp-brand{font-weight:600;letter-spacing:.01em}',
      '#lwp-head .lwp-meta{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#lwp-head button{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));',
      'background:transparent;color:inherit;border-radius:999px;padding:4px 10px;font:inherit;font-size:12px}',
      '#lwp-head button[data-on="on"]{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff;border-color:transparent}',
      '#lwp-flow{flex:1;min-height:0;overflow-y:auto;padding:16px 14px 8px;display:flex;flex-direction:column;gap:14px}',
      '.lwp-row{display:flex;flex-direction:column;gap:4px;max-width:100%}',
      '.lwp-row[data-who="user"]{align-items:flex-end}',
      '.lwp-bubble{max-width:86%;padding:9px 12px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.lwp-row[data-who="user"] .lwp-bubble{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff;border-bottom-right-radius:6px}',
      '.lwp-row[data-who="assistant"] .lwp-bubble{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08));border-bottom-left-radius:6px}',
      '.lwp-row[data-who="error"] .lwp-bubble{background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.35);color:#b91c1c}',
      '.lwp-time{font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af)}',
      '.lwp-empty{margin:auto;color:var(--dsw-alias-label-secondary,#9ca3af);font-size:13px;text-align:center;line-height:1.8}',
      '#lwp-foot{flex:none;padding:8px 12px 12px;display:flex;gap:8px;align-items:flex-end}',
      '#lwp-input{flex:1;min-height:44px;max-height:140px;resize:none;box-sizing:border-box;',
      'border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));border-radius:16px;padding:11px 14px;',
      'font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff)}',
      '#lwp-send{flex:none;width:44px;height:44px;border-radius:999px;border:none;color:#fff;',
      'background:var(--dsw-alias-button-info-fill,#3b82f6);font:inherit;font-size:13px}',
      '#lwp-send:disabled{opacity:.45}',
      '#lwp-drawer{position:absolute;left:0;right:0;bottom:0;max-height:72%;overflow-y:auto;',
      'background:var(--dsw-alias-bg-overlay,#fff);border-top:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.1));',
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

      /** 会话标题: 显示给人看的那个 (没标题时回落到 id 的前几位) */
      function sessionTitle(id) {
        var summary
        try {
          summary = ctx.sessions.list.getSnapshot().byId[id]
        } catch (_noList) {
          summary = undefined
        }
        var title = summary && typeof summary.title === 'string' ? summary.title.trim() : ''
        return title === '' ? '本场 ' + String(id).slice(0, 12) : title
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
      }

      /** 开一场: 不点名工作区就落 dsh 的默认那个 (球那场就在 `dsh-ball` 里, 见宿主的 ensureBallWorkspace) */
      function startSession() {
        try {
          ctx.uiWorkspace.startSession()
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

      /** 顶条那行读数: 本场是哪一场、账本还能用多久 */
      function renderMeta() {
        if (!els.meta) return
        var ledger = call('portalSession')
        var parts = []
        if (sessionId === null) parts.push('没有会话')
        else parts.push(sessionTitle(sessionId))
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
        if (els.send) els.send.disabled = true
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
            if (els.send) els.send.disabled = false
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

        var foot = h('div')
        foot.id = 'lwp-foot'
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
        foot.appendChild(els.input)
        els.send = h('button', null, '发送')
        els.send.id = 'lwp-send'
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
        foot.appendChild(els.send)
        root.appendChild(foot)

        els.drawer = h('div')
        els.drawer.id = 'lwp-drawer'
        els.drawer.hidden = true
        root.appendChild(els.drawer)

        document.body.appendChild(root)
      }

      function unmount() {
        mounted = false
        call('portalVisible', false)
        if (renderTimer !== null) clearTimeout(renderTimer)
        renderTimer = null
        if (pollTimer !== null) clearInterval(pollTimer)
        pollTimer = null
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
        try {
          listUnsub = ctx.sessions.list.subscribe(function () {
            var id = currentSessionId()
            if (id !== sessionId) adopt(id)
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
      }
    }

    function apply(ctx) {
      var portal = createPortal(ctx)
      expose(portal)
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
