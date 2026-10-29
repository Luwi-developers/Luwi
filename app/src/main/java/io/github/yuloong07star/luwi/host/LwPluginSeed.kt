package io.github.yuloong07star.luwi.host

import android.content.Context
import android.util.Log
import io.github.yuloong07star.luwi.plugin.PluginInstaller
import io.github.yuloong07star.luwi.plugin.PluginManager
import io.github.yuloong07star.luwi.plugin.PluginStore
import io.github.yuloong07star.luwi.plugin.PluginVersions
import io.github.yuloong07star.luwi.plugin.theme.BallTheme
import java.io.File

/**
 * 随包发的那个浮标外观插件 (2026-10-25 主人: "将鲸鱼娘插件入包, 不用用户自己安装")
 *
 * 链路与"从链接装入"**完全是同一条** ([PluginInstaller.install]): 解包 -> 验发布者签名与逐文件
 * 哈希 -> 查版本 / 前缀 / 能力 -> 才落地。随包不带任何特权, 少验一样都不算数 —— 真机上那份包坏了,
 * 这里给的就是"签名验不过"那一条, 与用户自己从链接装看到的一模一样
 *
 * **三件事各有一条判据**:
 *
 * 1. **只补这一版一次**: 记号 `$DSH_HOME/lw/plugin-seed.txt` 里一行一个版本号。写进去之后,
 *    主人把插件删掉就一直删着 —— "我删掉的东西每次开机又回来"是这类功能最招人烦的地方
 * 2. **比装着的旧才装**: 装着的已经是同一版或更新一版 (他从插件仓库自己升过) 就一个字节都不动;
 *    降级那一条 [PluginInstaller] 本来就会拒, 这里先比一次, 免得日志里留一条注定失败的尝试
 * 3. **首启替主人挑上它**: 只有"从来没挑过外观" (`$DSH_HOME/plugins/.theme.json` 不存在) 才写那一条;
 *    挑过内置 (那份文件里 id 是空串) 也是一个选择, 不去翻
 *
 * 落位失败 (assets 缺 / 磁盘满 / 验签不过) 只记日志:**这一件事不许拦住 host 起来**, 而缺哪一样在
 * 设置页「插件」那一段与球的菜单里都看得见 (那里只剩内置画法)
 *
 * 随包那份 `.lwp` 由构建从 `../luwi-plugins/packages/` 拷进 assets (见 `app/build.gradle.kts` 的
 * `copySeedAssets`) —— 签好的包只住在插件仓库那一侧, 本条只是把它读进来
 */
internal object LwPluginSeed {

    private const val TAG = "LwPluginSeed"

    /** assets 里那一个目录名 (与 `copySeedAssets` 的 `into("lw-plugins")` 对齐) */
    private const val FOLDER = "lw-plugins"

    /** 随包的那一份: 文件名带版本号, 换一版就换名字 (jsDelivr 那条纪律在这里同样省事) */
    private const val ASSET = "$FOLDER/whalegirl-balltheme-1.1.3.lwp"

    /** 插件自己的 id 与版本: 与包里的 `plugin.json` 逐字一致, 漂开了就永远装不上 */
    private const val ID = "io.github.yuloong07star.luwi.theme.whalegirl"
    private const val VERSION = "1.1.3"

    /** 记号落在 `$DSH_HOME/lw/` 下 (与 `BallPhaseFile` / `session-sync.json` 同一层) */
    private const val SEED_DIR = "lw"
    private const val SEED_FILE = "plugin-seed.txt"

    /** 外观选择那份文件的名字, 与 `BallTheme.CHOICE` 逐字一致 (那边是 private, 这里只能抄一份) */
    private const val THEME_CHOICE = ".theme.json"

    /**
     * 装一次 (与 `LwSeed.ensure` / `CustomPresets.ensure` 并排, 排进 restore 那条后台线程)
     *
     * 1000 多个文件要解包 + 逐文件验签, 那是几百毫秒到两秒的活 —— 放在主线程上就是一次看得见的卡
     */
    fun ensure(context: Context) {
        runCatching { seed(context) }
            .onFailure { Log.w(TAG, "the bundled ball theme could not be seeded", it) }
    }

    private fun seed(context: Context) {
        val home = File(context.filesDir, DshHost.HOME_DIR)
        val marker = File(File(home, SEED_DIR), SEED_FILE)
        val seeded = runCatching { marker.readLines().map { it.trim() }.filter { it.isNotEmpty() }.toSet() }
            .getOrDefault(emptySet())
        if (VERSION in seeded) return

        val installed = PluginStore.currentVersion(context, ID)
        if (installed == null || PluginVersions.compare(installed, VERSION) < 0) install(context)

        // 装成了才启用 / 挑外观 / 落记号: 装失败时下一次启动还有机会 (磁盘满这种事是暂时的)
        if (PluginStore.currentVersion(context, ID) == null) {
            Log.w(TAG, "the bundled $ID is not on disk after the install attempt, so it is not picked")
            return
        }
        enableOnce(context)
        chooseOnce(context)
        runCatching {
            marker.parentFile?.mkdirs()
            marker.writeText((seeded + VERSION).sorted().joinToString("\n") + "\n")
        }.onFailure { Log.w(TAG, "the seed marker could not be written", it) }
    }

    /** assets 里那一份 -> cache 里的临时文件 -> [PluginInstaller] (开发者模式一律关着, 它本来就是签好的) */
    private fun install(context: Context) {
        val staging = File(context.cacheDir, "lw-plugin-seed.lwp")
        try {
            context.assets.open(ASSET).use { input ->
                staging.outputStream().use { output -> input.copyTo(output) }
            }
        } catch (missing: Throwable) {
            Log.w(TAG, "$ASSET is not in this apk, so nothing is seeded", missing)
            return
        }
        try {
            val outcome = PluginInstaller.install(context, staging, developerMode = false)
            Log.i(TAG, "seeded ${outcome.name} ${outcome.version} (${outcome.id}) from $ASSET")
        } catch (refused: Throwable) {
            Log.w(TAG, "$ASSET was not installed: ${refused.message}", refused)
        } finally {
            staging.delete()
        }
    }

    /**
     * 启用一次 (与设置页"装完紧接着启用"那一下同一件事)
     *
     * `art` 域零能力, `PluginHost.connect` 对它是 null, 所以这一步只是把状态记成启用; 已经启用过
     * (主人自己点过, 或上一次启动已经做过) 就不动 —— 那之后主人停用它也照旧算数, 因为记号已经落过
     */
    private fun enableOnce(context: Context) {
        val entry = PluginManager.entries(context).firstOrNull { it.id == ID } ?: return
        if (entry.enabled) return
        runCatching { PluginManager.enable(context, ID) }
            .onSuccess { Log.i(TAG, "$ID is enabled: $it") }
            .onFailure { Log.w(TAG, "$ID could not be enabled", it) }
    }

    /**
     * 首启替主人挑上它: **只有从来没挑过**才动
     *
     * `.theme.json` 存在就说明主人选过 (选内置也会写一个空 id), 那一个字都不改 —— 与 `LwSeed` 的
     * "改过的那一份已经在了"是同一条道理
     */
    private fun chooseOnce(context: Context) {
        if (File(PluginStore.root(context), THEME_CHOICE).isFile) return
        runCatching { BallTheme.choose(context, ID) }
            .onSuccess { Log.i(TAG, "the ball theme now defaults to $ID") }
            .onFailure { Log.w(TAG, "the ball theme choice could not be written", it) }
    }
}
