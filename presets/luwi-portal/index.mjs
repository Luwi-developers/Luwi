/**
 * 宿主那一半: 空的
 *
 * 这一包只有客户端那一半 (`./client`), 而 dsh 的 client-modules 只扫**已经挂上的 Loader 行**里声明了
 * `dsh.client` 的包 —— 所以它必须有这一行 (见 `PluginOverlay` 的 PLUGINS / OWN_PLUGINS), 但宿主这一半
 * 什么都不做. 界面与数据全在 `lib/client.js` 里, 读写 `$DSH_HOME/lw` 那几份文件走 `window.Luwi` 那座桥
 * (Kotlin 侧的 `ui/PortalBridge.kt`), 因为浏览器里的 JS 碰不到 app 沙盒
 */
export const name = 'luwi-portal'

export function apply() {}
