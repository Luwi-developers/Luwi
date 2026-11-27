package io.github.yuloong07star.luwi.host

import android.content.Context
import android.util.Log
import java.io.File

/**
 * 那几行"装进树里, 但要能被 dsh 的设置面板改"的插件 —— 它们住 **profile 自己的 patch**
 *
 * 2026-10-16 主人报的那条: "生图保存失败, 面板上那几项都改不了"。能把它压死的有**两件**事, 各自都
 * 足够让面板回同一句错, 两件都得对:
 *
 * **一、挂错了层** —— patch 层序是 `bundle → profile 自己的 cordis.patch.yml → $DSH_HOME/cordis.patch.yml
 * → 命令行 --patch` (`dsh-app-boot/src/profile-context.ts` 的 `readProfilePatches`), 而
 * `applyEntryPatches` 只让**后面的** patch 命中**前面 insert 出来的行**
 * (`cordis-plugin-include/src/index.ts`)。面板那条写入由 config-editor 追加在 profile patch 末尾,
 * 于是它永远命中不了命令行覆盖层最后插进来的那一行 —— 一度以为这就是全部病根, 把这一行从
 * [PluginOverlay] 挪进 profile patch (下面那一段), 仍然是同一句错
 *
 * **二、盘上写的形态与 Loader 眼里的形态对不上** (2026-10-16 事后在设备上用真代码复现出来的)
 *
 * - dsh 读 patch 时会把 insert 子行里**绝对路径**的 name 锚成 `file://` URL
 *   (`dsh-app-boot` 的 `anchorInsertedPluginNames`: `isAbsolute(name)` 就 `pathToFileURL(resolve(...))`),
 *   于是 Loader 里这一行的 `options.name` 是 `file:///data/...`, 盘中那份文本里却是裸路径
 * - 面板存一次配置时, config-editor 把 `config` 行追加进盘上这份 patch, 那一行的 `name` 抄的是
 *   Loader 那个 (锚过的) 值 (`packages/boot/config-editor/src/index.ts` 的 `document.add`); 而它落盘
 *   前的自检做的是裸 `yaml.load` (**不 anchoring**), 同一条 insert 子行在自检里还是裸路径 ——
 *   名字对不上, `applyEntryPatches` 把这条 config 行按 `patch: name mismatch for "imagegen"` 丢掉,
 *   自检于是看到"生效值还是继承来的那一份", 抛出
 *   `Configuration for "imagegen" is overridden by a home patch or command-line overlay` ——
 *   明明没有覆盖层也报"被覆盖层覆盖", 就是这么来的
 * - 所以盘上这一行**直接写成 `file://` 形态** ([fileUrlOf]): 那不是新造一个东西, 它逐字就是 anchoring
 *   之后喂给 Loader 的那一份, 两侧一致之后面板追加的 config 行命中得上。旧安装里已经写下的裸路径由
 *   [namedRow] 在每启一次 host 时改成这个形态 (只改 `name:` 那一行)
 *
 * 修好之后 [PluginOverlay] 那一份仍然管另外几件事: 只按 id 覆盖已有行 (官方语音 bundle 那两条) 与插入
 * "设置面板不需要改它"的那几行
 *
 * 三条纪律: **[OWNED] 里的每一行都必须能在树里找到文件** (树没带它就不许留一行指向不存在的文件,
 * 那会让 loader 报一条 entry 载入失败); **用户写给它的 `config:` 一个字节都不动**; **`name:` 必须是
 * [fileUrlOf] 那个形态** —— 面板能不能存进去全看这一条 (判据在 `tools/check-image-edit.mjs`,
 * `tools/check-overlay-yaml.mjs` 与 `PluginRowsTest`)
 */
internal object PluginRows {

    private const val TAG = "PluginRows"

    /** profile 那份 patch 的文件名 (与 dsh 的 `PROFILE_PATCH_FILENAME` 一致) */
    private const val PATCH_FILE = "cordis.patch.yml"

    private const val PROFILE = "web"

    /**
     * 我们放进 profile patch 的那几行, **顺序就是写的顺序**
     *
     * `imagegen` (第三方生图插件 `@dickpy/dsh-imagegen`) 与 `mneme` (`@modusensus/dsh-mneme` 记忆)
     * 都是"装进树里, 但要能被 dsh 的设置面板改"的那一类: 它们的渠道、密钥、模型与数据目录是**用户
     * 在界面上配**的东西, 而装在命令行覆盖层上会让整个设置面板变成只读
     *
     * `config` 是**随包写进 insert 子行**的那几项 (面板之后追加的顶层 config 行压在它上面, 于是主人
     * 改过的值照样生效)。只有 mneme 要: 它的记忆库缺省落 `~/.dsh/memory`, 而本机 `HOME` 指向**工作区**
     * (`DshHost.spawn` 那两行), 不钉住就会在工作区根下长出一个 `.dsh/memory` —— 这与生图插件当年
     * 在 `/sdcard/DSH/.dsh/dsh-imagegen` 里那一坨是同一类毛病
     */
    private class Owned(
        val id: String,
        val entry: String,
        val config: (Context) -> List<String> = { emptyList() },
    ) {
        /** 包名: `node_modules/` 之后那一段 (带 scope 的是两段), 判"同一包"只认它 */
        val packageName: String = entry.substringAfter("node_modules/").let { rest ->
            if (rest.startsWith("@")) rest.split('/').take(2).joinToString("/") else rest.substringBefore('/')
        }
    }

    private val OWNED = listOf(
        Owned("imagegen", "node_modules/@dickpy/dsh-imagegen/lib/index.js"),
        Owned(
            "mneme",
            "node_modules/@modusensus/dsh-mneme/lib/index.js",
            config = ::memoryConfig,
        ),
    )

    /**
     * 已经撤出随包的那几行 (`id` → 包名, 2026-10-30)
     *
     * [OWNED] 只管**还在发**的那几行, 所以撤掉一个插件之后, 盘上那条指向已删文件的行不会被那一圈
     * 循环碰到 —— 设备上的表现是每启一次 host 写一句
     * `free-model (file://…/dsh-our-free-model/index.js): failed to import` 加
     * "1 entry did not activate" (2026-10-30 在 22041216C 上实测), 界面本身照常
     *
     * 这里按 id + 包名 + **指回宿主树**三条对一次账: 主人自己在 `plugins-src/` 里装的那一份 (裸包名,
     * 或者指向树外的路径) 一个字节都不动, 什么时候退役由主人决定
     */
    private val RETIRED = listOf("free-model" to "dsh-our-free-model")

    /**
     * 这几个包**跟随应用版本**: 本体比随包那份旧时, 备份本体并把挂载行改回宿主树 (2026-11-14)
     *
     * 2026-10-25 定的"先看本体, 有就不装"有一条代价: 本体一旦装下就永远钉在那一个版本上。应用升到
     * 2.8.0 带的是 mneme 0.15.1, 而机器上 `plugins-src/mneme` 还停在 0.9.4 时, 随包那份让位之后
     * 新版一个字节都用不上 (2026-11-14 真机读数: 面板写着 `dsh-mneme 0.9.4`), 而 Luwi 这一侧
     * 越来越依赖 mneme 的新能力 (文档记忆 / 实体提取 / 酒馆排除那几处补丁) —— 主人问的是
     * "能强制安装升级吗, 不然 luwi 有些用到 mneme 新功能的地方会无法使用"
     *
     * 做法只对这张表里的 id 生效, 而且**不删也不覆盖主人那份**: 比树里旧就改个名就地放着
     * (`mneme.bak-0.9.4-20261114`), 想退回把名字改回来即可; 版本相同或本体更新时照旧让位
     *
     * 只放 mneme: imagegen 的主人那份可能是他自己改过的, 顶掉会丢改动, 那条还是纯让位
     */
    private val FOLLOW_TREE = setOf("mneme")

    /**
     * 记忆库落在 `$DSH_HOME/memory`, 不落在工作区的 `~/.dsh/memory` (见 [Owned])
     *
     * 2026-10-29: 再加一条 `excludeAgentPresets: ['tavern']` —— 酒馆一场存档就是一场 DSH 会话
     * (preset 是 `tavern`), 而记忆插件的自动蒸馏会把那些台词写成 history / preference / project,
     * 连总览都改写成酒馆剧情. 排除按 preset 判, 不碰别的会话; 那一档的默认值由 `tools/pack-host.mjs`
     * 补进上游包里 (构建时重打, 锚点对不上就失败), 这里只负责说"排除谁"
     */
    private fun memoryConfig(context: Context): List<String> = listOf(
        "memoryDir: '${File(File(context.filesDir, DshHost.HOME_DIR), "memory").absolutePath}'",
        "excludeAgentPresets: ['tavern']",
        // 2026-11-08 主人要的是"人格卡能被她自己登记成一份长期记忆" (对话层方案 P3):
        // `document` 那一档在插件里缺省是**关的** (`config.js` 里 `documentMemoryEnabled: false`),
        // 关着的时候 `memory_register_document` 会被拒 (真机读数: 她自己回"document 记忆这一档是关着的,
        // 得先把它打开我才能登")。开着之后长文档在记忆里只留一张摘要卡, 正文仍归她管、按需读
        "documentMemoryEnabled: true",
    )

    /**
     * 每次 host 起来之前对一次账 (排在 [PluginOverlay.write] 前面, 与 `CustomPresets` 那两步并排)
     *
     * 四件事都在纯函数里: 文件在而这一行不在就补, 文件在而这一行还是裸路径就改成 [fileUrlOf] 形态,
     * 文件不在而这一行在就摘, 别的行一个都不碰; 已经撤出随包的那几行 ([RETIRED]) 顺带摘掉
     */
    fun ensure(context: Context) {
        runCatching { reconcile(context) }
            .onFailure { Log.w(TAG, "the plugin rows could not be reconciled", it) }
    }

    private fun reconcile(context: Context) {
        val root = DshHost.hostRoot(context)
        val file = patchFile(context)
        // profile 还不存在时按 dsh 自己那份模板起 (与 CustomPresets 用的是同一份, 见 patchTemplate)
        var patch = if (file.isFile) file.readText() else CustomPresets.patchTemplate()
        val before = patch
        for (row in OWNED) {
            val target = File(root, row.entry)
            val config = row.config(context)
            // **先看本体, 有就不装** (2026-10-25 主人: "对于预装的插件要先检查本体有没有才安装, 不覆盖安装")
            //
            // 两条判据都算"设备上已经有一份能用的":
            //   · 盘上已经有**别人**留下的挂载行 (2026-10-16 手工装进 `plugins-src/` 那种)
            //   · profile 的 `node_modules` 里这个包指向**宿主树之外** (主人自己那份的软链/目录)
            //
            // 命中就让位: 不删它那一行, 也不往它的目录里写任何东西 —— 那份是主人装的, 什么时候退役由
            // 主人决定。两行同时在的结果不是"用了新的那一份", 而是启动时一句
            // "an adapter for provider ... is already registered", 谁先谁后全看 patch 里的次序。
            //
            // 反过来, 只有**一条可用本体都没有**时才装随包这份; 树里那份进 APK 是给新机器的
            val mountedByRow = mountsPackage(patch, row.packageName, row.id)
            val userCopy = if (mountedByRow) null else userInstallOf(context, row.packageName, root)
            // [FOLLOW_TREE] 里的包再判一次版本: 本体比树里旧就把它改名备份, 让位改由树里那份接管
            val stale = when {
                userCopy == null || !target.isFile || row.id !in FOLLOW_TREE -> null
                else -> retireStaleCopy(File(userCopy), File(File(root, "node_modules"), row.packageName))
            }
            val taken = (mountedByRow || userCopy != null) && stale == null
            if (stale != null) {
                Log.w(TAG, "${row.packageName} was older than the bundled copy, so the local one was kept as"
                    + " ${stale.name} and ${row.id} mounts the bundled one")
            }
            // 老安装里那条手写行的 id 与我们的不同 (主人当年写的是 `dsh-mneme`, 我们这一行叫 `mneme`),
            // 本体被改名之后它就指向一个不存在的文件 —— 这里按包名把它收编: 改 id 与 name 两行,
            // `config:` 一个字节都不动 (主人那十几项 dream/summarize 就是靠这一条留下来的)
            //
            // 两种情形都要收编: 这一趟刚把本体退役 (stale), 与更早一趟退役完、行还指着那个不存在的
            // 路径 (2026-11-14 真机就是这样: 第一版没有收养逻辑, 留了一行空指向)
            val foreignId = when {
                !target.isFile -> null
                else -> foreignRowIdOf(patch, row.packageName, row.id)
                    ?.takeIf { stale != null || rowNameMissing(patch, it) }
            }
            patch = when {
                stale != null && foreignId != null ->
                    adoptForeignRow(withoutRow(patch, row.id), foreignId, row.id, target.absolutePath)
                taken && hasInsertRow(patch, row.id) -> withoutRow(patch, row.id).also {
                    Log.w(TAG, "${row.packageName} is already installed (${reasonOf(mountedByRow, userCopy)}),"
                        + " so ${row.id} stood down")
                }
                taken -> {
                    Log.i(TAG, "${row.packageName} is already installed (${reasonOf(mountedByRow, userCopy)}),"
                        + " so ${row.id} stays out")
                    patch
                }
                target.isFile -> ensuredRow(patch, row.id, target.absolutePath, config)
                hasInsertRow(patch, row.id) -> withoutRow(patch, row.id).also {
                    Log.w(TAG, "the host tree carries no ${row.entry}, so the ${row.id} row was removed")
                }
                else -> {
                    Log.w(TAG, "the host tree carries no ${row.entry}, so ${row.id} cannot be mounted")
                    patch
                }
            }
        }
        for ((id, packageName) in RETIRED) {
            val next = retired(patch, id, packageName, root.absolutePath)
            if (next != patch) {
                Log.w(TAG, "the retired $packageName row ($id) pointed into the host tree, so it was removed")
                patch = next
            }
        }
        if (patch == before) return
        file.parentFile?.mkdirs()
        file.writeText(patch)
        Log.i(TAG, "the plugin rows are in ${file.absolutePath}")
    }

    private fun patchFile(context: Context): File =
        File(File(File(File(context.filesDir, DshHost.HOME_DIR), "profiles"), PROFILE), PATCH_FILE)

    /* ── 纯函数: 判据在 PluginRowsTest ─────────────────────────────────── */

    /**
     * 把这一行对到"树里有这个文件"的状态: 没有就补一段 insert, 有但 `name:` 还是裸路径 (旧版本写下的)
     * 就只把那一行改成 [fileUrlOf] 形态
     *
     * 幂等: 已经是那个形态时一个字节都不动 (每启一次 host 都会叫一遍)
     */
    fun ensuredRow(patch: String, rowId: String, entryPath: String, config: List<String> = emptyList()): String {
        val name = fileUrlOf(entryPath)
        // 行已经挂上时: 名字对一次账, **config 那几行也补一次** (2026-11-08: 否则老安装永远拿不到新键)
        return if (hasInsertRow(patch, rowId)) ensuredConfig(namedRow(patch, rowId, name), rowId, config)
        else withRow(patch, rowId, name, config)
    }

    /**
     * 文件路径 -> Loader 认的那个 URL 形态 (`file:///data/...`), 与 Node 的 `pathToFileURL(路径).href`
     * 逐字一致 (dsh 的 anchoring 走的就是它)
     *
     * 这一棵树上那几个字符一个都不会出现 (整条路径都是 `filesDir/host/...`, 而包名是固定的), 照抄这份
     * 转义表是为了"哪天树挪到别处、包名换成带别的字符的"也不至于悄悄对不上
     */
    fun fileUrlOf(path: String): String = buildString {
        append("file://")
        for (character in path) append(
            when (character) {
                '%' -> "%25"
                '\\' -> "%5C"
                ' ' -> "%20"
                '#' -> "%23"
                '?' -> "%3F"
                '\n' -> "%0A"
                '\r' -> "%0D"
                '\t' -> "%09"
                else -> character.toString()
            },
        )
    }

    /**
     * "有没有任何一行提到这个 id" (缩进过的 insert 子行与顶层的 config 行都算) —— 与
     * [CustomPresets.hasRow] 同一个认法
     */
    fun hasRow(patch: String, rowId: String): Boolean =
        patch.lines().any { it.trimStart() == "- id: $rowId" }

    /**
     * "我们这一行 (那一行 `- insert:` 里的子行) 在不在"
     *
     * **判"挂没挂"只能用这一个**: 设置面板存过一次之后, 同一个 id 会多出一行**顶层**的 config 行,
     * 而"要不要挂"这件事只由 insert 那一行说了算 —— 拿"有没有任何一行提到这个 id"去判, 会在
     * "只剩 config 行"时以为已经挂上了, 于是插件从树上悄悄消失
     */
    fun hasInsertRow(patch: String, rowId: String): Boolean =
        patch.lines().any { indentOf(it) > 0 && it.trimStart() == "- id: $rowId" }

    /** 一段 YAML: 一行 `- insert:` 加一行 id 加一行 name (name 加引号, 免得 `@` 之类的字符绊住解析),
     * 再按需跟上这几项 `config:` (本应用代写的缺省值, 面板之后追加的那一行压在它上面) */
    fun rowBlock(rowId: String, name: String, config: List<String> = emptyList()): String = buildList {
        addAll(listOf("- insert:", "    - id: $rowId", "      name: '$name'"))
        if (config.isNotEmpty()) {
            add("      config:")
            config.forEach { add("        $it") }
        }
        add("")
    }.joinToString("\n")

    /**
     * 把我们那一行放进 patch
     *
     * **放在开头那段注释之后、第一个内容行之前** —— 设置面板追加的 config 行永远在文件末尾, 于是
     * "insert 在前、config 在后"这条顺序不会因为补过一次行就跟丢 (那一行要是落在 config 行后面,
     * 面板里存过的值会静默失效, 再点保存又回到"被覆盖"那句错)
     *
     * `name` 要的是 [fileUrlOf] 那个形态, 不是裸路径 —— 见文件头第二条
     */
    fun withRow(patch: String, rowId: String, name: String, config: List<String> = emptyList()): String {
        // 幂等: 已经挂上了就一个字节都不动 (每启一次 host 都会叫一遍)
        if (hasInsertRow(patch, rowId)) return patch
        val block = rowBlock(rowId, name, config).trimEnd()
        val lines = patch.lines().toMutableList()
        val empty = lines.indexOfFirst { it.trim() == "[]" }
        val content = lines.count { it.isNotBlank() && !it.trimStart().startsWith("#") }
        if (empty >= 0 && content == 1) {
            lines[empty] = block
            return lines.joinToString("\n").trimEnd() + "\n"
        }
        val head = lines.indexOfFirst { line -> line.isNotBlank() && !line.trimStart().startsWith("#") }
        val at = if (head < 0) lines.size else head
        lines.addAll(at, block.lines())
        return lines.joinToString("\n").trimEnd() + "\n"
    }

    /**
     * 把这一行 (那一行 `- insert:` 里的子行) 的 `name:` 改成 [name], 别的行一个字节都不动
     *
     * 这一步管的是"旧安装里已经写着裸路径"那一档: 那种盘面上面板永远存不进去 (见文件头第二条), 而
     * 我们每启一次 host 就在这里把它对成 [fileUrlOf] 形态。**只有 `- insert:` 段里那一行会被碰**:
     * 往下第一个缩进更深的 `name:` 才是它的入口; 顶层的 config 行是主人存在设置面板里的东西
     *
     * 已经是这个形态时原样返回 (幂等)
     */
    fun namedRow(patch: String, rowId: String, name: String): String {
        val lines = patch.lines().toMutableList()
        val at = lines.indexOfFirst { indentOf(it) > 0 && it.trimStart() == "- id: $rowId" }
        if (at < 0) return patch
        val indent = indentOf(lines[at])
        val entry = (at + 1 until lines.size).firstOrNull { index ->
            lines[index].isNotBlank() && indentOf(lines[index]) > indent &&
                lines[index].trimStart().startsWith("name:")
        } ?: return patch
        val line = "${" ".repeat(indentOf(lines[entry]))}name: '$name'"
        if (lines[entry] == line) return patch
        lines[entry] = line
        return lines.joinToString("\n").trimEnd() + "\n"
    }

    /**
     * 把这一行里**该由应用代写的那几行 config** 补齐 (缺哪一行补哪一行, 别的行一个字节都不动)
     *
     * 2026-11-08: [memoryConfig] 新加了一条 `documentMemoryEnabled: true` (对话层方案 P3 要她把人格卡
     * 登记成 document 记忆), 而 [ensuredRow] 原来只对 `name:` 那一行做对账 —— 行已经挂上的老安装
     * 永远拿不到新键。判法按**键名**: 值改过就覆盖成应用这份, 面板里加的别的键不动
     */
    fun ensuredConfig(patch: String, rowId: String, config: List<String>): String {
        if (config.isEmpty()) return patch
        val lines = patch.lines().toMutableList()
        val at = lines.indexOfFirst { indentOf(it) > 0 && it.trimStart() == "- id: $rowId" }
        if (at < 0) return patch
        val rowIndent = indentOf(lines[at])
        // 这一行的地盘: 往后到缩进不比它深为止
        var end = at + 1
        while (end < lines.size && (lines[end].isBlank() || indentOf(lines[end]) > rowIndent)) end += 1
        val nameAt = (at + 1 until end).firstOrNull { lines[it].trimStart().startsWith("name:") }
        if (nameAt == null) return patch
        val configAt = (at + 1 until end).firstOrNull { lines[it].trimStart() == "config:" }
        val itemIndent = " ".repeat(rowIndent + 4)
        val keyIndent = " ".repeat(rowIndent + 2)
        var next = patch
        for (line in config) {
            val key = line.substringBefore(":")
            val hit = (at + 1 until end).firstOrNull {
                lines[it].trimStart().startsWith("$key:") && indentOf(lines[it]) > rowIndent
            }
            val current = next.lines().toMutableList()
            if (hit != null) {
                if (current[hit].trim() == line) continue
                current[hit] = itemIndent + line
                next = current.joinToString("\n").trimEnd() + "\n"
                continue
            }
            val configLine = (at + 1 until end).firstOrNull { current[it].trimStart() == "config:" }
            val insertAt = if (configLine == null) {
                current.add(nameAt + 1, keyIndent + "config:")
                nameAt + 2
            } else {
                // 跟在已有那几行 config 后面 (没有就紧贴 `config:` 下面)
                var scan = configLine + 1
                while (scan < current.size && current[scan].isNotBlank() && indentOf(current[scan]) > indentOf(current[configLine])) scan += 1
                scan
            }
            current.add(insertAt, itemIndent + line)
            next = current.joinToString("\n").trimEnd() + "\n"
        }
        return next
    }

    /**
     * 把我们那一行摘掉 (树里没有这个文件时必须摘)
     *
     * **只摘 `- insert:` 段里那一行 (缩进过的那个)**: 顶层的 config 行是主人存在设置面板里的东西,
     * 一个字节都不动 —— 树把包带回来的那一天它自己就重新生效
     *
     * 从那一行往下, 缩进更深的都算它的 (`name:` 与可能的 `config:`); 段里没有别的 `- id:` 时才把
     * `- insert:` 外壳一起收掉; 整份 patch 只剩注释就还原成 `[]`
     */
    fun withoutRow(patch: String, rowId: String): String {
        val lines = patch.lines().toMutableList()
        val at = lines.indexOfFirst { indentOf(it) > 0 && it.trimStart() == "- id: $rowId" }
        if (at < 0) return patch
        val indent = indentOf(lines[at])
        var end = at + 1
        while (end < lines.size && (lines[end].isBlank() || indentOf(lines[end]) > indent)) end += 1
        // 往上找管着它那个 `- insert:` (缩进更浅的那一个)
        val shell = (at - 1 downTo 0).firstOrNull { indentOf(lines[it]) < indent && lines[it].trimStart() == "- insert:" } ?: -1
        // **这个壳的地盘到下一个缩进不比它深的行为止** (2026-10-16): 整份文件里往上找兄弟是错的 ——
        // 别人那个 `- insert:` 段里的子行会被当成它的兄弟, 于是自己这个只剩空壳的 `- insert:` 留了下来
        val shellEnd = if (shell < 0) {
            shell
        } else {
            var scan = shell + 1
            while (scan < lines.size && (lines[scan].isBlank() || indentOf(lines[scan]) > indentOf(lines[shell]))) scan += 1
            scan
        }
        // 兄弟 = 这个壳里除了我们这一行之外, 缩进更深的那几个 `- id:` (它自己那一段的兄弟都在 [at, end) 之外)
        val siblings = shell >= 0 && (shell + 1 until shellEnd).any { index ->
            (index < at || index >= end) && indentOf(lines[index]) > indentOf(lines[shell]) &&
                lines[index].trimStart().startsWith("- id: ")
        }
        lines.subList(at, end).clear()
        if (shell >= 0 && !siblings) lines.removeAt(shell)
        while (lines.isNotEmpty() && lines.last().isBlank()) lines.removeAt(lines.size - 1)
        val content = lines.count { it.isNotBlank() && !it.trimStart().startsWith("#") }
        return (if (content == 0) lines + "[]" else lines).joinToString("\n").trimEnd() + "\n"
    }

    /**
     * 盘上是不是**已经有别的行**挂着同一个包 (2026-10-25)
     *
     * 缘起是 2026-10-16 主人在手机上手工装过一份第三方插件 (源码在 `plugins-src/`, profile
     * `node_modules` 里一条软链, patch 里一条裸包名的行), 而随包也发过一份。两行同时在的结果不是
     * "用了新的那一份", 而是启动时一句 `an adapter for provider ... is already registered` ——
     * 先挂上的赢, 后挂上的整块塌, 而谁先全看 patch 里的次序 (那一份插件 2026-10-30 已撤出随包,
     * 这条判据仍要对 mneme 与 imagegen 生效)
     *
     * 判据是**包名**而不是路径: 旧的写法是裸包名 (靠 profile 的软链解析),
     * 我们写的是 `file://` 形态的绝对路径, 两种都要认出来
     * @param patch - 整份 patch
     * @param packageName - 包名 (`@modusensus/dsh-mneme` / `@dickpy/dsh-imagegen`)
     * @param exceptId - 自己那一行的 id (它不算"别的行")
     * @returns 别人挂着它就是 true
     */
    fun mountsPackage(patch: String, packageName: String, exceptId: String = ""): Boolean {
        val lines = patch.lines()
        for (index in lines.indices) {
            val line = lines[index]
            if (indentOf(line) <= 0) continue
            if (!line.trimStart().startsWith("- id: ")) continue
            val id = line.trimStart().removePrefix("- id: ").trim()
            if (id == exceptId) continue
            val indent = indentOf(line)
            for (scan in index + 1 until lines.size) {
                if (lines[scan].isNotBlank() && indentOf(lines[scan]) <= indent) break
                val entry = lines[scan].trimStart()
                if (!entry.startsWith("name:")) continue
                val value = entry.removePrefix("name:").trim().trim('"', '\'')
                if (packageOf(value) == packageName) return true
                break
            }
        }
        return false
    }

    /**
     * 一条挂载 (`name:` 那一行的值) 指的是哪个包
     *
     * 两种写法都要认: 裸包名 (靠 profile 的软链解析) 与绝对路径
     * (`file://…/node_modules/<包名>/index.js`)。路径那一档取 `node_modules/` 之后那一段
     * (带 scope 的两段); 不在 `node_modules` 里的 (旧的手工装法, 源码放 `plugins-src/`) 取入口文件
     * 所在目录名 —— 那种装法的入口都在包根上
     * @param value - `name:` 的值
     * @returns 包名 (认不出来时就是原文)
     */
    fun packageOf(value: String): String {
        val path = value.removePrefix("file://")
        if (!path.contains('/')) return path
        val at = path.lastIndexOf("/node_modules/")
        if (at >= 0) {
            val parts = path.substring(at + "/node_modules/".length).split('/')
            if (parts.isEmpty()) return path
            return if (parts[0].startsWith("@") && parts.size > 1) "${parts[0]}/${parts[1]}" else parts[0]
        }
        return path.substringBeforeLast('/', "").substringAfterLast('/').ifEmpty { path }
    }

    /**
     * 摘掉一条已经撤出随包的挂载行 ([RETIRED])
     *
     * 三条都要对上才摘: id 相同、包名相同、`name:` 是**指回宿主树**的 `file://` 路径. 主人自己装的那份
     * 要么是裸包名 (靠 profile 的 `node_modules` 软链解析)、要么指到 `plugins-src/` 里, 两种都不动 ——
     * 与"先看本体, 有就不装"同一条纪律
     * @param patch - 整份 patch
     * @param rowId - 当初我们写进去的那个 id (`free-model`)
     * @param packageName - 那个包 (`dsh-our-free-model`)
     * @param hostRoot - 宿主树根 (`files/host` 的绝对路径; 传字符串而不是 [File], 判的只是前缀)
     * @returns 摘过之后那份 patch (不该摘时原样返回)
     */
    fun retired(patch: String, rowId: String, packageName: String, hostRoot: String): String {
        val name = nameOfRow(patch, rowId) ?: return patch
        if (packageOf(name) != packageName) return patch
        if (!name.startsWith("file://")) return patch
        val root = hostRoot.trimEnd('/', '\\')
        val path = name.removePrefix("file://")
        if (!path.startsWith("$root/") && !path.startsWith("$root\\")) return patch
        return withoutRow(patch, rowId)
    }

    /**
     * 一行挂载的 `name:` 值 (没有这一行就是 null), 判据在 [PluginRowsTest]
     * @param patch - 整份 patch
     * @param rowId - 那一行的 id
     * @returns `name:` 去掉引号之后的原文; 这一行不在、或者它没有 `name:` 时 null
     */
    fun nameOfRow(patch: String, rowId: String): String? {
        val lines = patch.lines()
        for (index in lines.indices) {
            if (indentOf(lines[index]) <= 0) continue
            if (lines[index].trimStart() != "- id: $rowId") continue
            val indent = indentOf(lines[index])
            for (scan in index + 1 until lines.size) {
                if (lines[scan].isNotBlank() && indentOf(lines[scan]) <= indent) break
                val entry = lines[scan].trimStart()
                if (!entry.startsWith("name:")) continue
                return entry.removePrefix("name:").trim().trim('"', '\'')
            }
        }
        return null
    }

    /**
     * profile 的 `node_modules` 里, 这个包是不是**宿主树之外**的一份 (主人自己装的)
     *
     * 看的是解析之后的真实路径: 指向 `files/host/...` 的那种链接是随包这棵树的别名, 不算主人的 ——
     * 把它算进来, 随包那份就永远挂不上, 而它本来就是树里的那一份
     * @param context - 应用
     * @param packageName - 包名 (`@modusensus/dsh-mneme` / `@dickpy/dsh-imagegen`)
     * @param hostRoot - 宿主树根 (`files/host`)
     * @returns 那一份的真实路径; 没有、或者是树里那份时 null
     */
    private fun userInstallOf(context: Context, packageName: String, hostRoot: File): String? {
        val base = File(File(File(File(context.filesDir, DshHost.HOME_DIR), "profiles"), PROFILE), "node_modules")
        val candidate = File(base, packageName)
        if (!candidate.exists()) return null
        val path = runCatching { candidate.canonicalPath }.getOrNull() ?: return candidate.absolutePath
        return if (isUserCopy(path, hostRoot.absolutePath)) path else null
    }

    /**
     * 本体比树里旧时改名备份一份, 返回备份文件; 不旧 / 两边有一个读不出版本就回 null
     *
     * 只改名不移走: 主人那份的 `config` 与数据都还指着它, 想退回把名字改回来就行
     * (命名与 2026-11-14 手工升级时留下的 `mneme.bak-0.9.4-20261114` 同形)
     */
    private fun retireStaleCopy(theirs: File, ours: File): File? {
        val mine = versionOf(theirs) ?: return null
        val bundled = versionOf(ours) ?: return null
        if (!versionsBefore(mine, bundled)) return null
        val stamp = java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE)
        val parent = theirs.parentFile ?: return null
        var backup = File(parent, "${theirs.name}.bak-$mine-$stamp")
        var round = 2
        while (backup.exists() && round < 100) {
            backup = File(parent, "${theirs.name}.bak-$mine-$stamp-$round")
            round += 1
        }
        return if (theirs.renameTo(backup)) backup else null
    }

    /** `<目录>/package.json` 里的 `version`; 读不到 (或没有这一行) 回 null */
    fun versionOf(packageDir: File): String? = runCatching {
        val text = File(packageDir, "package.json").readText()
        Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1)
    }.getOrNull()

    /**
     * patch 里挂着**同一个包**的 insert 行 id; 找不到 (或者只有 [exceptId] 那一行) 回 null
     *
     * 认法是 name 里的路径段。两个名字对不上的地方在真机上长这样: 我们的 [Owned.packageName] 是
     * `@modusensus/dsh-mneme`, 主人那行写的是 `file:///…/plugins-src/mneme/lib/index.js` ——
     * 包名那一段带着 `dsh-` 前缀, 目录名却没有, 所以两头都试: 包名最后一段 (`dsh-mneme`) 与
     * 去掉 `dsh-` 之后的那一段 (`mneme`)
     */
    fun foreignRowIdOf(patch: String, packageName: String, exceptId: String): String? {
        val tail = packageName.substringAfterLast('/')
        if (tail.isEmpty()) return null
        val candidates = setOf(tail, tail.removePrefix("dsh-")).filter { it.isNotEmpty() }
        val lines = patch.lines()
        for (index in lines.indices) {
            val line = lines[index]
            if (indentOf(line) <= 0) continue
            if (!line.trimStart().startsWith("- id: ")) continue
            val id = line.trimStart().removePrefix("- id: ").trim()
            if (id == exceptId) continue
            val indent = indentOf(line)
            for (scan in index + 1 until lines.size) {
                if (lines[scan].isNotBlank() && indentOf(lines[scan]) <= indent) break
                val entry = lines[scan].trimStart()
                if (!entry.startsWith("name:")) continue
                val name = entry.removePrefix("name:").trim().trim('\'', '"')
                val hit = candidates.any { name.contains("/$it/") || name.endsWith("/$it") }
                if (hit) return id
                break
            }
        }
        return null
    }

    /**
     * 那条行的 `name:` 是不是指向一个**已经不存在的文件**
     *
     * 只认 `file://` 形态: 裸包名要交给 profile 的 node_modules 去解析, 这里判不了也不该判
     * (2026-11-14: 本体被改名之后, 老行留下的就是一条 `file://…/plugins-src/mneme/lib/index.js`,
     * 而那个目录已经不是它了 —— dsh 每启一次报一句 failed to import, 界面照常但没人愿意看那句红)
     */
    fun rowNameMissing(patch: String, rowId: String): Boolean {
        val name = nameOfRow(patch, rowId) ?: return false
        if (!name.startsWith("file://")) return false
        return !File(name.removePrefix("file://")).exists()
    }

    /**
     * 把那条老行收编成我们这一行: 只改 `id:` 与 `name:` 两行, 别的 (尤其 `config:`) 原样不动
     *
     * 判据 `adoptForeignRow keeps every config key` —— 主人那条 `dsh-mneme` 里躺着他配的
     * `dreamProvider` / `summarizeModel` 那十几项, 收编时丢一个就等于把他的模型选择改回缺省
     */
    fun adoptForeignRow(patch: String, foreignId: String, rowId: String, entryPath: String): String {
        val name = fileUrlOf(entryPath)
        val lines = patch.lines().toMutableList()
        for (index in lines.indices) {
            if (indentOf(lines[index]) <= 0) continue
            if (lines[index].trimStart() != "- id: $foreignId") continue
            val indentText = lines[index].takeWhile { it == ' ' }
            lines[index] = "$indentText- id: $rowId"
            for (scan in index + 1 until lines.size) {
                if (lines[scan].isNotBlank() && indentOf(lines[scan]) <= indentText.length) break
                if (!lines[scan].trimStart().startsWith("name:")) continue
                val nameIndent = lines[scan].takeWhile { it == ' ' }
                lines[scan] = "$nameIndent" + "name: '$name'"
                return lines.joinToString("\n")
            }
            return lines.joinToString("\n")
        }
        return patch
    }

    /**
     * 数字段比较: `0.9.4` 比 `0.15.1` 旧 (逐段转数字, 缺的段当 0)
     *
     * 不引 semver 依赖: 这里只用来判"本体要不要让位", 带上 `-rc.1` 那种预发布段的包不在
     * [FOLLOW_TREE] 里; 非数字段一律按 -1 计, 于是 `-rc` 永远排在正式版前面 (够用)
     */
    fun versionsBefore(older: String, newer: String): Boolean {
        fun parts(one: String): List<Int> = one.split('.', '-', '+').map { it.toIntOrNull() ?: -1 }
        val left = parts(older)
        val right = parts(newer)
        for (index in 0 until maxOf(left.size, right.size)) {
            val a = left.getOrElse(index) { 0 }
            val b = right.getOrElse(index) { 0 }
            if (a != b) return a < b
        }
        return false
    }

    /**
     * 这条真实路径算不算"主人自己那份" (纯函数, 判据在 PluginRowsTest)
     *
     * 树里那份 == 随包这份: 它也在 `node_modules/<包>` 底下, 差别只有根在哪
     * @param candidate - 解析之后的绝对路径
     * @param hostRoot - 宿主树根
     * @returns 在树外就是 true
     */
    fun isUserCopy(candidate: String, hostRoot: String): Boolean {
        if (candidate.isEmpty()) return false
        if (hostRoot.isEmpty()) return true
        val host = hostRoot.trimEnd('/', '\\')
        if (candidate == host) return false
        return !candidate.startsWith("$host/") && !candidate.startsWith("$host\\")
    }

    /** 让位那句话里"为什么"那半句 */
    private fun reasonOf(mountedByRow: Boolean, userCopy: String?): String = when {
        mountedByRow && userCopy != null -> "mounted by another row + a profile copy at $userCopy"
        mountedByRow -> "mounted by another row"
        else -> "the profile resolves a copy at ${userCopy.orEmpty()}"
    }

    private fun indentOf(line: String): Int = line.length - line.trimStart().length
}
