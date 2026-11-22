// lib/client.js — luwi-dsh-sync 的浏览器半: 官方侧边栏里的「luwi终端」面板 (同步 / 对端 / 配对都在这一页)。
//
// 形态: 手写的官方动态 bundle 外壳 (window.__ModuleLoader__.load({id, factory})), **不引构建步骤**。
//   · id 必须等于包名 —— 客户端模块系统按"离它最近的 package.json"给 bundle 定模块 id, 而
//     dsh.client 的半侧只挂在说明符恰为裸包名的那一行上
//   · 只依赖基线: require("react") + ctx.slots + ctx.get + ctx.effect; 不请求任何非基线模块
//   · 浏览器安全: 无 import / require(node:*) / Node API, 无顶层副作用 (只在 apply 里注册)
//
// 座位 (两个, 组件只有一份; 设计见 docs/Luwi-dsh-sync-设计.md §11.1):
//   · 官方右侧栏 tab: ctx.slots.inject('sidebar.right.pane.tab', …) 是能力门 —— 座位声明了
//     回调才跑 (harness ≥ 0.1.5), 拿不到 sidebarRightTabs / sidebarRight 就安静不装
//   · 左侧栏全局入口: sidebar.panellist (id luwi-sync) + main (key luwi-sync) —— 官方给
//     "全局面板"的那条路, 没有会话时也在。**2026-11-21 主人: 侧边栏那一行显示名改成「luwi终端」;
//     同一插件里那枚沙盒「终端」面板 (在手机的 Linux 沙盒里跑命令) 与同步无关, 整条下线**
//   · 账号/权益那一段 (登录 Luwi 账号 → P2P 到期闸) 同日整条下线: P2P 缺省关、手机侧从不启用,
//     这笔账一直是死的 (见 CHANGELOG 0.4.0)
//
// 数据: 同源 fetch 宿主的 /luwi-sync/* (宿主半见 lib/panel-routes.mjs)。通道没开 (宿主没有
// webServer, 路由没注册, SPA fallback 顶上来了) 时, 面板如实说一句并把所有按钮禁掉。
//
// 确认: 写操作要两次点击 —— 第一次举起确认条, 第二次带 confirm:true 才真的发出去
// (面板这一路不调 confirmSync: 人的点击本身就是这条渠道的确认, 见设计 §11.4)。

window.__ModuleLoader__.load({
	id: 'luwi-dsh-sync',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		// ── 正文 ────────────────────────────────────────────────────────────────────

		const React = require('react');

		const PLUGIN_NAME = 'luwi-dsh-sync';
		const PANEL_BASE = '/luwi-sync';
		const PANEL_HANDSHAKE = 'luwi-dsh-sync/panel';
		const LEFT_PANEL_ID = 'luwi-sync';
		const RIGHT_TAB_ID = `${PLUGIN_NAME}/panel`;
		const RIGHT_TAB_KIND = 'luwi-sync';
		const CSS_TAG_ID = 'luwi-dsh-sync-panel';
		const POLL_IDLE_MS = 5000;
		const POLL_BUSY_MS = 1000;
		const PROBE_TIMEOUT_MS = 1500;

		const h = React.createElement;

		// ── 文案 (zh 原文做键, en 是值; 不注册官方 locale 命名空间, 只查自己的表) ──────
		const EN = {
			'同步': 'Sync',
			'已挂载': 'Mounted',
			'未挂载': 'Not mounted',
			'设备': 'Device',
			'远端': 'Remote',
			'已配置': 'configured',
			'未配置': 'not configured',
			'开': 'on',
			'关': 'off',
			'分支': 'Branch',
			// Luwi 加 (2026-10-15): 仓库卡片那几句
			'仓库': 'Repository',
			'仓库地址': 'Repository address',
			'保存': 'Save',
			'同步: 开': 'sync: on',
			'同步: 关': 'sync: off',
			// Luwi 加 (2026-11-21): 侧边栏那一行改叫 luwi终端 (原来叫「同步」); 同一插件里那枚沙盒
			// 「终端」面板整条下线 (与同步无关, 主人点名下掉)
			'luwi终端': 'luwi terminal',
			'写下这段配置': 'write this into the sync config',
			'改了要重启 host 才生效': 'restart the host for this to take effect',
			'上次拉取': 'Last pull',
			'从未': 'never',
			'个文件': 'files',
			'最近错误': 'Last error',
			'确认': 'Confirm',
			'取消': 'Cancel',
			'自动刷新': 'Auto refresh',
			'刷新中': 'Refreshing',
			'面板通道没开': 'The panel channel is not open',
			'对端名片': "the peer's card",
			'影子工作区': "Its workspaces",
			'宿主没有注册 /luwi-sync 路由 —— 这个 profile 大概没有 HTTP 服务 (webServer)。同步本身照跑, 面板只读不可用。': 'The host did not register the /luwi-sync routes — this profile probably has no HTTP service (webServer). Sync itself keeps working; the panel is unavailable.',
			'已复制': 'Copied',
			'拉取会把远端的变化合进本地 (keep-both, 本地被改的文件进不了回收站之外任何地方)': 'Pull merges remote changes into the local tree (keep-both; nothing is silently overwritten)',
			'推送会把这台机器的全量镜像推到远端 —— 手机侧走的是移动数据时这笔账很大': 'Push uploads this machine\'s full mirror to the remote — expensive over mobile data on the phone side',
			'现在': 'now',
			'分钟前': 'min ago',
			'小时前': 'h ago',
			'天前': 'd ago',
			// 2026-10-20: 令牌那一格
			'令牌': 'Token',
			'还没存': 'not saved yet',
			'只存本机与应用私有目录, 二维码里会带上拼好的地址': 'stored only on this machine and in the app\'s private directory; the pairing QR carries the composed address',
			'GitHub 令牌 permissions 仅需: Contents —— Read and write': 'GitHub token permissions: Contents — Read and write only',
			// 2026-10-20: 清理仓库会话那一颗
			'清理仓库会话': 'Clean the repository sessions',
			'清理仓库会话会删掉仓库里窗口外的会话镜像与合并副本, 然后推一次 (本机会话一个字节都不动)': 'Cleaning removes the mirrored sessions outside the window and the merge copies from the repository, then pushes once (local sessions are untouched)',
			// 2026-10-20: 配对卡那几行 (原来只有中文)
			'配对手机': 'Pair a phone',
			'已配对': 'paired',
			'未配对': 'not paired',
			'生成配对码': 'Generate the pairing code',
			'生成中': 'Generating',
			'配对码': 'Pairing code',
			'手机: 设置 → 同步 → 扫码配对。二维码里有仓库凭据, 别外传。请确保 root 或 Shizuku 在 Luwi 上正常运行, 否则同步会失败。': 'Phone: Settings → Sync → scan the pairing code. The QR carries repository credentials, so do not share it. Make sure root or Shizuku is running for Luwi, otherwise sync fails.',
			// 2026-10-24: 面板收口的那几句 (运行方式徽标 / 折叠 / 运行结果摘要 / 已配置的小点)
			'本机进程': 'Local process',
			'手机桥接': 'Phone bridge',
			'本机进程 / 手机桥接': 'Local process / phone bridge',
			'高级': 'Advanced',
			'已保存': 'saved',
			'留空 = 保持不动': 'Leave empty to keep the current value',
			'已配置: 小点只是占位, 点一下清空后填新的, 保存才生效': 'Configured: the dots are a placeholder; click to clear, type the new value, then save',
			'取消': 'Cancel',
		};

		/** 当前语言 (apply 时按 locale 服务定一次, 变了就重设)。 */
		let localeId = 'zh';
		/** 语言变化的订阅者 (面板组件每实例一个)。 */
		const localeListeners = new Set();

		/**
		 * 取一句文案。
		 * @param {string} zh - 中文原文 (也是字典的键)。
		 * @returns {string} 当前语言下的文字 (表里没有就原样返回)。
		 */
		function t(zh) {
			return localeId === 'zh' ? zh : (EN[zh] ?? zh);
		}

		/**
		 * 订阅语言变化 (返回退订函数)。
		 * @param {() => void} listener - 变化时要跑的回调。
		 * @returns {() => void} 退订。
		 */
		function onLocale(listener) {
			localeListeners.add(listener);
			return () => { localeListeners.delete(listener); };
		}

		/** 广播语言变化 (注册服务那侧调)。 */
		function emitLocale() {
			for (const listener of Array.from(localeListeners)) {
				try { listener(); } catch { /* 一个订阅者炸了不影响别的 */ }
			}
		}

		/**
		 * 组件里的语言订阅: 变化时强制重渲染。
		 * @returns {void}
		 */
		function useLocaleTick() {
			const [, bump] = React.useState(0);
			React.useEffect(() => onLocale(() => bump(n => n + 1)), []);
		}

		// ── HTTP ───────────────────────────────────────────────────────────────────

		/**
		 * 打一次面板接口。**不抛**: 网络失败 / 非 JSON 应答都折算成 {status, body:null}。
		 * @param {string} path - PANEL_BASE 之后的那一段 (例如 '/panel')。
		 * @param {object} [init] - fetch init。
		 * @returns {Promise<{status: number, body: object|null}>} 状态码与解析后的体。
		 */
		async function api(path, init) {
			const options = { cache: 'no-store', ...(init ?? {}) };
			if (options.body !== undefined) {
				options.headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
			}
			let res;
			try {
				res = await fetch(PANEL_BASE + path, options);
			} catch (error) {
				return { status: 0, body: null, error: String((error && error.message) || error) };
			}
			let body = null;
			try {
				body = await res.json();
			} catch {
				// SPA fallback (index.html) / 空体 / 404 的 HTML: 一律当"通道没开"
				body = null;
			}
			return { status: res.status, body };
		}

		/**
		 * 探一次宿主配置 (座位怎么装、写面开不开)。
		 * @returns {Promise<{seats: string, panelOps: boolean}|null>} 读不到 = null (通道没开)。
		 */
		async function probeConfig() {
			const controller = typeof AbortController === 'function' ? new AbortController() : null;
			const timer = controller === null ? 0 : window.setTimeout(() => { try { controller.abort(); } catch { /* ignore */ } }, PROBE_TIMEOUT_MS);
			try {
				const { body } = await api('/panel', controller === null ? undefined : { signal: controller.signal });
				if (body === null || body.handshake !== PANEL_HANDSHAKE) return null;
				const config = body.config ?? {};
				return { seats: config.panelSeats ?? 'both', panelOps: config.panelOps !== false };
			} catch {
				return null;
			} finally {
				if (timer !== 0) window.clearTimeout(timer);
			}
		}

		// ── 小工具 ─────────────────────────────────────────────────────────────────

		/**
		 * 字节数转人读的串。
		 * @param {number} bytes - 字节数。
		 * @returns {string} 例如 '187.8 MB'。
		 */
		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes < 0) return '—';
			const units = ['B', 'KB', 'MB', 'GB', 'TB'];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
			return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
		}

		/**
		 * 毫秒差转相对时间。
		 * @param {number|undefined} ms - 已经过去的毫秒数。
		 * @returns {string} '从未' / '刚刚' / '3 分钟前' …
		 */
		function formatAge(ms) {
			if (!Number.isFinite(ms)) return t('从未');
			const value = /** @type {number} */ (ms);
			if (value < 60_000) return t('现在');
			if (value < 3_600_000) return `${Math.floor(value / 60_000)} ${t('分钟前')}`;
			if (value < 86_400_000) return `${Math.floor(value / 3_600_000)} ${t('小时前')}`;
			return `${Math.floor(value / 86_400_000)} ${t('天前')}`;
		}

		/**
		 * 宿主画好的二维码 SVG → `data:` URL (给 <img>, 不拼 HTML)。
		 * 宿主生成的 SVG 只有 ASCII (path/数字), btoa 够用; 万一不是就退回 URL 编码
		 * @param {string} svg - SVG 文本。
		 * @returns {string} data URL。
		 */
		function svgToDataUrl(svg) {
			const text = String(svg ?? '');
			try {
				return `data:image/svg+xml;base64,${window.btoa(text)}`;
			} catch {
				return `data:image/svg+xml,${encodeURIComponent(text)}`;
			}
		}

		/** 结构化错误/结果里那句人话。 */
		function messageOf(error) {
			if (error === null || error === undefined) return '';
			if (typeof error === 'string') return error;
			return String(error.message ?? error);
		}

		// ── 样式 (官方语义 token; 一个 <style> 标签, 卸载时摘掉) ─────────────────────

		const CSS = `
.luwi-sync-panel { display: flex; flex-direction: column; gap: 10px; padding: 10px; font-size: 13px;
  color: var(--dsw-alias-label-primary, #e8eaed); height: 100%; box-sizing: border-box; overflow-y: auto; }
.luwi-sync-head { position: sticky; top: 0; z-index: 2; background: var(--dsw-alias-bg-layer-1, #1e1f26);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12)); border-radius: 10px; padding: 8px 10px; }
.luwi-sync-head-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.luwi-sync-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary, #7a7f87); flex: none; }
.luwi-sync-dot[data-on="1"] { background: var(--dsw-alias-state-success-primary, #2fbf71); }
.luwi-sync-dot[data-on="0"] { background: var(--dsw-alias-state-error-primary, #e5484d); }
.luwi-sync-strong { font-weight: 600; }
.luwi-sync-dim { color: var(--dsw-alias-label-secondary, #9aa0a6); }
.luwi-sync-warn { color: var(--dsw-alias-state-warn-primary, #d8a300); }
.luwi-sync-bad { color: var(--dsw-alias-state-error-primary, #e5484d); }
.luwi-sync-good { color: var(--dsw-alias-state-success-primary, #2fbf71); }
.luwi-sync-tabs { display: flex; gap: 4px; }
.luwi-sync-tab { flex: 1; padding: 5px 8px; border-radius: 8px; cursor: pointer; text-align: center;
  border: 1px solid transparent; background: transparent; color: inherit; font: inherit; }
.luwi-sync-tab[data-active="1"] { background: var(--dsw-alias-bg-layer-2, #262a31);
  border-color: var(--dsw-alias-border-l2, rgba(255,255,255,.2)); font-weight: 600; }
/* Luwi 加 (G1-2): 对端那一个发消息框 (输入 + 按钮 + 上一次的回话) */
.luwi-sync-send { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
.luwi-sync-send .luwi-sync-input { flex: 1; min-width: 0; padding: 5px 8px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2)); background: transparent;
  color: inherit; font: inherit; }
.luwi-sync-send .luwi-sync-tab { flex: 0 0 auto; cursor: pointer; }
.luwi-sync-send .luwi-sync-tab[disabled] { opacity: .5; cursor: default; }
/* Luwi 加 (2026-10-15): 仓库卡片 —— 在 PC 面板里填一次地址 (两端填同一个), 外加同步总开关 */
.luwi-sync-field { display: block; margin-top: 6px; }
.luwi-sync-field .luwi-sync-input { width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2)); background: transparent;
  color: inherit; font: inherit; }
/* Luwi 加 (G1-3): 这一句发到对端的**哪一个工作区** —— 与"在对端新开一场"绑在一起 (kind:'new') */
.luwi-sync-send .luwi-sync-pick { flex: 0 1 auto; min-width: 0; max-width: 42%; padding: 5px 6px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2));
  background: transparent; color: inherit; font: inherit; }
.luwi-sync-card { border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
  border-radius: 10px; padding: 8px 10px; background: var(--dsw-alias-bg-layer-1, #1e1f26); }
.luwi-sync-card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.luwi-sync-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.luwi-sync-kv > span:nth-child(odd) { color: var(--dsw-alias-label-secondary, #9aa0a6); white-space: nowrap; }
.luwi-sync-kv > span:nth-child(even) { text-align: right; word-break: break-all; }
.luwi-sync-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.luwi-sync-btn { padding: 5px 10px; border-radius: 8px; cursor: pointer; font: inherit;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2));
  background: var(--dsw-alias-bg-layer-2, #262a31); color: inherit; }
.luwi-sync-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #4c8dff); }
.luwi-sync-btn:disabled { opacity: .45; cursor: not-allowed; }
.luwi-sync-btn[data-primary="1"] {
  /* 强调态只用品牌色做"描边 + 字", 不拿它当填充: --dsw-alias-brand-primary 是"当前主题的
     高对比 ink" —— 浅色主题下近黑 rgb(15,17,21), 深色主题下近白 rgb(249,250,251)
     (dsh 的 design-platform.css L192/L310), 而它没有配套的文字 token。
     早先写成 background: brand-primary + color: #fff ⇒ 深色主题下白底白字, 整块按钮看不见
     (2026-10-14 实拍确认)。改成 ink 描边 + ink 字压在 surface 上, 两种主题都可读 */
  background: var(--dsw-alias-bg-layer-2, #262a31);
  border-color: var(--dsw-alias-brand-primary, #4c8dff);
  color: var(--dsw-alias-brand-primary, #4c8dff);
  font-weight: 600;
}
.luwi-sync-btn[data-danger="1"] { border-color: var(--dsw-alias-state-warn-primary, #d8a300);
  color: var(--dsw-alias-state-warn-primary, #d8a300); }
/* Luwi 加 (2026-10-24): 同步总开关挪到「已挂载」那一行的最右, 开着时描边与字都是绿的
   —— 主人要的是"一眼看出它在跑", 关着保持普通按钮的样子 */
.luwi-sync-toggle { margin-inline-start: auto; }
.luwi-sync-toggle[data-on="1"] { border-color: var(--dsw-alias-state-success-primary, #2fbf71);
  color: var(--dsw-alias-state-success-primary, #2fbf71); }
.luwi-sync-confirm { border: 1px solid var(--dsw-alias-state-warn-primary, #d8a300); border-radius: 10px;
  padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
.luwi-sync-badge { font-size: 11px; padding: 1px 6px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12)); color: var(--dsw-alias-label-secondary, #9aa0a6); }
.luwi-sync-pre { white-space: pre-wrap; word-break: break-all; margin: 0; font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-secondary, #9aa0a6); }
.luwi-sync-list { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 2px; }
/* 2026-10-24: 「高级」与「全部字段」两处折叠 (分支框 / 完整应答) —— 用原生 details, 零 JS */
.luwi-sync-adv { margin-top: 6px; }
.luwi-sync-adv > summary { cursor: pointer; }
.luwi-sync-adv[open] > summary { margin-bottom: 4px; }
.luwi-sync-pair { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 8px; }
.luwi-sync-pair img { border-radius: 8px; background: #fff; padding: 4px; }
.luwi-sync-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 6px; }
.luwi-sync-icon { display: block; }
`;

		/**
		 * 把面板样式塞进 <head> (幂等: 同 id 的旧标签按当前内容刷新)。
		 * @returns {() => void} 摘掉标签的清理函数 (标签不是我们建的就什么都不做)。
		 */
		function installStyles() {
			if (typeof document === 'undefined' || !document.head) return () => {};
			let tag = document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`);
			const created = tag === null;
			if (tag === null) {
				tag = document.createElement('style');
				tag.dataset.plugin = PLUGIN_NAME;
				tag.dataset.pluginCss = CSS_TAG_ID;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== CSS) tag.textContent = CSS;
			if (!created) return () => {};
			return () => { if (tag.parentNode) tag.parentNode.removeChild(tag); };
		}

		// ── 图标 (左栏那枚; 几何只此一份) ───────────────────────────────────────────

		/**
		 * 「同步」图标: 两台设备之间一对反向箭头。
		 * @param {{size?: number, active?: boolean}} props - owner props (size / active)。
		 * @returns {object} React 元素。
		 */
		function SyncIcon(props) {
			const size = Number(props && props.size) || 16;
			return h('svg', {
				className: 'luwi-sync-icon',
				viewBox: '0 0 16 16',
				width: size,
				height: size,
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: '1.3',
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
				focusable: 'false',
			},
			h('rect', { key: 'a', x: '1.2', y: '2.6', width: '5.4', height: '4.4', rx: '1.2' }),
			h('rect', { key: 'b', x: '9.4', y: '9', width: '5.4', height: '4.4', rx: '1.2' }),
			h('path', { key: 'c', d: 'M9.6 5.4h3.1V3.2' }),
			h('path', { key: 'd', d: 'M6.4 10.6H3.3v2.2' }),
			h('path', { key: 'e', d: 'M12.7 5.4a5 5 0 0 1-8.2 1.4' }));
		}

		// ── 面板 ───────────────────────────────────────────────────────────────────

		/**
		 * 同步面板本体 (两个座位共用)。
		 * @param {{seat?: string}} props - seat: 'right' (右侧栏 tab) | 'main' (左栏全局入口)。
		 * @returns {object} React 元素。
		 */
		function SyncPanel(props) {
			useLocaleTick();
			const seat = props && props.seat ? props.seat : 'main';
			const [snap, setSnap] = React.useState(null);
			const [fault, setFault] = React.useState(null);
			const [pending, setPending] = React.useState(null);
			const [auto, setAuto] = React.useState(true);
			const [busy, setBusy] = React.useState(false);
			const [copied, setCopied] = React.useState(false);
			const [actionTarget, setActionTarget] = React.useState('sessions');
			const [loadedAt, setLoadedAt] = React.useState(0);
			// Luwi 加 (G1-2): 总览里那一个发消息框 (草稿 / 发送中 / 上一次的回话)
			// Luwi 加 (2026-10-15): 仓库卡片那两个输入框 (空 = 不动; 已配置的地址不回显)
			const [remoteDraft, setRemoteDraft] = React.useState('');
			const [branchDraft, setBranchDraft] = React.useState('');
			// Luwi 加 (2026-10-24): 已配置的输入框显示加密小点 (主人: 一眼看出"填过了"),
			// 点一下就把小点清掉、可以填新的; 仍然要点「保存」才生效。armed = 已经点开这一格
			const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
			const [remoteArmed, setRemoteArmed] = React.useState(false);
			const [tokenArmed, setTokenArmed] = React.useState(false);
			// Luwi 加 (2026-10-20): 访问令牌单独一格 (私有仓库的 PAT; 密码框, 不回显)
			const [tokenDraft, setTokenDraft] = React.useState('');
			// Luwi 加 (2026-10-20): 配对卡 (2026-10-20 主人: 「本机地址」那个框删掉 ——
			// 它只给对端通道用, 与同步无关; 二维码继续用配置里/profile 里已有的值)
			// 2026-10-24: 「工作区根」那个框删掉 —— 那功能是把某个文件夹的**文件**抄进仓库,
			// 与"同步会话"无关, 一直关着; 面板不再有入口 (配置里手写 workspace 仍生效)
			const [pair, setPair] = React.useState(null);
			const [pairError, setPairError] = React.useState(null);
			const [pairing, setPairing] = React.useState(false);
			// 2026-11-21 单向口径: 面板不再有"发给对端"那一格, peerDraft / peerSending /
			// peerAnswer / peerWorkspace 四个 state 与它们的 setter 一并删掉

			const running = Boolean(snap && snap.op && snap.op.state === 'running');
			const channelOpen = snap !== null;

			/** 拉一次快照。 */
			const load = React.useCallback(async () => {
				const { status, body, error } = await api('/panel');
				if (body === null || body.handshake !== PANEL_HANDSHAKE) {
					setSnap(null);
					setFault(error ?? `HTTP ${status}`);
					return;
				}
				setSnap(body);
				setFault(null);
				setLoadedAt(Date.now());
			}, []);

			React.useEffect(() => { void load(); }, [load]);

			React.useEffect(() => {
				if (!auto) return undefined;
				let alive = true;
				let timer = 0;
				const tick = async () => {
					await load();
					if (!alive) return;
					timer = window.setTimeout(tick, running ? POLL_BUSY_MS : POLL_IDLE_MS);
				};
				timer = window.setTimeout(tick, running ? POLL_BUSY_MS : POLL_IDLE_MS);
				return () => { alive = false; if (timer) window.clearTimeout(timer); };
			}, [auto, running, load]);

			/**
			 * 发一个动作。写操作由调用方带 confirm。
			 * @param {string} op - status | pull | push | peers | doctor。
			 * @param {string} target - sessions | workspace。
			 * @param {boolean} [confirm] - 写操作必须是 true。
			 * @returns {Promise<void>} 无。
			 */
			const call = async (op, target, confirm, extra) => {
				setPending(null);
				setBusy(true);
				try {
					const { status, body, error } = await api('/op', { method: 'POST', body: JSON.stringify({ op, target, confirm: confirm === true, ...(extra ?? {}) }) });
					if (body === null) {
						// 2026-11-22: 「运行结果」那一块撤掉了, 失败原因改摆在状态条下面那一行
						setPairError(String(error ?? `HTTP ${status}`));
						return;
					}
					// Luwi 加 (2026-10-20): 配对码 (载荷只在这一次应答里; 不进快照)
					if (op === 'pair') {
						if (body.ok === true) {
							setPair({ svg: body.svg, payload: body.payload, summary: body.summary });
							setPairError(null);
						} else {
							setPair(null);
							// 失败原因要摆在按钮旁边 (只落在最下面那块回执里, 人根本看不见 —— 2026-10-20 真机上就是这么"没反应"的)
							setPairError(String(body.error ?? 'failed'));
						}
					}
					// 2026-11-22: configure / prune 失败也要说话 —— 那块回执撤掉之后, 这里是唯一的出口
					if (op !== 'pair' && body.ok !== true) setPairError(String(body.error ?? 'failed'));
					// Luwi 加 (2026-10-20): 保存成功之后把"还要再点一次确认"那句换成写入结果, 免得人以为没生效
					if (op === 'configure' && body.ok === true) setPairError(null);
					// Luwi 加 (2026-10-15): 写进去了就把草稿清掉 (写的是哪几个值, 回执那一栏里有)
					if (op === 'configure' && body.ok === true) { setRemoteDraft(''); setTokenDraft(''); setBranchDraft(''); }
					await load();
				} finally {
					setBusy(false);
				}
			};

			if (!channelOpen) {
				return h('div', { className: 'luwi-sync-panel', 'data-seat': seat },
					h('div', { className: 'luwi-sync-head' },
						h('div', { className: 'luwi-sync-head-row' },
							h('span', { className: 'luwi-sync-dot', 'data-on': '0' }),
							h('span', { className: 'luwi-sync-strong' }, t('面板通道没开')))),
					h('div', { className: 'luwi-sync-card luwi-sync-dim' }, t('宿主没有注册 /luwi-sync 路由 —— 这个 profile 大概没有 HTTP 服务 (webServer)。同步本身照跑, 面板只读不可用。')),
					fault === null ? null : h('pre', { className: 'luwi-sync-pre' }, fault));
			}

			const mount = snap.mount ?? {};
			const config = snap.config ?? {};
			const deviceName = config.deviceName === '' || config.deviceName === undefined ? '—' : config.deviceName;

			// Luwi 加 (2026-10-20): 手机侧（bridge runner）只读 —— 开关与周期在 Luwi 应用的设置里改,
			// 配对也在那里扫码。面板这边改完还得重启 host, 所以不做第二处开关
			if (mount.runner === 'luwi-bridge') {
				return renderPhonePanel(mount, config, deviceName);
			}

			return h('div', { className: 'luwi-sync-panel', 'data-seat': seat },
				// 顶部状态条
				h('div', { className: 'luwi-sync-head' },
					h('div', { className: 'luwi-sync-head-row' },
						h('span', { className: 'luwi-sync-dot', 'data-on': mount.mounted ? '1' : '0' }),
						h('span', { className: 'luwi-sync-strong' }, mount.mounted ? t('已挂载') : t('未挂载')),
						h('span', { className: 'luwi-sync-badge', title: t('本机进程 / 手机桥接') }, mount.runner === 'luwi-bridge' ? t('手机桥接') : t('本机进程')),
						h('span', { className: 'luwi-sync-badge' }, `v=${snap.version}`),
						renderSyncToggle()),
					h('div', { className: 'luwi-sync-head-row luwi-sync-dim' },
						h('span', null, `${t('设备')} ${deviceName}`),
						h('span', null, `${t('远端')} ${config.remoteState === 'set' ? t('已配置') : t('未配置')}`)),
					mount.disabledReason === undefined ? null : h('div', { className: 'luwi-sync-bad' }, mount.disabledReason)),

				// 2026-11-22 主人: "将仓库以下的面板全部删除" —— 面板只剩三样:
				// 顶部状态条 / 配对卡 / 仓库卡 (仓库卡里带着同步总开关与它的确认条), 底下是自动刷新那一行。
				// 镜像读数 / 操作 / 对端 / P2P / 运行结果五块整块撤掉 —— 那些读数仍在 `/sync doctor` 与
				// `sync_*` 工具里, 面板不再摆一遍
				pairError === null ? null : h('div', { className: 'luwi-sync-bad', key: 'action-error' }, pairError),
				renderPairCard(),
				renderRepoCard(),
				// 底栏
				h('div', { className: 'luwi-sync-foot' },
					h('label', { className: 'luwi-sync-dim' },
						h('input', {
							type: 'checkbox',
							checked: auto,
							onChange: (event) => setAuto(event.target.checked),
						}),
						' ',
						t('自动刷新')),
					h('span', { className: 'luwi-sync-dim' }, busy ? t('刷新中') : (loadedAt === 0 ? '—' : formatAge(Date.now() - loadedAt)))));

			/**
			 * 一行 kv。
			 * @param {string} key - 名字。
			 * @param {unknown} value - 值 (ReactNode)。
			 * @param {string} [tone] - 额外的 class。
			 * @returns {object} React 元素 (fragment 的两个孩子)。
			 */
			function kv(key, value, tone) {
				return [
					h('span', { key: `${key}-k` }, key),
					h('span', { key: `${key}-v`, className: tone }, value === undefined || value === null || value === '' ? '—' : value),
				];
			}

			/**
			 * 同步总开关 (2026-10-24 从仓库卡挪到「已挂载」那一行最右)。
			 *
			 * `config.remoteState === 'set'` 就是"同步开着"; 这一颗点下去走 configure 的
			 * `{ on: !syncOn }`, 与设置页那个开关写的是同一份文件 (改完要重启 host)
			 * @returns {object} React 元素。
			 */
			function renderSyncToggle() {
				const syncOn = config.remoteState === 'set';
				const canFlip = config.panelOps === true && channelOpen && !busy && !running && pending === null;
				return h('button', {
					type: 'button',
					className: 'luwi-sync-btn luwi-sync-toggle',
					'data-on': syncOn ? '1' : '0',
					disabled: !canFlip,
					title: t('改了要重启 host 才生效'),
					onClick: () => setPending({ op: 'configure', target: 'sessions', extra: { on: !syncOn } }),
				}, syncOn ? t('同步: 开') : t('同步: 关'));
			}

			/**
			 * 手机侧那块只读面板 (bridge runner)。
			 *
			 * 开关与周期在 Luwi 应用的「设置 → 同步」里改 (那里还能扫码配对); 这一页只报读数,
			 * 不做第二处开关 —— 面板里改完还得重启 host, 那是自找的"改了没生效"
			 * @param {object} mount - 挂载读数。
			 * @param {object} config - 配置读数。
			 * @param {string} deviceName - 设备名。
			 * @returns {object} React 元素。
			 */
			function renderPhonePanel(mount, config, deviceName) {
				const pairingInfo = snap.pairing ?? {};
				const mirror = Array.isArray(snap.mirrors) ? snap.mirrors[0] : null;
				const meta = (mirror && mirror.meta) || {};
				const rows = [];
				rows.push(...kv(t('同步'), config.remoteState === 'set' ? t('开') : t('关')));
				rows.push(...kv(t('配对'), pairingInfo.paired ? `${t('已配对')}${pairingInfo.from ? ` · ${pairingInfo.from}` : ''}` : t('未配对')));
				rows.push(...kv(t('仓库主机'), pairingInfo.repoHost || '—'));
				rows.push(...kv(t('周期拉取'), `${config.pullIntervalMinutes ?? 0} min`));
				rows.push(...kv(t('上次拉取'), formatAge(meta.lastPullAgeMs)));
				if (meta.lastError) rows.push(...kv(t('最近错误'), meta.lastError, 'luwi-sync-bad'));
				return h('div', { className: 'luwi-sync-panel', 'data-seat': seat },
					h('div', { className: 'luwi-sync-head' },
						h('div', { className: 'luwi-sync-head-row' },
							h('span', { className: 'luwi-sync-dot', 'data-on': mount.mounted ? '1' : '0' }),
							h('span', { className: 'luwi-sync-strong' }, mount.mounted ? t('已挂载') : t('未挂载')),
							h('span', { className: 'luwi-sync-badge' }, `v=${snap.version}`)),
						h('div', { className: 'luwi-sync-head-row luwi-sync-dim' },
							h('span', null, `${t('设备')} ${deviceName}`))),
					h('div', { className: 'luwi-sync-card' },
						h('div', { className: 'luwi-sync-card-title' },
							h('span', { className: 'luwi-sync-strong' }, t('同步')),
							h('span', { className: 'luwi-sync-badge' }, config.remoteState === 'set' ? t('开') : t('关'))),
						h('div', { className: 'luwi-sync-kv' }, rows)),
					h('div', { className: 'luwi-sync-card luwi-sync-dim' }, t('手机端只读: 开关与周期拉取在 Luwi 应用的「设置 → 同步」里改, 配对也在那里扫码。')));
			}

			/**
			 * 仓库卡 + 保存提示 + 两次点击的确认条 (2026-10-22: 原来在「操作」页, 现在并进单页)。
			 * @returns {object[]} React 元素。
			 */
			function renderRepoCard() {
				const mirrors = Array.isArray(snap.mirrors) ? snap.mirrors : [];
				const target = pending ? pending.target : actionTarget;
				const mirror = mirrors.find(m => m.target === target);
				const writesAllowed = config.panelOps === true && channelOpen;
				const syncOn = config.remoteState === 'set';
				const hasRemote = syncOn;
				const canConfigure = writesAllowed && !busy && !running && pending === null;
				return [
					h('div', { className: 'luwi-sync-card', key: 'repo' },
						h('div', { className: 'luwi-sync-card-title' },
							h('span', { className: 'luwi-sync-strong' }, t('仓库')),
							h('span', { className: syncOn ? 'luwi-sync-good' : 'luwi-sync-dim' }, syncOn ? t('已配置') : t('未配置'))),
						h('div', { className: 'luwi-sync-dim' }, t('只在这台电脑上填一次; 手机用下面的配对码扫入')),
						h('label', { className: 'luwi-sync-field' },
							h('input', {
								type: 'text',
								className: 'luwi-sync-input',
								placeholder: t('仓库地址'),
								value: remoteDraft !== '' ? remoteDraft : (config.remoteState === 'set' && !remoteArmed ? MASK : ''),
								disabled: !writesAllowed,
								onFocus: () => { if (remoteDraft === '' && config.remoteState === 'set') setRemoteArmed(true); },
								onBlur: () => { if (remoteDraft === '') setRemoteArmed(false); },
								onChange: (e) => setRemoteDraft(e.target.value),
							})),
						h('div', { className: 'luwi-sync-dim' }, config.remoteState === 'set'
							? t('已配置: 小点只是占位, 点一下清空后填新的, 保存才生效')
							: t('留空 = 保持不动')),
						// 2026-10-20: 令牌单独一格 —— 手机侧 git 没有 credential helper,
						// 二维码里带的是拼好的地址 (PC 存干净地址 + 令牌, 手机存拼好的那一份)
						h('label', { className: 'luwi-sync-field' },
							h('input', {
								type: 'password',
								className: 'luwi-sync-input',
								placeholder: t('访问令牌 (私有仓库的 PAT; 留空 = 保持不动)'),
								value: tokenDraft !== '' ? tokenDraft : (config.hasRemoteToken === true && !tokenArmed ? MASK : ''),
								disabled: !writesAllowed,
								autoComplete: 'off',
								onFocus: () => { if (tokenDraft === '' && config.hasRemoteToken === true) setTokenArmed(true); },
								onBlur: () => { if (tokenDraft === '') setTokenArmed(false); },
								onChange: (e) => setTokenDraft(e.target.value),
							})),
						h('div', { className: 'luwi-sync-dim' }, `${t('令牌')}: ${config.hasRemoteToken ? t('已保存') : t('还没存')} · ${t('只存本机与应用私有目录, 二维码里会带上拼好的地址')}`),
						h('div', { className: 'luwi-sync-dim' }, t('GitHub 令牌 permissions 仅需: Contents —— Read and write')),
						// 2026-10-24: 分支几乎不动, 收进「高级」
						h('details', { className: 'luwi-sync-adv' },
							h('summary', { className: 'luwi-sync-dim' }, t('高级')),
							h('label', { className: 'luwi-sync-field' },
								h('input', {
									type: 'text',
									className: 'luwi-sync-input',
									placeholder: `${t('分支')} (${config.branch || 'main'})`,
									value: branchDraft,
									disabled: !writesAllowed,
									onChange: (e) => setBranchDraft(e.target.value),
								}))),
						h('div', { className: 'luwi-sync-actions' },
							h('button', {
								type: 'button',
								className: 'luwi-sync-btn',
								disabled: !canConfigure || (remoteDraft.trim() === '' && tokenDraft.trim() === '' && branchDraft.trim() === ''),
								onClick: () => setPending({
									op: 'configure',
									target: 'sessions',
									extra: {
										...(remoteDraft.trim() === '' ? {} : { remote: remoteDraft.trim(), pairing: true }),
										// 令牌单独一格; 与地址一起改时也生成新的配对 id (宿主那一侧判)
										...(tokenDraft.trim() === '' ? {} : { remoteToken: tokenDraft.trim() }),
										...(branchDraft.trim() === '' ? {} : { branch: branchDraft.trim() }),
									},
								}),
							}, t('保存')),
							// 同步总开关 2026-10-24 挪到顶部「已挂载」那一行 (renderSyncToggle)
							// Luwi 加 (2026-10-20): 清理仓库会话 —— 只删仓库里那些窗口外的镜像与合并副本,
							// 本机会话一个字节都不动; 走两次点击的确认条
							h('button', {
								type: 'button',
								className: 'luwi-sync-btn',
								disabled: !writesAllowed || !hasRemote,
								title: hasRemote ? undefined : t('先保存仓库地址'),
								onClick: () => setPending({ op: 'prune', target: 'sessions' }),
							}, t('清理仓库会话')))),
					h('div', { className: 'luwi-sync-dim', key: 'save-hint' }, t('保存是两次点击: 点完「保存」还要在下面那块确认条里点「确认」, 成功之后"已配置"才会亮')),
					// 写动作: 两次点击。2026-10-20 挪到仓库卡正下方 —— 原来它在整页最底下, 点了「保存」
					// 却看不到确认条, 真机上就是这么"没反应"的
					pending === null ? null : h('div', { className: 'luwi-sync-confirm', key: 'confirm' },
						h('div', null, pending.op === 'configure'
							? t('写下这段配置')
							: pending.op === 'push'
								? t('推送会把这台机器的全量镜像推到远端 —— 手机侧走的是移动数据时这笔账很大')
								: pending.op === 'prune'
									? t('清理仓库会话会删掉仓库里窗口外的会话镜像与合并副本, 然后推一次 (本机会话一个字节都不动)')
									: t('拉取会把远端的变化合进本地 (keep-both, 本地被改的文件进不了回收站之外任何地方)')),
						h('div', { className: 'luwi-sync-dim' },
							pending.op === 'configure'
								? t('改了要重启 host 才生效')
								: `${pending.target} · ${pending.op === 'push' && mirror && mirror.cost ? `${mirror.cost.files} ${t('个文件')} · ${formatBytes(mirror.cost.bytes)} · ` : ''}${t('远端')} ${config.remoteState === 'set' ? t('已配置') : t('未配置')}`),
						h('div', { className: 'luwi-sync-actions' },
							h('button', {
								type: 'button',
								className: 'luwi-sync-btn',
								disabled: busy || !writesAllowed,
								onClick: () => void call(pending.op, pending.target, true, pending.extra),
							}, t('确认')),
							h('button', { type: 'button', className: 'luwi-sync-btn', onClick: () => setPending(null) }, t('取消')))),
				];
			}

			/**
			 * 配对卡 (2026-10-22 主人: 配对操作放最上方 —— 换手机 / 重装 / 加第三台设备,
			 * 进来第一个动作都是它)。
			 *
			 * 2026-11-21: 「账号」那一行 (登录 Luwi 账号 / 刷新权益 / 退出登录) 整条下线 ——
			 * 它只给 P2P 到期闸供读数, 而 P2P 缺省关、手机侧从不启用, 等于没用; 配对码与 git 同步
			 * 本来就不看它 (见 CHANGELOG 0.4.0)
			 * @returns {object} React 元素。
			 */
			function renderPairCard() {
				const writesAllowed = config.panelOps === true && channelOpen;
				const hasRemote = config.remoteState === 'set';
				const pairSummary = snap.pairing ?? {};
				return h('div', { className: 'luwi-sync-card', key: 'pair' },
					h('div', { className: 'luwi-sync-card-title' },
						h('span', { className: 'luwi-sync-strong' }, t('配对手机')),
						h('span', { className: 'luwi-sync-badge' }, pairSummary.paired ? t('已配对') : t('未配对'))),
					h('div', { className: 'luwi-sync-dim' }, t('手机: 设置 → 同步 → 扫码配对。二维码里有仓库凭据, 别外传。请确保 root 或 Shizuku 在 Luwi 上正常运行, 否则同步会失败。')),
					hasRemote ? null : h('div', { className: 'luwi-sync-bad' }, t('还没有保存仓库地址: 先在下面那一格填好并保存 (两次点击), 再回来生成配对码')),
					h('div', { className: 'luwi-sync-actions' },
						h('button', {
							type: 'button',
							className: 'luwi-sync-btn',
							disabled: !writesAllowed || busy || !hasRemote,
							title: hasRemote ? undefined : t('先保存仓库地址'),
							onClick: () => void call('pair', 'sessions'),
						}, busy ? t('生成中') : t('生成配对码'))),
					pair === null ? null : h('div', { className: 'luwi-sync-pair' },
						h('img', { src: svgToDataUrl(pair.svg), width: 240, height: 240, alt: t('配对码') }),
						h('div', { className: 'luwi-sync-dim' }, `${pair.summary?.repoHost || ''} · ${pair.summary?.branch || ''}${pair.summary?.from ? ` · ${pair.summary.from}` : ''}`),
						h('button', {
							type: 'button',
							className: 'luwi-sync-btn',
							onClick: () => {
								try {
									void navigator.clipboard.writeText(pair.payload);
									setCopied(true);
									window.setTimeout(() => setCopied(false), 1500);
								} catch {
									// 剪贴板不可用: 不给假回执
								}
							},
						}, copied ? t('已复制') : t('复制配对文本'))));
			}


		}

		// ── 座位 ───────────────────────────────────────────────────────────────────

		/**
		 * 注册左侧栏全局入口 (sidebar.panellist 的图标 + main 的整页)。
		 *
		 * 2026-11-21 主人: 侧边栏只留这一行, 名字是 **luwi终端** (原来叫「同步」); 同一插件里那枚
		 * 「终端」(在手机 Linux 沙盒里跑命令) 与同步无关, 整条下线 —— 座位只剩这一对
		 * @param {object} ctx - 浏览器半的 cordis 上下文。
		 * @returns {() => void} 两处注册的清理函数。
		 */
		/** 左座位那一次注册的清理函数 (apply 跑第二遍时先摘旧的) */
		const seatState = { left: null };

		function installLeftSeat(ctx) {
			// 2026-11-21 晚: HMR / 重启之后 apply 可能跑第二遍. 先摘掉自己上一次那一对注册 ——
			// 同 id 重复注册会抛 `duplicate id`, 以前那个异常被吞掉, 侧边栏就无声消失
			if (seatState.left !== null) {
				try { seatState.left(); } catch { /* 已经摘掉 */ }
				seatState.left = null;
			}
			const icon = ctx.slots.register(
				{ name: 'sidebar.panellist', id: LEFT_PANEL_ID, order: 40, label: () => t('luwi终端') },
				(props) => h(SyncIcon, { size: props.size, active: props.active }),
			);
			let body;
			try {
				body = ctx.slots.register(
					{ name: 'main', key: LEFT_PANEL_ID },
					() => h(SyncPanel, { seat: 'main' }),
				);
			} catch (error) {
				// 身体那一半装不上时把图标也摘掉, 免得侧边栏留一颗点了没反应的入口
				try { icon(); } catch { /* 已经摘掉 */ }
				throw error;
			}
			const off = () => {
				try { body(); } catch { /* 已经摘掉 */ }
				try { icon(); } catch { /* 已经摘掉 */ }
				if (seatState.left === off) seatState.left = null;
			};
			seatState.left = off;
			return off;
		}

		/**
		 * 注册官方右侧栏 tab (能力门 + 两段式: tab 类型 + tab 身体)。
		 * 座位没声明 / 两个可选服务拿不到 = 安静返回, 不抛。
		 * @param {object} ctx - 浏览器半的 cordis 上下文。
		 * @returns {(() => void)|null} 清理函数 (没装成 = null 或空函数)。
		 */
		function installRightSeat(ctx) {
			if (!ctx.slots || typeof ctx.slots.inject !== 'function') return null;
			return ctx.slots.inject('sidebar.right.pane.tab', () => {
				let disposed = false;
				let poll = 0;
				let off = null;
				const cleanup = () => {
					disposed = true;
					if (poll) { try { window.clearTimeout(poll); } catch { /* ignore */ } poll = 0; }
					if (off) { try { off(); } catch { /* ignore */ } off = null; }
				};
				const attempt = () => {
					if (disposed) return;
					const tabs = typeof ctx.get === 'function' ? ctx.get('sidebarRightTabs') : null;
					const ctrl = typeof ctx.get === 'function' ? ctx.get('sidebarRight') : null;
					if (!tabs || typeof tabs.register !== 'function' || !ctrl || typeof ctrl.openTab !== 'function') {
						// 座位声明了 ≠ 服务就绪: 短轮询等一次 (拿到才注册, 拿不到就一直是左栏那条路)
						poll = window.setTimeout(attempt, 250);
						return;
					}
					let disposeTabs = null;
					let disposeBody = null;
					try {
						disposeTabs = tabs.register({
							id: RIGHT_TAB_ID,
							kind: RIGHT_TAB_KIND,
							keepMounted: true,
							title: () => t('同步'),
							guide: [{
								id: 'sync',
								order: 120,
								title: () => t('同步'),
								description: () => t('会话与工作区的跨设备同步: 状态 / 拉取 / 推送 / 自检'),
								icon: SyncIcon,
							}],
						});
						disposeBody = ctx.slots.register(
							{ name: 'sidebar.right.pane.tab', key: RIGHT_TAB_ID },
							() => h(SyncPanel, { seat: 'right' }),
						);
					} catch {
						// 注册被拒 (id 撞车 / 形态不符): 保持左栏那条路, 静默
						try { if (disposeTabs) disposeTabs(); } catch { /* ignore */ }
						try { if (disposeBody) disposeBody(); } catch { /* ignore */ }
						return;
					}
					off = () => {
						try { disposeBody(); } catch { /* ignore */ }
						try { disposeTabs(); } catch { /* ignore */ }
					};
				};
				attempt();
				return cleanup;
			});
		}

		/**
		 * 按宿主配置装座位。
		 * @param {object} ctx - 浏览器半的 cordis 上下文。
		 * @param {string} seats - both | right | left | off。
		 * @returns {() => void} 清理函数。
		 */
		function installSeats(ctx, seats) {
			// 不认识的取值按 both: 宁可多装一个座位, 也不要因为一个拼错的配置整个面板不见
			const mode = ['both', 'left', 'right', 'off'].includes(seats) ? seats : 'both';
			const wantLeft = mode === 'both' || mode === 'left';
			const wantRight = mode === 'both' || mode === 'right';
			const offs = [];
			if (wantLeft) {
				try {
					const off = installLeftSeat(ctx);
					if (typeof off === 'function') offs.push(off);
				} catch (error) {
					// 2026-11-21 晚: 这一处以前是 `catch {}` —— 左座位装不上, 侧边栏就没有 `luwi终端`,
					// 而且一个字都不说. 现在一律打到浏览器控制台 (dsh 的客户端日志会转出这一行)
					console.warn('[luwi-dsh-sync] left seat not registered:', error && error.message ? error.message : error);
				}
			}
			if (wantRight) {
				try {
					const off = installRightSeat(ctx);
					if (typeof off === 'function') offs.push(off);
				} catch { /* 同上 */ }
			}
			return () => { for (const off of offs) { try { off(); } catch { /* ignore */ } } };
		}

		// ── 插件 ───────────────────────────────────────────────────────────────────

		/**
		 * 装配: 样式 + 座位。座位装哪些先问宿主 (拿不到配置 = 当 both, 通道没开也要看得见入口)。
		 * @param {object} ctx - 浏览器半的 cordis 上下文。
		 * @returns {void}
		 */
		function apply(ctx) {
			ctx.effect(() => installStyles(), `${PLUGIN_NAME}.panel-css`);

			// 语言: 有 locale 服务就跟着它走 (可选服务, 缺了按中文)
			if (typeof ctx.get === 'function') {
				const locale = ctx.get('locale');
				if (locale && typeof locale.getLocale === 'function') {
					try {
						const current = locale.getLocale();
						localeId = current && typeof current.id === 'string' && current.id.startsWith('en') ? 'en' : 'zh';
					} catch { /* 读不到就按中文 */ }
				}
				if (locale && typeof locale.subscribe === 'function') {
					ctx.effect(() => {
						const off = locale.subscribe(() => {
							try {
								const current = locale.getLocale();
								const next = current && typeof current.id === 'string' && current.id.startsWith('en') ? 'en' : 'zh';
								if (next !== localeId) { localeId = next; emitLocale(); }
							} catch { /* ignore */ }
						});
						return () => { try { off(); } catch { /* ignore */ } };
					}, `${PLUGIN_NAME}.panel-locale`);
				}
			}

			ctx.effect(() => {
				let disposed = false;
				let off = null;
				const install = (seats) => {
					if (disposed || off !== null) return;
					off = installSeats(ctx, seats);
				};
				probeConfig().then(
					(config) => install(config === null ? 'both' : config.seats),
					() => install('both'),
				);
				return () => {
					disposed = true;
					if (off !== null) off();
				};
			}, `${PLUGIN_NAME}.panel-seats`);
		}

		const inject = ['slots'];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
