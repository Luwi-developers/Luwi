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
 *    由 `window.LuwiPortal.portalStatus()` 原样读出; 点「唤醒一下」投的就是 `RouterTick` 那条收件箱行, 与
 *    定时唤醒同一个入口 (判断永远只在宿主那一处)
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
    /** 账本轮询间隔: 球的 30 分钟窗口一过就会换场, 门户要跟过去 */
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
    /**
     * 缺省那张脸 (当前那套图标) 的缓存键 (2026-11-22)
     *
     * 与头像同一个套路: `markVer` 是套的 id, 没换套就不搬图。它比头像更常被用到 —— 头像没配、
     * 终端页 (那里头像被强制清空) 以及每次重挂都要画一次
     *
     * **键名里那个 `2` 是有用的** (2026-11-22): 之前那份 mark 是"画布原样", 内置那套的墨迹只占
     * 0.46, 于是在 96px 的空态里鲸尾只有女仆那张的一半大; 现在宿主交下来的是**紧裁填满**的那一份。
     * 不换键的话, 老机器 localStorage 里那份小数会一直画下去 (换套才会作废, 而人不一定换)
     */
    var MARK_CACHE = 'dsh.luwi.portal.mark2'
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
     * 主动场开场那句的头一段 (2026-11-12 #38; 2026-11-13 #43 跟着宿主改了措辞)
     *
     * 宿主 `proactiveStartLine` 的第一行逐字相同 (`host-plugin` 的 `PROACTIVE_START_MARK`) ——
     * 那一行是给模型的启动说明, **不是主人说的话**, 门户照它把整条认出来不画 (历史窗里仍在)
     */
    var PROACTIVE_START_MARK = '这行字不是主人发的, 是你自己想起他, 于是开了这个话头'
    /** 门户记录最多留几条 (跨场续写时的上限, 免得一场一场攒出无限长) */
    var RECORD_MAX = 240
    /**
     * 打开门户这一刻, 主动场那一场多久之内还算"最新的消息" (2026-11-12 #38)
     *
     * **与球那本账不是同一个数**: 那本账 2026-11-20 起是 30 分钟 (复用窗口), 这里问的是"刚才那一下
     * 说完没", 10 分钟够; 更长会把上一次开机的话也拽进来
     */
    var RECENT_PROACTIVE_MS = 10 * 60 * 1000
    /**
     * 主动场那几句插进本场时间线时的 `seq` 基址 (2026-11-12 #38, 2026-11-13 收紧口径)
     *
     * 同一轮里 `orderTimeline` 按 `seq` 排她的话: 那一场自己的 `seq` 从 1 数起, 与本场的数会撞, 于是
     * 把它抬到本场之上 —— 同一轮里"她后说的"就该排在后面, 也不会顶到本场已有的那几句前面
     */
    var ECHO_SEQ_BASE = 1000 * 1000

    /**
     * 输入框那行灰字 (2026-11-20 主人: "发消息或长按说话")
     *
     * **这句话就是发现长按的唯一入口**: 输入卡上没有麦克风图标, 语音态靠"按住空输入框"或头栏那颗
     * 「语音」叫出来, 所以灰字必须把那个动作说出来
     */
    var VOICE_HINT = '发消息或长按说话'
    /** 按住输入框多久算"我要说话" (再短就是点了一下, 留给光标) */
    var VOICE_LONG_PRESS_MS = 450
    /**
     * 一次最多按住 300 s (2.8.1 #F10): 与宿主 `PortalVoice.MAX_SECONDS` 同一个数 (判据钉住)
     *
     * 原来是 60 s 到点整段作废; 现在 60 s 那一道只是**滚段** (见 `VOICE_SEGMENT_MS`), 硬上限抬到 5 分钟
     */
    var VOICE_MAX_MS = 300 * 1000
    /**
     * 实时文字层的节拍 (2.8.1 #F10): 每 1500 ms 把这一段**新增的** PCM 切片送一块去认
     *
     * 与宿主 `PortalVoice.VOICE_CHUNK_MS` 同一个数 (判据钉住); **0 = 关掉流式**, 回到"松手整段转写"
     */
    var VOICE_CHUNK_MS = 1500
    /**
     * 一段最多 60 s: 到点**不丢**前面说的话 —— 先把已识别的落进草稿, 再接着录下一段
     *
     * 旧版到点就整段作废 (屏上回一句"再短点说"), 连说 90 s 的人只剩最后半分钟
     */
    var VOICE_SEGMENT_MS = 60 * 1000
    /** 短于 0.5 s 当作误触: 不送转写, 只说一句"太短了" */
    var VOICE_MIN_MS = 500
    /** 转写等太久的那道闸 (原生没回推时把"正在识别…"收回 idle, 免得永远停在那儿) */
    var VOICE_WATCH_MS = 45 * 1000
    /** 头栏那颗「终端」在原生清单拿不到时的退路 (正常文案来自 `menu_sync` 那一句) */
    var SYNC_TITLE = '终端'
    /**
     * 终端那一页 (2026-11-21, 落实表 #48) 的几个常量
     *
     * `TERMINAL_TITLE` 是**强制**的名字: 主人要的是"名称强行改成 luwi终端", 于是外观里改了昵称
     * 也不影响这一页; `TERMINAL_KEY` 让它扛得住页面重载 (配对要重启 host, 回来还是终端)
     */
    var TERMINAL_TITLE = 'luwi终端'
    var TERMINAL_KEY = 'dsh.luwi.portal.terminal'
    /**
     * 终端里那颗头栏钮的字 (2026-11-22 主人: "终端不加返回按钮, 而是从终端按钮返回, 在终端时,
     * 按钮上的字应当是「对话」")
     *
     * 于是终端**没有**自己的「‹」: 进出的那一颗从头到尾是同一个位置 —— 不在终端时写「终端」(文案跟原生
     * 清单走), 在终端里写这一个, 点它就回门户那一场对话 (见 [pickSync] / [applySyncTitle])
     */
    var TERMINAL_BACK_TITLE = '对话'
    var TERMINAL_BACK_HINT = '回到对话'
    /** 终端里点头像列几场 (主人: "只显示最近pc会话") */
    var TERMINAL_HISTORY_MAX = 20
    /** 探一次对端最多等这么久 / 弹窗开着时多久再探一次 */
    var TERMINAL_PROBE_MS = 6000
    var TERMINAL_POLL_MS = 5000
    /**
     * 那扇窗的门槛: **没连上不满这么久就不弹** (2026-11-22 主人: "终端还是一直会闪正在连接的窗口,
     * 但只出现不到 1s, 要求若未连接超过 3s 才出现那个窗口")
     *
     * 从前一进终端就先摆一张「正在找电脑」, 首探多半一瞬就有读数, 于是那张卡一闪而过 —— 先黑着,
     * 满 3 秒还连不上才弹. 判据 `check-luwi-portal` 终端那一段
     */
    var TERMINAL_GATE_GRACE_MS = 3000
    /** 电脑那几场会话的 cwd 的根 (`$DSH_HOME/lw/peer-workspaces`), 由原生报上来 */
    var TERMINAL_ROOT_KEY = 'shadowRoot'
    /**
     * 进终端时"最近那一场"的窗口 = 1 小时 (2026-11-21 主人: "进入终端时打开1h内最近终端对话, 没有要新建")
     *
     * 只决定**自动**落哪一场: 窗口外的那几场仍在终端历史里, 点一下照样接着聊
     */
    var TERMINAL_RECENT_MS = 60 * 60 * 1000
    /** 自动进终端那一趟之间至少隔这么久 (建不出来时别每个探测拍都重试一趟, 新建那条一等就是 10 秒) */
    var TERMINAL_ENTER_COOLDOWN_MS = 20 * 1000
    /**
     * 终端里"还没落到电脑那一场"时 `#lwp-flow` 的内容签名 (2026-11-21 主人: "进入终端时门户的对话仍显示在终端")
     *
     * 记一个正常签名撞不上的值: 清空之后走到这里, 换场那一下内容一变签名自然不同, 于是自己重画;
     * 不带这个记号的话 `resetFlow()` 之后签名是空内容那一份, 再来一次同样的对话就判成"画过了"
     */
    var TERMINAL_HIDDEN_SIG = '\u0000terminal-hidden'

    /**
     * 把页面收到的采样封成 16 kHz 单声道 PCM16 WAV (纯函数, 判据真跑)
     *
     * 宿主那条链只认这个形状 (`LwSpeech` 按 16 kHz 单声道解 wav), 而 WebView 的 `AudioContext`
     * 通常给 48 kHz —— 所以先按线性插值降到 16 kHz 再封头
     * @param chunks 每块都是 Float32Array (`ScriptProcessor` 一帧一块)
     * @param rate 采样率 (拿不到 / 不是正数就按 16000)
     * @returns 44 字节头 + 采样的 WAV 字节 (没有采样时只有头)
     */
    function wavOf(chunks, rate) {
      var parts = []
      var total = 0
      var list = Array.isArray(chunks) ? chunks : []
      for (var i = 0; i < list.length; i += 1) {
        var chunk = list[i]
        if (!chunk || typeof chunk.length !== 'number' || chunk.length === 0) continue
        parts.push(chunk)
        total += chunk.length
      }
      var samples = new Float32Array(total)
      var at = 0
      for (var j = 0; j < parts.length; j += 1) {
        samples.set(parts[j], at)
        at += parts[j].length
      }
      var source = Number(rate)
      if (!(source > 0)) source = 16000
      var out = samples
      if (source !== 16000 && samples.length > 1) {
        var length = Math.max(1, Math.floor(samples.length * 16000 / source))
        out = new Float32Array(length)
        var step = source / 16000
        for (var k = 0; k < length; k += 1) {
          var pos = k * step
          var base = Math.floor(pos)
          var frac = pos - base
          var first = base < samples.length ? samples[base] : 0
          var second = base + 1 < samples.length ? samples[base + 1] : first
          out[k] = first + (second - first) * frac
        }
      }
      var bytes = new Uint8Array(44 + out.length * 2)
      var view = new DataView(bytes.buffer)
      var ascii = function (offset, text) {
        for (var n = 0; n < text.length; n += 1) bytes[offset + n] = text.charCodeAt(n)
      }
      ascii(0, 'RIFF')
      view.setUint32(4, 36 + out.length * 2, true)
      ascii(8, 'WAVE')
      ascii(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, 16000, true)
      view.setUint32(28, 16000 * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      ascii(36, 'data')
      view.setUint32(40, out.length * 2, true)
      for (var m = 0; m < out.length; m += 1) {
        var clamped = out[m] > 1 ? 1 : (out[m] < -1 ? -1 : out[m])
        view.setInt16(44 + m * 2, Math.round(clamped * 32767), true)
      }
      return bytes
    }

    /** 字节 → base64 (分段拼, 一次 `apply` 十万个参数会炸栈) */
    function base64Of(bytes) {
      var text = ''
      var step = 0x8000
      for (var i = 0; i < bytes.length; i += step) {
        text += String.fromCharCode.apply(null, bytes.subarray(i, i + step))
      }
      return btoa(text)
    }

    /* ── 实时文字层那三个纯函数 (2.8.1 #F10, 判据真跑) ──────────────────────────
     *
     * 录音时波形行下面多一行"边说边出字": 每 `VOICE_CHUNK_MS` 把这一段新增的声音送去认一块,
     * 回来的字只追加到那一层. 三件事各抽成一个纯函数 —— 什么时候该送 / 怎么接字 / 松手写什么
     */

    /**
     * 这一拍该不该送一块去流式识别 (纯函数, 判据真跑)
     *
     * `chunkMs` 不是正数 = 关掉流式 (`VOICE_CHUNK_MS = 0`): 一整段一块都不送, 松手时回到整段转写
     * @param lastAt 上一块送出的时刻 (0 = 这一趟还没送过)
     * @param now 这一拍的时刻
     * @param chunkMs 节拍 (`client.js` 的 `VOICE_CHUNK_MS`)
     */
    function voiceChunkDue(lastAt, now, chunkMs) {
      var span = typeof chunkMs === 'number' && isFinite(chunkMs) ? chunkMs : 0
      if (!(span > 0)) return false
      var at = typeof lastAt === 'number' && isFinite(lastAt) ? lastAt : 0
      var stamp = typeof now === 'number' && isFinite(now) ? now : 0
      if (at <= 0) return true
      return stamp - at >= span
    }

    /**
     * 实时层新的一行 (纯函数, 判据真跑): 只把新认出来的那几个字接在后面
     *
     * 中文不加空格 (整段拼起来就是那句话); 两截的接缝上**都是英文数字**时才补一格 ——
     * 否则英文会粘成 "helloworld". 前后多余的空格一律收掉: 松手时草稿与这一层是同一份文字,
     * 差一个空格就不再"逐字一致"
     * @param shown 这一层已经有的那些字
     * @param addition 这一块刚认出来的那几个字
     */
    function voiceLiveJoin(shown, addition) {
      var head = typeof shown === 'string' ? shown.replace(/\s+$/u, '').replace(/^\s+/u, '') : ''
      var tail = typeof addition === 'string' ? addition.replace(/\s+$/u, '').replace(/^\s+/u, '') : ''
      if (tail === '') return head
      if (head === '') return tail
      var seam = /[A-Za-z0-9]$/u.test(head) && /^[A-Za-z0-9]/u.test(tail)
      return head + (seam ? ' ' : '') + tail
    }

    /**
     * 松手时草稿写什么 (纯函数, 判据真跑): 整段那份最准, 它空了才退回实时层那份
     *
     * "到点先把已识别的落进草稿"靠的就是这一条: 整段认不出来也不许把说过的话丢掉
     * @param live 实时层攒出来的那些字
     * @param final 整段转写回来的那一句
     */
    function voiceDraftText(live, final) {
      var said = typeof final === 'string' ? final.trim() : ''
      if (said !== '') return said
      return typeof live === 'string' ? live.trim() : ''
    }

    /* ── 录音波形那四个纯函数 (判据真跑, 2026-11-20 重做) ──────────────────────
     *
     * 做法照业界那套 (wavesurfer 的 `scrollingWaveform`): **走带窗口 + 峰值保持 + 归一化**。
     * 上一版是 `rms × 4` 配一条写死的正弦包络, 那是"假波形" —— 小声是一条直线, 大声糊顶,
     * 且永远中间高两边低, 一眼假
     */

    /** 条宽 / 间距 / 圆角帽 / 最小高 (px): wavesurfer 的 `barWidth 2 / barGap 1 / barRadius 2`,
     *  tapbeats 那份文档给的也是 2 / 1 / 1 */
    var REC_BAR_W = 2
    var REC_BAR_GAP = 1
    var REC_BAR_R = 1
    var REC_BAR_MIN = 2
    /** 每多少毫秒折一列, 一共留多少列 (3.2 s 的窗口) */
    var REC_SAMPLE_MS = 40
    var REC_COLS = 80
    /** 峰值保持的衰减 (每列一次) */
    var REC_HOLD_DECAY = 0.995
    /** 低于这个峰值就当静音: 一排点, 不是一条噪声 */
    var REC_SILENT = 0.02

    /**
     * 这一拍的电平 (RMS → 0~1): 对数感压缩, 说话与收音距离的差别不至于一条平线
     * @param rms `onaudioprocess` 算出来的均方根 (0~1)
     */
    function recLevelOf(rms) {
      var value = typeof rms === 'number' && isFinite(rms) ? Math.abs(rms) : 0
      var scaled = value * 6
      return scaled > 1 ? 1 : scaled
    }

    /** 峰值保持: 新的高就抬上去, 否则慢慢落 (安静时 hold 不塌成 0, 否则下一句会被放大成糊) */
    function recNextHold(hold, peak) {
      var kept = typeof hold === 'number' && isFinite(hold) ? hold : 0
      var next = typeof peak === 'number' && isFinite(peak) ? Math.abs(peak) : 0
      var decayed = kept * REC_HOLD_DECAY
      return next > decayed ? next : decayed
    }

    /**
     * 归一化: 峰值 / 保持值, 再开 0.6 次方 —— 小声 (峰值只有保持值的一成) 也能到三成高度
     * @param peak 这一列的峰值
     * @param hold 窗口内的峰值保持
     */
    function recNormalise(peak, hold) {
      var top = typeof hold === 'number' && isFinite(hold) ? hold : 0
      var value = typeof peak === 'number' && isFinite(peak) ? Math.abs(peak) : 0
      if (top < REC_SILENT || value < REC_SILENT) return 0
      var ratio = value / top
      if (ratio > 1) ratio = 1
      if (ratio < 0) ratio = 0
      return Math.pow(ratio, 0.6)
    }

    /**
     * 一排竖条的几何 (纯函数, 判据真跑): 走带式 —— 最新的那一列贴右边, 旧的往左排,
     * 装不下的从左边丢; 上下镜像于中线, 静音留 `REC_BAR_MIN` 的点
     * @param levels 从旧到新的电平 (0~1)
     * @param width 画布宽 (CSS px)
     * @param height 画布高 (CSS px)
     * @returns `[{x, y, w, h, r}]`
     */
    function recWaveRects(levels, width, height) {
      var list = Array.isArray(levels) ? levels : []
      var boxWidth = typeof width === 'number' && width > 0 ? width : 1
      var boxHeight = typeof height === 'number' && height > 0 ? height : 1
      var step = REC_BAR_W + REC_BAR_GAP
      var fit = Math.max(1, Math.floor((boxWidth + REC_BAR_GAP) / step))
      var shown = list.length > fit ? list.slice(list.length - fit) : list
      var pad = list.length > fit ? 0 : fit - shown.length
      var mid = boxHeight / 2
      var tallest = Math.max(REC_BAR_MIN, boxHeight - 8)
      var out = []
      for (var i = 0; i < fit; i += 1) {
        // 前 `pad` 格是"还没录到"的空档: 也画最小高的点, 整排因此从头就是一条基线
        var level = i < pad ? 0 : shown[i - pad]
        var value = typeof level === 'number' && isFinite(level) ? level : 0
        if (value < 0) value = 0
        if (value > 1) value = 1
        var barHeight = value <= 0 ? REC_BAR_MIN : Math.max(REC_BAR_MIN, tallest * value)
        out.push({
          x: boxWidth - (fit - i) * step,
          y: mid - barHeight / 2,
          w: REC_BAR_W,
          h: barHeight,
          r: REC_BAR_R,
        })
      }
      return out
    }

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

    /** 录音面板上滑取消时那枚向下的箭头 (2026-11-20): 两笔, 与 `⋯` / `＋` 同一档粗细 */
    var ARROW_DOWN_ICON = [
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
      '<path d="M8 3.2v9.4M4.2 8.8L8 12.6l3.8-3.8" stroke="currentColor" stroke-width="1.5"',
      ' stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ].join('')

    /**
     * 实时文字层那颗显隐钮的两副形状 (2.8.1 #F10)
     *
     * 开 = 三行字 (说的话正在这层里长出来); 关 = 同一个字形加一道斜杠 —— 与头栏那颗喇叭
     * "开加声波 / 关加斜杠" 同一套读法, 不另造形状
     */
    var LIVE_ON_ICON = [
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
      '<path d="M2.4 4.2h11.2M2.4 8h11.2M2.4 11.8h7.2" stroke="currentColor" stroke-width="1.4"',
      ' stroke-linecap="round"/></svg>',
    ].join('')
    var LIVE_OFF_ICON = [
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
      '<path d="M2.4 4.2h11.2M2.4 8h11.2M2.4 11.8h7.2" stroke="currentColor" stroke-width="1.4"',
      ' stroke-linecap="round"/>',
      '<path d="M3 13L13 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
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

    /**
     * 头栏那颗自动朗读的两副图标 (2026-11-20 主人给的三张官方手机端截图)
     *
     * 图 1 (关) 是**喇叭带一道斜杠**, 图 2 (开) 是**喇叭带两道声波** —— 差别在形状, 不在颜色,
     * 所以按状态换 `innerHTML`, `data-on` 只留底色与无障碍。笔画照 `+` / 发送那一档:
     * `viewBox 0 0 16 16` / `stroke-width 1.3` / `currentColor` / `fill=none`。
     * 喇叭本体两根: 声音从锥口进来 (左边的方块 + 向右张开的锥), 右边再挂两道弧
     */
    var SPEAKER_ON_ICON = [
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"',
      ' stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">',
      '<path d="M2.2 6.15h2.05L8.6 3.15v9.7L4.25 9.85H2.2z"></path>',
      '<path d="M10.7 5.6C11.75 6.3 12.35 7.1 12.35 8s-.6 1.7-1.65 2.4" stroke-linecap="round"></path>',
      '<path d="M12.15 3.75C13.85 4.95 14.75 6.4 14.75 8s-.9 3.05-2.6 4.25" stroke-linecap="round"></path>',
      '</svg>',
    ].join('')

    var SPEAKER_OFF_ICON = [
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"',
      ' stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">',
      '<path d="M2.2 6.15h2.05L8.6 3.15v9.7L4.25 9.85H2.2z"></path>',
      '<path d="M11 6.3l3.6 3.6M14.6 6.3L11 9.9" stroke-linecap="round"></path>',
      '</svg>',
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
      // 左边 = 头像 (2026-11-10 主人: "右上角 luwi 图标和 luwi 名可在外观设置中修改")
      // **2026-11-19 改口径** (主人: "点击头像开新对话改为打开历史" + "生效范围缩小到头像大小"):
      // 这颗钮只有头像那么大 (28x28 的圆钮, 热区就是头像), 点它开历史窗; 昵称搬到旁边当标识, 点不动
      '#lwp-brand{display:block;flex:none;width:28px;height:28px;padding:0;margin:0;appearance:none;',
      'border:0;background:transparent;color:inherit;line-height:0;border-radius:999px;cursor:pointer;',
      'transition:transform .15s ease}',
      '#lwp-brand:active{transform:scale(.94)}',
      '@media (hover:hover){#lwp-brand:hover{background:rgba(1,180,255,.12)}}',
      '#lwp-brand:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3964fe);outline-offset:2px}',
      '#lwp-brand .lwp-mark{position:relative;flex:none;width:28px;height:28px;display:block}',
      // 头像换成自定义那张时可能是方图: 圆裁 + 铺满, 28px 的框不变 (布局不跟着图抖)
      '#lwp-brand .lwp-mark img{display:block;width:28px;height:28px;border-radius:999px;object-fit:cover}',
      // 昵称与读数在头栏只是标识 (2026-11-19: 搬出按钮, 于是点那两个字什么都不发生)
      '#lwp-head .lwp-brand-text{display:flex;flex-direction:column;min-width:0;gap:1px}',
      '#lwp-head .lwp-brand-name{font-size:15px;font-weight:600;line-height:1.15;letter-spacing:.01em;',
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
      // 右边那一簇: 语音 / 终端 / 更多。**「历史」那颗已撤** (2026-11-19: 入口并进左边那颗头像)。
      // 类名而不是 `#lwp-head > button` —— 后者特异性比 `#lwp-brand` 高,
      // 会把头像也套进"圆角描边小按钮"那一套里 (2026-11-08 预览里就是一颗白胶囊)
      '#lwp-head .lwp-tab{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));',
      'background:transparent;color:inherit;border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;',
      'line-height:1.5;flex:none}',
      '#lwp-head .lwp-tab[data-on="on"]{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff;border-color:transparent}',
      // 三颗装成一簇 (2026-11-20 主人: "都要放在靠近更多按钮的位置, 向右对齐"): `margin-left:auto`
      // 挂在簇上, 昵称那一段因此只占左边剩下的宽度
      '#lwp-tabs{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}',
      // `⋯` 那顆比文字按钮宽一点, 点起来才不憋
      '#lwp-head .lwp-tab.lwp-more{padding:4px 11px;font-size:15px}',
      // 语音那颗只有图标 (官方那枚麦克风): 30x28 的圆钮, 字形跟 `+` / 表情同一档
      '#lwp-head .lwp-tab.lwp-tab-icon{display:grid;place-items:center;width:30px;height:28px;padding:0}',
      '#lwp-head .lwp-tab-icon svg{display:block}',

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

      /* 选工作区那一窗的样式已删 (2026-11-13): 门户里不再有需要人点的选工作区入口, 首启自动落进
       * `<工作区根>/Luwi` (见 landInDefaultWorkspace) */

      /* ── `⋯` 里那几行 (判断 / 探索 / 返回) ───────────────────────────────────── */
      '#lwp-drawer .lwp-menu-row{appearance:none;display:flex;align-items:center;gap:10px;width:100%;',
      'box-sizing:border-box;padding:11px 12px;margin-top:6px;font:inherit;font-size:14px;',
      'border-radius:14px;border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));',
      'background:transparent;color:inherit;text-align:left}',
      '#lwp-drawer .lwp-menu-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#lwp-drawer .lwp-menu-row em{font-style:normal;font-size:12px;',
      'color:var(--dsw-alias-label-secondary,#9ca3af)}',
      '#lwp-drawer .lwp-menu-back{align-self:flex-start;margin-bottom:2px}',
      // 原生那一份菜单 (2026-11-14): 开关行按 data-on 加粗, 禁用行变灰, 两组之间一条细线
      '#lwp-drawer .lwp-menu-row[data-on="on"]{font-weight:600}',
      '#lwp-drawer .lwp-menu-row[disabled]{opacity:.45}',
      '#lwp-drawer .lwp-menu-sep{height:1px;margin:10px 0 2px;',
      'background:var(--dsw-alias-border-l1,rgba(15,23,42,.12))}',

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
      // 本机占位那一行 (2.8.1 #33): 要淡一点, 与真落盘的那条分得开
      '.lwp-row[data-pending="on"] .lwp-bubble{opacity:.6}',
      // 老 WebView 不认 backdrop-filter: 退回一块更实的底, 免得字压在照片上看不清
      '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){',
      '.lwp-bubble{background:rgba(252,253,254,.92)}',
      '.lwp-row[data-who="user"] .lwp-bubble{background:rgba(216,227,255,.94)}',
      '.lwp-row[data-who="error"] .lwp-bubble{background:rgba(252,232,232,.94)}}',
      '.lwp-time{font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af)}',
      // 图片发送失败那一行 (2.8.1 #1): 气泡与「复制诊断」并排, 按钮靠右 —— 一行里只占一小块,
      // 不把气泡挤窄; 窄屏上气泡仍先占满它的 78%, 按钮贴着它右边
      '.lwp-fail{display:flex;align-items:flex-end;gap:8px;max-width:100%}',
      '.lwp-fail .lwp-bubble{max-width:78%}',
      '.lwp-fail .lwp-diag{flex:none;appearance:none;border:0;border-radius:12px;padding:6px 10px;',
      'font:inherit;font-size:12px;white-space:nowrap;',
      'color:var(--dsw-alias-state-error-primary,#b91c1c);background:rgba(220,38,38,.12)}',
      // 空态: 中间一张品牌标记 + 名字 (2026-11-08 主人: "对话界面中间显示 luwi 及其图标")
      // 光晕与浮动只做氛围, 不承载信息; 关掉动效也完全看得懂
      '#lwp-hero{position:relative;flex:1;min-height:180px;display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;padding:24px 0 8px;text-align:center}',
      '#lwp-hero::before{content:"";position:absolute;left:50%;top:50%;width:min(78vw,340px);',
      'height:min(78vw,340px);transform:translate(-50%,-52%);border-radius:50%;pointer-events:none;',
      'background:radial-gradient(circle,rgba(1,180,255,.12),rgba(1,180,255,0) 62%)}',
      '#lwp-hero .lwp-hero-mark{position:relative;display:grid;place-items:center;',
      'animation:lwp-float 4.2s ease-in-out infinite}',
      // 空态那张脸与头栏**同一个形状** (2026-11-10 主人: "这个新对话屏幕中间的图案应用圆形, 与头像一致"):
      // 圆裁 + 铺满, 96px 的框不变 —— 方图 (相册里随手选的那张) 也不会挤出一个方角
      // **2026-11-22 起图标套那张不受这个尺寸限制**: 96x96 的 cover 会把女仆头顶那根呆毛裁掉
      // (主人: "去除门户中心图标的尺寸限制, 否则会把呆毛也裁剪了"), 于是默认那张改按高度定尺寸、
      // 宽度跟着图形比例走, `contain` 不裁; 圆裁与铺满只给自选头像 (`data-photo="on"`)
      '#lwp-hero .lwp-hero-mark img{display:block;height:96px;width:auto;max-width:140px;object-fit:contain}',
      '#lwp-hero .lwp-hero-mark[data-photo="on"] img{width:96px;height:96px;border-radius:999px;object-fit:cover}',
      // 换了自定义头像之后, 头栏那颗 28px 有白描边才立得住; 空态这张大图同理 (原来是品牌图, 有自带留白)
      '#lwp-hero .lwp-hero-mark[data-photo="on"] img{box-shadow:0 0 0 2px var(--lwp-glass-fill,rgba(252,253,254,.9)),',
      '0 0 0 3px rgba(15,23,42,.08)}',
      '#lwp-hero .lwp-hero-name{position:relative;margin-top:14px;font-size:22px;font-weight:700;',
      'line-height:1.2;letter-spacing:.02em}',
      '#lwp-hero .lwp-hero-line{position:relative;margin-top:6px;font-size:13px;line-height:1.7;',
      'color:var(--dsw-alias-label-secondary,#6b7280)}',
      // 空态那颗「选工作区」的样式已删 (2026-11-13): 首启自动落进默认工作区, 界面不给要人点的入口
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
      // **气泡跟着图收** (2026-11-16): 只写 max-width 时它是一块 block, 在那一列里被 stretch 到 86%,
      // 右边一大片空灰 —— 真机截图量到气泡 911px / 图 323px。三个值里任一生效就够: inline-flex 管
      // "父不是 flex", align-self 管"父是 flex", width:fit-content 兜底 (与 `.lwp-file` 同一个写法)
      '.lwp-sticker{display:inline-flex;align-self:flex-start;width:fit-content;max-width:86%;',
      'padding:6px 10px;border-radius:var(--dsw-radius-lg,16px);',
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
      // 长按那一下的手感 (落实表 #41, 2026-11-13): 按住到点的那一块先暗下去, 菜单弹出来就知道按到了谁
      '.lwp-file[data-held="on"],.lwp-image[data-held="on"]{opacity:.7}',
      // 长按这两块时不要顺带选中名字: 那次选中会压在我们的菜单下面, 手一抬还留着一条高亮
      '.lwp-file,.lwp-image{-webkit-user-select:none;user-select:none}',
      // 长按文件弹出的那颗菜单: 与预设菜单同一套玻璃, 挂在手指那一点上 (`position:fixed` + 夹进视口),
      // 所以没有 `#lwp-menu` 那条"贴着卡片左边"的定位
      '#lwp-file-menu{position:fixed;z-index:2147483003;min-width:184px;max-width:78vw;padding:6px;',
      'border-radius:var(--dsw-radius-md,12px);background:var(--dsw-specific-menu,var(--lwp-glass-fill));',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}',
      '#lwp-file-menu[hidden]{display:none}',
      '#lwp-file-menu .lwp-file-menu-name{font-size:12px;line-height:16px;padding:4px 8px 6px;',
      'color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#lwp-file-menu .lwp-file-menu-note{font-size:12px;line-height:18px;padding:2px 8px 6px;',
      'color:var(--dsw-alias-label-secondary,#6b7280);white-space:normal}',
      '#lwp-file-menu .lwp-file-menu-item{display:block;width:100%;padding:8px;border:0;border-radius:8px;',
      'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;',
      'line-height:20px;text-align:left;cursor:pointer}',
      '@media (hover:hover){#lwp-file-menu .lwp-file-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
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
      // 「已开新对话」那颗读数 (2026-11-19 主人: "新对话的提示弹窗要单独一层, 否则会导致中间的图文
      // 受弹窗影响下移, 弹窗消失后又上移"): **absolute 的一层, 不参与排版** —— 出现与收起都不改
      // #lwp-flow 的高度, 中间那张脸与对话一个字都不动; `top` 由 showUndo 按头栏实际高度写
      '#lwp-undo{position:absolute;left:50%;transform:translateX(-50%);z-index:2;pointer-events:none;',
      'display:flex;align-items:center;gap:8px;padding:6px 10px 6px 12px;border-radius:999px;font-size:12px;',
      'color:var(--dsw-alias-label-primary,#18181b);background:var(--dsw-specific-menu,var(--lwp-glass-fill));',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}',
      '#lwp-undo[hidden]{display:none}',
      // 空态那颗「开一场」撤了 (2026-11-09 主人: "不需要用户手动点击开一场, 新界面里自动开始新对话")
      // —— 进来就自己开一场, 这一层不再摆一颗要人按的按钮

      // ── 终端那一页 (2026-11-21, 落实表 #48): 门户整页变黑 + 那扇「扫码配对 / 返回」 ──────────
      // 只改`#lwp-root` 这一棵树: 底下的 dsh 页面本来就藏起来了 (shellRoot 的 visibility),
      // 所以"全变黑"不需要动任何原生尺寸, K 键盘那一段 (`--lwp-ime`) 也照旧
      '#lwp-root[data-mode="terminal"]{background:#000}',
      '#lwp-root[data-mode="terminal"] #lwp-wall{display:none}',
      '#lwp-root[data-mode="terminal"] #lwp-head{color:#e6e6e6}',
      '#lwp-root[data-mode="terminal"] .lwp-brand-name{color:#e6e6e6}',
      '#lwp-root[data-mode="terminal"] .lwp-meta{display:none}',
      '#lwp-root[data-mode="terminal"] #lwp-tabs .lwp-tab{color:#cfcfcf;',
      'border-color:rgba(255,255,255,.18);background:transparent}',
      '#lwp-root[data-mode="terminal"] #lwp-flow{color:#d8d8d8}',
      // 终端里还没落到电脑那一场 (`data-term-session` 不是 on) 时, 门户那几条对话一条都不给看 (2026-11-21 主人:
      // "进入终端时, 门户的对话仍显示在终端, 进入终端时应当不显示") —— `visibility` 而不是 `display`,
      // 排版尺寸照旧, 换场之后不用重排; JS 那一半见 `renderFlow` 的闸与 `markTerminalSession`
      '#lwp-root[data-mode="terminal"]:not([data-term-session="on"]) #lwp-flow{visibility:hidden}',
      '#lwp-root[data-mode="terminal"] .lwp-bubble{background:rgba(255,255,255,.07);color:#e8e8e8;',
      'box-shadow:none}',
      '#lwp-root[data-mode="terminal"] .lwp-row[data-who="user"] .lwp-bubble{background:rgba(120,200,160,.16)}',
      '#lwp-root[data-mode="terminal"] .lwp-row[data-who="error"] .lwp-bubble{background:rgba(255,120,120,.18)}',
      '#lwp-root[data-mode="terminal"] .lwp-sep span{color:#9a9a9a;background:rgba(255,255,255,.08)}',
      '#lwp-root[data-mode="terminal"] #lwp-card{background:#151515;border:1px solid rgba(255,255,255,.12);',
      'box-shadow:none}',
      '#lwp-root[data-mode="terminal"] #lwp-input{color:#eaeaea}',
      '#lwp-root[data-mode="terminal"] #lwp-input::placeholder{color:#8a8a8a}',
      '#lwp-root[data-mode="terminal"] .lwp-hero-name{color:#e6e6e6}',
      '#lwp-root[data-mode="terminal"] .lwp-working{color:#9a9a9a;background:rgba(255,255,255,.06)}',
      // 卡片外的点击**不许被这层遮罩吃掉** (2026-11-22): 终端的出口是头栏那颗「对话」, 而这一层
      // 是 `position:fixed;inset:0` 的黑幕 —— 不给 `pointer-events:none` 的话头栏那几颗一个都点不到
      // (真机实测: 点「对话」纹丝不动, 只有卡片上的「返回」能退)。卡片自己再收回可点
      '#lwp-term-gate{position:fixed;inset:0;z-index:30;display:flex;align-items:center;',
      'justify-content:center;padding:0 24px;background:rgba(0,0,0,.72);pointer-events:none}',
      '#lwp-term-gate[hidden]{display:none}',
      '#lwp-term-gate .lwp-term-card{width:100%;max-width:360px;border-radius:20px;padding:20px 18px 16px;',
      'background:#111;border:1px solid rgba(255,255,255,.14);color:#e8e8e8;pointer-events:auto;',
      'box-shadow:0 18px 60px rgba(0,0,0,.6)}',
      '#lwp-term-gate .lwp-term-title{font-size:15px;font-weight:600;line-height:22px;margin-bottom:8px}',
      '#lwp-term-gate .lwp-term-body{font-size:12.5px;line-height:20px;color:#b9b9b9;margin-bottom:16px;',
      'white-space:pre-wrap}',
      '#lwp-term-gate .lwp-term-row{display:flex;flex-direction:column;gap:8px}',
      '#lwp-term-gate button{appearance:none;width:100%;border-radius:14px;padding:11px 14px;font-size:14px;',
      'line-height:20px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#e8e8e8}',
      '#lwp-term-gate button[data-primary="on"]{background:#e8e8e8;color:#111;',
      'border-color:transparent;font-weight:600}',
      '#lwp-term-gate .lwp-term-note{font-size:11.5px;line-height:18px;color:#8f8f8f;margin-top:10px;',
      'text-align:center}',

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
      // 拖文件进来那一刻 (2.8.1 #34): 卡上描一圈虚线, 松手就落在这一块 (贴边留 6px, 不盖住圆角)
      '#lwp-card[data-drop="over"]{outline:2px dashed var(--dsw-alias-state-business-primary);',
      'outline-offset:-6px}',
      // 拖进来那一刻的说明牌 (2026-11-19 主人: "图可以放了, 但最好再加上如图所示的提示"): 与后台
      // dsh 的 DropOverlay 同一形态 —— 居中两行, 一行说"拖到这儿就能加", 一行说上限. **不接点击**
      // (`pointer-events:none`): 拖到哪儿都不会挡住 `+`、输入框与发送键
      '#lwp-drop-hint{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;',
      'justify-content:center;gap:10px;padding:16px;box-sizing:border-box;pointer-events:none;',
      'border-radius:inherit;',
      'background:var(--dsw-specific-input-major,#fff);',
      'background:color-mix(in srgb,var(--dsw-specific-input-major,#fff) 88%,transparent)}',
      '#lwp-card[data-drop="over"] #lwp-drop-hint{display:flex}',
      '.lwp-drop-marks{display:flex;align-items:center;gap:10px;opacity:.95}',
      '.lwp-drop-title{font-size:17px;font-weight:600;line-height:1.3;',
      'color:var(--dsw-alias-label-primary);text-align:center}',
      '.lwp-drop-sub{font-size:12px;color:var(--dsw-alias-label-caption);text-align:center}',
      '#lwp-input{box-sizing:border-box;min-height:36px;',
      'max-height:calc(14 * (24px + var(--dsh-content-font-delta,0px)));',
      'padding:4px 12px 0 14px;border:0;outline:none;resize:none;overflow-y:auto;background:transparent;',
      'font-family:var(--dsw-font-family);font-size:inherit;line-height:inherit;',
      'color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary)}',
      '#lwp-input::placeholder{color:var(--dsw-alias-label-caption)}',
      // ── 长按说话那条录音条 (2026-11-20 三次改口径: 面积 = 输入框 1.5 倍, 边缘渐变) ──
      //
      // 不再是盖住半屏的大面板: 它就是**输入卡那一块地 + 半个卡高** —— 左右各 12px、底 12px
      // (与 `#lwp-dock` 的 `0 12px 12px` 对齐), 高度由 JS 按 `#lwp-card` 实测 × 1.5 写进 style。
      // **不吃事件** (`pointer-events:none`): 手指还压在原来的输入框上, 抬手与上滑都得照旧落在它那一侧。
      // 材质: 蓝渐变 + 顶部径向柔光 + 上沿 1px 内高光 + 3.5% 噪点; **上沿 22px 用 mask 淡出** ——
      // 与页面之间没有硬接缝 (真渐变), 代价是外投影一起被裁掉, 所以只留内高光
      '#lwp-rec{position:absolute;left:12px;right:12px;bottom:12px;z-index:7;box-sizing:border-box;',
      'height:148px;padding:16px 18px 14px;display:flex;flex-direction:column;gap:10px;',
      'pointer-events:none;overflow:hidden;border-radius:28px;',
      'background:linear-gradient(180deg,#5b7cff 0%,#3f6bff 54%,#2f5cff 100%);',
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.24);',
      '-webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,.72) 10px,#000 22px);',
      'mask-image:linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,.72) 10px,#000 22px);',
      'opacity:0;transform:translateY(14px) scale(.99);',
      'transition:opacity .16s ease,transform .24s cubic-bezier(.32,.72,0,1),background .18s ease}',
      '#lwp-rec[data-on="on"]{opacity:1;transform:translateY(0) scale(1)}',
      // 上滑到"松开取消"那一档: 整块往下沉一点、颜色退成中性灰 —— 读起来是"这块要丢掉", 不是"变暗了"
      '#lwp-rec[data-cancel="on"]{transform:translateY(8px) scale(.988);',
      'background:linear-gradient(180deg,#8b93a3 0%,#6f7686 54%,#5d6472 100%)}',
      // 顶部柔光: 一块很轻的径向光, 不是一条色带
      '#lwp-rec::before{content:"";position:absolute;left:-10%;right:-10%;top:-40%;height:86%;',
      'pointer-events:none;background:radial-gradient(62% 52% at 50% 40%,rgba(255,255,255,.14),rgba(255,255,255,0) 72%)}',
      // 噪点: 2x2 的一张, 摆着不动 (只画一次, 不占每帧)
      '#lwp-rec::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.035;',
      'background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'2\' height=\'2\'><rect width=\'1\' height=\'1\' fill=\'white\'/><rect x=\'1\' y=\'1\' width=\'1\' height=\'1\' fill=\'white\'/></svg>")}',
      // 第一行: 左提示, 右计时胶囊 (矮条里它们必须同一行)
      '#lwp-rec-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex:none;',
      'height:20px}',
      '#lwp-rec[data-busy="on"] .lwp-rec-wave{opacity:0;height:0;flex:none}',
      // 实时文字层 (2.8.1 #F10): 波形那一行下面两行, 读屏靠 `aria-live`; 两行封顶之后自己往上滚
      '#lwp-voice-live{flex:none;max-height:36px;overflow-y:auto;overscroll-behavior:contain;',
      'font-size:12.5px;line-height:18px;letter-spacing:.01em;color:rgba(255,255,255,.96);',
      'text-shadow:0 1px 0 rgba(0,0,0,.14);transition:opacity .16s ease}',
      '#lwp-voice-live:empty{display:none}',
      '#lwp-rec[data-live="off"] #lwp-voice-live{display:none}',
      // 波形那一行自带一颗 24px 显隐钮; 行与钮自己**收事件** (面板其余部分仍不吃事件, 抬手照旧落输入框)
      '.lwp-rec-wave-row{display:flex;align-items:stretch;gap:8px;flex:1;min-height:24px;pointer-events:none}',
      '.lwp-rec-live-btn{display:grid;place-items:center;flex:none;align-self:center;width:24px;height:24px;',
      'padding:0;border:0;border-radius:999px;background:rgba(255,255,255,.16);color:rgba(255,255,255,.96);',
      'pointer-events:auto;cursor:pointer;transition:opacity .16s ease,background .16s ease}',
      '@media (hover:hover){.lwp-rec-live-btn:hover{background:rgba(255,255,255,.26)}}',
      '#lwp-rec[data-live="off"] .lwp-rec-live-btn{opacity:.6}',
      // 转写中: 波形那一行让位给三个点, 实时文字**留着** —— 松手那一刻屏上与草稿里是同一句, 人看得见
      '#lwp-rec[data-busy="on"] .lwp-rec-wave-row{display:none}',
      // 红点归动画管 (`animation` 会盖住普通的 `opacity`), 所以要连 animation 一起停
      '#lwp-rec[data-busy="on"] .lwp-rec-dot{animation:none;opacity:0}',
      // 一行提示: 录制中点一颗会呼吸的红点, 上滑后浮出一枚向下箭头
      '.lwp-rec-hint{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;line-height:18px;',
      'font-weight:500;letter-spacing:.02em;color:rgba(255,255,255,.94);',
      'transition:opacity .16s ease;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.lwp-rec-dot{width:6px;height:6px;border-radius:999px;flex:none;background:#ff5d5d;',
      'box-shadow:0 0 0 3px rgba(255,93,93,.22);animation:lwp-rec-breath 1.6s ease-in-out infinite;',
      'transition:opacity .16s ease}',
      '@keyframes lwp-rec-breath{0%,100%{opacity:.55;box-shadow:0 0 0 3px rgba(255,93,93,.16)}',
      '50%{opacity:1;box-shadow:0 0 0 5px rgba(255,93,93,.28)}}',
      '.lwp-rec-arrow{width:13px;height:13px;flex:none;opacity:0;transform:translateY(-4px);',
      'transition:opacity .18s ease,transform .18s cubic-bezier(.23,1,.32,1)}',
      '#lwp-rec[data-cancel="on"] .lwp-rec-arrow{opacity:1;transform:translateY(0)}',
      // 波形: 走带 (新的从右边进); **左右两端各自 9% 淡出** —— 条子进出声都不硬切
      '.lwp-rec-wave{display:block;width:100%;flex:1;min-height:0;height:100%;pointer-events:auto;',
      '-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,#000 9%,#000 91%,rgba(0,0,0,0) 100%);',
      'mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,#000 9%,#000 91%,rgba(0,0,0,0) 100%);',
      'transition:opacity .18s ease;opacity:1}',
      // 转写中的三个点: 只动 transform; 平时不占位, 转写时接管波形那一行的空间
      '.lwp-rec-dots{display:flex;align-items:center;justify-content:center;gap:6px;flex:none;',
      'min-height:0;height:0;opacity:0;transition:opacity .18s ease}',
      '#lwp-rec[data-busy="on"] .lwp-rec-dots{flex:1;height:auto;opacity:1}',
      '.lwp-rec-dots i{width:5px;height:5px;border-radius:999px;background:rgba(255,255,255,.92);',
      'animation:lwp-rec-bounce 1.1s ease-in-out infinite}',
      '.lwp-rec-dots i:nth-child(2){animation-delay:.12s}',
      '.lwp-rec-dots i:nth-child(3){animation-delay:.24s}',
      '@keyframes lwp-rec-bounce{0%,80%,100%{transform:translateY(0);opacity:.5}',
      '40%{transform:translateY(-4px);opacity:1}}',
      // 计时胶囊: 在第一行右边, 不再绝对定位贴底
      '.lwp-rec-time{flex:none;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.16);',
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.28);',
      'font-size:10.5px;line-height:15px;letter-spacing:.04em;color:rgba(255,255,255,.88);',
      'font-variant-numeric:tabular-nums}',
      // 动效敏感的人: 只留淡入, 位移与呼吸全关
      '@media (prefers-reduced-motion:reduce){',
      '#lwp-rec{transform:none;transition:opacity .12s linear}',
      '#lwp-rec[data-on="on"],#lwp-rec[data-cancel="on"]{transform:none}',
      '.lwp-rec-dot,.lwp-rec-dots i{animation:none}',
      '.lwp-rec-arrow{transform:none}}',
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
      '#lwp-drawer .lwp-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;',
      // 2026-11-15: 检测项一多, 动作行会滚出抽屉的可视区 —— 那看起来就是"按钮点不动"。
      // 钉在抽屉底部 (sticky), 玻璃底自己铺一层, 下面的行滚过去也不会透出来
      'position:sticky;bottom:0;padding-top:8px;padding-bottom:2px;',
      'background:var(--dsw-specific-menu,var(--lwp-glass-fill));',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur)}',
      '#lwp-drawer .lwp-actions button{min-height:36px;padding:6px 14px;font-size:13px}',

      // 顶上那颗提示 (2.8.1 #12): 抽屉盖着的时候输入卡里那行 `#lwp-note` 在它后面, 写了也看不见 ——
      // 「开始这一趟」「刷新」按下去于是与"没接上"同形。这一颗挂在 root 上 (不在抽屉里), 重画抽屉不会
      // 把它一起清掉; 位置放顶上是因为抽屉自己能占到屏幕高度的七成
      '#lwp-toast{position:absolute;left:50%;transform:translateX(-50%);top:64px;z-index:6;',
      'max-width:78%;padding:8px 14px;border-radius:999px;font-size:12px;line-height:18px;text-align:center;',
      'color:var(--dsw-alias-label-primary,#18181b);background:var(--dsw-specific-menu,var(--lwp-glass-fill));',
      '-webkit-backdrop-filter:var(--lwp-glass-blur);backdrop-filter:var(--lwp-glass-blur);',
      'border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.12));',
      'box-shadow:0 8px 28px rgba(15,23,42,.18);pointer-events:none}',
      '#lwp-toast[hidden]{display:none}',
      '#lwp-toast[data-error="on"]{color:var(--dsw-alias-state-error-primary,#b91c1c)}',
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
      /**
       * 判断抽屉里那一句"这一下有没有出去" (2026-11-15)
       *
       * `portalTick` / `portalTickEnabled` 都是同步桥调用, 但判断本身在宿主那一侧异步跑 —— 点上
       * 之后屏上若一个字都不变, 与"按钮没接上"分不开。回执留 6 s, 之后自己收掉
       */
      var tickNote = ''
      // 「虚拟屏」那一项的二级项: 原生清单里的一项带 children 时暂存在这里, 抽屉切进 `screen` 态再画
      var screenItems = []
      /**
       * 原生清单里 `sync` 那一项的两句 (2026-11-22)
       *
       * 存下来是为了"进 / 出终端时只改字不跑一趟桥": 终端里那颗钮写「对话」, 出来要立刻写回清单
       * 里那一句 (设置里 rename 过也是它) —— 见 [applySyncState] / [applySyncTitle]
       */
      var syncTitle = ''
      var syncSummary = ''
      var sending = false
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
       *
       * `photo` 说的是"这张脸是不是主人自选的图" (2026-11-22): 空态那圈白描边只给自选头像, 图标套
       * 那张不算 —— 原来拿 `avatar !== MARK_PNG` 判, 而换套之后 `avatar` 是 data URL, 永远不等于
       * 内嵌那个常量, 于是终端页那圈描边自己冒了出来 (`face.json` 的 `avatar` 明明还是空串)
       */
      var identity = { name: DEFAULT_NAME, avatar: '', photo: false }
      /** 历史记录窗开着没有 / 它的订阅 (`ctx.sessions.list`) */
      var historyOpen = false
      var historyUnsub = null
      var historyQuery = ''
      /* ── 终端 (2026-11-21, 落实表 #48) ────────────────────────────────────────────
       *
       * 口径: 终端 = **手机管电脑**. 这一层只做界面那半边 —— 整页变黑、那扇「扫码配对 / 返回」、
       * 头像与名字强制、历史只列电脑那几场、新建只建与电脑连的场; 真正"发到电脑上执行"的是
       * 插件 (`agent/pre-step` 那条归属方闸把影子会话里的一句话转给电脑)
       *
       * 开没开由**这一层**说了算 (`terminalMode`), 原生只镜像 (`portalTerminalVisible`) ——
       * 页面重载 / 返回键 / 配对重启 host 之后两边都按页面说的那一个走
       */
      var terminalMode = false
      /** `portalTerminal()` 交回来的那份读数 (影子根 / 配没配对 / 通道开没开); 取不到时 null */
      var terminalInfo = null
      /** 探测对端那一拍: `{at, ok, busy, why}` */
      var terminalProbe = { at: 0, ok: false, busy: false, why: '' }
      /** 弹窗现在为什么开着: '' 关着 | 'unpaired' | 'off' | 'offline' */
      var terminalGate = ''
      /** 这一轮"没连上"从哪一刻开始算 (0 = 现在算得上连着 / 还没开始算); 见 [renderTerminalGate] 那 3 秒门槛 */
      var terminalGateSince = 0
      /** 3 秒门槛到点重画的那一拍 */
      var terminalGateTimer = null
      /** 进终端之前那一场 (`{id}`), 退出回它; 也写进 `TERMINAL_KEY` 的 `back`, 页面重载之后回得去 */
      var terminalReturn = null
      /** 上一次自动进终端 (挑场或新建) 的时刻: 冷却用, 见 [TERMINAL_ENTER_COOLDOWN_MS] */
      var terminalAutoAt = 0
      /** 上一句"终端里出了什么事"是什么时候 / 说的是哪一句: 同一句一分钟最多说一次, 换一句就当场说 */
      var terminalNotedAt = 0
      var terminalNotedKey = ''
      /** 终端里正在等的那个探测计时器 */
      var terminalProbeTimer = null
      var noteTimer = null
      /**
       * 屏幕上那一颗提示 (2.8.1 #12)
       *
       * `showNote` 写的是输入卡里那行小字, 抽屉一盖就看不见 —— 所以面板里那些"按下去了没有"的回执
       * 另走这一颗: 挂在 root 上, 抽屉与预览窗都盖不住, 2.4 s 自己收
       */
      var toastTimer = null
      /**
       * 探索面板现在写着哪一份读数 (`workKey`)
       *
       * 抽屉开着时每 3 s 那一拍 (`pollLedger`) 拿新的一份与它比: 盘上真的变了才重画, 于是「开始这一趟」
       * 投出去之后那一行 `这一趟` 会自己变成「正在跑」, 不必再按一次刷新
       */
      var workShown = ''
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
       * 自动落进默认工作区那一趟 (2026-11-13, 原「选工作区」口径作废)
       *
       * 首启 (`pm clear` 之后) dsh 那一边可能一个工作区都没有, 而这一层把 dsh 整个盖住了 ——
       * 所以这一层自己把 `<工作区根>/Luwi` 备好、注册上再落进去 (见 [landInDefaultWorkspace]),
       * 界面上不再摆任何要人点的选择入口
       */
      /** 正在落进某个工作区: 连点只认第一次 (与 [navigating] 分开, 两条路可以互相接管) */
      var entering = false
      /** 自动落位失败后那一次补试 (15 s, 只一次: 再往后由账本 / 会话表推着走) */
      var landRetryTimer = null
      /** `<工作区根>/Luwi` 的绝对路径 (问一次应用就缓存; 重挂时清掉再问) */
      var wantPathCache = null
      /**
       * 长按文件那颗菜单正在说的是哪一份 (落实表 #41, 2026-11-13)
       *
       * `{rel, name, bytes}` —— `rel` 是 `/lw-out/` 后面那段, 复制路径与交给系统都按它再问一次桥,
       * 页面自己不留绝对路径 (`portalAbsPath` / `portalCopyPath` 才是唯一一处拼路)
       */
      var menuFile = null

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
      /**
       * 门户记录 (2026-11-12 #38): 自动换场之前已经画在屏上的那些行
       *
       * 主动场是**固定新开**一场 (`presets/proactive` 里写死的), 而主人要的是"一打开就看到最新那句,
       * 上面那段历史还在" —— 所以自动换场 (账本 / 主动场 / 会话表) 之前先把当前画面抄进这里, 换过去
       * 之后接在新场前面画。`nodesOf` 每次把这两段合成一份, 于是条数只增不减。
       *
       * **只有点左上角「开新对话」或这一层重挂 (重启应用) 才清空** (主人 2026-11-12 的原话:
       * "门户对话记录不可自动清空"): 点历史是主人自己要看那一场, 也不抄
       */
      var carried = []
      /** 上一次投过的主动场 (`startedAt`): 同一个数只投一次, 挂载时先把文件里那一场记下来 */
      var proactiveSeen = 0
      /**
       * 主动场那几句 (2026-11-12 #38, 2026-11-13 收紧口径)
       *
       * 主人原话: "那句要出现在**当前对话**（门户首屏）里, **不允许只落在那一场独立会话的历史对话里**".
       * 那一场仍然是固定新开的 (预设与硬闸都绑在它上面), 门户**不换场** —— 只把那一场的 `lw/out`
       * 当成本场时间线上的几行插进来 (`echoItemOf`), 于是条数 = 触发前 + 1, 上面那段历史一条不动;
       * 开场提示词只在那一场自己的历史对话里 (见 [isProactiveStart]), 这里只收她说的那几句
       */
      var echoes = []
      /** 现在收的是哪一场 (`proactive.json` 的 `run.session`), 空串 = 还没收过 */
      var echoSession = ''
      /** 那一场已经收到哪个 `seq` (两段水位, 与 [loadOut] 同一条规矩) */
      var echoNext = 0
      /**
       * 「唤醒一下」点完之后那几拍补问的定时器 (2.8.1 #8)
       *
       * 收纳那一拍是 3 秒一次的 `pollLedger`, 而那颗按钮要的是"按下去就有回音" —— 点完这里自己
       * 多问几拍 (见 [watchWake]), 3 秒一到就交回定时器, 不留常驻轮询
       */
      var wakeTimer = null
      /** 已经取进 `outLines` 的那些 `seq` (取水位推进了也去重一次: 见 [loadOut] 里那段注释) */
      var seenSeq = {}
      var outQueue = []
      var outTimer = null
      var outReleaseAt = 0
      /** 上一拍见过的 user 节点 `seq` (新的一条 = 新一轮 → 撤掉还没上屏的旧条) */
      var userKey = ''
      /**
       * 上一次 `nodesOf()` 读到的 user 节点个数 (2026-11-14)
       *
       * 只给 [carryRecord] 当闸门用: 0 说明 dsh 的节点还没加载出来 (冷启 / 换场那一拍), 这时抄记录
       * 抄到的只有她的行 —— 冻进记录之后, 合并顺序就变成"她的话全在我上面"
       */
      var lastUsers = 0
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
       * 拖进来那个说明牌上的两个图标 (图片 / 文件)
       *
       * 2026-11-19 主人: "图可以放了, 但最好再加上如图所示的提示" —— 形态照后台 dsh 的 DropOverlay
       * 那两个圆角方块画, 内联 SVG (不新增图片资源, 也不用构建步骤)
       */
      var DROP_MARKS_SVG = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
        + '<rect x="3" y="3" width="18" height="18" rx="5" fill="#3b82f6"/>'
        + '<circle cx="9" cy="9" r="1.8" fill="#fff"/>'
        + '<path d="M5 17l4.2-4.2 3 3 2.3-2.3L19 17H5z" fill="#fff"/></svg>'
        + '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
        + '<rect x="3" y="3" width="18" height="18" rx="5" fill="#60a5fa"/>'
        + '<path d="M8 9h8M8 12h8M8 15h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'
      /**
       * 图片发送失败那三种说法 (落实表 #35, 2026-11-12)
       *
       * 主人报的是"选图 → 点确定 → 没反应": 三条路 (WebView 没回调 / 太大 / 等超时) 以前都是静默,
       * 人只能来群里问。**说法只有这三种** —— 页面与宿主 (logcat) 认的是同一张表
       */
      var IMAGE_FAIL = {
        /** 点了 `+` 宿主没进 `onShowFileChooser`, 或者选择器根本起不来 (issue #53 的另一半) */
        noCallback: 'webview 未回调',
        /** 选出来的那一份超过 [MAX_STASH_BYTES] */
        tooBig: '文件过大',
        /** 读字节 / 落盘一直没回来 */
        timeout: '上传超时',
      }
      /** 点 `+` 到宿主回报 "选择器起来了" 之间最多等多久: 要压在判据那个 5 s 里面 */
      var PICK_WAIT_MS = 2500
      /**
       * 回到页面之后先让出多久再判"没回调" (2.8.1 #13)
       *
       * 宿主那几句回话 (`pickState` / `picked`) 走 `evaluateJavascript`, 而选择器在前台时渲染器整个
       * 停着 —— 它们要等页面回到前台才落地, 落地的顺序还排在计时器后面 (2026-11-12 真机 logcat:
       * `file chooser` 之后 5.2 s 冒出一条假的「webview 未回调」, 而人当场就选了图) —— 所以回来之后先
       * 让出这一小段: 宿主的回话一两帧就到, 到了就把计时器撤掉; 真没回话, 宽限过了再报
       *
       * **四行诊断里认的就是这一档**: 那条失败气泡的第四行写着「图片: 未选择」—— 报的时候手里一张图都
       * 没有, 说明它来自这个看门狗, 而不是读字节 / 落盘那两条路 (那两条会带上这一份多大)
       */
      var PICK_GRACE_MS = 1500
      /** 选完之后读字节 + 落盘最多等多久 (12 MB 在这台机器上不到 1 s, 留足余量) */
      var UPLOAD_WAIT_MS = 10000
      /**
       * 本机那几条「图片发送失败」: `{id, at, text}` —— 画在对话流里 (`who:'error'`, 与 dsh 的
       * turn-error 同一档), **不进 dsh 的会话账**: 这是本机的现场, 不是要发给模型的内容
       */
      var imageFails = []
      /**
       * 本机那几条「这句没发出去」 (2.8.1 #33): `{id, at, text}` —— 与 [imageFails] 同一档
       * (`who:'error'`, 红字玻璃气泡), 画在门户自己的时间线上, **不进 dsh 的会话账**
       *
       * 主人报的是"点发送只有按钮变色, 正文没发出去, 过一会又恢复原状": 那时 `prompt()` 拒答只有一行
       * `console.log`, 而门户盖着 dsh 自己的错误节点 —— 屏上就等于什么都没发生
       */
      var sendFails = []
      /** 发送钮按住多久算长按 (长按 = steer, 轻点 = queue; 见 [sendGesture]) */
      var SEND_HOLD_MS = 550
      /**
       * 这一次投递还没落进 dsh 快照时, 屏上先占那一行 (2.8.1 #33)
       *
       * dsh 的回显要等 Host 收下 prompt 才进快照 (`pendingSubmissions` 只装 accepted 的那几条),
       * 于是"点了发送, 时间线上什么都没有"最长能空好几拍。这里先按本机这一份画一条半透明的行,
       * 落盘那条 user 节点一出现就让位 (判据见 [pendingEchoState])
       * `{id, at, text, attach}`; null = 没有欠着的那一行
       */
      var pendingEcho = null
      /** 本机那条占位最多占多久: dsh 那边一直不认就撤, 免得屏上留一条永远不落地的气泡 */
      var PENDING_ECHO_MS = 15000
      /** 占位的序号 (同一条正文连发两次也不撞 id) */
      var pendingSeq = 0
      /** 点 `+` 那一下的计时器 (宿主一回调就撤) */
      var pickWatch = null
      /** 这一趟选图还欠宿主一个回话 (`picked` / `empty` / `none` 里任意一个到了才算还清) */
      var pickPending = false
      /** 计时器这会儿是"停着等人"而不是"没挂": 页面看得见之后再按宽限挂上 (见 [pickWatchVisibility]) */
      var pickHeld = false
      /** 表情那个方框的边长 (px): 与 CSS `.lwp-sticker img` 里的 120 是同一个数, 改一处就得改另一处 */
      var STICKER_BOX = 120
      /**
       * 一条消息里最多画几张 dsh 附件图 (2026-11-20): 多出来的只写「+N 张图」——
       * 一次贴十几张时, 解码与滚动都不该被后半截拖住
       */
      var MAX_DURABLE_IMAGES = 4
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
        // **电脑那几场不记** (2026-11-21): 记了之后重载 / 退出门户再进来, 门户自己会停在电脑那一场 ——
        // 那是终端里头的事, 没进终端的门户不该看见它
        if (!isTerminalSession(id)) rememberSession(id)
        if (!same) {
          streamKey = ''
          // 换场就把"这一档问过没有"作废 (2026-11-20): 默认值可能在别处改过, 而这一场
          // 上一次落在这里时记下的那一档已经旧了 —— 不清就永远不会再问一次
          modelDefaultChecked = ''
          // 她说的话: 换会话就**重取全量** (一次画完、不排队), 上一场没上屏的条一条都不带过来
          clearOut('the conversation changed')
          // 草稿里那张图也不带过去 (它挂在上一场的会话 id 上)
          clearAttach()
          // 上一场那几条「图片发送失败」也不带过去 (落实表 #35): 它们是这一场的现场
          imageFails = []
          // 上一场那几条「这句没发出去」与还没落地的占位同样不带过去 (2.8.1 #33)
          sendFails = []
          pendingEcho = null
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
      /* [workspaceTitle] 已删 (2026-11-13): 它只服务于已删掉的那一窗工作区列表 */
      /**
       * 这一层默认该用哪个工作区 (纯函数: 判据 `check-luwi-portal` 抽出来真跑)
       *
       * 主人 2026-11-13 的口径: **直接默认使用 `<工作区根>/Luwi`** —— 所以先按路径认 (尾部 `/` 归一,
       * 与 [workspaceByPath] 同一口径), 认不到才退列表第一条有 id 的; 列表空着就回空串 (那表示还得
       * 让应用把目录备好再 `workspaces.create`)
       * @param {object[]} items `ctx.get('workspaces').list.getSnapshot().items`
       * @param {string} wantPath 应用那一侧解析出来的 `<工作区根>/Luwi`
       * @returns {string} workspaceId, 没有就是空串
       */
      function defaultWorkspaceId(items, wantPath) {
        var list = Array.isArray(items) ? items : []
        var want = typeof wantPath === 'string' ? wantPath.replace(/\/+$/, '') : ''
        var first = ''
        for (var i = 0; i < list.length; i += 1) {
          var item = list[i]
          if (!item) continue
          var id = String(item.workspaceId || item.id || '')
          if (id === '') continue
          if (first === '') first = id
          if (want === '') continue
          var mine = String(item.path || item.directory || item.root || '').replace(/\/+$/, '')
          if (mine !== '' && mine === want) return id
        }
        return first
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
          var opening = ctx.uiWorkspace.openWorkspace(owner)
          // 这是一条"顺手"的路 (给 [follow] 的 catch 兜底): 返回值没人等, 但也别留 unhandled rejection
          if (opening && typeof opening.catch === 'function') {
            opening.catch(function (reason) {
              console.log('[luwi-portal] openWorkspace failed: ' + describeError(reason))
            })
          }
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
       * 这一条 user 消息是不是主动场的开场提示词 (纯函数, 判据 `check-luwi-portal` 抽出来真跑)
       *
       * 两个记号都认: 宿主 2026-11-12 起写的 `source.via === 'proactive'`, 以及老会话里没有这个记号
       * 时那句开场白本身的头一段 ([PROACTIVE_START_MARK])。命中就**整条不画** —— 它是启动说明, 不是
       * 主人说的那句; 会话自己那一份历史 (dsh 的历史对话) 一个字都不动, 点进去还查得到
       */
      function isProactiveStart(node) {
        if (!node || typeof node !== 'object') return false
        var source = node.source
        // `wake` 是 2.8.1 #8 那一档: 点「唤醒一下」开的那一场, 开场同样是给模型的启动说明
        if (source && typeof source.via === 'string'
          && (source.via === 'proactive' || source.via === 'wake')) return true
        var text = textOf(node.content)
        return text.replace(/^\s+/u, '').indexOf(PROACTIVE_START_MARK) === 0
      }

      /**
       * 这一场主动对话是不是"新的、还没投过" (纯函数)
       *
       * - 没开会话 / 没有 `startedAt` → 不是
       * - `seen >= startedAt`: 这一场已经投过 (或它比挂载还早) → 不是, 同一个数只投一次
       */
      function proactiveNew(run, seen) {
        if (!run || typeof run.session !== 'string' || run.session === '') return false
        var startedAt = Number(run.startedAt) || 0
        if (startedAt <= 0) return false
        return startedAt > (Number(seen) || 0)
      }

      /**
       * 把手里的行接在门户记录后面 (纯函数)
       *
       * 身份 (`id`) 一样的只留一条 —— 换场前后同一条不该画两遍; 超过 [RECORD_MAX] 从头上截,
       * 留下来的一定是**最新的那一段**
       */
      function appendRecord(base, items) {
        var kept = Array.isArray(base) ? base.slice() : []
        var known = {}
        for (var i = 0; i < kept.length; i += 1) {
          var key = kept[i] && kept[i].id ? String(kept[i].id) : ''
          if (key !== '') known[key] = true
        }
        var added = Array.isArray(items) ? items : []
        for (var k = 0; k < added.length; k += 1) {
          var one = added[k]
          if (!one) continue
          var id = one.id ? String(one.id) : ''
          if (id !== '' && known[id] === true) continue
          if (id !== '') known[id] = true
          kept.push(one)
        }
        return kept.length > RECORD_MAX ? kept.slice(kept.length - RECORD_MAX) : kept
      }

      /**
       * 把「门户记录」与「这一场刚排好的那条线」合成**一条按时间**的线 (2026-11-14)
       *
       * **以前是 `appendRecord(carried, ordered)`** —— 记录那一段无条件接在最前面, 之后再不重排。
       * 冷启 / 自动换场的那一拍, 她的行是从 `lw/out/<会话>.jsonl` 同步读到的, 而 dsh 的 user 节点还在
       * 异步加载, `nodesOf()` 这时只排得出她的话; `carryRecord()` 把这条**半截线**冻进记录, 于是
       * 「她的话」整组压在自己的消息上面 (2026-11-14 主人截图: 12:18 嗯收到 / 12:30 在什么事 两条在上,
       * 12:18 －－ / 12:30 你好 两条在下)。所以这里改成: 先按身份去重 (`live` 在前, 同一身份以**当前**
       * 那份为准 —— 记录里是旧拷贝), 再**按墙上时钟排一遍**。
       *
       * 三条口径:
       * 1. `time` 读得到的按升序; 同刻**稳定** (保持输入相对顺序) —— `orderTimeline` 已经按轮把
       *    `user -> 她的行 -> error -> 兜底` 排好, 于是同刻的先后仍是那一套
       * 2. `time` 读不到 (`<= 0`) 的整段沉到最后, 内部仍按原相对顺序
       * 3. 排完从**尾部**截到 [RECORD_MAX] —— 留下的一定是最新的那一段
       *
       * @param {object[]} record 门户记录 (`carried`, 换场之前抄下来的那一段)
       * @param {object[]} live 本场排好的那一条线 (`orderTimeline` 的输出)
       * @returns {object[]} 按时间排好的一条线
       */
      function mergeTimeline(record, live) {
        var kept = appendRecord(Array.isArray(live) ? live : [], record)
        var known = []
        var unknown = []
        for (var i = 0; i < kept.length; i += 1) {
          var item = kept[i]
          if (!item) continue
          var at = Number(item.time) || 0
          if (at > 0) known.push({ item: item, at: at, at0: i })
          else unknown.push(item)
        }
        known.sort(function (a, b) {
          if (a.at !== b.at) return a.at - b.at
          return a.at0 - b.at0
        })
        var out = []
        for (var k = 0; k < known.length; k += 1) out.push(known[k].item)
        for (var u = 0; u < unknown.length; u += 1) out.push(unknown[u])
        return out.length > RECORD_MAX ? out.slice(out.length - RECORD_MAX) : out
      }

      /**
       * 换场之前先把屏上这些行抄进门户记录 (只有自动换场才抄, 见 [switchTo])
       *
       * **2026-11-14: 这一拍还没有 user 节点就不抄** (`lastUsers === 0`) —— 那时屏上只有她的行
       * (节点还在加载), 抄进去就是半截线; 换回来会重新从 `lw/out` 读一遍, 条数不会少
       */
      function carryRecord() {
        var items = nodesOf()
        if (lastUsers === 0 || items.length === 0) {
          console.log('[luwi-portal] record not carried: no user node yet (users=' + String(lastUsers) + ')')
          return
        }
        // **本机画的那几行不抄** (2.8.1 #33 审查): 半透明占位行与两条本机失败行都不在 dsh 的账里,
        // 抄进记录就撤不掉了 —— 换回来会多一条永远淡着的气泡 (真节点 id 不同, 去重也去不掉),
        // 或者把上一场的「图片没发出去」捎到这一场
        var keep = []
        for (var i = 0; i < items.length; i += 1) {
          var one = items[i]
          if (one.pending === true) continue
          if (one.fail === true) continue
          if (String(one.id || '').indexOf('sendfail\u0001') === 0) continue
          keep.push(one)
        }
        if (keep.length === 0) return
        carried = mergeTimeline(carried, keep)
      }

      /**
       * 清空门户记录 (2026-11-12 #38): **只有**「开新对话」与点历史这两条路
       *
       * 退后台 / 收门户 / 自动换场一条都不清 —— 主人: "门户对话记录不可自动清空, 除非用户重启应用
       * 或者开启新对话"; 重挂 (重启应用) 天然是空的, 所以这里也只有这两处
       */
      function dropRecord() {
        carried = []
        echoes = []
        echoSession = ''
        echoNext = 0
      }

      /**
       * 她在别的场次 (主动场) 说的一句 → 本场时间线上的一行 (纯函数)
       *
       * 身份带上场次 (`echo` + 会话 id + `seq`): 与本场 jsonl 的 `out\\u0001<seq>` 不可能撞, 换场两次
       * 也不会被 [appendRecord] 当成同一条; `seq` 抬到 [ECHO_SEQ_BASE] 之上, 于是同一轮里排在本场
       * 已有的那几句后面
       */
      function echoItemOf(sessionId, line) {
        var item = outItemOf(line)
        item.id = 'echo\u0001' + String(sessionId) + '\u0001' + String(line.seq)
        item.seq = ECHO_SEQ_BASE + (Number(line.seq) || 0)
        item.session = String(sessionId)
        item.echo = true
        return item
      }

      /**
       * 取一次主动场那几句 (`portalOut` 认的是 `lw/out/<会话>.jsonl`, 不必是当前这一场)
       *
       * `reset` = 换了一场主动对话, 从 0 重取; 否则只取 `seq > echoNext` 的尾巴 —— 与 [loadOut] 的
       * 两段水位同一条规矩. 取到就重画 (不排队: 她说的那几句已经在文件里落定了)
       */
      function loadEcho(reset) {
        if (echoSession === '') return
        if (reset) {
          echoes = []
          echoNext = 0
        }
        var page = call2('portalOut', echoSession, echoNext)
        var lines = page && Array.isArray(page.lines) ? page.lines : []
        var added = 0
        for (var i = 0; i < lines.length; i += 1) {
          var one = lines[i]
          if (!one) continue
          var seq = Number(one.seq) || 0
          if (seq > echoNext) echoNext = seq
          echoes.push(echoItemOf(echoSession, one))
          added += 1
        }
        if (added === 0) return
        flowForceBottom = true
        renderFlow()
      }

      /**
       * 收一场新的主动对话: 只换取数目标, **不清掉屏上已有的那几条** (2026-11-16, 2.8.1 #8)
       *
       * 连点三次「唤醒一下」会连着开三场: 以前换一场就 `echoes = []`, 于是第二下之后上一条气泡凭空
       * 消失, 看上去像"只有最后一次说了话"。`echoItemOf` 的身份带会话 id, 攒着不会撞; 只把
       * `echoNext` 归零 (水位是每一场自己的)
       */
      function adoptEchoRun(run) {
        if (!run || typeof run.session !== 'string' || run.session === '') return false
        if (run.session === echoSession) return false
        echoSession = run.session
        echoNext = 0
        loadEcho(false)
        return true
      }

      /**
       * 把宿主记着的那几场主动对话里还没收过的收进来 (2.8.1 #8)
       *
       * `proactive.json` 的 `run` 只有**最新一场**: 连点三次「唤醒一下」时, 两场之间那一场会被下一次
       * 覆盖掉, 光看 `run` 就只收得到最后那一句。宿主另记了一小串 `recent` (`portalStatus` 原样带
       * 过来), 这里按 `startedAt` 升序逐场补, 每场取一次它自己的 `lw/out`
       *
       * @returns {number} 这一拍补进来几场
       */
      function adoptProactiveRuns(proactive) {
        var runs = proactive && Array.isArray(proactive.recent) ? proactive.recent.slice() : []
        var newest = proactive && typeof proactive.session === 'string' ? proactive.session : ''
        if (newest !== '') {
          var known = false
          for (var k = 0; k < runs.length; k += 1) {
            if (runs[k] && runs[k].session === newest) known = true
          }
          if (!known) runs.push({ session: newest, startedAt: Number(proactive.startedAt) || 0 })
        }
        runs.sort(function (a, b) {
          return (Number(a && a.startedAt) || 0) - (Number(b && b.startedAt) || 0)
        })
        var adopted = 0
        for (var i = 0; i < runs.length; i += 1) {
          if (!proactiveNew(runs[i], proactiveSeen)) continue
          proactiveSeen = Number(runs[i].startedAt) || proactiveSeen
          if (adoptEchoRun(runs[i])) adopted += 1
        }
        return adopted
      }

      /**
       * 点完「唤醒一下」盯着看几拍 (2026-11-16, 2.8.1 #8)
       *
       * 主人要的是"按下去就有回音", 而收纳那一拍定时器是 3 秒一次 —— 这里自己连问 8 拍 (400 ms
       * 一发, 约 3 秒): 宿主一开新的一场就换成它, 再照那一场的 `lw/out` 把应声取回来。到点就交回
       * 定时器, 不留常驻轮询
       */
      function watchWake() {
        var left = 8
        function beat() {
          if (!mounted) return
          status = call('portalStatus')
          var run = status && status.proactive ? status.proactive : null
          if (adoptProactiveRuns(run) === 0) loadEcho(false)
          left -= 1
          if (left > 0) wakeTimer = setTimeout(beat, 400)
        }
        if (wakeTimer !== null) clearTimeout(wakeTimer)
        wakeTimer = null
        beat()
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
        if (source === 'history') {
          // 点历史 = 主人自己要看那一场: 换过去就是那一场, 不带上一段 (2026-11-12 #38)
          dropRecord()
          return follow(id, { align: true })
        }
        if (source === 'new') {
          // 「开新对话」是**唯一**清空门户记录的两条路之一 (另一条是重挂 / 重启应用)
          dropRecord()
          return follow(id, { align: true })
        }
        // 自动换场 (账本 / 会话表): 先把屏上那段抄进记录, 换过去之后接在后面画 ——
        // 于是"上一条历史仍在, 条数 +1", 置后台十分钟回来也不会少
        if (source === 'ledger' || source === 'list') carryRecord()
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
          // 多半是"这个工作区还没落定": 走自动落位那条 (备目录 -> 注册 -> 落进去), 不弹任何窗
          landInDefaultWorkspace('start')
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
            // 这中间自动落位可能已经把它接过来了: 那就什么都不用说
            if (sessionId === null) {
              showNote('没开出来, 稍后自动再试', true)
              landInDefaultWorkspace('retry')
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
       *
       * **它是浮层** (2026-11-19 主人: "提示弹窗要单独一层, 否则中间的图文受弹窗影响下移, 弹窗消失
       * 后又上移"): `#lwp-undo` 是 `position:absolute`, 这里只把 `top` 顶到头栏下面 —— 流里的高度
       * 一个像素都不占, 出现/收起都不重排对话区
       */
      function showUndo() {
        if (!els.undo) return
        var headHeight = els.head ? els.head.offsetHeight : 0
        els.undo.style.top = String((headHeight > 0 ? headHeight : 53) + 6) + 'px'
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
        // 2.8.1 #31: 「唤醒一下」那句带着宿主挑信号的来处 (`usage` / `schedule` / `check` / `wish` /
        // `fallback`). 只进元数据 (`meta.topicSource`), 气泡上不加字 —— 历史与排障看得出就够了
        var topicSource = typeof line.topicSource === 'string' ? line.topicSource : ''
        if (topicSource !== '') item.meta = { topicSource: topicSource }
        // 透明引用 (2026-11-20, 方案 §8.3): 这一句引的是哪一条记忆 (`episodes.jsonl` 的 id).
        // 只进元数据 (`meta.memoryRef` → 行的 `data-ref`), 气泡上不加字 —— 她要能"被查", 不是"被看着"
        var memoryRef = typeof line.memoryRef === 'string' ? line.memoryRef : ''
        if (memoryRef !== '') {
          item.meta = item.meta || {}
          item.meta.memoryRef = memoryRef
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
       * jsonl 的**一行** → 流里的项 (**一条气泡只装一样东西**, 2.8.1 #9)
       *
       * 宿主的 `lw_say` 现在把话 / 图 / 文件 / 表情各写各的行, 所以这一层通常一行一项; 但升级前写下的
       * 行还在文件里 (`kind:"image"` 与那句 `text` 在同一个对象里, 门户只好把一句话和图挤进一条气泡),
       * 那种行在这里**拆成两项**: 话一条气泡, 图或文件一条气泡。两项的 `id` 不同 (`…\u0001media`),
       * 增量渲染那一套身份与门户记录的去重都认得出它们是两条
       * @param {object} line jsonl 的一行
       * @returns {object[]} 一项或两项 (顺序: 话在前, 东西在后)
       */
      function outItemsOf(line) {
        var item = outItemOf(line)
        var text = typeof item.text === 'string' ? item.text.trim() : ''
        // 表情那一种已经由 [outItemOf] 把正文清掉了 (老行里的 `[…]` 占位符不上屏), 这里只管图与文件
        if ((item.kind !== 'image' && item.kind !== 'file') || text === '') return [item]
        var side = {}
        for (var key in item) {
          if (Object.prototype.hasOwnProperty.call(item, key)) side[key] = item[key]
        }
        side.id = String(item.id) + '\u0001media'
        side.text = ''
        // 话那一项只留身份与正文: 图 / 文件那几格 (`image` / `file` / `w` / `h`) 归 `side`
        var words = {
          who: item.who,
          id: item.id,
          seq: item.seq,
          time: item.time,
          kind: 'text',
          text: text,
        }
        return [words, side]
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
       * 一条消息里的**耐久图引用** (2026-11-20 主人: "这个在后台dsh内发送的图要求也要在门户上显示")
       *
       * 后台 dsh 那边 (浮球 / 原生会话界面) 发的图不经门户 `lw-in` stash 那一条路, 落盘后只剩
       * `{type:'image', attachment:{attachmentId, mediaType, width, height, bytes, name}}` —— 字节在
       * dsh 的附件仓里, 由 `ctx.uiConversation.imageUrl()` 取回 (见 [durableImageBubble])
       * 这里只挑"真能拿回来"的那些: 没有 `attachmentId` 的块交给 [hasImageBlock] 那条「（图）」兜底
       * @param {object[]} blocks user/message 的 content
       * @returns {object[]} `{attachmentId, mediaType, width, height, bytes, name}`
       */
      function imageAttachmentsOf(blocks) {
        var out = []
        if (!Array.isArray(blocks)) return out
        for (var i = 0; i < blocks.length; i += 1) {
          var block = blocks[i]
          if (!block || typeof block !== 'object') continue
          var kind = typeof block.type === 'string' ? block.type : block.kind
          if (kind !== 'image') continue
          var attachment = block.attachment
          if (!attachment || typeof attachment !== 'object') continue
          var id = typeof attachment.attachmentId === 'string' ? attachment.attachmentId : ''
          if (id === '') continue
          out.push({
            attachmentId: id,
            mediaType: typeof attachment.mediaType === 'string' ? attachment.mediaType : '',
            width: Number(attachment.width) || 0,
            height: Number(attachment.height) || 0,
            bytes: Number(attachment.bytes) || 0,
            name: typeof attachment.name === 'string' ? attachment.name : '',
          })
        }
        return out
      }

      /**
       * 本机占位那一行 (2.8.1 #33) —— 与真落盘那条 user 同一个形状, 只是多一位 `pending`
       * @returns 能直接交给 [orderTimeline] 的一项
       */
      function pendingEchoItem() {
        return {
          who: 'user',
          id: pendingEcho.id,
          time: pendingEcho.at,
          text: pendingEcho.text,
          attach: pendingEcho.attach,
          hasImage: false,
          pending: true,
        }
      }

      /**
       * 当前这一场的消息: user 节点 + 她说的话那份 jsonl, **按轮**合并 (2026-11-10)
       *
       * 两路流只按墙上时钟合并不够 (缺时间 / 同毫秒 / 宿主补句晚写都会把两条排反) —— 这里先把它们
       * 收成 `users` / `rows` / `extras` 三份, 再交给 [orderTimeline] 按"轮"排
       */
      function nodesOf() {
        // 这一场的节点还没到 (刚换场 / 场景还没恢复): 门户记录照画, 屏上不清空 (2026-11-12 #38)
        if (chatTarget === null) {
          lastUsers = 0
          var before = carried.slice()
          // 刚点过发送、这一场还没挂上: 本机那一行先占着, 屏上不是空的 (见 [pendingEcho])
          if (pendingEcho !== null && sending) before.push(pendingEchoItem())
          return before
        }
        var snapshot
        try {
          snapshot = chatTarget.getSnapshot()
        } catch (_noSnapshot) {
          lastUsers = 0
          return []
        }
        if (!snapshot) {
          lastUsers = 0
          return []
        }
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
            // **主动场的开场提示词不画** (2026-11-12 #38): 那一条是给模型的启动说明 (启动顺序 / 这一档
            // 能做什么 "/没有值得说的就沉默"), 主人没说过 —— 画出来就成了"她自己给自己下指令"的怪气泡。
            // 会话自己那一份历史一个字都不动 (dsh 的历史对话里点进去仍查得到), 这里只是不上门户
            if (isProactiveStart(node)) {
              fingerprint.push(node.seq)
              continue
            }
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
              // dsh 那边发的图 (见 [imageAttachmentsOf]): 有引用就画真图, 不再只剩「（图）」
              images: imageAttachmentsOf(node.content),
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
        // 一行里既有话又有图 / 文件时拆成两项 (2.8.1 #9), 于是老对话也是"话一条气泡, 图一条气泡"
        for (var k = 0; k < outLines.length; k++) {
          var line = outLines[k]
          if (releasedIds[line.seq] !== true) continue
          var parts = outItemsOf(line)
          for (var p = 0; p < parts.length; p += 1) rows.push(parts[p])
        }
        // 主动场那几句 (2026-11-12 #38): 与本场她的话走同一份 `rows` —— 交给 [orderTimeline] 按 `at`
        // 归轮、按抬高的 `seq` 排在后面, 于是"她刚说的那句"就落在本场时间线的末尾 (条数 +1)。
        // 主人自己翻到那一场时不叠: 那时它的真身就在上面那份 `outLines` 里
        for (var w = 0; w < echoes.length; w += 1) {
          if (echoes[w].session === sessionId) continue
          rows.push(echoes[w])
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
          // 主动场投过来的那几句也算 (2026-11-12 #38): 否则本场 jsonl 还空着时会再兜一句正文,
          // 屏上就变成"她说的 + 兜底"两条 —— 主人要的是**那条** + 1
          for (var z = 0; z < echoes.length; z += 1) {
            if (Number(echoes[z].time) >= lastUserTime) spoke = true
          }
          var allowFallback = !luwiFlow() || outLines.length === 0
          if (allowFallback && !spoke && assistantOwner >= 0) {
            // 2026-11-22: 正文里若带附件段 (电脑那边折回来的那种), 与 user 侧一样拆出来 ——
            // 话在上、附件在下 (主人: "在前台里要若本次会话带文件, 要显示在消息下方")
            var fallbackSplit = splitAttach(assistantFallback)
            extras.push({
              who: 'assistant',
              // 兜底行的身份挂在**它所依附的那条 user** 上 (方案 §2.2), 而它所依附的是
              // `assistantOwner` 那一轮的 user —— 不是"最新一条 user"
              id: users[assistantOwner].id === '' ? '' : 'fallback\u0001' + users[assistantOwner].id,
              time: Number(users[assistantOwner].time) || 0,
              text: fallbackSplit.main,
              attach: fallbackSplit.names,
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
            // 四行诊断 (2.8.1 #1): 这条是本机的图片失败 (`fail`), 右侧才有那颗「复制诊断」——
            // dsh 自己的 turn-error 两个字段都没有
            fail: true,
            diag: imageFails[f].diag,
          })
        }
        // 本机那几条「这句没发出去」 (2.8.1 #33): 与图片失败同一档, 按它自己那一刻归轮
        for (var sf = 0; sf < sendFails.length; sf += 1) {
          extras.push({
            who: 'error',
            id: sendFails[sf].id,
            time: sendFails[sf].at,
            text: sendFails[sf].text,
          })
        }
        // dsh 自己记下的那一条 prompt 拒答: 门户盖着它自己那块错误条, 这里补画一行
        // (本机已经按同一句话记过的那条就不重复画 —— 两处说的是同一件事)
        var rejected = promptErrorText(snapshot.promptError)
        if (rejected !== '') {
          var rejectedKnown = false
          for (var rf = 0; rf < sendFails.length; rf += 1) {
            if (sendFails[rf].text === rejected) rejectedKnown = true
          }
          if (!rejectedKnown) {
            extras.push({ who: 'error', id: 'prompt-error\u0001' + rejected, time: 0, text: rejected })
          }
        }
        // 本机那条占位: 落盘的 user 节点到了就让位, 失败 / 等太久就撤 (见 [pendingEchoState])
        if (pendingEcho !== null) {
          var holdNow = pendingEchoState(pendingEcho, users, sending, Date.now(), PENDING_ECHO_MS)
          if (holdNow === 'done') {
            console.log('[luwi-portal] pending echo landed: ' + String(pendingEcho.id))
            pendingEcho = null
          } else if (holdNow === 'drop') {
            console.log('[luwi-portal] pending echo gave up: ' + String(pendingEcho.id))
            pendingEcho = null
          }
        }
        // 记下这一拍读到了几个 user 节点 (给 [carryRecord] 当闸门, 见 [lastUsers])
        lastUsers = users.length
        // 这一句还没进 dsh 的快照: 先按本机这一份占一行 (半透明), 点完发送屏上立刻有东西
        if (pendingEcho !== null) users.push(pendingEchoItem())
        // 排好之后与门户记录**按时间**合成一条 (落实表 #38): 换场带过来那一段不再盲接在头上
        // (2026-11-14: 主人报的"她的话整组压在我的消息上面"就是那条盲拼接造成的)
        return mergeTimeline(carried, orderTimeline(users, rows, extras))
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
       * **2026-11-13**: 原来那颗「选工作区」已删 —— 首启由 [landInDefaultWorkspace] 静默把
       * `<工作区根>/Luwi` 备好并落进去, 界面不给任何要人点的入口
       */
      function heroNode() {
        var hero = h('div')
        hero.id = 'lwp-hero'
        var wrap = h('div', 'lwp-hero-mark')
        // 自定义头像才加那圈描边 (品牌图自带留白, 再套一圈只会显脏) —— 判据是 [identity.photo],
        // 不是"avatar 不等于内嵌的 MARK_PNG": 图标套那张 data URL 也不是自选图 (2026-11-22 终端页
        // 那圈框就是这么冒出来的)
        wrap.setAttribute('data-photo', identity.photo ? 'on' : 'off')
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
          ? (currentWorkspaceId() === '' ? '正在准备…' : '正在开一场新的')
          : '在的，说吧'))
        return hero
      }

      /**
       * 进来就自己开一场 (2026-11-09 主人: "不需要用户手动点击开一场, 新界面里自动开始新对话")
       *
       * **只试一次**: 后面那条 15 s 的补试由 [landInDefaultWorkspace] 自己排 (只一次), 这里再重试
       * 只会把提示刷掉。`sessionId` 已经有值就一个字节都不动 —— 那是"回来接着聊", 不是新开一场;
       * `restore()` 恢复的那一场也算有值
       *
       * 2026-11-13: 空的这一支**先落工作区再开** —— 首启 (`pm clear` 之后) 工作区列表可能是空的,
       * 那时 `startSession()` 会抛, 与其等它抛, 不如先把默认工作区备好再进去 (见 [landInDefaultWorkspace])
       */
      function autoStart() {
        if (autoStartTried) return
        autoStartTried = true
        if (typeof sessionId === 'string' && sessionId !== '') return
        if (currentWorkspaceId() === '') {
          landInDefaultWorkspace('start')
          return
        }
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
        // 点一下 = 预览窗; 长按 = 那颗菜单 (复制路径 / 用其它应用打开, 落实表 #41)
        wrap.onclick = function () {
          if (consumeHeld(wrap)) return
          openPreview({ rel: rel, name: leaf, bytes: 0 })
        }
        attachLongPress(wrap, function (at) {
          openFileMenu({ rel: rel, name: leaf, bytes: 0 }, at)
        })
        return wrap
      }

      /**
       * 会话里那张耐久图怎么拿回来 (2026-11-20)
       *
       * `ctx.uiConversation.imageUrl(sessionId, attachment)` 读 `session.readAttachment` 生成同一份
       * blob URL 并按会话缓存 (`peekImageUrl` 命中就不必等); 会话绑定释放时会回收 —— 于是取不到时
       * 这一格照实说一句, 不静默. 门户自己没有这条路时 (老宿主) 回 null / reject, 交给「（图）」兜底
       */
      function conversationFace() {
        try {
          return ctx.uiConversation && typeof ctx.uiConversation.imageUrl === 'function' ? ctx.uiConversation : null
        } catch (_noFace) {
          return null
        }
      }

      /** 已经缓存好的那张 URL (同步; 没有就 undefined) */
      function peekDurableImage(ref) {
        var face = conversationFace()
        if (face === null || typeof face.peekImageUrl !== 'function' || sessionId === null) return undefined
        try {
          return face.peekImageUrl(sessionId, ref)
        } catch (_noPeek) {
          return undefined
        }
      }

      /** 取回那一张 (异步; 失败 reject) */
      function loadDurableImage(ref) {
        var face = conversationFace()
        if (face === null || sessionId === null) return Promise.reject(new Error('no conversation face'))
        return face.imageUrl(sessionId, ref)
      }

      /**
       * 一张 dsh 附件图: 先画出来再看字节, 取不到就「图没取到」
       *
       * 尺寸能从 `attachment.width/height` 拿到就先钉住比例 (解码前就有高度, 下面那条不会被顶一下);
       * 点一下 = 预览窗 (与 `/lw-out` 那条同一扇窗, 这一档直接给 blob URL, 见 [openPreview])
       * @param {object} ref `imageAttachmentsOf` 的一项
       */
      function durableImageBubble(ref) {
        var wrap = h('div', 'lwp-image')
        wrap.setAttribute('data-source', 'attachment')
        var img = document.createElement('img')
        img.alt = ''
        if (ref.width > 0 && ref.height > 0) {
          img.width = ref.width
          img.height = ref.height
          img.style.aspectRatio = String(ref.width) + ' / ' + String(ref.height)
        }
        if ('decoding' in img) img.decoding = 'async'
        /** 画上这张 src; 之前说过「没取到」就把那句话换掉 */
        var paint = function (url) {
          if (typeof url !== 'string' || url === '') return false
          if (!wrap.contains(img)) {
            wrap.textContent = ''
            wrap.appendChild(img)
          }
          wrap.removeAttribute('data-broken')
          img.src = url
          settleDecode(img)
          var leaf = ref.name === '' ? '图片' : ref.name
          wrap.onclick = function () {
            openPreview({ src: url, name: leaf })
          }
          return true
        }
        var broke = function () {
          wrap.setAttribute('data-broken', 'on')
          wrap.textContent = '图没取到'
          wrap.onclick = null
        }
        img.onerror = function () { broke() }
        wrap.appendChild(img)
        var cached = peekDurableImage(ref)
        if (cached !== undefined) paint(cached)
        settle(function () { return loadDurableImage(ref) }).then(function (url) {
          if (!paint(url)) broke()
        }).catch(function () { broke() })
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
        // 点一下 = 预览窗, 长按 = 那颗菜单 (落实表 #41: 复制路径 / 用其它应用打开)
        wrap.onclick = function () {
          if (consumeHeld(wrap)) return
          openPreview(file)
        }
        attachLongPress(wrap, function (at) { openFileMenu(file, at) })
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
        // `src` 那一档 (2026-11-20): dsh 附件图是会话绑定的 blob URL, 不走 `/lw-out` 那条路由
        var src = String(file && file.src ? file.src : '')
        var name = String(file && file.name ? file.name : (src === '' ? '文件' : '图片'))
        var bytes = Number(file && file.bytes ? file.bytes : 0)
        els.previewName.textContent = name
        els.previewBody.textContent = ''
        // 上一份可能是 Office (那一档会改内边距); 换一档就把它摘掉
        els.previewBody.removeAttribute('data-kind')
        if (src !== '') {
          var shown = document.createElement('img')
          shown.alt = ''
          shown.src = src
          shown.onerror = function () {
            els.previewBody.textContent = ''
            els.previewBody.appendChild(h('div', 'lwp-preview-note', '这张图现在取不到'))
          }
          els.previewBody.appendChild(shown)
          els.previewBody.setAttribute('data-kind', 'image')
        } else if (rel === '') {
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
      function historyRows(snapshot, query, currentId, scope) {
        var byId = snapshot && typeof snapshot === 'object' && snapshot.byId ? snapshot.byId : {}
        var ids = Object.keys(byId)
        var needle = String(query === undefined || query === null ? '' : query).trim().toLowerCase()
        /** 只有搜索框空着时才把当前那场钉在最前 */
        var pinCurrent = needle === ''
        // 2026-11-21 终端: 影子根底下的那些是"电脑那几场", 两端互不串.
        // 没给 shadowRoot 时不做任何过滤 (老调用方 / 老读数一个字节不变)
        var root = scope && typeof scope.shadowRoot === 'string' ? scope.shadowRoot : ''
        var terminalOnly = !!(scope && scope.mode === 'terminal')
        var rows = []
        for (var i = 0; i < ids.length; i += 1) {
          var summary = byId[ids[i]]
          if (!summary || typeof summary !== 'object') continue
          var id = typeof summary.id === 'string' && summary.id !== '' ? summary.id : String(ids[i])
          var current = id === currentId
          var blank = summary.blank === true
          if (blank && !current) continue
          if (root !== '') {
            var onPeer = underShadow(summary.cwd, root)
            if (terminalOnly !== onPeer) continue
          }
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
        // 终端里只列电脑那几场 (最近的那些), 普通模式下把那些排除掉 (2026-11-21)
        var rows = terminalMode
          ? terminalRows(snapshot, historyQuery, sessionId, terminalRoot(), TERMINAL_HISTORY_MAX)
          : historyRows(snapshot, historyQuery, sessionId, { mode: 'all', shadowRoot: terminalRoot() })
        els.historyList.textContent = ''
        if (rows.length === 0) {
          els.historyList.appendChild(h('div', 'lwp-history-empty', historyQuery.trim() === ''
            ? (terminalMode ? '电脑那边还没有对话' : '还没有历史对话')
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
        // 终端里那一窗是"电脑上的对话", 底部那颗按钮建出来的是与电脑连的一场 (2026-11-21)
        if (els.historyTitle) els.historyTitle.textContent = terminalMode ? '电脑上的对话' : '历史对话'
        if (els.historyNew) {
          els.historyNew.textContent = terminalMode ? '在电脑上开一场新对话' : '开始新的对话'
        }
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
          showNote('这一场现在打不开, 稍后再试', true)
        }
      }

      /* ── 默认工作区: 静默备好再落进去 (2026-11-13, 原「选工作区」口径作废) ──────────
       *
       * 首启 / `pm clear` 之后 dsh 那一边可能一个工作区都还没有, 而这一层盖住了它整个界面 ——
       * 原来这里摆一颗「选工作区」让人点, 主人 2026-11-13 改成**直接默认使用 `<工作区根>/Luwi`**:
       * 一条都没有时就请应用把那条目录备好 (桥上的 `portalWorkspace(true)`), 再让 dsh 认它
       * (`workspaces.create({path})`, 幂等 —— 已注册就把原来那条还回来)。**不走 `initializeDefault`**:
       * dsh 自己那条首启缺省工作区落在 `<系统 Documents>` 下, 安卓上必失败
       * (`system Documents directory is unavailable`)
       */

      /** `<工作区根>/Luwi` 的绝对路径 (应用三档解析出来的那一份; 问一次就缓存, 重挂时清掉再问) */
      function wantWorkspacePath() {
        if (wantPathCache !== null) return wantPathCache
        var made = call('portalWorkspace', false)
        wantPathCache = made && typeof made.path === 'string' ? made.path : ''
        return wantPathCache
      }

      /** 这一屏认得的工作区里默认那个 (`Luwi` 按路径优先, 退列表第一条; 空表回空串) */
      function currentWorkspaceId() {
        return defaultWorkspaceId(workspaceItems(), wantWorkspacePath())
      }

      /**
       * 把默认工作区备好, 再按列表给出它的 id
       *
       * 列表里已经有就直接用; 没有才请应用建目录 -> `workspaces.create({path})` -> 250 ms × 12 拍
       * 等列表出现 (订阅漏了事件时这是唯一的兜底) -> 按路径再认一次
       * @param {(id: string) => void} done id 为空串表示这一趟没成 (原因已写进一行提示)
       */
      function ensureWorkspace(done) {
        var ready = currentWorkspaceId()
        if (ready !== '') {
          done(ready)
          return
        }
        var made = call('portalWorkspace', true)
        var path = made && typeof made.path === 'string' ? made.path : ''
        if (path === '' || made.exists !== true) {
          showNote('工作区目录没建起来', true)
          done('')
          return
        }
        // 这一趟问出来的就是"默认那个", 记下来让后面的按路径认也用这一份
        wantPathCache = path
        var tries = 0
        function wait() {
          var id = defaultWorkspaceId(workspaceItems(), path)
          if (id !== '') {
            done(id)
            return
          }
          tries += 1
          if (tries >= 12) {
            showNote('没等到工作区列表', true)
            done('')
            return
          }
          setTimeout(wait, 250)
        }
        var service = workspaceService()
        if (!service || typeof service.create !== 'function') {
          // 服务还没挂上 (它比这一层晚到过): 一样走补拍, 列表一出现就落进去
          wait()
          return
        }
        var pending = null
        try {
          pending = service.create({ path: path })
        } catch (error) {
          showNote('工作区没建起来: ' + describeError(error), true)
          done('')
          return
        }
        if (!pending || typeof pending.then !== 'function') {
          wait()
          return
        }
        pending.then(wait, function (error) {
          showNote('工作区没建起来: ' + describeError(error), true)
          done('')
        })
      }

      /**
       * 自动落进默认工作区 (2026-11-13)
       *
       * 首启 / 这一场落不下去时唯一的入口: 备好 -> 落进去, **全程不弹任何窗**。没成只留一句提示,
       * 并排一次 15 s 的补试 (只一次; 之后由账本 / 会话表推着走)
       * @param {string} from 谁触发的 (start / retry / again / back, 只进日志)
       */
      function landInDefaultWorkspace(from) {
        if (entering) return
        ensureWorkspace(function (id) {
          if (id === '') {
            if (landRetryTimer === null) {
              landRetryTimer = setTimeout(function () {
                landRetryTimer = null
                if (typeof sessionId === 'string' && sessionId !== '') return
                landInDefaultWorkspace('again')
              }, 15000)
            }
            return
          }
          console.log('[luwi-portal] landing in the default workspace (' + from + ')')
          enterWorkspace(id)
        })
      }

      /**
       * 切到某个工作区并落进它的一场 (2026-11-13 起只有自动落位在调, 不再由人点)
       *
       * `openWorkspace` 自己会复用 / 新建一张空白草稿并把它挂到 dsh 的 mainView 上, 所以这里
       * 只等 `currentSessionId()` 落到那一场 (与 [newConversation] 同一套 150 ms × 24 次);
       * 落到就 `switchTo(id, 'new')` + `portalBind` + 15 s 不跟账本 —— 三件都做完, 下一句话
       * 才发得出去、才不会被账本拽走。打不开只留一句话, **不弹任何窗**
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
            showNote('没开出来, 稍后自动再试', true)
            return
          }
          setTimeout(look, 150)
        }
        function landIn(id) {
          entering = false
          // 自动落位这一条也要让 dsh 的 mainView 一起过去 (source 'new' 自带 align)
          switchTo(id, 'new')
          call('portalBind', id)
          ledgerHoldUntil = Date.now() + 15000
          renderMeta()
          renderFlow()
        }
        setTimeout(look, 150)
      }

      /**
       * 底部那颗「开始新的对话」
       *
       * **2026-11-19 起这是新对话的两条入口之一** (另一条是首启的 [autoStart]): 头栏那颗头像
       * 改去开历史窗了, 所以"开一场新的"收敛到这一颗 —— 先关窗, 再走 [newConversation]
       */
      function startFromHistory() {
        closeHistory()
        // 2026-11-21 终端: 这一颗在终端里建的是**与电脑连的那一场** (影子工作区里的新会话),
        // 不是本地那场普通对话
        if (terminalMode) {
          terminalNew()
          return
        }
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

      /* ── 长按文件那颗菜单 (落实表 #41, 2026-11-13) ───────────────────────────────
       *
       * 主人: "在前台里, 如果有文件, 比如 doc/ppt/jpg 等, 允许长按出菜单, 可选复制路径, 用其它应用打开"
       *
       * 点一下仍然是预览 (2026-11-09 的那条); 长按多出来的只是这两件事 —— **路径从桥上来**,
       * 页面手里只有 `assets/<id>/<名字>` 与 `in/<名字>` 两种相对路径 (见 `PortalBridge.portalAbsPath`)
       */

      /** 按住多久算长按 (与发送钮那条 550 ms 同一档, 取略短: 文件上按下去有回显, 晚了像没反应) */
      var LONG_PRESS_MS = 520

      /** 手指挪出这么多 px 就不算长按 (在对话流里滑动时不能弹菜单) */
      var LONG_PRESS_SLOP = 10

      /** 挪出多远算"这不是一下按住" (平方比, 省一次开方) */
      function pressMoved(dx, dy) {
        return dx * dx + dy * dy > LONG_PRESS_SLOP * LONG_PRESS_SLOP
      }

      /**
       * 把一颗元素接上长按
       *
       * 四条退路都要接: 抬手 / 指针被系统收走 / 手指挪出这一块 / 挪出这个距离 —— 少一条就会出现
       * "滑一下对话流, 菜单冒出来"。另外 Android WebView 对图的长按还会送一条 `contextmenu`
       * (那张"保存图片"的原生菜单), 一并吞掉
       *
       * @param el 接长按的那一块 (文件 chip 或一张图)
       * @param handler 到点时调一次, 参数是按下那一点的 `{x, y}` (菜单就弹在那儿)
       */
      function attachLongPress(el, handler) {
        var timer = null
        var from = null
        function drop() {
          if (timer !== null) {
            clearTimeout(timer)
            timer = null
          }
          from = null
          if (el.removeAttribute) el.removeAttribute('data-held')
        }
        el.addEventListener('pointerdown', function (event) {
          if (event && typeof event.button === 'number' && event.button !== 0) return
          // 这一下按下去就重新算: 上一次长按若没等到 click (手抬到外面去了), 残留的标记不能吞掉这一次
          el.__lwHeld = false
          drop()
          from = { x: Number(event.clientX) || 0, y: Number(event.clientY) || 0 }
          timer = setTimeout(function () {
            timer = null
            el.__lwHeld = true
            if (el.setAttribute) el.setAttribute('data-held', 'on')
            handler(from)
          }, LONG_PRESS_MS)
        })
        el.addEventListener('pointermove', function (event) {
          if (from === null || timer === null) return
          if (pressMoved(Number(event.clientX) - from.x, Number(event.clientY) - from.y)) drop()
        })
        el.addEventListener('pointerup', function () { drop() })
        el.addEventListener('pointercancel', function () { drop() })
        el.addEventListener('pointerleave', function () { drop() })
        el.addEventListener('contextmenu', function (event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
        })
        return el
      }

      /**
       * 这一颗刚才是"长按"吗
       *
       * 长按抬手之后浏览器照样会补一条 `click`, 若不吞掉就会"菜单弹出来的同时预览窗也张开了"
       */
      function consumeHeld(el) {
        if (!el || el.__lwHeld !== true) return false
        el.__lwHeld = false
        return true
      }

      /**
       * 菜单往哪儿放: 手指那一点起, 但整块夹进视口
       *
       * `fixed` 的 left/top 是视口坐标, 手指点在最右边那一份文件上时菜单会有一半在屏外 ——
       * 所以先按手指放, 放不下就贴边 (留 8px)
       */
      function clampMenuPos(x, y, w, h, vw, vh) {
        var margin = 8
        var maxLeft = vw - w - margin
        var maxTop = vh - h - margin
        var left = Math.max(margin, Math.min(x, maxLeft))
        var top = Math.max(margin, Math.min(y, maxTop))
        return { left: left, top: top }
      }

      /** 菜单里那一行 (整行都能点, 与预设菜单同一个手感) */
      function fileMenuItem(label, onPick) {
        var item = h('button', 'lwp-file-menu-item', label)
        item.type = 'button'
        item.setAttribute('role', 'menuitem')
        item.onclick = function () { onPick() }
        return item
      }

      /** 收起那颗菜单 (点空白 / 选了其中一条 / 换一份文件 / 下线时都走这里) */
      function closeFileMenu() {
        menuFile = null
        if (els.fileMenu) els.fileMenu.hidden = true
      }

      /**
       * 菜单要说的是哪一份, 以及那两条能不能点
       *
       * 行里没有 `rel` 的那一份 (旧行 / 坏行) 两个动作都不成立: 菜单照弹, 但只写一句"没有留下路径",
       * 而不是把按钮画上再点出一句错
       */
      function fileMenuPlan(file) {
        var rel = String(file && file.rel ? file.rel : '')
        var name = String(file && file.name ? file.name : '文件')
        return {
          rel: rel,
          name: name,
          bytes: Number(file && file.bytes ? file.bytes : 0),
          known: rel !== ''
        }
      }

      /**
       * 长按一份文件之后弹菜单
       *
       * @param file `{rel, name, bytes}` (与她说过的那份行同形)
       * @param at 按下那一点 `{x, y}` (视口坐标)
       */
      function openFileMenu(file, at) {
        if (!els.fileMenu) return
        var plan = fileMenuPlan(file)
        // 菜单与预设菜单 / 表情面板互斥: 那两块都从输入卡上弹, 同时开着会叠在一起
        closeMenu()
        closeStickerPanel()
        closePreview()
        closeHistory()
        menuFile = { rel: plan.rel, name: plan.name, bytes: plan.bytes }
        els.fileMenuName.textContent = plan.name
        els.fileMenuNote.hidden = plan.known
        els.fileMenuCopy.hidden = !plan.known
        els.fileMenuOpen.hidden = !plan.known
        els.fileMenu.hidden = false
        // 量一次尺寸再落位: 先藏起来量 (visibility 不影响布局), 免得先在左上角闪一帧
        els.fileMenu.style.visibility = 'hidden'
        var box = els.fileMenu.getBoundingClientRect()
        var vw = window.innerWidth || 0
        var vh = window.innerHeight || 0
        var spot = clampMenuPos(
          Number(at && at.x) || 0,
          Number(at && at.y) || 0,
          box.width,
          box.height,
          vw,
          vh
        )
        els.fileMenu.style.left = String(spot.left) + 'px'
        els.fileMenu.style.top = String(spot.top) + 'px'
        els.fileMenu.style.visibility = ''
      }

      /**
       * 复制这一份的绝对路径
       *
       * 复制走应用那一侧 (`portalCopyPath`): WebView 里 `navigator.clipboard` 要有焦点、要算用户
       * 手势, 长按菜单点下来这一下不是每次都算数; 系统剪贴板才是一定成的那条
       */
      function copyFilePath() {
        var file = menuFile
        closeFileMenu()
        if (!file || file.rel === '') {
          showNote('这一份没有留下路径', true)
          return
        }
        var got = call('portalCopyPath', file.rel)
        if (!got || got.ok !== true) {
          showNote(got && got.error ? String(got.error) : '复制不了这条路径', true)
          return
        }
        showNote('已复制路径: ' + String(got.path))
      }

      /** 菜单第二条: 交给系统里接这个类型的那个应用 (与预览窗那颗按钮同一条窄通道) */
      function openFileWithSystem() {
        var file = menuFile
        closeFileMenu()
        if (!file) return
        openWithSystem(file.rel)
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
        // 这一趟是给表情包挑的 (2.8.1 #13): 宿主照这个说法把 Uri 原样交回 `change`, 一个字节都不读 ——
        // 加表情走的是 `lw/stickers` 那份 base64, 不是 `+` 那条 `lw-in/`
        call('portalPickMode', 'sticker')
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
          // dsh 那边发的图 (2026-11-20): 身份里带 attachmentId, 图块补上那一拍这一行才会重建
          item.images && item.images.length > 0
            ? item.images.map(function (one) { return String(one.attachmentId || '') }).join(',')
            : '',
          item.hasImage ? '1' : '', item.fallback ? '1' : '',
          // 有四行诊断才画「复制诊断」, 这一位也进身份: 少了它, 诊断补上那一拍不会重建那一行
          item.diag ? '1' : '',
          // 本机占位那一行 (2.8.1 #33): 它变成真的那条时身份也换了, 那一行才重画一次
          item.pending ? '1' : '',
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
        // 一句气泡从哪条信号来的 (2.8.1 #31): 值就是 `meta.topicSource`, 老行没有这一格就不写
        if (item.meta && item.meta.topicSource) row.setAttribute('data-topic', item.meta.topicSource)
        // 这一句引的是哪条记忆 (2026-11-20, 方案 §8.3): 值就是 `meta.memoryRef` —— 排障时顺着它
        // 去 `lw/memory/episodes.jsonl` 查原话
        if (item.meta && item.meta.memoryRef) row.setAttribute('data-ref', item.meta.memoryRef)
        // 本机占位那一行 (2.8.1 #33): 还欠 dsh 一条落盘的 user 节点, 画淡一点 —— 人一眼看得出"还在送"
        if (item.pending) row.setAttribute('data-pending', 'on')
        if (item.who === 'user' && item.hasImage && !(item.attach && item.attach.length > 0)) {
          // 有图块却一份落盘都没有 (stash 失败 / 旧消息): 补一行「（图）」, 不假装贴过也不整条丢掉
          // (后台 dsh 发的那种落盘只剩 attachmentId, 有 attach 或有引用时走下面那一支画真图)
          var lostOnly = h('div', 'lwp-image', '（图）')
          lostOnly.setAttribute('data-broken', 'on')
          row.appendChild(lostOnly)
          if (item.text !== '') row.appendChild(h('div', 'lwp-bubble', item.text))
        } else if (item.who === 'user') {
          // user 那一侧: 话在上, 附件在下 (2026-11-09 的口径不变); 附件两路并存 ——
          // ① 门户 `+` 发的图与文件 (字节落在工作区 `lw-in/`, 名字在正文那一段里)
          // ② 后台 dsh 那边发的图 (落盘只剩 attachmentId, 走 [durableImageBubble] 取真图) (2026-11-20)
          if (item.text !== '') row.appendChild(h('div', 'lwp-bubble', item.text))
          var drew = false
          var listed = Array.isArray(item.attach) ? item.attach : []
          for (var a = 0; a < listed.length; a += 1) {
            var attached = listed[a]
            if (isImageName(attached)) {
              row.appendChild(imageBubble({ image: 'in/' + encodeURIComponent(attached) }))
            } else {
              row.appendChild(fileChip({ rel: 'in/' + encodeURIComponent(attached), name: attached }, 'in'))
            }
            drew = true
          }
          var refs = Array.isArray(item.images) ? item.images : []
          var shownRefs = 0
          for (var r = 0; r < refs.length && shownRefs < MAX_DURABLE_IMAGES; r += 1) {
            row.appendChild(durableImageBubble(refs[r]))
            shownRefs += 1
            drew = true
          }
          if (refs.length > shownRefs) {
            row.appendChild(h('div', 'lwp-bubble', '+' + String(refs.length - shownRefs) + ' 张图'))
          }
          // 有图块却一条引用都没有 (旧消息 / stash 失败): 补一行「（图）」, 不假装贴过也不整条丢掉
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
        } else if (item.fail) {
          // 图片发送失败那一泡 (2.8.1 #1): 气泡右侧多一颗「复制诊断」—— 四行 (机型 / Android /
          // WebView / 图片) 一点就进剪贴板, 与失败那一刻 logcat 上那四行逐字同一份
          // **按钮总在**: 诊断没取到也要让人点得着 (点了会照实说一句), 而不是静悄悄地少一块
          var failRow = h('div', 'lwp-fail')
          failRow.appendChild(h('div', 'lwp-bubble', item.text))
          var diagButton = h('button', 'lwp-diag', '复制诊断')
          diagButton.type = 'button'
          diagButton.onclick = function () { copyImageDiag(item.id) }
          failRow.appendChild(diagButton)
          row.appendChild(failRow)
        } else {
          // 她那一侧 (assistant 兜底行 / 老行): 2026-11-22 起正文里的附件段也拆出来 ——
          // 电脑那边折回来的文件会走这一段, 主人要的是"话在上、文件在下"
          if (item.text !== '') row.appendChild(h('div', 'lwp-bubble', item.text))
          var extra = Array.isArray(item.attach) ? item.attach : []
          for (var x = 0; x < extra.length; x += 1) {
            var attachedName = extra[x]
            if (isImageName(attachedName)) {
              row.appendChild(imageBubble({ image: 'in/' + encodeURIComponent(attachedName) }))
            } else {
              row.appendChild(fileChip({ rel: 'in/' + encodeURIComponent(attachedName), name: attachedName }, 'out'))
            }
          }
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
        // 终端里还没落到电脑那一场: 门户的对话一格都不上屏 (2026-11-21 主人原话) ——
        // `openTerminal` 到 `terminalEnter` 落场之间有几百毫秒 (离线时是整个门牌期), 那一段 `sessionId`
        // 还是门户那一场, 照常画就等于把"我的对话"贴在黑底上; 落到电脑那一场之后签名一变自己重画
        if (terminalMode && !isTerminalSession(sessionId)) {
          if (flowSig !== TERMINAL_HIDDEN_SIG) {
            resetFlow()
            flowSig = TERMINAL_HIDDEN_SIG
          }
          return
        }
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
        // 终端那身皮上的"落到电脑那一场没有"跟着每一次重画对一次 (见 [markTerminalSession]):
        // 终端里的对话该不该上屏就认这个记号, `renderFlow` 的闸也在同一拍里读它
        markTerminalSession()
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

      /**
       * 顶上那颗提示 (2.8.1 #12 主人: "点击开始这一趟和刷新没有反馈, 需要加上toast反馈")
       *
       * 与 `showNote` 的差别只有落点: 那一行在输入卡里, 抽屉开着时被压在下面; 这一颗是 root 的子元素,
       * 抽屉与预览窗都是它的兄弟 —— 所以面板里的动作一律用它回执。2.4 s 后自己收, 连点只留最后一句
       *
       * @param text 要说的那一句
       * @param isError true 时按错误色写 (没投出去 / 桥不在)
       */
      function toast(text, isError) {
        if (!els.toast) return
        els.toast.textContent = text === undefined || text === null ? '' : String(text)
        els.toast.setAttribute('data-error', isError === true ? 'on' : 'off')
        els.toast.hidden = els.toast.textContent === ''
        if (toastTimer !== null) clearTimeout(toastTimer)
        toastTimer = null
        if (els.toast.hidden) return
        toastTimer = setTimeout(function () {
          toastTimer = null
          if (els.toast) {
            els.toast.textContent = ''
            els.toast.hidden = true
            els.toast.setAttribute('data-error', 'off')
          }
        }, 2400)
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
        // 缺省那张脸 (2026-11-22): 它也有自己的缓存键, 与背景 / 头像同一个套路 —— 换套才搬一次图。
        // 不把它算进"要不要 full"这一条, 没配背景也没配头像的机器就永远是读数那一份, mark 永远是空
        var markVer = typeof meta.markVer === 'string' ? meta.markVer : ''
        var cachedWall = ver === '' ? null : readStored(WALL_CACHE)
        var cachedAvatar = avatarVer === '' ? null : readStored(AVATAR_CACHE)
        var cachedMark = markVer === '' ? null : readStored(MARK_CACHE)
        var wallReady = cachedWall && cachedWall.ver === ver && typeof cachedWall.url === 'string'
          && cachedWall.url !== ''
        var avatarReady = cachedAvatar && cachedAvatar.ver === avatarVer
          && typeof cachedAvatar.url === 'string' && cachedAvatar.url !== ''
        var markReady = cachedMark && cachedMark.ver === markVer
          && typeof cachedMark.url === 'string' && cachedMark.url !== ''
        if (ver !== '') meta.wall = wallReady ? cachedWall.url : ''
        if (avatarVer !== '') meta.avatar = avatarReady ? cachedAvatar.url : ''
        if (markVer !== '') meta.mark = markReady ? cachedMark.url : ''
        if ((ver !== '' && !wallReady) || (avatarVer !== '' && !avatarReady) || (markVer !== '' && !markReady)) {
          var full = call('portalLook', true)
          if (full && typeof full.wall === 'string') meta.wall = full.wall
          if (full && typeof full.avatar === 'string') meta.avatar = full.avatar
          if (full && typeof full.mark === 'string') meta.mark = full.mark
          if (full && typeof full.markVer === 'string') meta.markVer = full.markVer
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
        // 缺省那张脸 = 设置 -> 外观里挑的那套图标 (2026-11-22): 页面内嵌的 MARK_PNG 降成最后兜底,
        // 于是主人换了图标之后, 头栏、空态与终端页一起换
        var markVer = typeof data.markVer === 'string' ? data.markVer : ''
        var mark = typeof data.mark === 'string' ? data.mark : ''
        if (markVer !== '') {
          var cachedMark = readStored(MARK_CACHE)
          if (!mark && cachedMark && cachedMark.ver === markVer) mark = cachedMark.url
          if (mark) writeStored(MARK_CACHE, { ver: markVer, url: mark })
        }
        if (mark === '') mark = MARK_PNG
        // 2026-11-21 终端: 这一页里名字与头像**强制**——外观里改过的昵称与自选头像都不进终端
        // (主人: "头像强行改成luwi头像, 名称强行改成「luwi终端」")
        if (terminalMode) {
          name = TERMINAL_TITLE
          avatar = ''
        }
        var src = avatar === '' ? mark : avatar
        // 「这张脸是不是自选的图」只在这里算一次, 而且**排在终端那一段清空 `avatar` 之后** ——
        // 终端页清空之后必然 `false`, 那圈描边于是进不了终端 (2026-11-22)
        var photo = avatar !== ''
        if (els.brandName) els.brandName.textContent = name
        if (els.markImg) els.markImg.src = src
        // 空态那张脸是"重新画一遍"的: 它只在没有消息时存在, 所以这里顺手把已经画着的那张也改掉
        if (els.heroName) els.heroName.textContent = name
        if (els.heroImg) els.heroImg.src = src
        if (els.heroMark) els.heroMark.setAttribute('data-photo', photo ? 'on' : 'off')
        identity = { name: name, avatar: src, photo: photo }
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
      /** 正在把哪一场的模型拨回宿主默认 (避开同一场连着叫几遍, 见 [followDefaultModel]) */
      var modelDefaultPending = null
      /** 上一次已经问过宿主默认的那一档 (id + provider/model/effort), 同一档不再问第二遍 */
      var modelDefaultChecked = ''
      /** 目录订阅: 目录一响 chip 就跟着改 (见 [watchModelDirectory]) */
      var modelDirSource = null
      var modelDirUnsub = null
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

      /**
       * 目录一响就跟着改 (2026-11-20): 门户原来只在 `loadModel` 那一拍取一次快照, 于是这一场里
       * 别处换了模型 (原生界面 / 拨默认) 之后 chip 会停在旧名字 —— 现在挂在目录的 store 上,
       * 它一变就重画, 并再判一次"空白场要不要跟默认"
       * @param {string|null} id 订阅所属的那一场 (换场之后旧订阅一律不再动手)
       */
      function watchModelDirectory(id) {
        if (modelDirSource === modelDirectory) return
        if (modelDirUnsub !== null) {
          try { modelDirUnsub() } catch (_noUnsub) { /* 订阅已经不在了, 无所谓 */ }
          modelDirUnsub = null
        }
        modelDirSource = modelDirectory
        if (modelDirectory === null || typeof modelDirectory.store.subscribe !== 'function') return
        try {
          modelDirUnsub = modelDirectory.store.subscribe(function () {
            if (sessionId !== id || modelDirectory === null) return
            modelState = modelDirectory.store.getSnapshot()
            renderModel()
            followDefaultModel()
          })
        } catch (_noSubscribe) {
          modelDirUnsub = null
        }
      }

      function loadModel() {
        if (sessionId === null) {
          modelDirectory = null
          modelState = null
          watchModelDirectory(null)
          renderModel()
          return
        }
        var service = modelService()
        if (!service || typeof service.directoryFor !== 'function') {
          modelDirectory = null
          modelState = null
          watchModelDirectory(null)
          renderModel()
          return
        }
        try {
          modelDirectory = service.directoryFor(sessionId)
        } catch (_noDirectory) {
          modelDirectory = null
        }
        watchModelDirectory(sessionId)
        if (modelDirectory === null) {
          modelState = null
          renderModel()
          return
        }
        settle(function () { return modelDirectory.load() }).then(function (state) {
          modelState = state
          renderModel()
          // 空白场跟宿主默认 (2026-11-20): 换场 / 新建 / 投影后到都会走到这里
          followDefaultModel()
        }).catch(function () {
          modelState = null
          renderModel()
        })
      }

      /**
       * 空白场要不要把模型拨回宿主默认 (2026-11-20 主人: "我在门户里改的模型要作为默认模型,
       * 新开会话都要用门户中设置的模型")
       *
       * 只回答"拨不拨": 非空白场**永远不拨** (那一场自己选过的模型归它自己); 两边缺一个都不拨;
       * 已经一致也不拨. 纯函数, 判据 `check-luwi-portal.mjs` 抽出来真跑
       * @param {object|null} current 这一场现在那份 `{provider, model, reasoningEffort?}`
       * @param {object|null} hostDefault 宿主 `modelCatalog().default`
       * @param {boolean} blank 这一场是不是还没发过话
       * @returns {boolean} true = 把默认拨给这一场
       */
      function blankModelNeedsDefault(current, hostDefault, blank) {
        if (blank !== true) return false
        if (current === null || current === undefined) return false
        if (hostDefault === null || hostDefault === undefined) return false
        if (typeof hostDefault.provider !== 'string' || typeof hostDefault.model !== 'string') return false
        if (typeof current.provider !== 'string' || typeof current.model !== 'string') return false
        if (current.provider !== hostDefault.provider) return true
        if (current.model !== hostDefault.model) return true
        var was = current.reasoningEffort === undefined ? '' : String(current.reasoningEffort)
        var want = hostDefault.reasoningEffort === undefined ? '' : String(hostDefault.reasoningEffort)
        return was !== want
      }

      /**
       * 空白场把模型拨回宿主默认 (见 [blankModelNeedsDefault])
       *
       * **只对空白场做**, 同一场一次只跑一趟 (`modelDefaultPending` 就是那道闸, 换场 / 投影后到 /
       * 拨完再 load 会连着叫几遍); 拿不到默认、拨不动都安静收手 —— chip 维持现状, 不编造
       */
      function followDefaultModel() {
        var id = sessionId
        if (id === null || modelState === null || modelDirectory === null) return
        if (modelDefaultPending === id) return
        var summary = summaryOf(id)
        if (!summary || summary.blank !== true) return
        var current = modelState.current
        var key = id + '\u0001' + (current
          ? String(current.provider) + '/' + String(current.model) + '/'
            + (current.reasoningEffort === undefined ? '' : String(current.reasoningEffort))
          : '')
        // 这一档已经问过一遍了 (拨回之后 current 会变, key 也就变了, 于是只多问那一次)
        if (modelDefaultChecked === key) return
        var remote = remoteOf()
        if (remote === null) return
        modelDefaultChecked = key
        modelDefaultPending = id
        settle(function () { return remote.session.modelCatalog() }).then(function (result) {
          if (modelDefaultPending === id) modelDefaultPending = null
          if (id !== sessionId) return
          if (!result || result.ok === false || !result.value) {
            // **不静默**: 拿不到宿主默认就说明白, 否则"新会话还是老模型"只能靠猜
            var why = result && result.error ? String(result.error.message || result.error.code) : 'no catalog'
            console.log('[luwi-portal] model default unavailable: ' + why)
            return
          }
          if (!blankModelNeedsDefault(modelState && modelState.current, result.value.default, true)) return
          return settle(function () { return modelDirectory.select(result.value.default) }).then(function (picked) {
            if (picked && picked.ok === false) {
              var refused = picked.error && picked.error.message ? picked.error.message : 'select refused'
              console.log('[luwi-portal] model default not applied: ' + String(refused))
              return
            }
            loadModel()
          })
        }).catch(function (error) {
          if (modelDefaultPending === id) modelDefaultPending = null
          console.log('[luwi-portal] model default check failed: ' + String(error && error.message ? error.message : error))
        })
      }

      /** dsh 的 remote 面 (取宿主默认模型用; 没有就 null) */
      function remoteOf() {
        try {
          return ctx.remote && ctx.remote.session ? ctx.remote : null
        } catch (_noRemote) {
          return null
        }
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


      // ── 语音 (2026-11-20 主人给的三张官方手机端截图) ─────────────────────────────
      //
      // 两件互不相干的事挤在这一段里, 别混着改:
      //
      // 1. **语音输出** = 自动朗读开关 —— 就是 设置 → 说话 → 「朗读回答」那一格
      //    (`SpeakSettings.readAloud`), 一处状态两处界面; 喇叭两副图标与两句 Toast 照图 1 / 图 2
      // 2. **语音输入** = 长按空输入框**当场开录** (没有中间态), 松手转写进草稿, 上滑取消;
      //    录音面板是那块蓝色渐变 + 一排随声音跳动的竖条 (照图 3)

      /** 自动朗读现在开着没有 (头栏那颗喇叭的图标形状与亮灯都看它) */
      var speakOn = false

      /** 头栏那颗喇叭: 两副图标 / 亮灯 / 无障碍名字一起换 */
      function applySpeakStatus(status) {
        if (!els.speakButton) return
        speakOn = !!(status && status.readAloud === true)
        els.speakButton.innerHTML = speakOn ? SPEAKER_ON_ICON : SPEAKER_OFF_ICON
        els.speakButton.setAttribute('data-on', speakOn ? 'on' : 'off')
        els.speakButton.setAttribute('aria-pressed', speakOn ? 'true' : 'false')
        var label = speakOn ? '已开启自动朗读' : '已关闭自动朗读'
        els.speakButton.title = label
        els.speakButton.setAttribute('aria-label', label)
      }

      /** 挂上来 / 从设置页回来时对一次表 (设置页那一格与这颗是同一个开关) */
      function refreshSpeak() {
        applySpeakStatus(call('portalSpeak', JSON.stringify({ op: 'status' })))
      }

      /**
       * 点一下那颗喇叭: 翻的是 设置 → 说话 里那同一个开关
       *
       * 宿主每轮念之前都会问一次 `speak op=status`, 所以**不用重启 host**, 下一轮就按新值走
       */
      function toggleSpeak() {
        var answer = call('portalSpeak', JSON.stringify({ op: 'toggle' }))
        if (answer === null || answer.ok !== true) {
          toast('这一版宿主还不支持', true)
          return
        }
        applySpeakStatus(answer)
        // 这两句与官方手机端图上那两句逐字相同
        toast(speakOn ? '已开启自动朗读' : '已关闭自动朗读')
      }

      // ── 语音输入 (长按当场开录) ───────────────────────────────────────────────
      /** `idle` / `press` / `recording` / `working` */
      var voiceState = 'idle'
      /** 这一趟的编号: 原生回推时用它认人, 换一趟就抬一格, 过期的那份直接丢 */
      var voiceId = 0
      var voiceStartedAt = 0
      var voiceTimer = null
      var voiceTicker = null
      var voiceWatch = null
      var voiceStream = null
      var voiceStreamAsk = null
      var voiceContext = null
      var voiceProcessor = null
      var voiceChunks = null
      var voiceSourceRate = 0
      /** 这一趟已经送去流式识别的块数 (数 `voiceChunks` 的条目, 每块只认一次) / 上一块送出的时刻 */
      var voiceChunkCursor = 0
      var voiceChunkAt = 0
      /** 这一趟**送出去过**几块: 送过的块会从 `voiceChunks` 里剪掉, 所以不能拿 cursor 判"走没走流式" */
      var voiceChunkSent = 0
      /** 送出去的块号: 原生日志里那个 `chunk=N` 就是它, 整场连说不重数 */
      var voiceChunkSeq = 0
      /** 最高一块已经接住的块号 (回推乱序时后到的那块丢掉, 实时层不会写重) */
      var voiceChunkSeen = 0
      /** 流式这一趟攒出来的文字 = 实时层那一份 (松手时与末段拼成草稿, 两处逐字同源) */
      var voiceLiveText = ''
      /** 实时文字层现在露着没有 (点波形 / 那颗 24px 钮翻的就是它, 录音本身一动不动) */
      var voiceLiveOn = true
      /** 宿主不认 `op=voice-chunk` 时置真: 这一趟退回"松手整段转写", 不再每 1.5 s 问一次 */
      var voiceStreamOff = false
      /** 这一段的起始时刻 (满 `VOICE_SEGMENT_MS` 就滚下一段) */
      var voiceSegmentAt = 0
      /** 末段那一块回来之后往哪儿落: `segment` = 滚下一段 / `release` = 落草稿收尾 */
      var voiceCommit = ''
      /** 长按输入框那颗计时器 (450 ms 还没抬手就是"要说话") */
      var pressTimer = null
      /** 起手那一点 (px): 手指挪过 12 px 才当"这不是长按", 真机上按住不动也会有几像素抖动 */
      var pressStartX = 0
      var pressStartY = 0
      /** 手指还按着: 要到麦克风是异步的, 抬手可能发生在流回来之前 */
      var voiceHeld = false
      /** 这一趟已经上滑到"松开就取消" */
      var recCancel = false
      /** 起手那一点的 Y: 上滑量按它算 */
      var recStartY = 0
      /** 波形那一帧的号与"这一列攒到哪儿了" */
      var recFrame = 0
      var recLastSample = 0
      /** 这一列里见过的最大峰值 (`onaudioprocess` 每拍更新) */
      var recPeak = 0
      /** 窗口内的峰值保持 (归一化的分母) */
      var recHold = 0
      /** 起落平滑后的这一列电平 (快起慢落) */
      var recShown = 0
      /** 走带历史: 从旧到新, 最多 `REC_COLS` 列 */
      var recHist = []
      /** 缓存的竖直渐变 (尺寸变了才重建) */
      var recGradient = null
      var recGradientHeight = 0
      /** 面板上那两句提示 (图 3 的「松手发送，上滑取消」; 这一层松手是"进草稿", 所以照实写) */
      var REC_HINT = '松手转写，上滑取消'
      var REC_HINT_CANCEL = '松开取消'
      var REC_HINT_BUSY = '正在转写…'
      /** 上滑多少像素算取消 */
      var REC_CANCEL_PX = 56
      /** 录音条的高度 = 输入卡实测高 × 这个倍数 (主人 2026-11-20: "比输入框高1.5倍即可") */
      var REC_PANEL_RATIO = 1.5
      var REC_PANEL_FALLBACK = 148
      var REC_PANEL_MIN = 120
      var REC_PANEL_MAX = 210

      /** 蓝色录音面板升起来 (长按 450 ms 那一刻) */
      function showRecPanel() {
        recCancel = false
        recPeak = 0
        recHold = 0
        recShown = 0
        recHist = []
        recLastSample = 0
        recGradient = null
        voiceChunkCursor = 0
        voiceChunkAt = 0
        voiceChunkSent = 0
        voiceChunkSeq = 0
        voiceChunkSeen = 0
        voiceLiveText = ''
        voiceStreamOff = false
        voiceSegmentAt = 0
        voiceCommit = ''
        fitRecPanel()
        if (els.rec) {
          els.rec.setAttribute('data-on', 'on')
          els.rec.setAttribute('data-cancel', 'off')
          els.rec.setAttribute('data-busy', 'off')
        }
        applyRecLive()
        paintRecLive('')
        if (root) root.setAttribute('data-rec', 'on')
        setRecHint(REC_HINT)
        paintRecTime()
        paintRecWave()
        // **不在这里起帧**: 这一刻 `voiceState` 还是 `press` (麦克风还没到手), 起帧会第一帧就退出、
        // 之后再也没人重画 —— 那条就这么"不动"了 (2026-11-20 主人: "那个条没有波动")
      }

      /**
       * 量一下输入卡, 把这条的高度定成它的 1.5 倍 (2026-11-20 主人: "高度改成比输入框高1.5倍即可")
       *
       * 卡片里带附件行时会更高: 一样按 1.5 倍跟, 但封顶 `REC_PANEL_MAX`, 免得表情九宫格把条顶上天
       */
      function fitRecPanel() {
        if (!els.rec) return
        var cardHeight = 0
        if (els.card && typeof els.card.getBoundingClientRect === 'function') {
          var box = els.card.getBoundingClientRect()
          cardHeight = box && isFinite(box.height) ? box.height : 0
        }
        var wanted = cardHeight > 0 ? Math.round(cardHeight * REC_PANEL_RATIO) : REC_PANEL_FALLBACK
        if (wanted > REC_PANEL_MAX) wanted = REC_PANEL_MAX
        if (wanted < REC_PANEL_MIN) wanted = REC_PANEL_MIN
        els.rec.style.height = String(wanted) + 'px'
        recGradient = null
        // 一行读数: 卡多高、条多高 (真机验收要的就是这个比例, 也方便日后查"条怎么又高了")
        console.log('[luwi-portal] rec bar ' + wanted + 'px (card ' + Math.round(cardHeight) + 'px)')
      }

      /** 帧循环: 只在真的在录的时候跑 (由 `startRecording` 的 `begin()` 拉起来) */
      function startRecPump() {
        if (recFrame !== 0) return
        var pump = function () {
          recFrame = 0
          if (voiceState !== 'recording') return
          sampleRecColumn(false)
          paintRecWave()
          paintRecTime()
          pumpVoiceChunk()
          pumpVoiceSegment()
          recFrame = requestAnimationFrame(pump)
        }
        recFrame = requestAnimationFrame(pump)
      }

      /**
       * 实时文字层露着没有 (2.8.1 #F10)
       *
       * 只写一个记号 (`data-live`), 显隐全靠 CSS —— 录音态、计时、波形一个都不看它
       */
      function applyRecLive() {
        if (!els.rec) return
        els.rec.setAttribute('data-live', voiceLiveOn ? 'on' : 'off')
        if (!els.recLiveBtn) return
        var label = voiceLiveOn ? '隐藏实时文字' : '显示实时文字'
        els.recLiveBtn.innerHTML = voiceLiveOn ? LIVE_ON_ICON : LIVE_OFF_ICON
        els.recLiveBtn.setAttribute('aria-pressed', voiceLiveOn ? 'true' : 'false')
        els.recLiveBtn.setAttribute('aria-label', label)
        els.recLiveBtn.setAttribute('title', label)
      }

      /**
       * 波形行那颗显隐钮 / 波形本身 (2026-11-20 的条 + 2.8.1 #F10 这颗钮走同一个 handler)
       *
       * **只切文字层**: 录音 / 计时 / 波形都不动, 抬手照旧落在输入框那一侧 (`stopPropagation`)
       */
      function toggleRecLive() {
        voiceLiveOn = !voiceLiveOn
        applyRecLive()
      }

      /** 波形行与那颗 24px 钮各挂一次: 点哪儿都是同一件事 */
      function wireRecLiveToggle() {
        // 同一个 handler 挂两处 (波形本身 + 那颗钮); `stopPropagation` 是必须的 —— 抬手那一路挂在
        // `window` 上, 不挡住的话点一下钮就被当成"松手", 录音当场收尾
        var onTapLive = function (event) {
          if (event && event.stopPropagation) event.stopPropagation()
          toggleRecLive()
        }
        if (els.recWave) els.recWave.addEventListener('pointerup', onTapLive)
        if (els.recLiveBtn) {
          els.recLiveBtn.addEventListener('click', onTapLive)
          // `click` 挡不住那一发 `pointerup` (它是先冒到 `window` 的): 钮里这一发单独挡下
          els.recLiveBtn.addEventListener('pointerup', function (event) {
            if (event && event.stopPropagation) event.stopPropagation()
          })
        }
      }

      /**
       * 实时层那一行字 (2.8.1 #F10)
       *
       * 只追加 (拼字在 `voiceLiveJoin`); 两行封顶之后跟着最新那一行走 —— 屏上永远是刚说出口的那几个字
       * @param text 这一次要显示的全量文字 (空串 = 清空)
       */
      function paintRecLive(text) {
        if (!els.recLive) return
        var said = typeof text === 'string' ? text : voiceLiveText
        voiceLiveText = said
        if (els.recLive.textContent !== said) els.recLive.textContent = said
        if (typeof els.recLive.scrollHeight === 'number') {
          var box = els.recLive.clientHeight || 0
          var long = box > 0 && els.recLive.scrollHeight > box + 1
          els.recLive.setAttribute('data-long', long ? 'on' : 'off')
          if (long) els.recLive.scrollTop = els.recLive.scrollHeight
        }
      }

      /** 这一趟走不走流式: 节拍开着, 宿主也认那一块, 而且真的已经送出去过 */
      function voiceStreaming() {
        return VOICE_CHUNK_MS > 0 && voiceStreamOff !== true && voiceChunkSent > 0
      }

      /**
       * 到点就把这一段**新增的** PCM 送一块去认 (实时层那一趟)
       *
       * 送 `voiceChunkCursor` 之后那几块: 每块只认一次, 不把前面的声音重复认一遍;
       * 回来的字只追加到实时层, **草稿在这一步一个字都不动**
       */
      function pumpVoiceChunk() {
        if (voiceState !== 'recording') return
        if (voiceStreamOff) return
        if (!(VOICE_CHUNK_MS > 0)) return
        if (voiceChunks === null) return
        if (voiceChunks.length <= voiceChunkCursor) return
        if (!voiceChunkDue(voiceChunkAt, Date.now(), VOICE_CHUNK_MS)) return
        sendVoiceChunk(false)
      }

      /**
       * 送一块去流式识别
       * @param fin true = 这一段到此为止 (滚段那一块 / 松手那一块)
       * @returns 真的送出去了没有 (没有新声音时 false)
       */
      function sendVoiceChunk(fin) {
        var chunks = voiceChunks
        if (chunks === null) return false
        var slice = chunks.slice(voiceChunkCursor)
        if (slice.length === 0) return false
        var wav = wavOf(slice, voiceSourceRate)
        if (wav.byteLength <= 44) return false
        voiceChunkCursor = chunks.length
        voiceChunkAt = Date.now()
        voiceChunkSeq += 1
        if (fin === true) voiceCommit = voiceState === 'recording' ? 'segment' : 'release'
        var answer = call('portalVoice', JSON.stringify({
          op: 'voice-chunk',
          id: voiceId,
          seq: voiceChunkSeq,
          final: fin === true,
          data: base64Of(wav),
          language: 'auto',
        }))
        if (answer === null || answer.ok !== true) {
          // 这一版宿主还不认这一块: 关掉流式, 松手时退回整段转写 (别每 1.5 s 空问一次)。
          // **这一趟的采样一块都不剪** —— 整段那条路还要用它们
          voiceStreamOff = true
          return false
        }
        voiceChunkSent += 1
        // 送出去的那几块不必再留着: 流式只认新增的那一截. 长按 5 分钟因此也不会把
        // 整段 48 kHz 的采样 (几百 MB) 全攒在内存里
        chunks.splice(0, voiceChunkCursor)
        voiceChunkCursor = 0
        return true
      }

      /** 一段到点了 (60 s): 先把已识别的落进草稿, 再接着录下一段 */
      function pumpVoiceSegment() {
        if (voiceState !== 'recording') return
        if (!(VOICE_SEGMENT_MS > 0)) return
        if (voiceSegmentAt <= 0) return
        if (Date.now() - voiceSegmentAt < VOICE_SEGMENT_MS) return
        commitVoiceSegment()
      }

      /**
       * 滚段 (2.8.1 #F10): 旧版到点整段作废, 现在把这一段剩下的声音送去认, 文字回来落草稿
       *
       * **录音不停** —— 面板、计时、波形一帧都不重来, 人只管接着往下说
       */
      function commitVoiceSegment() {
        voiceSegmentAt = Date.now()
        if (sendVoiceChunk(true)) return
        // 这一段后面没有再出声: 实时层已有的那份照样落草稿, 再接着录
        commitVoiceLive()
      }

      /** 把实时层已经攒出来的那份写进草稿, 实时层清空接着录下一段 */
      function commitVoiceLive() {
        var said = voiceDraftText(voiceLiveText, '')
        voiceCommit = ''
        voiceLiveText = ''
        if (said === '') return
        insertDraft(said)
        paintRecLive('')
      }

      /**
       * 流式那条路的收尾 (松手那一块回来 / 等不到回音): 实时层那份落草稿
       *
       * 草稿与实时层是**同一份文字**: 屏上最后一行与框里的字不会差一个字
       */
      function finishVoiceRecording() {
        var said = voiceDraftText(voiceLiveText, '')
        voiceCommit = ''
        voiceState = 'idle'
        if (els.rec) els.rec.setAttribute('data-busy', 'off')
        hideRecPanel()
        if (said === '') {
          toast('没有识别到内容', true)
          return
        }
        insertDraft(said)
        if (els.input) {
          try { els.input.focus() } catch (_noFocus) { /* 页还没上屏时 focus 会抛, 忽略 */ }
        }
      }

      /** 转写等太久的闸: 45 s 没回推就收摊, 实时层已有的那份先落草稿 */
      function armVoiceWatch() {
        if (voiceWatch !== null) clearTimeout(voiceWatch)
        voiceWatch = setTimeout(function () {
          voiceWatch = null
          if (voiceState !== 'working') return
          var said = voiceDraftText(voiceLiveText, '')
          voiceState = 'idle'
          hideRecPanel()
          if (said !== '') {
            insertDraft(said)
            return
          }
          toast('这一句还没回来: 再按一次试试', true)
        }, VOICE_WATCH_MS)
      }

      /** 面板落下去, 波形停 */
      function hideRecPanel() {
        recCancel = false
        recPeak = 0
        recHold = 0
        recShown = 0
        recHist = []
        recLastSample = 0
        voiceChunkCursor = 0
        voiceChunkAt = 0
        voiceChunkSent = 0
        voiceChunkSeen = 0
        voiceLiveText = ''
        voiceCommit = ''
        voiceSegmentAt = 0
        if (recFrame !== 0) {
          try { cancelAnimationFrame(recFrame) } catch (_noFrame) { /* 老 WebView */ }
          recFrame = 0
        }
        if (els.rec) {
          els.rec.setAttribute('data-on', 'off')
          els.rec.setAttribute('data-cancel', 'off')
          els.rec.setAttribute('data-busy', 'off')
        }
        if (els.recLive) {
          els.recLive.textContent = ''
          els.recLive.setAttribute('data-long', 'off')
        }
        if (root) root.setAttribute('data-rec', 'off')
        // 长按那一下关掉过的 `touch-action` 要还回去 (选区与滚动靠它)
        if (els.input) els.input.style.touchAction = ''
        clearRecWave()
      }

      /**
       * 折一列进走带历史 (每 `REC_SAMPLE_MS` 一次)
       *
       * 顺序是: 峰值保持 → 归一化 → 快起慢落 → 入历史; `force` 用来在开录 / 收尾时补一列空的
       * @param force true = 不等节拍, 立刻记一列
       */
      function sampleRecColumn(force) {
        var now = Date.now()
        if (!force && recLastSample !== 0 && now - recLastSample < REC_SAMPLE_MS) return
        if (force && recLastSample !== 0 && now - recLastSample < REC_SAMPLE_MS) return
        recLastSample = now
        recHold = recNextHold(recHold, recPeak)
        var target = recNormalise(recPeak, recHold)
        // 快起 (0.6) 慢落 (0.12): 说话时立刻抬起来, 停顿时慢慢落, 不是一根根跳
        recShown = target > recShown ? target * 0.6 + recShown * 0.4 : target * 0.12 + recShown * 0.88
        recPeak = 0
        recHist.push(recShown)
        while (recHist.length > REC_COLS) recHist.shift()
      }

      /** 右下角那一行 `0:03 / 1:00` */
      function paintRecTime() {
        if (!els.recTime) return
        var seconds = voiceStartedAt === 0 ? 0 : Math.floor((Date.now() - voiceStartedAt) / 1000)
        if (seconds < 0) seconds = 0
        var whole = Math.floor(VOICE_MAX_MS / 1000)
        var mm = String(Math.floor(whole / 60))
        var ss = whole % 60
        els.recTime.textContent = '0:' + (seconds < 10 ? '0' : '') + String(seconds)
          + ' / ' + mm + ':' + (ss < 10 ? '0' : '') + String(ss)
      }

      /**
       * 画那一排竖条 (2026-11-20 重做)
       *
       * 几何全在 `recWaveRects` 里 (纯函数, 判据真跑): 走带右对齐 / 2 px 条 + 1 px 缝 + 1 px 圆角帽 /
       * 静音留 2 px 的点。这里只负责上色:
       * 一条竖直渐变 (上白下淡) + **旧的往左淡出** + 右端一枚柔光点当"录音笔头"
       */
      function paintRecWave() {
        var canvas = els.recWave
        if (!canvas || typeof canvas.getContext !== 'function') return
        var ctx2d = canvas.getContext('2d')
        if (!ctx2d) return
        var dpr = window.devicePixelRatio || 1
        var width = canvas.clientWidth || 320
        var height = canvas.clientHeight || 96
        var pxWidth = Math.max(1, Math.round(width * dpr))
        var pxHeight = Math.max(1, Math.round(height * dpr))
        if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
          canvas.width = pxWidth
          canvas.height = pxHeight
          recGradient = null
        }
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx2d.clearRect(0, 0, width, height)
        if (recGradient === null || recGradientHeight !== height) {
          recGradient = ctx2d.createLinearGradient(0, 0, 0, height)
          recGradient.addColorStop(0, 'rgba(255,255,255,.98)')
          recGradient.addColorStop(0.55, 'rgba(255,255,255,.9)')
          recGradient.addColorStop(1, 'rgba(255,255,255,.62)')
          recGradientHeight = height
        }
        var rects = recWaveRects(recHist, width, height)
        ctx2d.fillStyle = recGradient
        var rounded = typeof ctx2d.roundRect === 'function'
        for (var i = 0; i < rects.length; i += 1) {
          var rect = rects[i]
          // 旧的往左淡出: 越靠左越淡, 读起来像"声音从右边流进来"
          var t = rects.length < 2 ? 1 : i / (rects.length - 1)
          ctx2d.globalAlpha = 0.35 + 0.65 * t
          if (rounded) {
            ctx2d.beginPath()
            ctx2d.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r)
            ctx2d.fill()
          } else {
            ctx2d.fillRect(rect.x, rect.y, rect.w, rect.h)
          }
        }
        ctx2d.globalAlpha = 1
        // 右端那枚柔光点: 只在真的有声音时露头
        if (recHold >= REC_SILENT) {
          var glow = ctx2d.createRadialGradient(width - 2, height / 2, 0, width - 2, height / 2, 16)
          glow.addColorStop(0, 'rgba(255,255,255,.55)')
          glow.addColorStop(1, 'rgba(255,255,255,0)')
          ctx2d.fillStyle = glow
          ctx2d.fillRect(width - 18, height / 2 - 16, 18, 32)
        }
      }

      /** 把波形擦干净 (面板收起 / 正在转写时) */
      function clearRecWave() {
        var canvas = els.recWave
        if (!canvas || typeof canvas.getContext !== 'function') return
        var ctx2d = canvas.getContext('2d')
        if (!ctx2d) return
        ctx2d.setTransform(1, 0, 0, 1, 0, 0)
        ctx2d.clearRect(0, 0, canvas.width, canvas.height)
      }

      /**
       * 长按 450 ms 到点: **当场开录**
       *
       * 面板从底部升起来 + 挂抬手 / 上滑那两个监听 —— 手指还压在原来的输入框上, 所以面板
       * `pointer-events:none`, 事件照旧落在输入框那一侧 (换 DOM 会把抬手事件吞掉)
       */
      function beginHoldRecording() {
        if (voiceState === 'recording' || voiceState === 'working') return
        if (els.input) {
          try { els.input.blur() } catch (_noBlur) { /* 没收键盘也不算错 */ }
        }
        closeMenu()
        closeStickerPanel()
        closeFileMenu()
        recStartY = 0
        voiceHeld = true
        showRecPanel()
        window.addEventListener('pointermove', onRecMove, { passive: true })
        // 手指那一路要 `touchmove` 再挡一次: `pointerdown` 里改 `touch-action` 对**这一趟手势**
        // 已经晚了 (Chromium 在 touchstart 那一刻就定了这一趟是不是 pan), 只有现场
        // `preventDefault()` 才拦得住"上滑被当成滚动, 然后丢一发 pointercancel"
        window.addEventListener('touchmove', onRecTouch, { passive: false })
        window.addEventListener('pointerup', onRecRelease, { once: true })
        window.addEventListener('pointercancel', onRecRelease, { once: true })
        window.addEventListener('touchend', onRecRelease, { once: true })
        startRecording()
      }

      /** 手指那一路的上滑量: 拦下滚动 + 同一套阈值 */
      function onRecTouch(event) {
        if (voiceState !== 'recording') return
        if (event && event.cancelable) event.preventDefault()
        var touch = event && event.touches && event.touches[0]
        var y = touch ? Number(touch.clientY) : NaN
        if (!isFinite(y)) return
        applyRecDrag(y)
      }

      /** 手指往上挪过阈值 = 这一趟不要了 (提示换成「松开取消」, 面板压暗一点) */
      function onRecMove(event) {
        if (voiceState !== 'recording') return
        var y = Number(event && event.clientY)
        if (!isFinite(y)) return
        applyRecDrag(y)
      }

      /** 上滑量的那一处算术 (手与笔两路共用) */
      function applyRecDrag(y) {
        if (recStartY === 0) recStartY = y
        var over = (y - recStartY) <= -REC_CANCEL_PX
        if (over === recCancel) return
        recCancel = over
        setRecHint(over ? REC_HINT_CANCEL : REC_HINT)
        if (els.rec) els.rec.setAttribute('data-cancel', over ? 'on' : 'off')
      }

      /** 面板上那行字 (点 / 箭头 / 文本是一行里的三样, 文字换在 span 上) */
      function setRecHint(text) {
        if (!els.recText) return
        if (els.recText.textContent === text) return
        els.recText.textContent = text
      }

      /** 抬手 (或系统把这一趟收走): 按上滑量决定转写还是丢掉 */
      function onRecRelease() {
        dropRecListeners()
        if (voiceState === 'recording') {
          stopRecording(recCancel)
          return
        }
        // 还在等麦克风时抬手: 这一趟从没开始, 面板收起就行
        if (voiceState === 'press') {
          voiceHeld = false
          voiceState = 'idle'
          hideRecPanel()
        }
      }

      /** 抬手 / 上滑那几个监听一次性的, 收尾时全部摘掉 */
      function dropRecListeners() {
        window.removeEventListener('pointermove', onRecMove)
        window.removeEventListener('touchmove', onRecTouch)
        window.removeEventListener('pointerup', onRecRelease)
        window.removeEventListener('pointercancel', onRecRelease)
        window.removeEventListener('touchend', onRecRelease)
      }

      /** 按住那一刻要麦克风: 到手就留着这一趟用, 松手时由 [releaseVoiceCapture] 还回去 */
      function openVoiceStream() {
        if (voiceStream !== null || voiceStreamAsk !== null) return
        var media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
        if (!media || typeof media.getUserMedia !== 'function') {
          toast('这一版 WebView 拿不到麦克风', true)
          return
        }
        voiceStreamAsk = media.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        }).then(function (stream) {
          voiceStreamAsk = null
          if (!voiceHeld) {
            stream.getTracks().forEach(function (track) { track.stop() })
            return null
          }
          voiceStream = stream
          return stream
        }).catch(function (error) {
          voiceStreamAsk = null
          var name = error && error.name ? String(error.name) : ''
          toast(name === 'NotAllowedError' ? '麦克风权限没给: 去设置 → 权限里打开' : '麦克风起不来: ' + name, true)
          return null
        })
      }

      /** 把录音那几件 (处理器 / 上下文 / 流) 全部放掉 */
      function releaseVoiceCapture() {
        if (voiceProcessor !== null) {
          try { voiceProcessor.disconnect() } catch (_noDisc) { /* 已经断了 */ }
          try { voiceProcessor.onaudioprocess = null } catch (_noHandler) { /* 老 WebView */ }
          voiceProcessor = null
        }
        if (voiceContext !== null) {
          try { voiceContext.close() } catch (_noClose) { /* 已经关了 */ }
          voiceContext = null
        }
        if (voiceStream !== null) {
          try {
            voiceStream.getTracks().forEach(function (track) { track.stop() })
          } catch (_noTracks) { /* 流已经被系统收了 */ }
          voiceStream = null
        }
        voiceStreamAsk = null
        voiceChunks = null
        voiceSourceRate = 0
        if (voiceTicker !== null) clearInterval(voiceTicker)
        voiceTicker = null
      }

      /** 要麦克风 + 开录: 从这一刻起音频就在往 `voiceChunks` 里走 */
      function startRecording() {
        if (voiceState === 'recording' || voiceState === 'working') return
        voiceState = 'press'
        var begin = function (stream) {
          if (!stream) {
            voiceState = 'idle'
            hideRecPanel()
            return
          }
          // 抬手发生在流回来之前: 那时候**不开始录** —— 否则这一趟会一直录到 `VOICE_MAX_MS`
          if (!voiceHeld) {
            voiceState = 'idle'
            hideRecPanel()
            return
          }
          var Ctor = window.AudioContext || window.webkitAudioContext
          if (typeof Ctor !== 'function') {
            toast('这一版 WebView 录不了音', true)
            voiceState = 'idle'
            hideRecPanel()
            return
          }
          try {
            voiceContext = new Ctor()
          } catch (_noContext) {
            voiceContext = null
          }
          if (voiceContext === null || typeof voiceContext.createScriptProcessor !== 'function') {
            toast('录音起不来', true)
            voiceState = 'idle'
            hideRecPanel()
            return
          }
          voiceSourceRate = voiceContext.sampleRate
          voiceChunks = []
          recPeak = 0
          recHold = 0
          recShown = 0
          recHist = []
          recLastSample = 0
          voiceProcessor = voiceContext.createScriptProcessor(4096, 1, 1)
          voiceProcessor.onaudioprocess = function (event) {
            if (voiceChunks === null) return
            var channel = event.inputBuffer.getChannelData(0)
            voiceChunks.push(new Float32Array(channel))
            // 波形要的是"这一块里最响的那一下": 峰值比 RMS 更贴耳朵, 也不会把一串辅音抹平
            // (归一化与起落平滑在 [sampleRecColumn] 里, 这里只记原始峰值)
            var peak = 0
            for (var i = 0; i < channel.length; i += 1) {
              var amplitude = channel[i] < 0 ? -channel[i] : channel[i]
              if (amplitude > peak) peak = amplitude
            }
            var levelled = recLevelOf(peak)
            if (levelled > recPeak) recPeak = levelled
          }
          var source = voiceContext.createMediaStreamSource(stream)
          source.connect(voiceProcessor)
          // 不接到目的地就收不到回调 (Chromium 的老规矩); 那头没有被写, 所以不出声
          voiceProcessor.connect(voiceContext.destination)
          voiceStartedAt = Date.now()
          voiceSegmentAt = voiceStartedAt
          voiceChunkCursor = 0
          // 节拍从**开录这一刻**算: 第一块在 1.5 s 头上送 (不留一拍 85 ms 的空块去问模型)
          voiceChunkAt = voiceStartedAt
          voiceChunkSent = 0
          voiceChunkSeen = 0
          voiceLiveText = ''
          voiceCommit = ''
          // 这一趟的编号在**开录这一刻**发 (2.8.1 #F10): 块与末段都拿它认人, 中途不再换号,
          // 否则松手那一拍会把还没回来的块全判成"过期", 实时层那份文字就断在半截
          voiceId += 1
          voiceState = 'recording'
          // 帧循环从**这一刻**才开始: 上面那句之前 `voiceState` 还是 `press`, 早起的帧会立刻退出
          startRecPump()
          if (voiceTimer !== null) clearTimeout(voiceTimer)
          voiceTimer = setTimeout(function () { voiceTimer = null; stopRecording(false) }, VOICE_MAX_MS)
          if (voiceTicker !== null) clearInterval(voiceTicker)
          voiceTicker = setInterval(paintRecTime, 200)
        }
        if (voiceStream !== null) {
          begin(voiceStream)
          return
        }
        openVoiceStream()
        if (voiceStreamAsk === null) {
          voiceState = 'idle'
          hideRecPanel()
          return
        }
        voiceStreamAsk.then(begin)
      }

      /**
       * 松手: 收尾并送转写
       *
       * 两条路 (2.8.1 #F10):
       *
       * 1. **流式**已经送过块 —— 最后一截也送一块 (`final`), 它的文字回来与实时层拼成草稿,
       *    屏上那一层与框里的字因此是同一份
       * 2. 一块都没送过 (`VOICE_CHUNK_MS = 0` / 这一趟太短 / 宿主不认那一块) —— 照旧整段转写
       * @param cancelled true = 上滑取消了 (这一趟丢掉)
       */
      function stopRecording(cancelled) {
        if (voiceState !== 'recording') return
        var elapsed = Date.now() - voiceStartedAt
        voiceHeld = false
        if (voiceTimer !== null) clearTimeout(voiceTimer)
        voiceTimer = null
        voiceStartedAt = 0
        voiceState = 'idle'
        if (cancelled) {
          voiceId += 1
          releaseVoiceCapture()
          call('portalVoice', JSON.stringify({ op: 'cancel' }))
          hideRecPanel()
          toast('已取消', false)
          return
        }
        if (elapsed < VOICE_MIN_MS) {
          releaseVoiceCapture()
          hideRecPanel()
          toast('太短了, 再说一句', false)
          return
        }
        // 末段那一块要在放掉采集**之前**封 (wav 从 `voiceChunks` 里出)
        if (voiceStreaming()) {
          var sent = sendVoiceChunk(true)
          releaseVoiceCapture()
          voiceState = 'working'
          clearRecWave()
          setRecHint(REC_HINT_BUSY)
          if (els.rec) els.rec.setAttribute('data-busy', 'on')
          if (sent) {
            armVoiceWatch()
            return
          }
          // 末段没有新声音: 上一块已经回来了就当场收尾, 还在路上就等它 (`voiceChunkAnswer` 收)
          voiceCommit = 'release'
          if (voiceChunkSeen >= voiceChunkSeq) {
            finishVoiceRecording()
            return
          }
          armVoiceWatch()
          return
        }
        var chunks = voiceChunks || []
        var rate = voiceSourceRate
        releaseVoiceCapture()
        var wav = wavOf(chunks, rate)
        if (wav.byteLength <= 44) {
          hideRecPanel()
          toast('没有录到声音', true)
          return
        }
        voiceState = 'working'
        // 转写这一段：面板留着但换成「正在转写…」+ 三个点，波形擦掉 —— 不然松手后屏上什么都没有
        clearRecWave()
        setRecHint(REC_HINT_BUSY)
        if (els.rec) els.rec.setAttribute('data-busy', 'on')
        var answer = call('portalVoice', JSON.stringify({
          op: 'transcribe',
          id: voiceId,
          data: base64Of(wav),
          language: 'auto',
        }))
        if (answer === null || answer.ok !== true) {
          voiceState = 'idle'
          hideRecPanel()
          toast('这一版宿主还不支持语音输入', true)
          return
        }
        // 原生那边在别的线程认, 认完经 `__LUWI_PORTAL__.voice({id, ok, text})` 回推
        armVoiceWatch()
      }

      /** 把认出来的那一句接进草稿 (有字就空一格, 光标停在末尾) */
      function insertDraft(text) {
        if (!els.input) return
        var current = String(els.input.value || '')
        var next = current === '' ? text : current.replace(/\s+$/u, '') + ' ' + text
        els.input.value = next
        try {
          els.input.dispatchEvent(new Event('input', { bubbles: true }))
        } catch (_noEvent) {
          // 事件派不出去的那台机器: 两道都当场补上 (门与高度)
          updateSendGate()
          autoSizeInput()
        }
        try { els.input.setSelectionRange(next.length, next.length) } catch (_noSelection) { /* 老 WebView */ }
        updateSendGate()
      }

      /**
       * 原生回推的那一份 (`window.__LUWI_PORTAL__.voice`)
       *
       * 三种: `kind:'permission'` 是权限那一问的回执 (只改一句提示); `kind:'chunk'` 是流式那一块
       * (见 [voiceChunkAnswer]); 其余是整段转写结果 —— 编号对不上的直接丢掉 (上滑取消过 / 又按了
       * 一次之后, 旧的那趟不该再动草稿)
       * @param payload `{kind?, id?, seq?, final?, ok, text?, error?, engine?, mic?}`
       */
      function voiceAnswer(payload) {
        if (!payload || typeof payload !== 'object') return
        if (payload.kind === 'permission') {
          if (payload.mic === true) {
            toast('麦克风给好了, 再长按一次', false)
          } else {
            toast('麦克风权限没给: 去设置 → 权限里打开', true)
          }
          return
        }
        if (payload.kind === 'chunk') {
          if (typeof payload.id === 'number' && payload.id !== voiceId) return
          voiceChunkAnswer(payload)
          return
        }
        // 整段转写的结果只可能出现在"已经松手"之后: 还在录的时候来的一律当陈旧回推
        if (voiceState === 'recording') return
        if (typeof payload.id === 'number' && payload.id !== voiceId) return
        if (voiceWatch !== null) clearTimeout(voiceWatch)
        voiceWatch = null
        if (payload.ok !== true) {
          // 整段这条腿断了也不许把说过的话丢掉: 实时层那份先落草稿
          var kept = voiceDraftText(voiceLiveText, '')
          voiceState = 'idle'
          hideRecPanel()
          if (kept !== '') {
            insertDraft(kept)
            return
          }
          toast(payload.error ? String(payload.error) : '这一句没认出来', true)
          return
        }
        var final = String(payload.text === undefined || payload.text === null ? '' : payload.text)
        var said = voiceDraftText(voiceLiveText, final)
        voiceState = 'idle'
        if (els.rec) els.rec.setAttribute('data-busy', 'off')
        if (said !== '') paintRecLive(said)
        hideRecPanel()
        if (said === '') {
          toast('没有识别到内容', true)
          return
        }
        insertDraft(said)
        if (els.input) {
          try { els.input.focus() } catch (_noFocus) { /* 页还没上屏时 focus 会抛, 忽略 */ }
        }
      }

      /**
       * 流式那一块回来的文字 (2.8.1 #F10)
       *
       * 三档:
       *
       * 1. 普通一块 —— 只追加到实时层, 草稿一个字不动
       * 2. 滚段那一块 (`final`, 还在录) —— 拼起来落草稿, 实时层清空接着录
       * 3. 松手那一块 —— 拼起来落草稿并收尾 (与实时层同一份文字)
       * @param payload `{kind:'chunk', id, seq, final, text}`
       */
      function voiceChunkAnswer(payload) {
        var seq = Number(payload.seq)
        if (isFinite(seq) && seq > 0) {
          // 乱序 / 重发的那一块丢掉: 实时层不会把同一句写两遍
          if (seq <= voiceChunkSeen) return
          voiceChunkSeen = seq
        }
        var said = String(payload.text === undefined || payload.text === null ? '' : payload.text)
        paintRecLive(voiceLiveJoin(voiceLiveText, said))
        var fin = payload.final === true
        if (voiceState === 'recording') {
          // 还在录: 普通块只追加, **只有这一段封口那一块**落草稿 (滚段)
          if (!fin) return
          commitVoiceLive()
          return
        }
        // 松手之后: 松手那一块 (或它之前最后一块) 回来才收尾; 更早的块只并进实时层
        if (voiceCommit !== 'release') return
        if (isFinite(seq) && seq > 0 && seq < voiceChunkSeq) return
        finishVoiceRecording()
      }

      /**
       * 发送钮的两副面孔 (转圈 / 箭头)
       *
       * **只管图标与禁用** (2.8.1 #33): 草稿什么时候清、什么时候还, 由 [send] 自己决定 —— 以前两件事
       * 混在 `sending` 一个记号上, 失败那一路"还了草稿还把按钮锁回去", 屏上就是"转一圈、什么都没发、
       * 过会自己恢复原状"
       */
      function setSendBusy(busy) {
        if (!els.send) return
        els.send.innerHTML = busy ? SPIN_ICON : SEND_ICON
        els.send.disabled = busy === true
        els.send.setAttribute('data-busy', busy === true ? 'on' : 'off')
        // 转完这一圈就按草稿重新判一次能不能点 (失败时草稿被还回来了, 那颗钮必须还能点)
        if (busy !== true) updateSendGate()
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

      /**
       * 一次投递被拒 / 抛错时的那句人话 (2.8.1 #33)
       *
       * 以前 `prompt()` 回 `{ok:false}` 只有一行 `console.log`: 门户盖着 dsh 自己的错误节点, 于是
       * 屏上只剩"按钮转一圈又回来、草稿还在"。这句就是屏上那一行。**能拿到码与话就照抄**, 拿不到才用
       * 兜底那句 —— 不在屏上写一句没人对得上的话
       *
       * @param reason `prompt()` 的 `result.error` / 抛出来的 Error / 一句现成的串
       * @returns 直接能画的那一句
       */
      function sendFailText(reason) {
        var prefix = '这句没发出去'
        if (reason === undefined || reason === null) return prefix
        if (typeof reason === 'string') {
          var said = reason.trim()
          return said === '' ? prefix : prefix + ': ' + said
        }
        var code = typeof reason.code === 'string' ? reason.code : ''
        var message = typeof reason.message === 'string' ? reason.message : ''
        if (code !== '' && message !== '') return prefix + ': ' + code + ': ' + message
        if (message !== '') return prefix + ': ' + message
        if (code !== '') return prefix + ': ' + code
        return prefix + ': ' + describeError(reason)
      }

      /**
       * dsh 自己记下的那一条 prompt 拒答 (`snapshot.promptError`) → 屏上那一句
       *
       * 快照上那一格是 dsh 的 object-layer 状态, 门户这一层看不见它自己那块错误条, 所以读出来自己画
       * @param promptError `{op, error:{code, message}}` (没有就是 null)
       * @returns 能画的那一句; 没有拒答回空串
       */
      function promptErrorText(promptError) {
        if (!promptError || typeof promptError !== 'object') return ''
        // 那一格也是「停那一轮」失败时的落点 (`op:'stop'`): 那不是"没发出去", 不在这条链上说
        if (typeof promptError.op === 'string' && promptError.op !== 'send') return ''
        var reason = promptError.error
        if (!reason) return ''
        return sendFailText(reason)
      }

      /**
       * 记一条「这句没发出去」并当场重画 (2.8.1 #33)
       *
       * 与 [imageFail] 同一个写法: 只留最近三条, 连发失败十次不该把整段对话顶走
       * @param text 要画的那一句 (屏上就是一整句, 不再拼别的)
       */
      function pushSendFail(text) {
        var said = String(text === undefined || text === null ? '' : text).trim()
        if (said === '') said = '这句没发出去'
        var at = Date.now()
        sendFails.push({
          id: 'sendfail\u0001' + String(at) + '\u0001' + String(sendFails.length),
          at: at,
          text: said,
        })
        while (sendFails.length > 3) sendFails.shift()
        console.log('[luwi-portal] send failed: ' + said)
        renderFlow()
      }

      /**
       * 屏上那条 user 行是不是"我刚发出去的那一句"
       *
       * dsh 的 user 节点晚一拍才到: 正文一样 (附件那一段已被 `splitAttach` 拆走) 而且时刻不早于本机
       * 记下的那一拍, 才算同一条 —— 只比正文的话, 同一句话连发两次会把旧的那条当成新的
       * @param hold [pendingEcho]
       * @param one 快照里的一条 user (见 [nodesOf])
       * @returns 同一条 = true
       */
      function pendingEchoSame(hold, one) {
        if (!hold || !one || one.who !== 'user') return false
        // 空白归一之后再比: dsh 那边可能把行尾 / 连着的空行收了一下, 那不该让占位多留一拍
        var mineText = String(hold.text || '').replace(/\s+/g, ' ').trim()
        var thatText = String(one.text || '').replace(/\s+/g, ' ').trim()
        if (thatText !== mineText) return false
        var names = Array.isArray(one.attach) ? one.attach.join(',') : ''
        var mine = Array.isArray(hold.attach) ? hold.attach.join(',') : String(hold.attach || '')
        if (names !== mine) return false
        var when = Number(one.time) || 0
        return when === 0 || when >= Number(hold.at) - 2000
      }

      /**
       * 本机那条占位还要不要占着 (2.8.1 #33)
       *
       * 纯函数, 判据工具直接抽出来真跑 (check-luwi-portal §20)
       * @param hold [pendingEcho]
       * @param users 快照里这一场的 user 节点 (已拆过附件)
       * @param busy 这一句还在投 (`sending`)
       * @param now 现在 (毫秒)
       * @param limit 最多占多久 (`PENDING_ECHO_MS`)
       * @returns `keep` 继续占 / `done` 落盘那条到了 / `drop` 撤掉 (失败或等太久)
       */
      function pendingEchoState(hold, users, busy, now, limit) {
        if (!hold) return 'drop'
        var list = Array.isArray(users) ? users : []
        for (var i = 0; i < list.length; i += 1) {
          if (pendingEchoSame(hold, list[i])) return 'done'
        }
        if (busy === true) return 'keep'
        var ttl = Number(limit)
        if (!isFinite(ttl) || ttl <= 0) ttl = 15000
        return now - Number(hold.at) > ttl ? 'drop' : 'keep'
      }

      /**
       * 发送钮那一次按下的判据 (2.8.1 #33): 一次 pointerdown→pointerup 只投一次
       *
       * 纯函数, 判据工具直接抽出来真跑。轻点 = `queue`, 按住到点 = `steer`, 长按之后那次抬起
       * **不再**投 queue —— 以前靠"计时器有没有被清掉"当记号, 多一根手指 (第二次 pointerdown 覆盖了
       * 计时器 id) 就会变成两次投递
       * @param state `{pressed, fired}` 上一拍的状态 (不改它)
       * @param event `down` / `hold` / `up` / `cancel`
       * @returns `{state, act}`; act: `arm` 挂计时器 / `hold` 投 steer / `tap` 投 queue / `disarm` 撤计时器 / `ignore`
       */
      function sendGesture(state, event) {
        var pressed = state !== null && state !== undefined && state.pressed === true
        var fired = state !== null && state !== undefined && state.fired === true
        if (event === 'down') {
          // 已经按着就不再挂第二个计时器 (第二根手指不许变成第二次投递)
          if (pressed) return { state: { pressed: true, fired: fired }, act: 'ignore' }
          return { state: { pressed: true, fired: false }, act: 'arm' }
        }
        if (event === 'hold') {
          if (!pressed || fired) return { state: { pressed: pressed, fired: fired }, act: 'ignore' }
          return { state: { pressed: true, fired: true }, act: 'hold' }
        }
        if (event === 'up') {
          if (!pressed) return { state: { pressed: false, fired: false }, act: 'ignore' }
          if (fired) return { state: { pressed: false, fired: false }, act: 'ignore' }
          return { state: { pressed: false, fired: false }, act: 'tap' }
        }
        return { state: { pressed: false, fired: false }, act: pressed ? 'disarm' : 'ignore' }
      }

      function kv(key, value) {
        var row = h('div', 'lwp-kv')
        row.appendChild(h('b', null, key))
        row.appendChild(h('span', null, value === undefined || value === null || value === '' ? '—' : String(value)))
        return row
      }

      function openDrawer(which) {
        drawer = drawer === which ? '' : which
        // 开一层时先取一份最新的读数 (2.8.1 #12): 面板上那几行不该停在上一次打开时的那一份
        if (drawer !== '') status = call('portalStatus')
        renderDrawer()
      }

      /**
       * 「···」那张菜单 (2026-11-10 主人: "右上角判断层和工作合成一个按钮, 改成 ··· 表示更多")
       *
       * 三行: 判断 / 探索 / 收起。点进去沿用原来那两个面板 (内容一个字节没改), 面板顶上多一行
       * 「‹ 返回」回到这张菜单 —— 这样 `#lwp-drawer` 只有一处, 不必给每个面板再造一扇窗
       *
       * 2026-11-13 (#40): 这两行的口径改成「判断」「探索」—— 面板里那一行标题跟着同口径,
       * 于是点进去前后看到的是同一个词
       */
      function renderMenuDrawer() {
        els.drawer.appendChild(h('h3', null, '更多'))
        // 她自己的两张面板一直在最上面: 那是这一页的东西
        drawerRow('判断', '她什么时候开口那一套读数', '›', false, true, function () { openDrawer('router') })
        drawerRow('探索', '她挑时机开的那一场与最近一份摘要', '›', false, true, function () { openDrawer('work') })
        // 2026-11-17 主人: 探索下面再来一行「开发」——点进去是这一页上的开发面板, 排法与判断 / 探索
        // / 虚拟屏同一套; 后台球菜单那一份仍是原生下拉 (那一层没有这一页可画)
        drawerRow('开发', '新建应用 / 工具链 / 打开开发台', '›', false, true, function () { openDrawer('dev') })
        // 原生那一份 (2026-11-14: 前台不画浮球之后, 球菜单里那几件全搬到这里)
        // 老宿主没有 `portalMenu` 时回 null, 于是抽屉就还是原来那三行 —— 不回归
        var menu = call('portalMenu')
        if (Array.isArray(menu) && menu.length > 0) {
          els.drawer.appendChild(h('div', 'lwp-menu-sep'))
          for (var i = 0; i < menu.length; i += 1) {
            // 「终端」2026-11-20 上移到头栏 (夹在语音与 `⋯` 之间), 抽屉不再画它; 原生那份清单
            // 一个字节没改 —— 后台球菜单仍是原生下拉, 那一行还在那儿 (改名对它生效)
            if (menu[i] && menu[i].id === 'sync') continue
            portalRow(menu[i])
          }
        }
        // 头栏那颗「终端」的文案与开关态跟着这份清单走 (每次开抽屉顺手对齐一次)
        applySyncState(menu)
        drawerRow('收起', '', '', false, true, function () { openDrawer('') })
      }

      /**
       * 抽屉里的一行
       *
       * @param mark 右边那个记号: `›` = 点进去还有一层, `✓` = 这一项现在开着, 空 = 点了就办
       * @param on 开关态 / 选中态 (写 `data-on`, CSS 加粗)
       * @param enabled false 时整行点不动 (与原生那份清单的 enabled 同一件事)
       */
      function drawerRow(label, note, mark, on, enabled, onPick) {
        var row = h('button', 'lwp-menu-row')
        row.type = 'button'
        if (enabled === false) row.disabled = true
        if (on) row.setAttribute('data-on', 'on')
        var text = h('div')
        text.style.display = 'flex'
        text.style.flexDirection = 'column'
        text.style.minWidth = '0'
        text.appendChild(h('span', null, label))
        if (note) text.appendChild(h('em', null, note))
        row.appendChild(text)
        if (mark) row.appendChild(h('span', null, mark))
        row.onclick = onPick
        els.drawer.appendChild(row)
        return row
      }

      /** 原生那一份菜单里的一行 (虚拟屏 / 触摸控制 / 同步 / 酒馆 / 回到后台 / 反馈 / 设置) */
      function portalRow(item) {
        if (!item || typeof item.id !== 'string') return
        var kids = Array.isArray(item.children) ? item.children : []
        var mark = kids.length > 0 ? '›' : (item.on === true ? '✓' : '')
        drawerRow(item.title || '', item.summary || '', mark, item.on === true, item.enabled !== false, function () {
          if (kids.length > 0) {
            screenItems = kids
            openDrawer('screen')
            return
          }
          if (call('portalMenuPick', item.id) === null) {
            showNote('这一版宿主还不支持', true)
            return
          }
          renderDrawer()
          // 开关那一拍要等主线程执行完: 隔一会儿再画一次, 状态就对上了
          setTimeout(function () { if (drawer !== '') renderDrawer() }, 160)
        })
      }

      /**
       * 原生清单里 `sync` 那一项 (现在的名字是「终端」)
       *
       * 拿不到就回 null —— 老宿主没有这一项时按钮退回常量文案, 点了也只会说一句"还不支持"
       * @param menu `portalMenu()` 交回来的那一份 (或 `portalMenuPick` 的回执)
       * @returns 那一项, 没有就 null
       */
      function syncItemOf(menu) {
        if (!Array.isArray(menu)) return null
        for (var i = 0; i < menu.length; i += 1) {
          if (menu[i] && menu[i].id === 'sync') return menu[i]
        }
        return null
      }

      /**
       * 头栏那颗钮现在写什么字 (2026-11-22)
       *
       * 两档: **在终端里 = 「对话」**(点它回门户那一场), 否则 = 原生清单里那一句「终端」。
       * 清单那两句先由 [applySyncState] 存进 `syncTitle` / `syncSummary`, 于是开关终端、页面重载、
       * 配对回来这几种时刻都不用再走一趟桥就能把字换对
       */
      function applySyncTitle() {
        if (!els.syncButton) return
        if (terminalMode) {
          els.syncButton.textContent = TERMINAL_BACK_TITLE
          els.syncButton.title = TERMINAL_BACK_HINT
          els.syncButton.setAttribute('aria-label', TERMINAL_BACK_HINT)
          return
        }
        var title = syncTitle === '' ? SYNC_TITLE : syncTitle
        var summary = syncSummary
        els.syncButton.textContent = title
        els.syncButton.title = summary
        els.syncButton.setAttribute('aria-label', summary === '' ? title : title + ': ' + summary)
      }

      /**
       * 头栏那颗「终端」的文案 / 已打开态 / 无障碍名字全从原生清单来
       *
       * 文案与状态只有一处实现 (`PortalMenu.items()` 读 `menu_sync` 那两句), 页不抄第二份 ——
       * 于是设置里改名、开与关的 summary 变化, 这颗钮自己就跟上了。**字写哪一句归 [applySyncTitle]
       * 说** (终端里换「对话」), 这一份只负责把清单那两句记下来并把亮灯对齐
       * @param menu 一份新的清单
       */
      function applySyncState(menu) {
        if (!els.syncButton) return
        var item = syncItemOf(menu)
        syncTitle = item && typeof item.title === 'string' && item.title !== '' ? item.title : SYNC_TITLE
        syncSummary = item && typeof item.summary === 'string' ? item.summary : ''
        els.syncButton.setAttribute('data-on', item && item.on === true ? 'on' : 'off')
        applySyncTitle()
      }

      /**
       * 头栏那颗钮 (2026-11-20 从 `⋯` 抽屉里搬上来)
       *
       * 2026-11-21 改了口径: 这一颗不再翻开关, 而是**打开终端那一页** (手机管电脑); 开关仍在
       * 设置页那一段。2026-11-22 起它是**一个开关**: 不在终端时进终端, 在终端里回对话 ——
       * 终端不再有自己的「‹ 返回」(主人: "终端不加返回按钮, 而是从终端按钮返回, 在终端时按钮上的字
       * 应当是「对话」"), 于是同一个位置既是入口也是出口
       */
      function pickSync() {
        if (terminalMode) closeTerminal()
        else openTerminal()
        // 顺手把原生清单的文案对齐一次 (它仍写着「已配对: 谁」/「未配对」)
        setTimeout(function () { applySyncState(call('portalMenu')) }, 160)
      }

      /** 「虚拟屏」那一层: 屏列表 / 暂停接受控制 / 释放 / 显示隐藏窗口 */
      /**
       * 「开发」面板 (2026-11-17 主人: 面板要像判断 / 探索 / 虚拟屏那样画在这一页上)
       *
       * 顶上两行读数 (已有项目 / 工具链) 由原生现算; 下面三行动作都只投一个 id,
       * 真正干活的是 app 那一侧 (`portalDevPick`) —— 下 113 MB 与建开发屏都在那边丢线程池, 这里只
       * 当场收一句「开始了」, 干完原生自己 Toast 报结果
       */
      function renderDevDrawer() {
        var dev = call('portalDev') || {}
        els.drawer.appendChild(h('h3', null, '开发'))
        els.drawer.appendChild(kv('已有项目', String(dev.projects || '') || '还没有'))
        els.drawer.appendChild(kv('工具链', String(dev.toolchain || '') || '状态读不到'))
        var act = function (id) {
          var line = call('portalDevPick', id)
          showNote(line === null ? '这一版宿主还不支持' : String(line), line === null)
          setTimeout(function () { if (drawer === 'dev') renderDrawer() }, 1200)
        }
        // 2026-11-17 主人: 这一层只留三行; 导入工具链还在设置页那一段里
        drawerRow('新建开发应用', '建一个项目', '', false, true, function () { act('new') })
        // 开发屏开着时这一行变「关闭开发台」, 点一下把所有虚拟屏收掉 (主人 2026-11-17)
        var screenOpen = dev.screenOpen === true
        drawerRow(
          screenOpen ? '关闭开发台' : '打开开发台（虚拟屏）',
          screenOpen ? '释放所有虚拟屏' : '构建时在上面看进度',
          '›',
          screenOpen,
          true,
          function () { act(screenOpen ? 'screen.close' : 'screen') },
        )
        drawerRow('下载 luwi 开发安卓工具', '先选直链还是镜像', '›', false, true, function () { openDrawer('devdl') })
      }

      /**
       * 「下载 luwi 开发安卓工具」的第二层: 直链 / 镜像 (2026-11-17 主人: 点下载要弹一下让选)
       *
       * 两档打的是同一份 `luwi-toolchain.zip`: 直链 = GitHub Releases 直连, 镜像 = 三个加速代理。
       * 选完回上一层并把结果用 note 说出来 (真正的进度由原生 Toast 报)
       */
      function renderDevDownloadDrawer() {
        els.drawer.appendChild(h('h3', null, '下载 luwi 开发安卓工具'))
        els.drawer.appendChild(kv('包', 'luwi-toolchain.zip · 113 MB'))
        var pickOne = function (id) {
          var line = call('portalDevPick', id)
          showNote(line === null ? '这一版宿主还不支持' : String(line), line === null)
          openDrawer('dev')
        }
        drawerRow('直链', 'GitHub Releases 直连', '', false, true, function () { pickOne('download:direct') })
        drawerRow('镜像', 'ghproxy / gh-proxy / ghfast 三个代理', '', false, true, function () { pickOne('download:mirror') })
      }
      function renderScreenDrawer() {
        // 每画一次都拿最新的那一份: 点「释放」之后列表里那块就该没了
        var menu = call('portalMenu')
        if (Array.isArray(menu)) {
          for (var j = 0; j < menu.length; j += 1) {
            if (menu[j] && Array.isArray(menu[j].children) && menu[j].children.length > 0) {
              screenItems = menu[j].children
              break
            }
          }
        }
        els.drawer.appendChild(h('h3', null, '虚拟屏'))
        if (screenItems.length === 0) {
          drawerRow('还没有已创建的虚拟屏', '', '', false, false, function () {})
          return
        }
        for (var i = 0; i < screenItems.length; i += 1) portalRow(screenItems[i])
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
          else if (drawer === 'screen') renderScreenDrawer()
          else if (drawer === 'router') renderRouterDrawer()
          else if (drawer === 'dev') renderDevDrawer()
          else if (drawer === 'devdl') renderDevDownloadDrawer()
          else renderWorkDrawer()
        }
        if (els.moreButton) els.moreButton.setAttribute('data-on', drawer === '' ? 'off' : 'on')
      }

      /**
       * 动作行最右那颗「设置」(2026-11-13 主人: "判断和探索面板的设置按钮…应该加在打开唤醒/刷新 的右侧")
       *
       * 只翻一个开关: 参数在原生那层读写 (设置 → 活动 → 更多设置 是同一份), 页面一个字节不写盘 ——
       * 与面板上那几行读数同一条边界。`focus` 决定弹窗落在哪一组
       */
      function settingsButton(focus) {
        var button = h('button', null, '设置')
        button.onclick = function () {
          if (call('portalActivitySettings', focus) === null) showNote('这一版宿主还不支持', true)
        }
        return button
      }

      function renderRouterDrawer() {
        var data = status || {}
        var router = data.router || {}
        var last = router.last || {}
        els.drawer.appendChild(h('h3', null, '判断'))
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
        // 这一行叫「唤醒」: 2026-11-13 主人把叫法统一了, 与 `sim.json` 的 `wake` 段一个口径
        // 2026-11-20: `sim.json` 的「潜水 / 活跃」那一格删了, 开关态只剩 `router.json` 一个来源
        // (页面不再有"更多设置里选的活跃"那种第二档说法)
        var tickOn = router.tick && router.tick.enabled === true
        els.drawer.appendChild(kv('唤醒', tickOn ? '开着 (25-55 分一次)' : '关着'))
        // 点了之后那一句回执: 判断在宿主那一侧异步跑, 不写一行的话按下去与"没接上"同形
        if (tickNote !== '') els.drawer.appendChild(kv('回执', tickNote))

        // 2026-11-14 主人: "checks 改成检测项, 后面的数字只显示已有检测项即可" —— 那个 `/ 3`
        // 从来没当过闸 (宿主只按 12 截断库存), 摆在面板上只会被读成"还差三条", 所以整格去掉
        var checks = Array.isArray(router.checks) ? router.checks : []
        els.drawer.appendChild(h('h3', null, '检测项 (' + checks.length + ')'))
        if (checks.length === 0) {
          els.drawer.appendChild(kv('内容', '探索还没交过检测项'))
        }
        for (var i = 0; i < checks.length; i++) {
          var one = checks[i] || {}
          var line = h('div', 'lwp-check')
          var body = h('p', null, one.what || one.label || '一条检测项')
          // 判法那一行是给人看的读数: 宿主写的是 `when.kind` / `when.minutes` / `when.package`
          // (2026-11-14 修: 原来读 `one.minutes` / `one.packageName`, 两个字段宿主从来不写, 于是
          // 分钟数与包名一帧都没显示过), 判法本身也换成中文, 与标题同一个口径
          var when = one.when || {}
          var kindText = { usage: '用满', time: '到点', event: '日历前' }[when.kind] || String(when.kind)
          var detail = []
          if (when.kind) detail.push(kindText)
          if (one.at) detail.push(String(one.at))
          if (when.minutes) detail.push(String(when.minutes) + ' 分')
          if (when.package) detail.push(String(when.package))
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
        var tick = h('button', null, '唤醒一下')
        tick.onclick = function () {
          // 回执先落屏 (2026-11-15 主人: 「唤醒一下」点不动): 判断在宿主那一侧异步跑, 这一拍
          // 屏上什么都不变的话, 按下去与"没接上"是同一个样子
          //
          // 2026-11-16 (#8, 主人: "点击唤醒一下时, 必须主动说话"): 这一下投的是 `source:"wake"`,
          // 宿主不再过判断层那几道闸, 先应一声再开一场 —— 所以回执写"她这就说", 并且点完自己
          // 盯几拍 ([watchWake]), 3 s 内必有一颗气泡 (不等 3 s 那一拍定时器)
          var result = call('portalTick')
          if (result === null) {
            tickNote = ''
            showNote('这一版宿主还不支持', true)
            return
          }
          if (result.queued === false) {
            tickNote = '这一下没投出去 (收件箱写不进去)'
            showNote('这一下没投出去', true)
          } else if (result.host === 'starting') {
            tickNote = '宿主在起, 起好她就会应一声'
          } else {
            tickNote = '已投出去 (第 ' + String(result.seq || 0) + ' 行), 她这就说'
          }
          renderDrawer()
          watchWake()
          // 6 s 后收掉那一行: 回执是"这一下有没有出去", 不是常驻读数
          setTimeout(function () {
            if (drawer !== 'router' || tickNote === '') return
            tickNote = ''
            renderDrawer()
          }, 6000)
          setTimeout(refresh, 600)
        }
        actions.appendChild(tick)
        // 开关: 它回的就是**写完之后**的那一份快照, 于是就地重画, 不必等下一次补拍
        // (2026-11-15: 关掉唤醒要连 sim.json 的"活跃"一起收, 否则合成值仍开, 按钮看着没反应)
        var toggle = h('button', null, tickOn ? '关掉唤醒' : '打开唤醒')
        toggle.onclick = function () {
          var fresh = call('portalTickEnabled', !tickOn)
          if (fresh === null) {
            showNote('这一版宿主还不支持', true)
            return
          }
          status = fresh
          tickNote = tickOn ? '唤醒关掉了 (更多设置里那一档也收了)' : '唤醒开着, 25-55 分一次'
          renderDrawer()
          setTimeout(function () {
            if (drawer !== 'router' || tickNote === '') return
            tickNote = ''
            renderDrawer()
          }, 6000)
        }
        actions.appendChild(toggle)
        // 第三颗挂在动作行最右 (主人 2026-11-13 点名的位置), 落判断层那一组
        actions.appendChild(settingsButton('router'))
        els.drawer.appendChild(actions)
      }

      /**
       * 探索面板那几行读数 (纯函数, 2.8.1 #12; 2026-11-21 二改)
       *
       * 之前这三行读的是 `explore.json` 里**从来没有**的键 (`nextTask` / `lastSummaryAt` / `schedule.time`),
       * 于是面板永远写着「还没有排 / — / —」, 宿主写得再勤也不动。宿主现在报的是真的那几份: 任务卡
       * (`lw/explore-card.md`) / 摘要目录里最新那份 / `explore-schedule.json` 的步数。行文只在这里拼一处,
       * 判据脚本真跑这张真值表 (`tools/check-luwi-portal.mjs` 第十九节)
       *
       * **排期撤了之后没有「探索时刻」这一行**: `schedule` / `enabled` / `nextAt` 三个读数一并删掉,
       * 换成一格步数 —— 那是判断层每场开场真的读的东西
       */
      function workReading(explore) {
        var data = explore || {}
        var task = typeof data.nextTask === 'string' ? data.nextTask.trim() : ''
        var chars = Number(data.cardChars)
        var next = task === '' ? '还没有排 (开场会自由探索)' : task
        if (task !== '' && isFinite(chars) && chars > 0) next += ' (' + String(chars) + ' 字)'
        // 摘要那一行用 `stamp` 而不是 `clock`: 上一次可能是前天的, 只写 HH:MM 会被读成今天
        var last = Number(data.lastSummaryAt) > 0 ? stamp(data.lastSummaryAt) : '—'
        var steps = Number(data.steps)
        var budget = isFinite(steps) && steps > 0 ? '每场最多 ' + String(steps) + ' 步' : '—'
        return {
          next: next,
          last: last,
          budget: budget,
          running: data.running === true ? '正在跑' : '没在跑',
        }
      }

      /** 那几行拼成一把键: 抽屉开着时只有盘上真的变了才重画 (见 `pollLedger`) */
      function workKey(explore) {
        var reading = workReading(explore)
        return [reading.next, reading.last, reading.budget, reading.running].join('\u0001')
      }

      function renderWorkDrawer() {
        var explore = (status && status.explore) || {}
        var reading = workReading(explore)
        workShown = workKey(explore)
        els.drawer.appendChild(h('h3', null, '探索'))
        els.drawer.appendChild(kv('下一趟', reading.next))
        els.drawer.appendChild(kv('上次摘要', reading.last))
        els.drawer.appendChild(kv('每场步数', reading.budget))
        els.drawer.appendChild(kv('这一趟', reading.running))
        var actions = h('div', 'lwp-actions')
        var start = h('button', null, '开始这一趟')
        start.onclick = function () {
          // 回执先落屏 (2.8.1 #12 主人: "点击开始这一趟和刷新没有反馈"): 投递与开那一场都在宿主
          // 那一侧, 这一拍屏上什么都不变的话, 按下去与"没接上"分不开
          var result = call('portalExplore')
          if (result === null) {
            toast('这一版宿主还不支持', true)
            return
          }
          if (result.running === true) {
            toast('已经有一场在跑, 这一下不另开', false)
          } else if (result.queued === false) {
            toast('这一下没投出去 (收件箱写不进去)', true)
          } else {
            toast('已投出去 (第 ' + String(result.seq || 0) + ' 行), 她这就开始')
          }
          setTimeout(refresh, 700)
        }
        actions.appendChild(start)
        var again = h('button', null, '刷新')
        again.onclick = function () {
          var fresh = refresh()
          if (fresh === null) {
            toast('这一版宿主还不支持', true)
            return
          }
          toast('已刷新 ' + clock(fresh.now))
        }
        actions.appendChild(again)
        // 第三颗挂在「开始这一趟 / 刷新」右边, 落探索那一组
        actions.appendChild(settingsButton('explore'))
        els.drawer.appendChild(actions)
      }

      /** 重取一份判断层 / 探索读数并就地重画 (回执里那几句要用新的一份, 所以把 `status` 交回去) */
      function refresh() {
        status = call('portalStatus')
        renderDrawer()
        renderMeta()
        // 设置页里翻过「终端」那一开关之后回到前台, 头栏那颗的字与亮灯要跟着对上
        applySyncState(call('portalMenu'))
        // 设置 → 说话 里翻过「朗读回答」也一样: 那颗喇叭的两副图标与亮灯跟着换
        refreshSpeak()
        if (mounted) renderFlow()
        return status
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
       * @param {string} [picture] 这一次那张图多大 (`未选择` = 人把选择器退出来了 / 压根没选)
       */
      function imageFail(reason, picture) {
        var text = String(reason === undefined || reason === null ? '' : reason)
        if (text !== IMAGE_FAIL.noCallback && text !== IMAGE_FAIL.tooBig && text !== IMAGE_FAIL.timeout) {
          text = IMAGE_FAIL.timeout
        }
        var at = Date.now()
        // 四行诊断 (2.8.1 #1): 机型 / Android / WebView 只有宿主读得到, 所以那一份由它拼 —— 同一份
        // **既进 logcat 又原样回存**到这条气泡上, 「复制诊断」复制的就是它, 两边才会逐字一致
        var size = picture === undefined || picture === null ? '' : String(picture).trim()
        if (size === '') size = '未选择'
        var got = call('portalImageFail', JSON.stringify({ reason: text, image: size }))
        var diag = got && typeof got.diag === 'string' ? got.diag : ''
        imageFails.push({
          id: 'imagefail\u0001' + String(at) + '\u0001' + String(imageFails.length),
          at: at,
          text: '图片发送失败：' + text,
          diag: diag,
        })
        // 只留最近三条: 连着失败十次不该把整段对话顶走
        while (imageFails.length > 3) imageFails.shift()
        console.log('[luwi-portal] image send failed: ' + text)
        renderFlow()
      }

      /** 撤掉"WebView 没回调"那个计时器 (宿主真回调了就撤) */
      function disarmPickWatch() {
        if (pickWatch === null) return
        clearTimeout(pickWatch)
        pickWatch = null
      }

      /**
       * 挂上"WebView 没回调"的计时器 —— **页面看得见才挂** (2.8.1 #13)
       *
       * 选择器一盖上来, 这块 WebView 就不可见了, 渲染器那边 JS 计时器整个停着; 等页面回到前台, 那个
       * 早就到点的计时器**第一个跑**, 而宿主那两句回话还排在它后面 —— 于是每次选图都多一条假的
       * 「webview 未回调」, 这一条就是那个根: 盖着的时候不挂 (`pickHeld`), 回来看见宿主没说话再挂
       * @param {number} delay 挂多久之后才算"没回调"
       */
      function armPickWatchWhileVisible(delay) {
        disarmPickWatch()
        pickHeld = false
        if (typeof document !== 'undefined' && document.hidden === true) {
          // 已经看不见了 (选择器盖着): 挂着也只会误报, 记一笔"人在里面挑", 回来再挂
          pickHeld = true
          return
        }
        pickWatch = setTimeout(pickWatchDue, delay)
      }

      /** 计时器到点: 还欠着回话才报, 而且只在页面看得见的时候报 */
      function pickWatchDue() {
        pickWatch = null
        if (pickPending !== true) return
        if (typeof document !== 'undefined' && document.hidden === true) {
          pickHeld = true
          return
        }
        pickPending = false
        imageFail(IMAGE_FAIL.noCallback)
      }

      /**
       * 选择器盖上来 / 回到页面 (2.8.1 #13)
       *
       * 两件事: 盖着就把计时器停了 (那段时间它跑不动, 硬留着只会在回来那一瞬间误报); 回来时还欠着回话
       * 就按 [PICK_GRACE_MS] 再挂一次 —— 宿主那两句先落地的话, 这一步到点前就已经被撤掉了
       */
      function pickWatchVisibility() {
        if (pickPending !== true) return
        if (typeof document !== 'undefined' && document.hidden === true) {
          disarmPickWatch()
          pickHeld = true
          return
        }
        if (pickHeld !== true) return
        armPickWatchWhileVisible(PICK_GRACE_MS)
      }

      /** 点 `+` 之后先假定"WebView 没回调": 宿主那侧一行 `pickState` 回来就撤掉它 */
      function armPickWatch() {
        pickPending = true
        armPickWatchWhileVisible(PICK_WAIT_MS)
      }

      /** 选择器起来了 (宿主 `shown`): 还欠一个终态, 但页面这会儿盖着, 计时器先停着 */
      function pickOwed() {
        pickPending = true
        pickHeld = true
        // 那句 `shown` 有可能是排队到现在的 (人已经回来了): 那就按宽限再挂一次, 不能停在"什么都不等"
        armPickWatchWhileVisible(PICK_GRACE_MS)
      }

      /** 这一趟选图有结论了 (`picked` / `empty` / `none`): 不欠了, 计时器也撤掉 */
      function pickSettled() {
        pickPending = false
        pickHeld = false
        disarmPickWatch()
      }

      /**
       * 宿主那侧对这次选择的回话 (见 `HostScreen.onShowFileChooser` 与那个选择器的回调)
       *
       * - `shown`: `onShowFileChooser` 真的进来了 —— 选择器起来了. **这一档不算结清**: 文件还没回来,
       *   只是把计时器停住 (见 [pickOwed])
       * - `picked`: 选择器回来了而且选到了东西 —— 落好的那几份随后由 [picked] 交回页面 (2.8.1 #13)
       * - `empty`: 选择器回来了但是空的 —— **人自己退出来的** (2026-11-15 主人: "没有选择直接
       *   退出...要求这种情况下不要显示这个报错")。这一档只撤计时器, 屏上不留一个字: 取消是
       *   主人自己的动作, 不是一次失败
       * - `none`: 选择器起不来 (没有能接这个 intent 的应用) —— 这一档才是真的"点了没反应", 要说
       * @param {string} state 宿主给的那一个词
       */
      function pickState(state) {
        var what = String(state === undefined || state === null ? '' : state)
        if (what === 'shown') {
          pickOwed()
          return
        }
        pickSettled()
        if (what === 'picked' || what === 'empty') return
        imageFail(IMAGE_FAIL.noCallback)
      }

      /**
       * 宿主把选好的那几份交回来了 (2.8.1 #13)
       *
       * **字节是宿主读的、宿主落的** (见 `PortalBridge.stashPicked`): 页面不再拿 `content://` 去
       * FileReader, 也不再 base64 过桥 —— 那两条路在有的机器上就是"点确定什么都没有" (issue #53)
       * 这里拿到的每一份都已经在 `<工作区>/lw-in/` 里了 (`path` 是盘上的绝对路径), 所以直接记成
       * `ready`: 缩略图走 `/lw-out/in/<名字>`, 发送时路径进正文, 她拿 `read_image` 打开的就是这一份
       *
       * **一次选几份就有几份, 只此一处 push** —— 同一次发送只落 1 个文件靠的就是宿主那边只读一遍
       * @param {object} payload `{files:[{name, path, bytes, image, mediaType}], rejected:[{name, reason}]}`
       * @returns {number} 真的加进待发栏几份 (判据拿它读)
       */
      function picked(payload) {
        pickSettled()
        if (typeof sessionId !== 'string' || sessionId === '') {
          // 选择器是开了会话才弹的; 走到这儿说明这一场刚被换掉 —— 文件已经在盘上, 说一句就走
          showNote('先开一场对话', true)
          return 0
        }
        var body = payload !== null && typeof payload === 'object' ? payload : {}
        var files = body.files !== null && typeof body.files === 'object' && body.files.length ? body.files : []
        var added = 0
        for (var i = 0; i < files.length && attach.length < MAX_ATTACH; i += 1) {
          var one = files[i]
          if (one === null || typeof one !== 'object') continue
          var path = typeof one.path === 'string' ? one.path : ''
          if (path === '') continue
          var name = typeof one.name === 'string' && one.name !== '' ? one.name : baseNameOf(path)
          var mediaType = typeof one.mediaType === 'string' ? one.mediaType : ''
          attach.push({
            kind: one.image === true ? 'image' : 'stashed',
            name: name,
            bytes: Number(one.bytes) || 0,
            mediaType: mediaType !== '' ? mediaType : mimeOfName(name),
            data: '',
            status: 'ready',
            error: '',
            path: path,
            lastLogged: '',
          })
          added += 1
        }
        var rejected = body.rejected !== null && typeof body.rejected === 'object' && body.rejected.length
          ? body.rejected
          : []
        if (rejected.length > 0) {
          // 被拒的那几份宿主给了人话 (读不动 / 太大 / 不收这种文件): 原样说一句, 不静默
          var said = []
          for (var r = 0; r < rejected.length; r += 1) {
            var bad = rejected[r] !== null && typeof rejected[r] === 'object' ? rejected[r] : {}
            said.push(String(bad.name || '这一份') + (bad.reason ? ': ' + String(bad.reason) : ''))
          }
          showNote('这些没进来: ' + said.join('; '), true)
        }
        renderAttach()
        return added
      }

      /**
       * 气泡右侧那颗「复制诊断」(2.8.1 #1)
       *
       * 复制的那四行**不是点击这一刻拼的**: 失败那一下宿主已经拼好一份 (同一份进了 logcat), 这里原样
       * 交回去, 于是剪贴板与 logcat 同刻逐字一致, 走宿主 `portalCopyDiag` 而不是 `navigator.clipboard`
       * —— 后者要有焦点、要算用户手势, 系统剪贴板才一定成 (与 [copyFilePath] 同一条路)
       * @param {string} id 那条「图片发送失败」的身份 (见 [imageFail])
       */
      function copyImageDiag(id) {
        var key = String(id === undefined || id === null ? '' : id)
        var one = null
        for (var i = 0; i < imageFails.length; i += 1) {
          if (imageFails[i].id === key) {
            one = imageFails[i]
            break
          }
        }
        if (one === null || one.diag === '') {
          showNote('这条诊断没留下, 再失败一次', true)
          return
        }
        var got = call('portalCopyDiag', one.diag)
        if (!got || got.ok !== true) {
          showNote(got && got.error ? String(got.error) : '复制不了这条诊断', true)
          return
        }
        showNote('已复制诊断 ' + String(got.lines) + ' 行')
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
          imageFail(IMAGE_FAIL.timeout, sizeText(one.bytes))
        }, UPLOAD_WAIT_MS)
      }

      /** 弹选择器: 走 `<input type=file>`, 也就是 `HostScreen.onShowFileChooser` 那条路 */
      function pickFile() {
        if (els.file === undefined || els.file === null) return
        if (typeof sessionId !== 'string' || sessionId === '') {
          showNote('先开一场对话', true)
          return
        }
        // 这一趟是普通附件 (2.8.1 #13): 宿主读、宿主落进 `lw-in/`, 落好的那几份再经 [picked] 交回来
        call('portalPickMode', 'file')
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

      /**
       * 拖进来那一刻: 输入卡描一圈虚线 (对齐 dsh 的 `DropOverlay`)
       *
       * 进 / 出 / 松手三条路都走这一处, 免得"拖走了那圈还亮着"
       * @param over - 现在是不是拖在上面
       */
      function markDrop(over) {
        if (!els || !els.card) return
        if (over === true) els.card.setAttribute('data-drop', 'over')
        else els.card.removeAttribute('data-drop')
      }

      /**
       * 拖进来的那几份 = 待发栏那几行 (2.8.1 #34)
       *
       * 主人: "前台门户的输入框也要像后台DSH一样可拖放文件加入". 落点就是 `+` 选完那根链 ——
       * 图走 `readImage`, 别的走 `stashOne`: 读字节 → `portalStash` 落 `lw-in/` → chip, 这里不自己
       * 读一遍字节, 也不接新桥方法
       *
       * 拖进来的目录不带结构 (`DataTransfer.files` 里只有文件), 所以按单文件处理 —— 已知限制
       * @param node - 从哪块接住的 (`lwp-card` / `lwp-dock`, 只进日志)
       * @param event - 那个 drop 事件
       */
      function dropFiles(node, event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
        markDrop(false)
        var files = event && event.dataTransfer ? event.dataTransfer.files : null
        var total = files && typeof files.length === 'number' ? files.length : 0
        var names = []
        for (var i = 0; i < total; i += 1) {
          names.push(files[i] && files[i].name ? String(files[i].name) : '?')
        }
        // 一行读数: 真机上"拖进来没有 / 从哪块接的 / 几份 / 叫什么"只能看这一行
        console.log('[luwi-portal] drop ' + (node && node.id ? String(node.id) : '?')
          + ' -> ' + total + ' 份: ' + names.join(', '))
        if (total === 0) {
          showNote('拖进来的东西没读出来', true)
          return
        }
        onFilesChosen(files)
      }

      /**
       * 给一块区域挂上"拖文件进来" (2.8.1 #34)
       *
       * `dragover` 一定要 `preventDefault()` —— 不叫这一声浏览器就不认这块能接, `drop` 永远不来
       * (真机上就表现成"拖过来什么都没发生"). 输入卡与 dock 都挂: 落点常在卡片外沿或表情面板那块
       * 空白上. 子节点的事件会冒泡上来, 所以四条都 `stopPropagation`, 一份文件只落一次
       * @param node - 要挂的容器
       */
      function bindDropTarget(node) {
        if (!node || typeof node.addEventListener !== 'function') return
        node.addEventListener('dragenter', function (event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
          markDrop(true)
        })
        node.addEventListener('dragover', function (event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
          if (event && event.dataTransfer) {
            try {
              event.dataTransfer.dropEffect = 'copy'
            } catch (_noDropEffect) {
              // 老 WebView 的 dataTransfer 是只读的: 少了那个光标形状也能接
            }
          }
          markDrop(true)
        })
        node.addEventListener('dragleave', function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
          markDrop(false)
        })
        node.addEventListener('drop', function (event) { dropFiles(node, event) })
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
            // 带上这一份多大: 四行诊断里的第四行就是它 (2.8.1 #1)
            imageFail(IMAGE_FAIL.tooBig, sizeText(file && file.size ? file.size : 0))
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
      /**
       * 这一次投递在本机上先占的那一行 (2.8.1 #33)
       *
       * 只记"人说的那部分" (`text`) 与附件名字: 附件那一段路径挂在 `text` 后面进的 prompt, 而
       * `splitAttach` 会把落盘那一条的正文重新拆成同样两份, 两边才比得上 (见 [pendingEchoSame])
       * @param text 人写的那一句 (可能为空 = 只发附件)
       * @param items 待发附件 (`attach` 那一份)
       * @returns [pendingEcho]
       */
      function pendingEchoStart(text, items) {
        var names = []
        for (var i = 0; i < items.length; i += 1) {
          if (items[i] && typeof items[i].name === 'string' && items[i].name !== '') names.push(items[i].name)
        }
        pendingSeq += 1
        var at = Date.now()
        return {
          id: 'pending\u0001' + String(at) + '\u0001' + String(pendingSeq),
          at: at,
          text: text,
          attach: names,
        }
      }

      /* ── 输入框高度: 长文本发完要回一行 (2.8.1 #51) ────────────────────────────────
       *
       * 之前高度只挂在 `input` 事件上, 而**清空是程序改 `value`** —— 那一趟不会来事件, 于是
       * 打满十几行发出去之后, 框还留着上一次那一截, 要等下一次敲键才收回去 (2026-11-24 主人报)
       *
       * 现在三条路都走同一个 [autoSizeInput]: `input` 事件 / `send()` 清空之后 / 失败还草稿之后。
       * 换算与"清不清"是纯函数 ([inputHeightPx] / [inputResetsToLine]), 判据直接抽出来真跑
       */
      /** 一行多高 / 至多几行: 与 CSS 的 `#lwp-input` 的 line-height 与 max-height 同一档 */
      var INPUT_LINE_PX = 24
      var INPUT_MAX_LINES = 14
      /** 上一次写进去的高度: 只有变了才在 logcat 上留一行读数 (逐键一句会刷屏) */
      var inputPx = 0

      /**
       * 清空之后要不要回 CSS 的一行默认高 (纯函数)
       *
       * 只有**真的空**才算: 全是空白的草稿仍按内容量, 那也就是一行
       * @param value 输入框里的原文
       * @returns 空草稿 true
       */
      function inputResetsToLine(value) {
        return String(value === null || value === undefined ? '' : value) === ''
      }

      /**
       * 有字的输入框该多高 (纯函数)
       *
       * 折行由 `scrollHeight` 自己算, 这一层只管两头: 一行以下不缩、封顶行数以上不长
       * @param measured 量出来的内容高 (`scrollHeight`, 含内边距与 min-height)
       * @param linePx 一行多高
       * @param maxLines 至多几行
       * @returns 该写进 `style.height` 的像素数
       */
      function inputHeightPx(measured, linePx, maxLines) {
        var line = Number(linePx) > 0 ? Number(linePx) : INPUT_LINE_PX
        var lines = Number(maxLines) >= 1 ? Math.floor(Number(maxLines)) : INPUT_MAX_LINES
        var raw = Number(measured)
        if (!isFinite(raw) || raw < line) raw = line
        var cap = line * lines
        return raw > cap ? cap : raw
      }

      /**
       * 一行多高: 取算出来的 line-height
       *
       * 字号那一档会跟着 `--dsh-content-font-delta` 走, 所以不写死量出来的那一份;
       * 取不到 (还没上屏 / 老 WebView) 就回 [INPUT_LINE_PX]
       */
      function inputLinePx(node) {
        try {
          var css = window.getComputedStyle(node)
          var px = css ? parseFloat(css.lineHeight) : 0
          if (isFinite(px) && px > 0) return px
        } catch (_noStyle) {
          // 取不到就用 CSS 那一档, 与 `#lwp-input` 的 line-height 同一个数
        }
        return INPUT_LINE_PX
      }

      /**
       * 把输入框的高度按内容重算一次
       *
       * 空草稿把 inline height 写回 `''` —— 回 CSS 那一行 (min-height 36 / rows=1), 不留上一次
       * 那一截。有字时先放回 `auto` 再量: inline height 还钉着上一次那一份的时候, `scrollHeight`
       * 读到的就是那一份, 直接拿去算等于把旧高度又写一遍
       * @returns 这一拍的高度 (空草稿回 0)
       */
      function autoSizeInput() {
        if (!els.input) return 0
        if (inputResetsToLine(els.input.value)) {
          els.input.style.height = ''
          if (inputPx !== 0) {
            inputPx = 0
            console.log('[luwi-portal] input height reset 1 行')
          }
          return 0
        }
        els.input.style.height = 'auto'
        var px = inputHeightPx(els.input.scrollHeight, inputLinePx(els.input), INPUT_MAX_LINES)
        els.input.style.height = String(px) + 'px'
        if (px !== inputPx) {
          inputPx = px
          console.log('[luwi-portal] input height ' + String(px) + 'px')
        }
        return px
      }

      /**
       * 交给 dsh 自己投递: 与输入框同一条路 (beginSubmission 的 echo 让"发送中"也能画)
       *
       * 2.8.1 #33 起这一条链的规矩是**点一次必然看见结果**: 投出去先在时间线上占一行 (本机那一份,
       * 见 [pendingEcho]); 落盘那条 user 节点到了就换成它; 被拒 / 抛错就换成一条红字 (`who:'error'`),
       * 并且只在这一刻把草稿还回去 —— 以前 `{ok:false}` 只有一行 `console.log`, 屏上就是"按钮转一圈、
       * 什么都没发出去、过一会自己恢复原状"
       */
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
          // 空草稿: 以前是**静默 return** —— 按了 Enter (或那颗钮还能点) 时什么都不发生, 与"按钮变色"
          // 分不开。说一句, 而且那颗钮本来就按不动 (见 [updateSendGate])
          showNote('先写点什么, 再发', true)
          return
        }
        // 2026-11-21 终端: 这一句要落到"电脑那一场"上. 当前不在电脑那几场里时先开一场 ——
        // 草稿原样留在输入框 (下面那条 return 在清空之前), 开好了再发一次
        if (terminalMode && !isTerminalSession(sessionId)) {
          terminalNew()
          showNote('正在电脑上开一场, 开好了再发这一句', true)
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
        // 清空是程序改 value —— 不会来 `input` 事件, 高度必须在这一拍自己收回去 (#51)
        autoSizeInput()
        // 本机先占一行: dsh 的回显要等 Host 收下 prompt 才进快照, 这几拍屏上不该是空的
        pendingEcho = pendingEchoStart(text, attach)
        // 每发一句都把这一场写进账本 (2026-11-20 主人: "每一次门户发送都 portalBind 续一次"):
        // 只在第一句写的话, 门户里聊久了回浮标就换场了 —— 窗口是滑动的, 每一句都重算。
        // **终端里不写** (2026-11-21): 那是电脑那一场, 球不该跟过去
        if (!terminalMode) call('portalBind', sessionId)
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
        // 这一次没成的那一句 (空串 = 成了): `{ok:false}` 与抛错两条路都写进这里, 收尾只判它
        var failed = ''
        // **同步抛也算这一趟的失败**: `session.prompt()` 在桥断了的时候是同步抛的
        // (`Promise.resolve(x())` 拦不住它) —— 那一下会把 `sending` 永远钉在 true, 按钮就一直转圈
        var started
        try {
          started = Promise.resolve(session.prompt(blocks, mode, undefined, requestId))
        } catch (error) {
          started = Promise.reject(error)
        }
        started = started.then(function (result) {
          // `prompt()` 回的是 `{ ok, value | error }` —— 不看它就会**静默失败** (2026-11-08 真机上就是这么
          // "点了发送没反应"的: 图片块被拒, 而 Promise 照样 resolve)
          if (result && result.ok === false) {
            failed = sendFailText(result.error)
            console.log('[luwi-portal] prompt rejected: ' + failed)
            return result
          }
          // 成了才把待发栏清掉: 失败那一趟那几张图还在栏里, 人改一改就能重发
          clearAttach()
          return result
        })
        started
          .catch(function (error) {
            // 抛错 (桥不在 / 传输断了): 与 `{ok:false}` 同一档说法, 屏上不静默
            if (failed === '') failed = sendFailText(error)
            console.log('[luwi-portal] send failed: ' + describeError(error))
          })
          .then(function () {
            if (failed !== '') {
              // 本机占位让给那一条错误 (它不是"发出去了")
              pendingEcho = null
              // dsh 自己把这条拒答记在快照的 `promptError` 上 (门户盖着它那块错误条, 见 [promptErrorText]);
              // 快照里读得到就让它画, 读不到 (抛错那一路) 就本机记一条 —— 两条都在时间线上, 不会两份
              if (promptErrorOf() === '') pushSendFail(failed)
              showNote(failed, true)
              // 草稿只在这一刻还回去 (成了就不还): 人接着改、接着发
              if (els.input && els.input.value === '') {
                els.input.value = text
                // 还回来的是一整段长文本: 高度跟着它, 不然那一段留在屏上 (#51)
                autoSizeInput()
              }
            }
            sending = false
            setSendBusy(false)
            updateSendGate()
            scheduleRender()
          })
      }

      /** dsh 快照里记着的那一条 prompt 拒答 → 屏上那一句 (读不到回空串) */
      function promptErrorOf() {
        if (chatTarget === null || typeof chatTarget.getSnapshot !== 'function') return ''
        var snap
        try {
          snap = chatTarget.getSnapshot()
        } catch (_noSnap) {
          return ''
        }
        return promptErrorText(snap && snap.promptError)
      }

      /** 账本换了场就跟着走 (球超时另开一场时, 门户不该还停在旧的) */
      function pollLedger() {
        // 这一拍顺便兜一件事: FileObserver 漏了事件时把她说的话补读回来
        var wasThinking = phaseThinking()
        status = call('portalStatus')
        // 探索面板开着时跟着盘上那几份文件走 (2.8.1 #12): 这一拍读到的那一份与屏上写着的不同就重画 ——
        // 于是「开始这一趟」投出去之后 `这一趟` 会自己变成「正在跑」, 宿主改写了任务卡也会当场看见
        if (drawer === 'work' && workKey(status && status.explore) !== workShown) renderDrawer()
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
        // 2026-11-21 终端: 球那本账指的是手机这一侧的一场, 不该把终端从电脑那几场上拽走
        // (终端里只跟"电脑那几场"的账本, 别的一律不动屏)
        if (terminalMode && !isTerminalSession(ledger && ledger.id)) {
          renderMeta()
          return
        }
        // 账本过期 (她 30 分钟没说话) 时也跟随一次: 打开应用是想看刚聊过的那一场, 不是想落在一张空 draft 上
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
        // **主动场那几句要投到这一屏上** (2026-11-12 #38, 2026-11-13 收紧成"进当前对话"):
        // 那一场是固定新开的 (预设与主动场硬闸都绑在它身上), 但主人要的是"出现在当前对话里, 不是
        // 只落在那一场独立会话的历史里" —— 所以**不换场**, 只把那一场的 `lw/out` 当成本场时间线上的
        // 几行插进来 (见 [echoes] / [echoItemOf]); 条数 = 触发前 + 1, 上面那段历史一条不动.
        // 换了一场主动对话才重取 (同一个 `startedAt` 只投一次), 之后每拍补尾巴
        // 2026-11-16 (#8): 换场**不清**屏上已有的那几条 —— 连点三次「唤醒一下」三条都要留着;
        // 而且照宿主的 `recent` 把两拍之间被覆盖掉的那一场也补进来 (见 [adoptProactiveRuns])
        var run = status && status.proactive ? status.proactive : null
        if (adoptProactiveRuns(run) === 0) loadEcho(false)
        renderMeta()
      }

      /* ── 终端 (2026-11-21, 落实表 #48) ─────────────────────────────────────────────
       *
       * 主人四条:
       *   ① 终端 = 手机管电脑; 门户点「终端」整页变黑, 没连上电脑时只有「扫码配对 / 返回」两颗钮
       *   ② 终端里头像与名字是强制的 (`luwi` / `luwi终端`), 点头像只列**电脑那几场**会话
       *   ③ 终端里「新建」只建与电脑连的那一场 (落在影子工作区, 第一句话由插件的归属方闸转给电脑)
       *   ④ 终端历史与非终端历史**互不串**: 普通历史里看不到电脑那几场, 终端里也看不到别的
       *
       * 判据在 `check-luwi-portal.mjs` 第二十七节: [underShadow] / [terminalRows] /
       * [terminalGateState] 都是纯函数, 由脚本抽出来真跑
       */

      /** 一个 cwd 的归一写法 (安卓上 `/data/data` 与 `/data/user/0` 指同一处; 尾部斜杠不算) */
      function normalizeCwdPath(value) {
        var text = String(value === undefined || value === null ? '' : value)
        text = text.replace(/^\/data\/data\//u, '/data/user/0/')
        return text.replace(/\/+$/u, '')
      }

      /**
       * 这一条 cwd 在不在影子根底下 (纯函数)
       *
       * 影子根 = 原生报上来的 `$DSH_HOME/lw/peer-workspaces`; 电脑那几场会话的 cwd 都在这底下
       * (投影会话由插件建在这里, 终端里"新建"的那一场也是)。根是空串时一律 false ——
       * 取不到读数就不做任何过滤, 由调用方退回老行为
       * @param {string} cwd 会话的 cwd
       * @param {string} root 影子根
       * @returns {boolean} 在里面就 true
       */
      function underShadow(cwd, root) {
        var base = normalizeCwdPath(root)
        if (base === '') return false
        var path = normalizeCwdPath(cwd)
        if (path === '') return false
        return path === base || path.indexOf(base + '/') === 0
      }

      /**
       * 电脑那几场会话 (纯函数)
       *
       * 与 [historyRows] 同一套排序口径 (当前置顶只在没搜索时, 其余按 updatedAt 倒序, 没时间的沉底),
       * 但只留影子根底下的, 并截到 [TERMINAL_HISTORY_MAX] 条 —— 主人要的是"最近"那几场
       * @param {object} snapshot `ctx.sessions.list.getSnapshot()`
       * @param {string} query 搜索框里的字
       * @param {string|null} currentId 当前画着的那一场
       * @param {string} root 影子根
       * @param {number} [cap] 最多几条
       * @returns {{id: string, title: string, at: number, current: boolean, blank: boolean}[]}
       */
      function terminalRows(snapshot, query, currentId, root, cap) {
        // 影子根都取不到 = 还没连上电脑, 那一档一场都不算 (否则"终端里"会把本机历史也列出来)
        if (normalizeCwdPath(root) === '') return []
        var rows = historyRows(snapshot, query, currentId, { mode: 'terminal', shadowRoot: root })
        var limit = Number(cap)
        if (!isFinite(limit) || limit <= 0) limit = TERMINAL_HISTORY_MAX
        return rows.slice(0, limit)
      }

      /**
       * 1 小时以内最近的那一场 (纯函数, 判据 `check-luwi-portal` 抽出来真跑)
       *
       * 2026-11-21 主人: "进入终端时打开1h内最近终端对话" —— 于是"最近"是三个条件一起: 有
       * `updatedAt` (没时间的沉底, 不当"最近"), 落在窗口里 (恰好 1 小时算在里面), 取时间**最大**那个
       * (不认数组顺序: [terminalRows] 那一列按"当前置顶"排过)
       * @param {{id: string, at: number}[]} rows 电脑那几场 (`terminalRows` 的输出)
       * @param {number} now 现在 (ms)
       * @param {number} windowMs 窗口多宽 (无效 = 没有"最近"这一档, 一律 null)
       * @returns {object|null} 挑中的那一行, 一场都没有就是 null (调用方据它去新建)
       */
      function terminalRecentRow(rows, now, windowMs) {
        var at = Number(now)
        var window = Number(windowMs)
        if (!isFinite(at) || at <= 0) return null
        if (!isFinite(window) || window <= 0) return null
        var list = Array.isArray(rows) ? rows : []
        var best = null
        var bestAt = -1
        for (var i = 0; i < list.length; i += 1) {
          var row = list[i]
          if (!row || typeof row !== 'object') continue
          var when = Number(row.at) || 0
          if (when <= 0) continue
          if (at - when > window) continue
          if (when <= bestAt) continue
          best = row
          bestAt = when
        }
        return best
      }

      /**
       * 上次记下的"退出终端回哪儿"还认不认 (纯函数, 判据 `check-luwi-portal` 抽出来真跑)
       *
       * 页面重载 / 配对重启 host 之后 `TERMINAL_KEY` 里还留着上一次那个返回点, 但那一场可能已经不在了,
       * 也可能本身就是电脑那一场 (老版本只记当前场, 在终端里重载就会记成电脑场) —— 后者不认, 否则
       * "返回"等于没退
       * @param {object|null} stored `readStored(TERMINAL_KEY)` 那一份 (`{on, back:{id}}`)
       * @param {object|null} snapshot `ctx.sessions.list.getSnapshot()`
       * @param {string} root 影子根
       * @returns {{id: string}|null} 认就打这一场, 不认回 null (由调用方记当前这一场)
       */
      function terminalReturnOf(stored, snapshot, root) {
        // 只有"终端还开着"那一份记录才带返回点 (退出时写的是 `{on: false}`, 整条被换掉)
        if (!stored || typeof stored !== 'object' || stored.on !== true) return null
        var back = stored.back
        var id = back && typeof back === 'object' && typeof back.id === 'string' ? back.id : ''
        if (id === '') return null
        var byId = snapshot && typeof snapshot === 'object' && snapshot.byId ? snapshot.byId : {}
        var summary = Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null
        // 快照里没有这一场时**信任**它 (与 [restore] 同一套宽松口径: 列表可能还在加载);
        // 但认得出是电脑那一场就一定不认
        if (summary && typeof summary === 'object' && underShadow(summary.cwd, root)) return null
        return { id: id }
      }

      /**
       * 进终端那一拍该记哪个返回点 (纯函数, 判据抽出来真跑)
       *
       * 三档: 屏上本来就不是电脑那一场 → 就记它; 屏上就是电脑那一场 (老记录没带 `back` / 在终端里重载
       * 过来的) → 记门户自己记忆里那一场 (`SESSION_KEY`, 2026-11-21 起它不会记电脑那几场); 两样都没有 →
       * 记空串, 由 [terminalRestore] 回门户那个默认工作区 —— **绝不能把电脑那一场本身记成返回点**
       * @param {string|null} currentId 屏上这一场
       * @param {string} remember `SESSION_KEY` 里那一场 (读不到就空串)
       * @param {boolean} onPeer 屏上这一场是不是电脑那一场
       * @param {boolean} rememberOnPeer `remember` 那场是不是电脑那一场
       * @returns {{id: string}} 要记的返回点
       */
      function terminalReturnFor(currentId, remember, onPeer, rememberOnPeer) {
        if (onPeer !== true && typeof currentId === 'string' && currentId !== '') return { id: currentId }
        if (rememberOnPeer !== true && typeof remember === 'string' && remember !== '' && remember !== currentId) {
          return { id: remember }
        }
        return { id: '' }
      }

      /**
       * 返回门户那一场"到位了没有" (纯函数, 判据抽出来真跑)
       *
       * 光看 `switchTo` 的返回值不够: 它是"画得上" (`chatTarget` 建起来了), 而 `openSession` 抛
       * `unknown session` 时 dsh 的 mainView 还留在电脑那一场 —— 那一拍会话表再推一版就会把门户拽回去。
       * 所以判据是"画上了 **且** mainView 不再是电脑那一场" (main 读不到时按真算, 没有更好的读数)
       * @param {boolean} drawn `switchTo` 的返回
       * @param {string|null} mainId dsh mainView 那一场 (`currentSessionId()`)
       * @param {string} wantId 要落地的那一场
       * @param {boolean} mainOnPeer mainView 那一场是不是电脑那一场
       * @returns {boolean} 到位了就 true
       */
      function terminalLanded(drawn, mainId, wantId, mainOnPeer) {
        if (drawn !== true) return false
        if (mainId === wantId) return true
        return mainOnPeer !== true
      }

      /**
       * 终端那扇弹窗现在该说哪一句 (纯函数)
       *
       * 四档: 没配对 / 终端关着 / 配对码缺连接口令或通道没开 / 电脑没连上 (探测通了就不弹, 不看配置缺不缺地址); `online` 时**不弹**
       * (状态是空串). 每一档都给一句能照着做的人话 —— 弹窗上那两颗钮不变 (扫码配对 / 返回)
       *
       * **「正在找电脑」只有第一次探测才说** (2026-11-21 主人: "一直会反复闪这个弹窗"): 探针 5/15 秒一拍,
       * 每一拍都先把卡片翻成「正在找电脑」再翻回来就是那个闪。已经有过落定读数 (`probe.at > 0`) 时,
       * 重探那一拍按上一次的结论画 —— 掉线那张卡连原因都不闪 (`probe.why` 在重探期间保留)
       *
       * `probe` 那一格 (2026-11-22) = **这一档要靠活探测才有结论** (探测中 / 电脑没连上), 于是要过
       * `renderTerminalGate` 那 3 秒门槛才许上屏; 没配对 / 终端关着 / 配对码缺口令那三档从配置读得出,
       * 不闪, 也就不必让人对着黑屏等 3 秒
       * @param {object|null} info `portalTerminal()` 那一份
       * @param {{ok: boolean, busy: boolean, why: string, at: number}} probe 最近一次探测
       * @returns {{state: string, title: string, body: string, note: string, install: boolean, probe: boolean}} 界面照它画
       */
      function terminalGateState(info, probe) {
        var paired = !!(info && info.paired === true)
        var at = probe && typeof probe.at === 'number' && isFinite(probe.at) ? probe.at : 0
        var busy = !!(probe && probe.busy === true)
        // 还没有任何落定读数的那一次探测 = 才配说「正在找电脑」; 其余重探都按上一次的结论画
        var firstProbe = busy && !(at > 0)
        var online = !firstProbe && !!(probe && probe.ok === true)
        // 探通了就是通: 配置里缺 `peerUrl` 之类只影响"能不能主动拨", 对端在线这件事以探测为准
        if (online && paired && info && info.syncOn === true) {
          return { state: '', title: '', body: '', note: '', install: false, probe: false }
        }
        if (!paired) {
          // 2026-11-22 (主人: "在没有配对时扫码配对下加一个「去给PC装luwi终端」"): 这一档才多那一颗钮
          return {
            state: 'unpaired',
            title: '连上电脑',
            body: '还没连上电脑。\n在电脑上的 dsh 面板里生成一张配对码, 再用这里扫一下。\n电脑上还没装 luwi终端 的话, 先按下面那颗钮去装。',
            note: '',
            install: true,
            probe: false,
          }
        }
        if (!info || info.syncOn !== true) {
          return {
            state: 'off',
            title: '终端关着',
            body: '终端关着: 在 设置 → 终端 里打开它, 手机才能管电脑。\n也可以直接扫一张新的配对码。',
            note: '',
            install: false,
            probe: false,
          }
        }
        if (info && info.terminalReady === false) {
          return {
            state: 'offline',
            title: '终端还没配好',
            body: '配对码里缺连接口令, 或者对端通道没开。\n在电脑上重新生成一张配对码, 再扫一次。',
            note: '',
            install: false,
            probe: false,
          }
        }
        if (firstProbe) {
          return { state: 'probing', title: '正在找电脑', body: '稍等一下…', note: '', install: false, probe: true }
        }
        var why = probe && typeof probe.why === 'string' ? probe.why : ''
        var who = info && typeof info.pcName === 'string' && info.pcName !== '' ? info.pcName : '电脑'
        return {
          state: 'offline',
          title: '电脑没连上',
          body: '配对过了, 但「' + who + '」那边没应答。\n确认电脑上的 dsh 开着、地址能通; 这里会自动再试。',
          note: why === '' ? '' : '(' + why + ')',
          install: false,
          probe: true,
        }
      }

      /** 原生交回来的那份终端读数 (桥不在 / 老宿主 → 全按未配对) */
      function fetchTerminalInfo() {
        var raw = call('portalTerminal')
        if (raw === null || raw === undefined) return null
        if (typeof raw === 'string') {
          try {
            return JSON.parse(raw)
          } catch (_badJson) {
            return null
          }
        }
        return typeof raw === 'object' ? raw : null
      }

      /** 影子根 (取不到就空串: 那一档不做任何过滤, 老行为一个字节不变) */
      function terminalRoot() {
        var key = TERMINAL_ROOT_KEY
        var value = terminalInfo && terminalInfo[key]
        return typeof value === 'string' ? value : ''
      }

      /** 这一场是不是"电脑那一场" */
      function isTerminalSession(id) {
        if (typeof id !== 'string' || id === '') return false
        var snapshot = sessionsSnapshot()
        var summary = snapshot && snapshot.byId ? snapshot.byId[id] : null
        if (!summary || typeof summary !== 'object') return false
        return underShadow(summary.cwd, terminalRoot())
      }

      /** 列表快照 (读不到就 null: 调用方按空表处理) */
      function sessionsSnapshot() {
        try {
          return ctx.sessions.list.getSnapshot()
        } catch (_noList) {
          return null
        }
      }


      /**
       * 终端那身皮上的记号: 屏上这一场是不是电脑那一场 (2026-11-21 主人: "进入终端时门户的对话仍显示")
       *
       * 写的是 `#lwp-root` 的 `data-term-session` —— 样式表里那条
       * `:not([data-term-session="on"]) #lwp-flow{visibility:hidden}` 靠它兜住 JS 还没跑的第一帧,
       * `renderFlow` 的闸靠它决定要不要画。**不在终端时一律摘掉属性** (门户照旧显示对话)
       */
      function markTerminalSession() {
        if (root === null) return
        if (!terminalMode) {
          root.removeAttribute('data-term-session')
          return
        }
        root.setAttribute('data-term-session', isTerminalSession(sessionId) ? 'on' : 'off')
      }

      /** 把终端那身皮穿上 / 脱掉 (整页黑 + 头栏那颗写「终端 / 对话」+ 强制的身份) */
      function applyTerminalMode() {
        if (root !== null) {
          if (terminalMode) root.setAttribute('data-mode', 'terminal')
          else root.removeAttribute('data-mode')
        }
        // 出口那颗钮的字: 终端里「对话」, 出来写回原生清单那一句 (2026-11-22)
        applySyncTitle()
        // 落到电脑那一场没有: 决定对话上不上屏 (见 [markTerminalSession])
        markTerminalSession()
        // 身份: 终端里名字与头像都归这一页说了算 (见 [applyIdentity] 里那一段覆盖)
        applyIdentity(look || {})
      }

      /**
       * 进终端 (唯一入口: 头栏那颗「终端」、球菜单、抽屉那一行、原生 `terminal(true)`)
       *
       * 三件: 记下"进来之前是哪一场" (退出要回去)、穿皮、探一次电脑。**没连上也进** ——
       * 主人要的是"点终端就全变黑", 弹窗盖在黑底上
       *
       * 返回点也落盘 (2026-11-21): 配对要把 host 重启一次, 页面重载之后这一句还认得出该回哪儿;
       * 上一份记录里那个点要是电脑那一场 (老版本在终端里重载时会记成它) 就不认, 重新记当前这一场
       */
      function openTerminal() {
        if (!mounted) mount()
        terminalInfo = fetchTerminalInfo()
        if (!terminalMode) {
          var kept = terminalReturnOf(readStored(TERMINAL_KEY), sessionsSnapshot(), terminalRoot())
          // 记不上"不是电脑那一场"时退门户自己记忆里那一场 —— 屏上本来就是电脑那一场 (老记录没有 `back`)
          // 也绝不能把它记成返回点, 否则"返回"等于没退
          terminalReturn = kept !== null
            ? kept
            : terminalReturnFor(
              sessionId,
              recallSession(),
              isTerminalSession(sessionId),
              isTerminalSession(recallSession()),
            )
          terminalMode = true
          terminalAutoAt = 0
          // 3 秒门槛从**进来这一拍**起算, 不从第一帧渲染起算 (渲染要等穿皮 / 清 DOM, 慢机上是零点几秒,
          // 算在门槛里就白白多黑一会儿): 探通了当场清 0, 见 [renderTerminalGate]
          terminalGateSince = Date.now()
          writeStored(TERMINAL_KEY, { on: true, back: terminalReturn })
        }
        applyTerminalMode()
        // 门户那几条对话当场下屏 (样式已经靠 `data-term-session` 藏起来了, 这里再把 DOM 也清掉):
        // 落到电脑那一场之后 `renderFlow` 会自己重画, 不必等 3 秒那一拍
        flowSig = null
        renderFlow()
        call('portalTerminalVisible', true)
        probeTerminal()
        scheduleTerminalProbe()
        renderTerminalGate()
      }

      /** 退出终端: 收起那扇窗, 回进终端之前那一场 (见 [terminalRestore]) */
      function closeTerminal() {
        if (!terminalMode) return
        terminalMode = false
        terminalGate = ''
        // 3 秒门槛那一拍也撤掉: 退出之后它再画一次, 就没人管得住了 (下一次进来从自己那一拍重新算)
        terminalGateSince = 0
        if (terminalGateTimer !== null) {
          clearTimeout(terminalGateTimer)
          terminalGateTimer = null
        }
        writeStored(TERMINAL_KEY, { on: false })
        if (terminalProbeTimer !== null) {
          clearTimeout(terminalProbeTimer)
          terminalProbeTimer = null
        }
        closeHistory()
        if (els.termGate) els.termGate.hidden = true
        applyTerminalMode()
        call('portalTerminalVisible', false)
        var back = terminalReturn
        terminalReturn = null
        terminalAutoAt = 0
        // 终端里 `#lwp-flow` 是空的 (见 [renderFlow] 那道闸): 先作废签名, 再把屏换回门户那一场 ——
        // 换成功了那条 `switchTo → follow` 会自己重画; 屏上本来就不是电脑那一场 (没换过场) 时这里当场画一次
        flowSig = null
        terminalRestore(back)
        if (!isTerminalSession(sessionId)) renderFlow()
      }

      /**
       * 退出终端之后把屏换回"进终端之前那一场" (2026-11-21)
       *
       * 两件事:
       * ① 进终端之前门户还没落到任何一场 (`back.id` 空, 冷启动途中点的终端) —— 回门户那个默认工作区,
       *    **不能把人留在电脑那一场**; 屏上本来就不是电脑场时什么都不做
       * ② 有那一场就换回去, 而且**换到真的挂上为止**: 终端把 dsh 的 mainView 带去了影子工作区,
       *    `openSession` 第一下会抛 `unknown session` (那句 `openBallWorkspace` 是异步的), 只试一次
       *    就停会让门户一直停在电脑那一场
       * 真换了场才 15 秒不跟账本 (与「开新对话」同一套): 这中间球那边说了话也不许把界面再拽走
       * @param {{id: string}|null} back `terminalReturn`
       */
      function terminalRestore(back) {
        var id = back && typeof back === 'object' && typeof back.id === 'string' ? back.id : ''
        if (id === '') {
          // 没记返回点: 屏上 (画的那一场 / mainView 那一场) 只要还在电脑那儿就回门户那个默认工作区
          if (isTerminalSession(sessionId) || isTerminalSession(currentSessionId())) {
            landInDefaultWorkspace('back')
          }
          return
        }
        // 根本没换过场 (还没落场就退出来 / 一直没连上电脑): 屏上就是那一场, 一个字节都不用动 ——
        // 白走一趟 `switchTo` 会把门户记录顺手清掉 (那是给"真换了场"准备的)
        if (sessionId === id && chatTarget !== null && currentSessionId() === id) return
        var before = sessionId
        var tries = 0
        function look() {
          // 这中间又点进终端了: 别再抢回来 (那是人的选择)
          if (terminalMode) return
          var drawn = switchTo(id, 'history')
          var main = currentSessionId()
          // 判据不能只看 `switchTo` 的返回值 (那只是"画得上"): mainView 还留在电脑那一场时
          // 会话表再推一版就会把门户拽回去, 所以继续补拍
          if (terminalLanded(drawn, main, id, isTerminalSession(main))) {
            if (before !== id) ledgerHoldUntil = Date.now() + 15000
            return
          }
          tries += 1
          // 5 秒 (250 ms × 20): 这条路一定跨工作区 —— 要等 `openBallWorkspace` 那趟 RPC 回来才落得下,
          // 慢机上 2 秒就点人一句"没打开"太急了 (与 [enterWorkspace] 的 24 拍同一个量级)
          if (tries >= 20) {
            showNote('刚才那一场没打开, 在历史里点一下它', true)
            return
          }
          setTimeout(look, 250)
        }
        look()
      }

      /**
       * 终端里出的事说一句 (同一句一分钟最多一句)
       *
       * 自动那趟 (探针每 5/15 秒一拍) 不能每拍都弹一次提示, 可也不能一声不响地把人留在黑底上 ——
       * 所以静默那条路改走这一颗: 该知道的还是会知道, 只是同一句不刷屏。换了一句 (另一种原因)
       * 就当场说, 不压在上一句的窗口里
       * @param {string} text 要说的话
       */
      function terminalNoteOnce(text) {
        var key = String(text === undefined || text === null ? '' : text)
        if (key === '') return
        var now = Date.now()
        if (key === terminalNotedKey && now - terminalNotedAt < 60000) return
        terminalNotedKey = key
        terminalNotedAt = now
        showNote(key, true)
      }

      /**
       * 探一次电脑: 同源 `GET /luwi-sync/peer-live`
       *
       * 为什么是这条路由: 它本来就会顺手问一次对端 (`/peer/info`), 于是"电脑在不在"与"通道通不通"
       * 是同一个读数; 令牌不出宿主 (页面这一侧一个字节都拿不到)。**只认 `ok === true`** ——
       * 老插件没有这条路由时 dsh 的 SPA 兜底会回一张 index.html, 那不是 JSON
       */
      function probeTerminal() {
        if (terminalProbe.busy) return
        // 还没有落定读数的那一次探测才让卡片说「正在找电脑」; 之后每一拍重探都把上一次的结论
        // (ok / at / why) 原样带过去 —— 卡片只在 `done()` 里按新读数画一次, 不在这一行翻面
        var firstProbe = !(terminalProbe.at > 0)
        terminalProbe = { at: terminalProbe.at, ok: terminalProbe.ok, busy: true, why: terminalProbe.why }
        if (terminalMode && firstProbe) renderTerminalGate()
        var settled = false
        var control = null
        var timer = null
        function done(ok, why) {
          if (settled) return
          settled = true
          if (timer !== null) clearTimeout(timer)
          terminalProbe = { at: Date.now(), ok: ok, busy: false, why: why || '' }
          console.log('[luwi-portal] terminal probe ' + (ok ? 'ok' : 'failed') + (why ? ' (' + why + ')' : ''))
          if (terminalMode) renderTerminalGate()
        }
        timer = setTimeout(function () {
          try {
            if (control) control.abort()
          } catch (_abortRefused) {
            /* 老 WebView 不给 abort 就算了, 下面那一路仍会回一句超时 */
          }
          done(false, '探测超时')
        }, TERMINAL_PROBE_MS)
        try {
          if (typeof AbortController === 'function') control = new AbortController()
          var init = { cache: 'no-store', credentials: 'same-origin' }
          if (control) init.signal = control.signal
          fetch('/luwi-sync/peer-live', init).then(function (response) {
            if (!response || response.ok !== true) {
              // 403 是"这扇门只认本机界面" (反代 / 局域网上的浏览器) —— 与"电脑没连上"分开说
              var status = response && response.status ? response.status : 0
              done(false, status === 403 ? '这一页不是从本机打开的那一份 (控制面只认回环)' : 'HTTP ' + (status || '?'))
              return null
            }
            return response.json().then(function (body) {
              var ok = body !== null && typeof body === 'object' && body.ok === true
              done(ok, ok ? '' : (body && body.error ? String(body.error) : ''))
            }, function () {
              done(false, '不懂的应答')
            })
          }, function () {
            done(false, '网络不通')
          }).catch(function () {
            done(false, '网络不通')
          })
        } catch (_noFetch) {
          done(false, '这一版 WebView 没有 fetch')
        }
      }

      /** 探一次电脑 (在线时降频续探: 掉线要能自己回到弹窗, 不能只试一次) */
      function scheduleTerminalProbe(onlineHint) {
        if (terminalProbeTimer !== null) clearTimeout(terminalProbeTimer)
        // 间隔在**这一拍探之前**算: `probeTerminal()` 一进去就把 `busy` 置真, 探完再算就永远不是 online
        var online = onlineHint === undefined ? terminalProbe.ok === true : onlineHint === true
        terminalProbeTimer = setTimeout(function () {
          terminalProbeTimer = null
          if (!terminalMode) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            scheduleTerminalProbe(online)
            return
          }
          var wasOnline = terminalProbe.ok === true && terminalProbe.busy !== true
          probeTerminal()
          scheduleTerminalProbe(wasOnline)
        }, online ? 15000 : TERMINAL_POLL_MS)
      }

      /**
       * 那扇窗还要再等多久才许上屏 (纯函数, 判据抽出来真跑)
       *
       * `since` = 这一轮"没连上"的第一拍 ([terminalGateSince]); 返回 **0 表示当场就能弹**,
       * 正数 = 还要先黑着的毫秒数. 门槛只算一次: 满 [TERMINAL_GATE_GRACE_MS] 之后每一拍都是 0
       * (掉线卡不会自己再收回去). 还没开始算 (`since` 0 / 读数不全) 时给满门槛 —— 失败关闭
       * @param {number} since 第一拍的时刻
       * @param {number} now 现在
       * @param {number} grace 门槛 (毫秒)
       * @returns {number} 还要等的毫秒数
       */
      function terminalGateWait(since, now, grace) {
        var started = typeof since === 'number' && isFinite(since) ? since : 0
        var at = typeof now === 'number' && isFinite(now) ? now : 0
        var span = typeof grace === 'number' && isFinite(grace) && grace > 0 ? grace : 0
        if (span === 0) return 0
        if (!(started > 0)) return span
        var waited = at - started
        if (!(waited > 0)) return span
        return waited >= span ? 0 : span - waited
      }

      /**
       * 把那扇窗按当前读数重画; online 时顺手把终端带进"最近那一场"
       *
       * **没连上不满 3 秒不弹** ([TERMINAL_GATE_GRACE_MS], 2026-11-22 主人): 一进终端先黑着 ——
       * 首探多半一瞬就有读数, 从前那张「正在找电脑」就是这样一闪而过. 门槛从这一轮"没连上"的
       * **第一拍**起算 ([terminalGateSince]), 探通了当场清 0; 黑着那段只挂一个到点重画的计时器,
       * 不打轮询、也不提前上屏
       *
       * 门槛只管 `said.probe === true` 那两档 (探测中 / 电脑没连上 —— 它们要靠活探测才有结论);
       * 没配对 / 终端关着 / 配对码缺口令是从配置读出来的, 不闪, 当场就画
       */
      function renderTerminalGate() {
        if (!terminalMode || !els.termGate) return
        var said = terminalGateState(terminalInfo, terminalProbe)
        terminalGate = said.state
        if (said.state === '') {
          terminalGateSince = 0
          if (terminalGateTimer !== null) {
            clearTimeout(terminalGateTimer)
            terminalGateTimer = null
          }
          els.termGate.hidden = true
          terminalEnter()
          return
        }
        var now = Date.now()
        if (said.probe === true) {
          if (!(terminalGateSince > 0)) terminalGateSince = now
          var wait = terminalGateWait(terminalGateSince, now, TERMINAL_GATE_GRACE_MS)
          if (wait > 0) {
            // 还没到 3 秒: 先黑着, 到点再画一次 (这中间探通了就走上面那条, 这张卡一次都不上屏)
            els.termGate.hidden = true
            if (terminalGateTimer === null) {
              terminalGateTimer = setTimeout(function () {
                terminalGateTimer = null
                renderTerminalGate()
              }, wait)
            }
            return
          }
        } else {
          terminalGateSince = 0
        }
        if (terminalGateTimer !== null) {
          clearTimeout(terminalGateTimer)
          terminalGateTimer = null
        }
        els.termGate.hidden = false
        if (els.termTitle) els.termTitle.textContent = said.title
        if (els.termBody) els.termBody.textContent = said.body
        if (els.termInstall) els.termInstall.hidden = said.install !== true
        if (els.termNote) {
          els.termNote.textContent = said.note
          els.termNote.hidden = said.note === ''
        }
      }

      /**
       * 把"电脑那个工作区"找出来 (只找, **不建**)
       *
       * 为什么不在本地建: 插件的影工作区布局是 `<影子根>/<对端 deviceId>/<工作区名>`
       * (`shadowDirName`), 页面拿不到那个 deviceId; 自建一个 `<影子根>/<电脑名>` 会让归属方闸
       * 认不出是哪个工作区, 那几句话在电脑上就落到"最近那个工作区"去了。所以这一层只等插件把影子
       * 工作区同步出来 (对端在线时几秒就有), 没有就明说 —— 不假装开了一场
       * @param {(id: string) => void} done 空串 = 现在还没有
       * @param {boolean} [quiet] 自动那趟 (`terminalEnter`) 传真: 等不到只说给日志, 不刷屏
       */
      function ensureTerminalWorkspace(done, quiet) {
        var base = terminalRoot()
        if (base === '') {
          if (quiet) {
            console.log('[luwi-portal] terminal auto-enter: no shadow root yet')
            terminalNoteOnce('终端读数还没取到, 稍后再试')
          } else showNote('终端读数还没取到, 稍后再试', true)
          done('')
          return
        }
        var tries = 0
        function look() {
          var ready = terminalWorkspaceOf(workspaceItems(), base)
          if (ready !== '') {
            done(ready)
            return
          }
          tries += 1
          if (tries >= 40) {
            if (quiet) {
              console.log('[luwi-portal] terminal auto-enter: no shadow workspace yet')
              terminalNoteOnce('电脑那边还没有对话同步过来: 等它连上再开')
            } else showNote('电脑那边还没有对话同步过来: 等它连上再开', true)
            done('')
            return
          }
          setTimeout(look, 250)
        }
        look()
      }

      /** 影子根底下的那个工作区 (纯查表; 没有就空串) */
      function terminalWorkspaceOf(items, root) {
        var list = Array.isArray(items) ? items : []
        for (var i = 0; i < list.length; i += 1) {
          var item = list[i]
          if (!item) continue
          var id = String(item.workspaceId || item.id || '')
          if (id === '') continue
          if (underShadow(item.path, root)) return id
        }
        return ''
      }

      /**
       * 终端里的「新建」: 只建与电脑连的那一场
       *
       * 落到影子工作区里的一场新会话 —— 第一句话由插件的 `agent/pre-step` 闸按 `target:{kind:'new'}`
       * 转给电脑, 电脑那边新开一场, 回答再折回这一场 (这就是"手机开新对话发送到 pc")
       * @param {{quiet: boolean}} [options] 自动进终端那一趟不带提示 (窗口 1 小时内没有电脑对话时它会走到这里)
       */
      function terminalNew(options) {
        if (navigating) return
        if (!terminalMode) return
        var quiet = !!(options && options.quiet === true)
        var before = sessionId
        ensureTerminalWorkspace(function (workspaceId) {
          if (workspaceId === '') return
          // 等这 10 秒的中间可能已经退出终端了: 那就别再开影子工作区, 否则 dsh 的 mainView
          // 会被人留在电脑那一场上 (那句"返回就回门户那一场"就白说了)
          if (!terminalMode) return
          navigating = true
          var opening = null
          try {
            opening = ctx.uiWorkspace.openWorkspace(workspaceId)
          } catch (error) {
            navigating = false
            if (quiet) {
              console.log('[luwi-portal] terminal auto-new: openWorkspace threw: ' + describeError(error))
              terminalNoteOnce('电脑那个工作区打不开: ' + describeError(error))
            } else showNote('电脑那个工作区打不开: ' + describeError(error), true)
            return
          }
          if (opening && typeof opening.catch === 'function') {
            opening.catch(function (reason) {
              console.log('[luwi-portal] terminal openWorkspace failed: ' + describeError(reason))
            })
          }
          var tries = 0
          function look() {
            // 这一趟等出来的新场不许把人从门户那一场拽走 (退出终端之后这场就不算数了)
            if (!terminalMode) {
              navigating = false
              return
            }
            tries += 1
            var id = currentSessionId()
            if (id !== null && bindingOf(id) !== undefined) {
              land(id)
              return
            }
            if (tries >= 24) {
              navigating = false
              if (quiet) {
                console.log('[luwi-portal] terminal auto-new: no session appeared')
                terminalNoteOnce('电脑那边没开出来, 稍后再试')
              } else showNote('电脑那边没开出来, 稍后再试', true)
              return
            }
            setTimeout(look, 150)
          }
          function land(id) {
            navigating = false
            switchTo(id, 'new')
            ledgerHoldUntil = Date.now() + 15000
            renderMeta()
            renderFlow()
            if (!quiet && id === before) showNote('已经是新对话了')
          }
          setTimeout(look, 150)
        }, quiet)
      }

      /**
       * 进终端之后落到哪一场 (2026-11-21 主人的口径)
       *
       * - 已经在电脑那几场里: **不动** —— 人可能刚从终端历史里挑了更早的一场, 重探一拍不许把它拽走
       * - 否则看 1 小时内最近那一场 ([terminalRecentRow]) → 换过去
       * - 1 小时内一场都没有 → **新建一场与电脑连的对话** ([terminalNew]), 这一趟静默
       * 自动那趟 20 秒最多一次 ([TERMINAL_ENTER_COOLDOWN_MS]): 建不出来时别每个探测拍都重来一遍
       */
      function terminalEnter() {
        if (!terminalMode) return
        if (isTerminalSession(sessionId)) return
        if (Date.now() - terminalAutoAt < TERMINAL_ENTER_COOLDOWN_MS) return
        terminalAutoAt = Date.now()
        var recent = terminalRecentRow(
          terminalRows(sessionsSnapshot(), '', sessionId, terminalRoot(), TERMINAL_HISTORY_MAX),
          Date.now(),
          TERMINAL_RECENT_MS,
        )
        if (recent === null) {
          terminalNew({ quiet: true })
          return
        }
        // 那一场所在的影子工作区可能还没打开 (`follow` 里 `openSession` 会抛, 之后要等一轮) ——
        // 与 `pollLedger` 同一个做法: 开不出来就补拍几次, 不要只试一次就把人留在本地那一场
        var tries = 0
        function look() {
          if (!terminalMode) return
          if (isTerminalSession(sessionId)) return
          if (switchTo(recent.id, 'history')) return
          tries += 1
          if (tries >= 8) {
            // 自动那趟一分钟最多说一句 (人没点任何东西, 但黑底上也不能一声不响), 下一拍过了冷却再试
            console.log('[luwi-portal] terminal auto-enter: could not open ' + recent.id)
            terminalNoteOnce('电脑那一场现在打不开, 稍后再试')
            return
          }
          setTimeout(look, 250)
        }
        look()
      }

      /**
       * 返回键先问这一句 (2026-11-21; 由 [PAGE_BACK_JS] 调)
       *
       * 顺序: 弹窗 / 终端 → 历史窗 → 抽屉 → 预览窗。收掉一件回 `closed`, 什么都没收就 `none`
       * (后者让原生把这一下还给「再按一次退出」)
       */
      function terminalBack() {
        if (terminalMode) {
          closeTerminal()
          return 'closed'
        }
        if (historyOpen) {
          closeHistory()
          return 'closed'
        }
        if (drawer !== '') {
          openDrawer('')
          return 'closed'
        }
        if (els.preview && els.preview.hidden === false) {
          closePreview()
          return 'closed'
        }
        return 'none'
      }

      /**
       * 原生那两句 (`terminal(true/false)`) 的落点: 幂等
       *
       * 已经在终端里时只重探一次 (页面重载 / 配完对回来那一拍), 不重复记 `terminalReturn`;
       * 顺手把自动那趟的冷却清掉 —— 这一句是**人点进来的** (头栏 / 球菜单), 刚失败过再点一次就该当场再试
       */
      function setTerminal(open) {
        var want = open !== false
        if (want) {
          if (terminalMode) {
            terminalInfo = fetchTerminalInfo()
            terminalAutoAt = 0
            probeTerminal()
            renderTerminalGate()
            return
          }
          openTerminal()
          return
        }
        closeTerminal()
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
        // 左边 = 头像 (2026-11-19 主人: "点击头像开新对话改为打开历史" + "生效范围缩小到头像大小"):
        // 那颗钮里只有 28px 的头像, **热区就是头像** —— 昵称搬到它旁边当标识, 点不亮任何东西。
        // 头像与昵称都由 `applyIdentity()` 从 `portalLook` 那一份里填 (2026-11-10 起可在外观里改)
        els.head = head
        els.brand = h('button')
        els.brand.id = 'lwp-brand'
        els.brand.type = 'button'
        els.brand.setAttribute('aria-label', '历史对话')
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
        els.brand.onclick = function () { openHistory() }
        // 头栏这里**不留**「‹ 返回」 (2026-11-22 主人: "终端不加返回按钮, 而是从终端按钮返回")
        // 终端的出口是右边那颗钮: 在终端里它写「对话」(见 [applySyncTitle]), 点一下回门户那一场
        head.appendChild(els.brand)
        // 昵称与读数: 只是标识 (不进那颗头像按钮, 否则又变成"整块可点")
        var brandText = h('span', 'lwp-brand-text')
        els.brandName = h('span', 'lwp-brand-name', DEFAULT_NAME)
        brandText.appendChild(els.brandName)
        els.meta = h('span', 'lwp-meta', '')
        brandText.appendChild(els.meta)
        head.appendChild(brandText)
        // 右边三颗 (2026-11-20 主人: "顶栏应该是语音输出，是喇叭形状" / "都要放在靠近更多按钮的位置,
        // 向右对齐"): **自动朗读 → 终端 → ⋯** 装进 `#lwp-tabs` 这一簇, `margin-left:auto` 挂在
        // 那一簇上 —— 三颗一起贴最右, 不再跟着昵称走
        var tabs = h('div')
        tabs.id = 'lwp-tabs'
        els.tabs = tabs
        els.speakButton = h('button', 'lwp-tab lwp-tab-icon')
        els.speakButton.id = 'lwp-speak-btn'
        els.speakButton.type = 'button'
        els.speakButton.setAttribute('aria-pressed', 'false')
        els.speakButton.setAttribute('data-on', 'off')
        els.speakButton.setAttribute('aria-label', '已关闭自动朗读')
        els.speakButton.title = '已关闭自动朗读'
        // 两副图标照官方手机端那两张: 关 = 喇叭 + 斜杠, 开 = 喇叭 + 两道声波 (见 [applySpeakStatus])
        els.speakButton.innerHTML = SPEAKER_OFF_ICON
        els.speakButton.onclick = function () { toggleSpeak() }
        tabs.appendChild(els.speakButton)
        // 「同步」搬出抽屉并改名「终端」(2026-11-20): 文案与开关态从 `portalMenu()` 来 ——
        // 页不另写死字, 一处 rename 两处跟着变; 2026-11-22 起它在终端里改写成「对话」([applySyncTitle])
        els.syncButton = h('button', 'lwp-tab', SYNC_TITLE)
        els.syncButton.id = 'lwp-sync-btn'
        els.syncButton.type = 'button'
        els.syncButton.setAttribute('data-on', 'off')
        els.syncButton.setAttribute('aria-label', SYNC_TITLE)
        els.syncButton.onclick = function () { pickSync() }
        tabs.appendChild(els.syncButton)
        els.moreButton = h('button', 'lwp-tab lwp-more', '⋯')
        els.moreButton.id = 'lwp-more-btn'
        els.moreButton.type = 'button'
        els.moreButton.setAttribute('aria-label', '更多')
        els.moreButton.onclick = function () { openDrawer(drawer === '' ? 'menu' : '') }
        tabs.appendChild(els.moreButton)
        head.appendChild(tabs)
        root.appendChild(head)

        // 「已开新对话」: **浮在头栏下面的一层** (absolute, 不占排版), 8 秒后自己收
        els.undo = h('div')
        els.undo.id = 'lwp-undo'
        els.undo.hidden = true
        els.undo.setAttribute('role', 'status')
        els.undo.setAttribute('aria-live', 'polite')
        els.undo.appendChild(h('span', null, '已开新对话'))
        root.appendChild(els.undo)

        /* ── 终端那扇「扫码配对 / 返回」(2026-11-21, 落实表 #48) ─────────────────────
         *
         * 黑底上的一张小卡: **恒有两颗钮** —— 主钮「扫码配对」、次钮「返回」(退出终端)。
         * 文案按 `terminalGateState()` 那四档换, 钮不换 (主人只要这两颗)
         */
        els.termGate = h('div')
        els.termGate.id = 'lwp-term-gate'
        els.termGate.hidden = true
        els.termGate.setAttribute('role', 'dialog')
        els.termCard = h('div', 'lwp-term-card')
        els.termTitle = h('div', 'lwp-term-title', '连上电脑')
        els.termBody = h('div', 'lwp-term-body', '')
        els.termCard.appendChild(els.termTitle)
        els.termCard.appendChild(els.termBody)
        var termRow = h('div', 'lwp-term-row')
        els.termPair = h('button', null, '扫码配对')
        els.termPair.type = 'button'
        els.termPair.setAttribute('data-primary', 'on')
        els.termPair.onclick = function () { call('portalTerminalPair') }
        // 2026-11-22 (主人: "在没有配对时扫码配对下加一个「去给PC装luwi终端」"): 只在没配对那一档出现,
        // 点它落一个掷标给原生, 由它开系统浏览器 (页面自己开不了外部浏览器)
        els.termInstall = h('button', null, '去给 PC 装 luwi终端')
        els.termInstall.type = 'button'
        els.termInstall.hidden = true
        els.termInstall.onclick = function () { call('portalTerminalInstall') }
        els.termExit = h('button', null, '返回')
        els.termExit.type = 'button'
        els.termExit.onclick = function () { closeTerminal() }
        termRow.appendChild(els.termPair)
        termRow.appendChild(els.termInstall)
        termRow.appendChild(els.termExit)
        els.termCard.appendChild(termRow)
        els.termNote = h('div', 'lwp-term-note', '')
        els.termNote.hidden = true
        els.termCard.appendChild(els.termNote)
        els.termGate.appendChild(els.termCard)
        root.appendChild(els.termGate)

        /* ── 长按说话那条录音条 (2026-11-20 三次改口径; 2.8.1 #F10 加实时文字层) ───────
         *
         * 行序: 第一行「红点 + 提示 + 上滑时那枚向下箭头」和「计时胶囊」分居左右; 第二行是波形
         * (右侧一颗 24px 显隐钮, 点波形本身也是同一件事); 第三行是实时文字层; 转写中把后两行换成
         * 三个点。**不吃事件** (`pointer-events:none`): 手指还压在原来的输入框上, 抬手与上滑都得
         * 照旧落在它那一侧 —— 长按那一刻把 DOM 换掉, 抬手事件会被一起吞掉; 只有波形行与那颗钮
         * 自己把事件收回来 (它们要接着点)
         */
        els.rec = h('div')
        els.rec.id = 'lwp-rec'
        els.rec.setAttribute('data-on', 'off')
        els.rec.setAttribute('data-live', 'on')
        els.rec.setAttribute('role', 'status')
        els.recRow = h('div')
        els.recRow.id = 'lwp-rec-row'
        els.recHint = h('div', 'lwp-rec-hint')
        els.recDot = h('i', 'lwp-rec-dot')
        els.recHint.appendChild(els.recDot)
        els.recHint.appendChild(h('span'))
        els.recArrow = h('i')
        els.recArrow.className = 'lwp-rec-arrow'
        els.recArrow.innerHTML = ARROW_DOWN_ICON
        els.recHint.appendChild(els.recArrow)
        els.recRow.appendChild(els.recHint)
        els.recText = els.recHint.querySelector('span')
        if (els.recText) {
          els.recText.className = 'lwp-rec-text'
          els.recText.setAttribute('aria-live', 'polite')
          els.recText.textContent = REC_HINT
        }
        els.recTime = h('div', 'lwp-rec-time', '0:00 / 5:00')
        els.recRow.appendChild(els.recTime)
        els.rec.appendChild(els.recRow)
        // 波形那一行: 走带画布 + 右端一颗显隐钮 (实时文字层的开关, 不碰录音)
        els.recWaveRow = h('div', 'lwp-rec-wave-row')
        els.recWave = document.createElement('canvas')
        els.recWave.className = 'lwp-rec-wave'
        els.recWave.setAttribute('aria-hidden', 'true')
        els.recWaveRow.appendChild(els.recWave)
        els.recLiveBtn = h('button', 'lwp-rec-live-btn')
        els.recLiveBtn.type = 'button'
        els.recLiveBtn.setAttribute('aria-pressed', 'true')
        els.recLiveBtn.innerHTML = LIVE_ON_ICON
        els.recWaveRow.appendChild(els.recLiveBtn)
        els.rec.appendChild(els.recWaveRow)
        // 实时文字层: `aria-live` 让读屏跟着念, 两行封顶之后自己往上滚
        els.recLive = h('div', 'lwp-rec-live')
        els.recLive.id = 'lwp-voice-live'
        els.recLive.setAttribute('aria-live', 'polite')
        els.recLive.setAttribute('data-long', 'off')
        els.rec.appendChild(els.recLive)
        els.recDots = h('div', 'lwp-rec-dots')
        els.recDots.appendChild(h('i'))
        els.recDots.appendChild(h('i'))
        els.recDots.appendChild(h('i'))
        els.recDots.setAttribute('aria-hidden', 'true')
        els.rec.appendChild(els.recDots)
        root.appendChild(els.rec)
        wireRecLiveToggle()
        applyRecLive()

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
        // 一滑动就把那颗菜单收起: 它按手指那一点定过一次位, 流一动就与那一份文件对不上了
        els.flow.addEventListener('scroll', function () { closeFileMenu() }, { passive: true })
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
        els.input.placeholder = VOICE_HINT
        els.input.rows = 1
        els.input.addEventListener('keydown', function (event) {
          // 敲键盘就是"我要打字": 那颗长按计时器当场作废
          if (pressTimer !== null) clearTimeout(pressTimer)
          pressTimer = null
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send('queue')
          }
        })
        els.input.addEventListener('input', function () {
          updateSendGate()
          // 高度跟着内容长, 上限那一档写在 CSS 的 max-height 里 (14 行); 换算只有 [autoSizeInput] 一份
          autoSizeInput()
        })
        /* ── 长按空输入框 = 当场开录 (2026-11-20 主人: "长按不是显示语音输入，而是直接开始录音") ──
         *
         * **只在草稿为空时接管**: 有字时长按仍是系统的选中 / 粘贴那一套 (浏览器自己办), 否则输入框里
         * 就没法选字了。计时器在抬手 / 手指一动 / 落键 / 失焦时都撤掉 —— 早撤晚撤都是"这一下不是长按"
         *
         * `contextmenu` 是 WebView 里长按真正会来的那一下 (系统的选中菜单): 空草稿时吃掉它, 免得
         * 菜单盖在面板上; 有字时留着 (粘贴要用)
         */
        /**
         * 长按那 450 ms 里把输入的 `touch-action` 关掉 (2026-11-20 真机)
         *
         * 不关的话, 按住再往上划会被 Chromium 判成页面滚动, 于是先来一发 `pointercancel` ——
         * 长按的计时器被撤掉、上滑取消那一路也永远走不到。收手时立刻还原, 免得影响正常的选区与滚动
         */
        var releaseTouchAction = function () {
          if (els.input) els.input.style.touchAction = ''
        }
        var cancelPress = function () {
          if (pressTimer === null) return
          clearTimeout(pressTimer)
          pressTimer = null
          releaseTouchAction()
        }
        els.input.addEventListener('pointerdown', function (event) {
          if (voiceState === 'recording' || voiceState === 'working') return
          if (String(els.input.value || '').trim() !== '') return
          cancelPress()
          // 起手那一点记下来: 上滑取消按它算, 而"手指抖一下"不算取消了长按
          if (els.input) els.input.style.touchAction = 'none'
          var y = Number(event && event.clientY)
          recStartY = isFinite(y) ? y : 0
          pressStartX = Number(event && event.clientX) || 0
          pressStartY = recStartY
          pressTimer = setTimeout(function () {
            pressTimer = null
            beginHoldRecording()
          }, VOICE_LONG_PRESS_MS)
        })
        els.input.addEventListener('pointerup', cancelPress)
        els.input.addEventListener('pointercancel', cancelPress)
        els.input.addEventListener('pointermove', function (event) {
          if (pressTimer === null) return
          // 手指挪过 40 px 才当"这不是长按": 真机按住不动也会抖, 40 px 也不会误伤"轻轻一划" ——
          // 宁可多认一次长按 (抬手就能取消录音), 也不要让长按在这台机器上十次里八次不响
          var dx = (Number(event && event.clientX) || 0) - pressStartX
          var dy = (Number(event && event.clientY) || 0) - pressStartY
          if (Math.sqrt(dx * dx + dy * dy) > 40) cancelPress()
        })
        els.input.addEventListener('blur', cancelPress)
        els.input.addEventListener('contextmenu', function (event) {
          if (String(els.input.value || '').trim() !== '') return
          event.preventDefault()
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
        // 选择器盖上来 / 回到页面 (2.8.1 #13): 那段时间计时器停着, 回来先给宿主一句回话的机会 ——
        // 没有这一句, 每次选图都会多一条假的「webview 未回调」(见 [pickWatchVisibility])
        document.addEventListener('visibilitychange', function () { pickWatchVisibility() })

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
        // 轻点 = queue, 按住到点 = steer (2.8.1 #33): 一次按下只许投一次 —— 判据全在 [sendGesture]
        // 那个纯函数里, 这里只负责挂计时器与调 send
        var sendPress = { pressed: false, fired: false }
        var sendTimer
        /** 抬起 / 撤掉计时器一处收口: 状态机与计时器必须一起复位, 否则下一次按下会被判 'ignore' */
        function endSendPress(event) {
          var step = sendGesture(sendPress, event)
          sendPress = step.state
          if (sendTimer !== undefined) {
            clearTimeout(sendTimer)
            sendTimer = undefined
          }
          return step
        }
        els.send.addEventListener('pointerdown', function () {
          var step = sendGesture(sendPress, 'down')
          sendPress = step.state
          if (step.act !== 'arm') return
          sendTimer = setTimeout(function () {
            sendTimer = undefined
            var held = sendGesture(sendPress, 'hold')
            sendPress = held.state
            if (held.act === 'hold') {
              send('steer')
              // **投出去就复位** (2.8.1 #33 审查): send() 立刻把按钮置 disabled, 手指还按着时
              // 表单项收不到 pointerup —— 不复位就卡在 `fired`, 此后每次轻点都判 'ignore',
              // 屏上又是「按了没反应」
              sendPress = { pressed: false, fired: false }
            }
          }, SEND_HOLD_MS)
        })
        els.send.addEventListener('pointerup', function () {
          var step = endSendPress('up')
          if (step.act === 'tap') send('queue')
        })
        els.send.addEventListener('pointercancel', function () { endSendPress('cancel') })
        // 按钮被置 disabled 之后 pointerup 不再送到它身上 (Chromium 不给 disabled 控件派发 pointer 事件):
        // 补一条窗口捕获阶段的兜底, 只在还按着的时候收口 —— 正常那一路已经复位, 这里不会再投第二次
        window.addEventListener('pointerup', function () {
          if (sendPress.pressed) endSendPress('cancel')
        }, true)
        window.addEventListener('pointercancel', function () {
          if (sendPress.pressed) endSendPress('cancel')
        }, true)
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

        // **拖文件进来就能加附件** (2.8.1 #34 主人: "前台门户的输入框也要像后台DSH一样可拖放文件加入")
        // 卡与 dock 都挂: 落点常在卡片外沿或表情面板那块空白上, 只挂一个就会"拖过来没反应"; 两条路
        // 汇进同一个 `onFilesChosen`, 与 `+` 选完完全同一根链 (读字节 → portalStash 落 lw-in/ → chip)
        // 拖进来的说明牌 (2026-11-19 主人: "图可以放了, 但最好再加上如图所示的提示"): 建在这里,
        // 显示由 CSS 管 —— `#lwp-card[data-drop="over"] #lwp-drop-hint{display:flex}`, 与那圈虚线
        // 同一把开关 (`markDrop`), 于是"拖进来就有提示、松手就没"不需要第二份状态
        //
        // 两行字里的上限取**本机真数** (MAX_ATTACH / MAX_STASH_BYTES): 后台 dsh 那句"20 张, 每张
        // 50MB"是它自己的上限, 照抄过来就是骗人
        els.hint = h('div')
        els.hint.id = 'lwp-drop-hint'
        var dropMarks = h('div', 'lwp-drop-marks')
        dropMarks.innerHTML = DROP_MARKS_SVG
        els.hint.appendChild(dropMarks)
        var dropTitle = h('div', 'lwp-drop-title')
        dropTitle.textContent = '文件或图片拖动到此处即可添加'
        els.hint.appendChild(dropTitle)
        var dropSub = h('div', 'lwp-drop-sub')
        dropSub.textContent = '最多 ' + MAX_ATTACH + ' 个附件, 每份不超过 '
          + Math.round(MAX_STASH_BYTES / (1024 * 1024)) + ' MB'
        els.hint.appendChild(dropSub)
        card.appendChild(els.hint)

        els.card = card
        els.dock = dock
        bindDropTarget(els.card)
        bindDropTarget(els.dock)

        els.drawer = h('div')
        els.drawer.id = 'lwp-drawer'
        els.drawer.hidden = true
        root.appendChild(els.drawer)

        // 顶上那颗提示 (2.8.1 #12): 抽屉里「开始这一趟 / 刷新」的回执写这里 —— 输入卡那行 `#lwp-note`
        // 在抽屉后面, 写了也看不见。挂在 root 上而不是抽屉里: 重画抽屉 (每 3 s 比一次读数) 不会连带清掉
        els.toast = h('div')
        els.toast.id = 'lwp-toast'
        els.toast.setAttribute('role', 'status')
        els.toast.hidden = true
        root.appendChild(els.toast)

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

        /* ── 长按文件那颗菜单 (落实表 #41, 2026-11-13) ─────────────────────────
         *
         * 两个动作: 复制这一份的绝对路径 / 交给系统里接它的应用。菜单本体只建一次, 每次长按只改
         * 名字与落点 (`openFileMenu`), 收起是 `hidden` —— 与抽屉、预览窗同一条手感
         */
        els.fileMenu = h('div')
        els.fileMenu.id = 'lwp-file-menu'
        els.fileMenu.hidden = true
        els.fileMenu.setAttribute('role', 'menu')
        els.fileMenuName = h('div', 'lwp-file-menu-name', '')
        els.fileMenu.appendChild(els.fileMenuName)
        els.fileMenuNote = h('div', 'lwp-file-menu-note', '这一份没有留下路径')
        els.fileMenuNote.hidden = true
        els.fileMenu.appendChild(els.fileMenuNote)
        els.fileMenuCopy = fileMenuItem('复制路径', function () { copyFilePath() })
        els.fileMenu.appendChild(els.fileMenuCopy)
        els.fileMenuOpen = fileMenuItem('用其它应用打开', function () { openFileWithSystem() })
        els.fileMenu.appendChild(els.fileMenuOpen)
        // 菜单自己那一块吃掉 click: 否则点菜单里的空白处会一路冒到下面的消息上
        els.fileMenu.onclick = function (event) { event.stopPropagation() }
        root.appendChild(els.fileMenu)

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
        els.historyTitle = h('div', 'lwp-history-title', '历史对话')
        historyHead.appendChild(els.historyTitle)
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

        /* 选工作区那一窗已删 (2026-11-13): 首启由 landInDefaultWorkspace 静默落进 `<工作区根>/Luwi`,
         * 界面不再有需要人点的选择入口 */

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
        // 长按文件那颗菜单先判: 它浮在手指那一点上, 点到它自己以外就收起
        if (els.fileMenu && !els.fileMenu.hidden) {
          if (target instanceof Node && els.fileMenu.contains(target)) return
          closeFileMenu()
        }
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
        else onVisible()
      }

      /**
       * 回到前台 (2026-11-12 #38, 主人: "门户对话记录不可自动清空" + "打开应用要显示最新的消息")
       *
       * 撤队撤掉的那些条本来会永远不上屏 —— 取水位已经推到文件尾, 而 `releasedIds` 还是 false,
       * 于是"她在这段时间说的话"一条都补不回来。所以回来先 `loadOut(true)` **从文件重取全量**:
       * 一次画完、不排队; 视线落到底 (最新那条). 再立刻问一拍账本与主动场 —— 不等那 3 s 定时器
       */
      function onVisible() {
        if (typeof document !== 'undefined' && document.hidden) return
        loadOut(true)
        // 那一场的 jsonl 也重取一次: 后台这十分钟她说的几句一条都不少 (2026-11-12 #38)
        loadEcho(true)
        stickOn = true
        pollLedger()
        scheduleRender()
        stickFlow()
      }

      /* ── 账号: 首启引导那一行要的三件事 (2026-11-14) ─────────────────────────── */

      /**
       * 把一次账号动作的结果送回宿主 (Kotlin 那侧 `PortalBridge.lwAccountResult`)
       * @param action `status` / `login` / `key`
       * @param body 结果本体
       */
      function reportAccount(action, body) {
        var payload = body || {}
        payload.action = action
        try {
          call('lwAccountResult', JSON.stringify(payload))
        } catch (error) {
          console.log('[luwi-portal] account report failed: ' + describeError(error))
        }
      }

      /**
       * 问一次宿主那条 `/lw-account` 路由 (2026-11-14)
       *
       * **为什么不走 `remote.account` / `remote.credentials`**: 那是 dsh 开给**自家账号页**的缝,
       * 第三方插件直接调会一声不响地挂住 (真机读数: 12 s 没有回音)。这条路由是宿主进程里那条直路 ——
       * 它后面就是 `deepseekAccount` 与 `credentials` 两个服务本身
       * @param op `status` / `login` / `key`
       * @param body 另外几个字段 (`key` 那一档用)
       * @returns 宿主回的那一段对象 (失败也是对象: `{ok:false, error}`)
       */
      function askHostAccount(op, body) {
        var payload = body || {}
        payload.op = op
        var locale = 'zh'
        try {
          locale = ctx.locale.getSnapshot().active || 'zh'
        } catch (_noLocale) {
          locale = 'zh'
        }
        payload.locale = locale
        // 登录那条要宿主知道"回调落在哪": 换 token 的那一步发生在这一页的 origin 上
        if (op === 'login') payload.origin = window.location.origin
        return fetch('/lw-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(function (answer) { return answer.json() })
      }

      /** 读一次账号状态: 登录了没有 / 账号档模型那条凭据写了没有 (两条都由宿主一起答) */
      function accountStatus() {
        askHostAccount('status').then(function (result) {
          reportAccount('status', result || { ok: false, error: 'no reply' })
        }, function (error) {
          reportAccount('status', { ok: false, error: describeError(error) })
        })
      }

      /**
       * 起一次登录: 宿主要一个授权地址, 这一侧把它交给系统浏览器 (2026-11-14)
       *
       * 宿主那条回环回调就是这一页的 origin —— 浏览器里登录完之后, 换 token 那一步仍然在 app 的 host
       * 里完成, 回来读一次状态就能看到已登录
       */
      function accountLogin() {
        reportAccount('login', { ok: true, pending: true })
        askHostAccount('login').then(function (result) {
          reportAccount('login', result || { ok: false, error: 'no reply' })
        }, function (error) {
          reportAccount('login', { ok: false, error: describeError(error) })
        })
      }

      /**
       * 写一把 API Key: 与 dsh Models 页同一个 ref, 由宿主写进它自己的凭据服务
       * @param key 用户粘进来的那个串 (去首尾空白; 空串 = 请宿主清掉这一把)
       */
      function accountKey(key) {
        var value = typeof key === 'string' ? key.trim() : ''
        askHostAccount('key', { key: value }).then(function (result) {
          reportAccount('key', result || { ok: false, error: 'no reply' })
        }, function (error) {
          reportAccount('key', { ok: false, error: describeError(error) })
        })
      }

      function unmount() {
        mounted = false
        // 收起门户 = 退出终端 (2026-11-21): 页面不在了, 原生那一层也别再铺着黑底
        if (terminalMode) {
          terminalMode = false
          terminalGate = ''
          writeStored(TERMINAL_KEY, { on: false })
          call('portalTerminalVisible', false)
          // 后面那层 dsh 也别停在电脑那一场 (没有门户这层皮, 那一场看着就是"我的对话")
          // **只切工作区**: 退出终端时 mainView 在影子工作区, 那儿的场 `openSession` 一个都留不住
          // (`sessions.retain` 只认当前工作区), 而 `hide()` 刚在那儿开的空场也会跟着被换掉;
          // 换不过去就算了, 下次进终端 / 挂载会重新落 (尽力而为, 不给卸挂添一条会抛的路)
          if (isTerminalSession(currentSessionId())) {
            var home = currentWorkspaceId()
            if (home !== '') {
              try {
                var leaving = ctx.uiWorkspace.openWorkspace(home)
                if (leaving && typeof leaving.catch === 'function') {
                  leaving.catch(function (reason) {
                    console.log('[luwi-portal] could not leave the peer workspace: ' + describeError(reason))
                  })
                }
              } catch (_cannotLeave) {
                console.log('[luwi-portal] could not leave the peer workspace: ' + describeError(_cannotLeave))
              }
            }
          }
        }
        // 门户关了就不再记返回点 (DOM 与那一场的关系断了; 下次挂载按 `SESSION_KEY` 落回门户那一场),
        // 冷却与"一句话一分钟"的记号也一起清 —— 重开这一页要能当场判一次该落哪一场
        terminalReturn = null
        terminalAutoAt = 0
        terminalNotedAt = 0
        terminalNotedKey = ''
        if (terminalProbeTimer !== null) {
          clearTimeout(terminalProbeTimer)
          terminalProbeTimer = null
        }
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
        if (wakeTimer !== null) clearTimeout(wakeTimer)
        wakeTimer = null
        if (noteTimer !== null) clearTimeout(noteTimer)
        noteTimer = null
        if (undoTimer !== null) clearTimeout(undoTimer)
        undoTimer = null
        closeMenu()
        closeStickerPanel()
        closeFileMenu()
        closePreview()
        closeHistory()
        // 模型目录那条订阅跟着门户走 (2026-11-20): 收起就摘, 重挂时 loadModel 自己再挂
        if (modelDirUnsub !== null) {
          try { modelDirUnsub() } catch (_noUnsub) { /* 订阅已经不在了, 无所谓 */ }
          modelDirUnsub = null
        }
        modelDirSource = null
        modelDefaultPending = null
        modelDefaultChecked = ''
        // 录音这一层整块收掉 (2026-11-20): 录音 / 麦克风流 / 计时器 / 面板都不许跨挂载留着 ——
        // 挂着一条开着的流, 退出门户之后麦克风还在被占, 那是主人一眼看得见的错
        if (voiceState === 'recording') stopRecording(true)
        dropRecListeners()
        releaseVoiceCapture()
        hideRecPanel()
        if (pressTimer !== null) clearTimeout(pressTimer)
        pressTimer = null
        if (voiceWatch !== null) clearTimeout(voiceWatch)
        voiceWatch = null
        voiceHeld = false
        voiceState = 'idle'
        // 下一次挂载是新的 DOM: 落进工作区那条腿若正等着, 让它自然超时 (不跨挂载落地);
        // 那条 15 s 的补试也一起撤掉 —— 重挂之后 autoStart 会再走一遍
        entering = false
        if (landRetryTimer !== null) clearTimeout(landRetryTimer)
        landRetryTimer = null
        wantPathCache = null
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
        // `false`, 一次 `true` 都没有 —— 于是宿主一直以为门户没开, 菜单永远写「回到前台」, 键盘也
        // 一直走"缩 WebView"那条旧路。挂上就报一次, 收起时 unmount() 再报 false
        call('portalVisible', true)
        // 终端的读数先取一份 (2026-11-21): 普通历史要靠 `shadowRoot` 把电脑那几场过滤掉, 而它原先
        // 只在真的点过终端之后才有 —— 冷启 / 重载之后那扇门就一直是"什么都不过滤"
        terminalInfo = fetchTerminalInfo()
        staleFollowed = false
        try {
          restore()
          status = call('portalStatus')
          // 挂载这一刻文件里记着的主动场: **十分钟内的算"最新的消息"**, 第一拍就接进当前对话 —— 这样
          // "打开应用看到最新那句"与"页面被系统重建过"两条都不靠运气; 更早的就是上一次开机的事, 不接
          // (`startedAt` 变大才算新, 见 [proactiveNew]; 减一 = 只补最新那一场, 不把 `recent` 里更早的
          // 全翻上来 —— 2.8.1 #8 加了 `recent` 之后这一格必须这么写)
          var openedRun = status && status.proactive ? status.proactive : null
          var openedAt = openedRun ? Number(openedRun.startedAt) || 0 : 0
          proactiveSeen = openedAt > 0 && Date.now() - openedAt <= RECENT_PROACTIVE_MS ? openedAt - 1 : openedAt
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
            // 两扇门互不串 (2026-11-21): dsh 的 mainView 换到"另一种场"时不跟 —— 终端里只跟电脑那几场
            // (否则 mainView 还在手机那一场时会把终端甩出来), 普通门户也不跟电脑那几场 (否则返回门户
            // 会被再拽回电脑那一场, 那层界面已经没了, 人没有出口)
            var sameKind = isTerminalSession(id) === terminalMode
            if (id !== sessionId && sameKind) switchTo(id, 'list')
            else {
              renderModel()
              // 投影可能是后到的: 每一帧都再问一次「拨过没」, 拨过就什么都不做
              ensureFullAccess()
              // 空白场跟默认那一条同理 (2026-11-20): 摘要 / 投影后到时补判一次, 同一档只问一次
              followDefaultModel()
            }
          })
        } catch (_noList) {
          listUnsub = null
        }
        pollTimer = setInterval(pollLedger, LEDGER_POLL)
        pollLedger()
        // 空态就自己开一场 (2026-11-09): 等第一拍账本落定再判, 免得把 restore 出来的那一场挤掉
        setTimeout(autoStart, 800)
        // 终端那一页扛得住重载 (2026-11-21): 配对要重启 host, 回来这一帧就自己进终端
        var storedTerminal = readStored(TERMINAL_KEY)
        if (storedTerminal && storedTerminal.on === true) setTimeout(openTerminal, 300)
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
        /**
         * 进 / 出终端那一页 (2026-11-21, 落实表 #48)
         *
         * 原生那两条入口都走它: 球菜单 / 抽屉那一行 (`PortalTerminal.open` 会先 `show()` 再
         * `terminal(true)`), 以及页面重载之后补的那一句 (`terminal(true)`, 见 `TERMINAL_ON_SCRIPT`)
         */
        terminal: setTerminal,
        /** 返回键先问页面这一句: 收掉一层就 `closed`, 什么都没收就 `none` */
        back: terminalBack,
        /** 宿主推的键盘高度 (2026-11-09): 只改这一层的 padding, 不动 WebView 尺寸 */
        setKeyboard: applyIme,
        /**
         * 拖进来 / 拖走那一刻 (2026-11-19 主人: "再加上如图所示的提示")
         *
         * 系统拖放不给页面 HTML5 事件, 所以原生那一层 (`HostScreen.acceptDrop`) 在
         * `ACTION_DRAG_ENTERED` / `DROP` / `EXITED` / `ENDED` 各喊一声; 这里只把它交给 [markDrop] ——
         * 与桌面浏览器那条路 (dragenter / dragover / dragleave) 同一处开关, 虚线和高亮说明牌一起走
         */
        dropOver: function (over) { markDrop(over === true) },
        /**
         * 宿主对"选图"那一下的回话 (2026-11-12, 落实表 #35)
         *
         * `shown` / `picked` 是"选择器起来了 / 文件交回来了", 撤计时器就完事; `empty` / `none` 是
         * "选了但 WebView 没回调" 与 "选择器起不来" —— 这两种在屏上都是**什么都没发生**, 所以直接
         * 报一句带上原因
         */
        pickState: pickState,
        /**
         * 宿主把选好的那几份交回来 (2.8.1 #13)
         *
         * `{files:[{name, path, bytes, image, mediaType}], rejected:[…]}` —— 字节已经在
         * `<工作区>/lw-in/` 里了 (宿主读的、宿主落的), 这里只管记成 ready 并重画待发栏
         */
        picked: picked,
        /**
         * 注入一次「图片发送失败」(2.8.1 #1): 与计时器到点那条路同一个函数 —— 判据靠它制造一次失败,
         * 然后点气泡右侧那颗「复制诊断」
         */
        imageFail: imageFail,
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
          // `lw/out` 下任何一份变了都推这一下: 主动场那一份也在同一个目录里 (2026-11-12 #38)
          loadEcho(false)
        },
        /**
         * 账号三件事 (2026-11-14): `status` / `login` / `key`
         *
         * 宿主那侧 (原生引导窗) 用 `evaluateJavascript` 调它, 结果走 `lwAccountResult` 回来 ——
         * 一条动作一个来回, 页面上不留状态
         * @param action `status` / `login` / `key`
         * @param payload `key` 那一档是 `{"key":"…"}` (字符串或对象都认)
         */
        account: function (action, payload) {
          var body = payload
          if (typeof body === 'string') {
            try {
              body = JSON.parse(body)
            } catch (_badJson) {
              body = {}
            }
          }
          // **一步都不许静默**: 上一版没有这层 try, 同步抛 (例如这个 profile 没给 `remote.account`)
          // 就既没有结果也没有日志, 原生那一行永远停在"正在取账号状态…" (2026-11-14 真机踩到)
          try {
            // 三条都转发给宿主那条路由 (见 [askHostAccount]): 页面这一侧没有要自己算的东西
            if (action === 'status') accountStatus()
            else if (action === 'login') accountLogin()
            else if (action === 'key') accountKey(body && body.key)
            else reportAccount(String(action), { ok: false, error: 'unknown action' })
          } catch (error) {
            console.log('[luwi-portal] account ' + action + ' threw: ' + describeError(error))
            reportAccount(String(action), { ok: false, error: describeError(error) })
          }
        },
        /**
         * 弹窗关掉之后收一次最新读数 (2026-11-13)
         *
         * 原生那个窗是独立 Window, 盖在 WebView 上时这一层不重绘; 关掉之后宿主播一句
         * `onSettingsClosed`, 这里把 `portalStatus()` 再拉一遍 —— 面板上那几行读数才是刚改过的数
         */
        refresh: refresh,
        /**
         * 语音那一路的回推 (2026-11-20): 原生认完一句就调它
         *
         * 落点只有两件: `kind:'permission'` 改一句提示, 其余把文字接进草稿并退出语音态 ——
         * 具体的判断与"编号对不对得上"都在 [voiceAnswer] 里
         * @param payload `{kind?, id?, ok, text?, error?, engine?, mic?}`
         */
        voice: function (payload) { voiceAnswer(payload) },
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
          // `mount()` 自己带着 `if (mounted) return` 的幂等, 不必再问一次"开着没有" ——
          // 原来那句是 `if (!portal.isOpen())`, 而 `isOpen` 从来没暴露在这个对象上, 一按就是
          // TypeError: portal.isOpen is not a function (2026-11-14 真机 logcat 抓到),
          // 于是菜单里「回到前台」一直是死的
          portal.mount()
        },
        hide: function () { portal.hide() },
        /**
         * 终端那一页的进出 (2026-11-21, 落实表 #48)
         *
         * 原生两条入口都落到这里: 球菜单 / 抽屉那一行 (`PortalTerminal.open` 先 `show()` 再
         * `terminal(true)`), 以及页面重载之后补的那一句。**白名单少一行, 原生那句
         * `evaluateJavascript` 就一声不响地什么都不做** —— 这一页于是永远打不开
         */
        terminal: function (open) { portal.terminal(open) },
        /** 返回键先问这一句 (由 `PAGE_BACK_JS` 调): `closed` / `none` */
        back: function () { return portal.back() },
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
        /**
         * 宿主把选好的那几份交回来 (2.8.1 #13): `{files, rejected}`
         *
         * 交回来的是**落好盘的那几份** (宿主读的、宿主落的) —— 页面上于是"缩略图直接出现", 而不是
         * 自己去读一串 `content://` 再 base64 过桥; 后者在有的机器上就是"点了确定什么都没有"
         */
        picked: function (payload) { portal.picked(payload) },
        /**
         * 注入一次「图片发送失败」(2.8.1 #1)
         *
         * 判据要的是"注入一次 WebView 文件选择回调失败后, 气泡右侧出现「复制诊断」" —— 真机上制造
         * 一次失败不一定顺手, 所以这里留一个口子: `__LUWI_PORTAL__.imageFail('webview 未回调')` 与
         * 计时器到点走的是**同一条**路 (同一个三选一说法表, 同一份四行诊断)
         * @param reason 三种说法之一, 别的按「上传超时」
         * @param picture 这一张图多大; 省略 = `未选择`
         */
        imageFail: function (reason, picture) { portal.imageFail(reason, picture) },
        /**
         * 原生那个「更多设置」窗关掉了 (2026-11-13): 面板不关, 只是把读数重拉一遍 ——
         * 弹窗里改的就是那几行 (冷却 / 唤醒 / 下一趟), 不拉就会停在旧数
         */
        onSettingsClosed: function () { portal.refresh() },
        /**
         * 账号三件事 (2026-11-14): 原生引导那一行借这一页调 dsh 的登录 / 凭据接口
         *
         * **必须在这里再转一次**: `window.__LUWI_PORTAL__` 是一张白名单, 只把这里列出来的方法交给
         * 宿主 —— 少了这一行, 原生 `evaluateJavascript` 那句会因为 `account` 是 undefined 而**一声
         * 不响地什么都不做** (2026-11-14 真机: 那一行永远停在"正在取账号状态…")
         * @param action `status` / `login` / `key`
         * @param payload `key` 那一档是 `{key}`
         */
        account: function (action, payload) { portal.account(action, payload) },
        /**
         * 语音那一路的回推 (2026-11-20): 转写结果与"权限给没给"都从这一条进来
         *
         * 与 `account` 同一条分寸: **白名单少一行, 原生那句 `evaluateJavascript` 就一声不响地
         * 什么都不做** —— 页面上于是永远停在"正在识别…" (原生写的是
         * `window.__LUWI_PORTAL__.voice(...)`)
         * @param payload `{kind?, id?, ok, text?, error?, engine?, mic?}`
         */
        voice: function (payload) { portal.voice(payload) },
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



