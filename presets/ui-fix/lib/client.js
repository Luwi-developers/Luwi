/**
 * Luwi 的 CSS 覆盖层 (2.7.8 批次 4, D8 = b)
 *
 * **只写选择器与样式** —— 不复制组件、不 monkey-patch JS、不改上游任何一个字节。这样这一层随时能
 * 整块撤掉: 上游哪一条修好了, 把对面那一段删掉就行 (每一段都写着"什么时候可以删")。
 *
 * 三条纪律:
 *
 * 1. **选择器优先挑上游自己写的 `data-*` 属性与自家类名** (`[data-files-path]` / `.mneme-*`), 那些是
 *    作者有意命名的东西; dsh 前端那套 `_path_1kiio_3` 是 CSS module 的哈希类名, 只在没有别的抓手时
 *    才用, 而且**它一变我们的补丁就静默失效** —— 所以 `tools/check-ui-fix.mjs` 会拿这里出现的每一个
 *    选择器去已构建的产物里 grep 一遍, 一个都命中不了就红
 * 2. 每段都要能用一句话说清"量到的现象是什么、哪一个数说明的", 不许照着猜测写
 * 3. 一律挂 `@media` 或收窄到某一处, **别在桌面宽度上也生效** —— 这一层是给手机屏幕补的
 *
 * 量到的现场 (2026-10-17, 模拟器 `Luvi_API36` 412 dp 宽 / 真机 22041216C 393 dp 宽, 全部由 CDP
 * 的 `getBoundingClientRect()` 读出来, 不是看图猜的):
 *
 * - **记忆面板 (dsh-mneme)**: `.mneme-overlay` 是 `width: min(1240px, calc(100vw - 88px))` = **326**,
 *   而它里面 `.mneme-xmain` 是两列写死宽度的横排 —— `.mneme-xside` **236** + `.mneme-xside--filter`
 *   **214** = **450**, 于是右列被裁掉 **89 px**: 截图上是 `Importance / ★3-` 与 `All` 那颗
 *   chip 断在半截, 标签栏的 `Settings` 也只剩 `Sett`. 同一层里 `.mneme-vtabs` 是 **414** 宽压在
 *   **324** 的容器里, 两头都出界
 * - **文件面板的路径行**: 上游给的是"尾部对齐 + 左端淡出" (`justify-content: flex-end` 加
 *   `[data-path-clipped]` 的 28px 渐变), 412 dp 上那条路径文字 **427 px** 宽、左边 **65 px** 是
 *   看不见的 (截图从 `ted/0/Android/…` 那种半截开始); `title` 上有全路径, 但触屏上没有 hover
 *
 * **这一份不是普通的 ESM**: dsh 的客户端模块是按 `window.__ModuleLoader__.load({ id, factory })`
 * 装载的 (与 `dsh-web-mobile` / `dsh-mneme` 那些 `lib/client.js` 同一个形状), 写成 `export ...`
 * 会被当成经典脚本解析, 报一句 `SyntaxError: Unexpected token 'export'` —— 2026-10-17 在模拟器上
 * 就是这么趴下的 (`web boot: 1 entry did not activate`, 页面上却什么都看不见)
 */
window.__ModuleLoader__.load({
  id: 'luwi-ui-fix',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports

    /** 窄屏的门槛: 记忆面板那两列加起来 450, 加边框与控制留白, 720 以下就放不下了 */
    var NARROW = '(max-width: 720px)'

    // 每条覆盖都带 `!important`: 我们这一段 <style> 与上游那几个客户端包同优先级, 谁先插进来不由我们
    // 决定, 而这一层本来就是"非要压过上游"的那一层 —— 这是唯一能保证顺序的地方, 不是偷懒
    var CSS = [
      '/* ── 一、记忆面板: 两列改成一列叠起来 ────────────────────────────────────────',
      '   量到: 450 px 的内容塞进 326 px 的卡片, 右列 89 px 被 overflow:hidden 裁掉',
      '   什么时候可以删: 上游把 .mneme-xmain 改成分支宽度 (或给 .mneme-xside--filter 一个 wrap 规则) 之后',
      '*/',
      '@media ' + NARROW + ' {',
      '  .mneme-overlay {',
      '    width: calc(100vw - 24px) !important;',
      '    height: calc(100vh - 40px) !important;',
      '  }',
      '  /* 四颗标签加起来 414, 卡片只有 326: 让它自己横着滚, 而不是两头出界 */',
      '  .mneme-vtabs {',
      '    min-width: 0 !important;',
      '    overflow-x: auto !important;',
      '    scrollbar-width: none;',
      '  }',
      '  .mneme-vtabs::-webkit-scrollbar {',
      '    display: none;',
      '  }',
      '  .mneme-vtab {',
      '    flex: 0 0 auto !important;',
      '    padding: 0 8px !important;',
      '  }',
      '  /* 两列 / 三列一律各自占满一行 —— 用 flex-wrap 而不是写死顺序, 那一层里到底几个孩子交给上游 */',
      '  .mneme-xmain {',
      '    flex-wrap: wrap !important;',
      '    overflow-y: auto !important;',
      '  }',
      '  .mneme-xside,',
      '  .mneme-xside--filter {',
      '    flex: 1 1 100% !important;',
      '    width: auto !important;',
      '    border-right: 0 !important;',
      '  }',
      '  .mneme-xside--filter {',
      '    border-top: 1px solid var(--dsw-alias-border-l2);',
      '  }',
      '  /* 结果那一栏要有下限高度, 否则叠起来之后被挤成一条 */',
      '  .mneme-xbrowse {',
      '    flex: 1 1 100% !important;',
      '    width: 100% !important;',
      '    min-height: 300px !important;',
      '  }',
      '}',
      '',
      '/* ── 二、文件面板的路径行: 折成两行, 别再裁掉开头 ────────────────────────────',
      '   量到: 文字 427 px 宽、容器 346 px, 左端 65 px 藏在 overflow 后面, 只剩 28 px 的淡出提示',
      '   什么时候可以删: 上游自己改成折行 / 头尾各留锚点之后',
      '*/',
      '@media ' + NARROW + ' {',
      '  span[data-files-path] {',
      '    justify-content: flex-start !important;',
      '    white-space: normal !important;',
      '    overflow-wrap: anywhere !important;',
      '    line-height: 1.4;',
      '    max-height: 2.8em !important;',
      '    -webkit-line-clamp: 2;',
      '    -webkit-box-orient: vertical;',
      '    display: -webkit-box !important;',
      '    -webkit-mask-image: none !important;',
      '    mask-image: none !important;',
      '  }',
      '}',
      '',
      '/* ── 三、窄屏上会话那一列被算成 0 宽 (整片空白) ──────────────────────────────',
      '   量到 (2026-11-08, 真机 22041216C, 393 CSS px, 0.2.2 那一版): `dsh-web-mobile@3.1.0`',
      '   把框架的栅格写成 `minmax(0, 1fr) 0 0 !important`, 它的前提是"侧栏出流之后 center',
      '   自动落到第 1 轨"; 而 0.2.2 给 `.centerCol` 写了显式的 `grid-column: 2`, 于是会话列',
      '   落进 0 宽的第 2 轨: DOM 与无障碍树都在 (会话、输入框、发送键都在), 屏幕上只剩底色',
      '   —— 框架的计算值是 `393.091px 0px 0px`, `.centerCol` 量到 `0x859`',
      '   把模板恢复成宿主自己写的那一份就回来了: 同一页改成 `0 minmax(0px,1fr) minmax(0px,0px)`',
      '   之后计算值是 `0px 393.091px 0px`, 会话立刻画出来',
      '   改法取 `html body` 两节是为了压过它那条 `html [data-mobile-nav]` 的 !important',
      '   什么时候可以删: `dsh-web-mobile` 改成按 `grid-column` 定位那几列 (或者上游把中心列',
      '   改回自动落位) 之后 —— 判据是这一页的框架计算值应当是 `0px <整宽>px 0px`',
      '*/',
      '@media (max-width: 1023px) and (pointer: coarse) {',
      '  html body [data-mobile-nav="frame"] {',
      '    grid-template-columns: 0 minmax(0px, 1fr) minmax(0px, 0px) !important;',
      '  }',
      '}',
      '',
      '/* ── 四、左侧抽屉打开是一块白 / 一开就弹回 ──────────────────────────────────',
      '   量到 (2026-11-08, 真机 22041216C, 393 CSS px, 0.2.2): `dsh-web-mobile` 那条',
      '   `[data-mobile-nav="frame"] > :first-child` 的抽屉规则 (position / inset / width、',
      '   z-index 1300、translateX、`background: var(--dsw-specific-sidebar-fill)`) 的前提是',
      '   "框架的第一个孩子就是侧栏列"; 0.2.2 起框架的第一个孩子是**抽屉遮罩**',
      '   `[data-sidebar-mask]` —— 于是收起时遮罩被推到 -110% 屏外, 打开时 `transform: none`',
      '   把这块 280px、浅灰底、z 1300 的空遮罩滑上屏, 正好压在真侧栏 (宿主 z 71) 上:',
      '   看到的就是一块"白"(整块被压暗), 而遮罩本身就是宿主那个"点一下关闭"的背面,',
      '   同一手势的抬手就把它又关回去',
      '   这里只把遮罩还原成宿主自己的那一层 (整屏 / z 70 / 不位移 / 用遮罩色), 真抽屉列继续按',
      '   宿主那套走 (宽度 280、z 71、打开时可见) —— 宿主这版的抽屉本来就是 280 宽',
      '   改法取 `html body #root` 三节是为了压过它那两条 `html [...]` 的 !important',
      '   什么时候可以删: `dsh-web-mobile` 改成按 `[data-sidebar-mask]` 与侧栏列各自定位之后',
      '*/',
      '@media (max-width: 1023px) and (pointer: coarse) {',
      '  html body #root [data-mobile-nav="frame"] > [data-sidebar-mask] {',
      '    position: absolute !important;',
      '    inset: var(--dsh-frame-chrome-top, 0px) 0 0 !important;',
      '    width: auto !important;',
      '    max-width: none !important;',
      '    z-index: 70 !important;',
      '    transform: none !important;',
      '    padding-top: 0 !important;',
      '    border-right: 0 !important;',
      '    background: var(--dsw-alias-bg-mask-1) !important;',
      '    touch-action: auto !important;',
      '    /* 这一条是"一开就弹回"的解药: 0.2.2 给遮罩挂了 onClick=toggleSidebar, 而插件的边缘划',
      '       在轴锁那一刻就已经把状态翻成打开 (early commit), 抬手的合成 click 再落到遮罩上就是',
      '       第二次 toggle —— 净效果是弹回。让遮罩只当"变暗那一层", 点击交给插件自己的背面',
      '       (`[data-mobile-nav="dismiss-shadow"]`) 与抽屉里的行 */',
      '    pointer-events: none !important;',
      '  }',
      '  /* 插件自己的变暗背面在 z 1250, 它那条抽屉列的 z 1300 现在落到遮罩上了; 宿主的侧栏列',
      '     只有 z 71, 于是打开时"背面压在抽屉上" —— 整块发灰发白就是这个。把列抬回契约值 */',
      '  html body #root [data-mobile-nav="frame"] [class*="sidebarCol"] {',
      '    z-index: 1300 !important;',
      '  }',
      '}',
    ].join('\n')

    /** 注入一次样式表, 交回一个"把这段样式摘掉"的函数 (cordis 的 effect 认这个形状) */
    function install() {
      var tag = document.createElement('style')
      tag.dataset.luwiUiFix = '2.7.8'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return function () {
        tag.remove()
      }
    }

    function apply(ctx) {
      // 客户端这份 context 有 effect; 万一哪天没有, 至少样式还在 (那也仍然只是一个 <style>)
      if (ctx && typeof ctx.effect === 'function') ctx.effect(install)
      else install()
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
