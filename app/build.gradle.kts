import java.io.File
import java.net.URI
import java.security.MessageDigest

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// The dsh host tree is a build product of the submodule rather than of this repository, and the
// APK ships it as one archive the app extracts on first run, so the build grows two steps here
// instead of a checked-in directory. Both are keyed on the submodule pin and on its sources, so
// only a dsh change pays for the rebuild: a plain :app:assembleDebug reuses what it already has
// Edits to submodule files outside the globs below do not invalidate the tree; rerun with
// `--rerun-tasks` (or run tools/pack-host.mjs by hand and push it, see tools/push-host.mjs)
val dshCheckout = rootProject.layout.projectDirectory.dir("third_party/deepseek-harness")
val hostTree = layout.buildDirectory.dir("host-tree")
val hostAssets = layout.buildDirectory.dir("generated/host-assets")

// 首启要落到 $DSH_HOME 里的那两项 (四份技能 + 两条样例快捷指令) 也是构建产物: 源在仓库根的
// `skills/` 与 `quick-commands/`, 拷成 assets 的形状由下面的 copySeedAssets 做。**显式列这几份,
// 不整目录拷** —— `skills/android-device-control` 这一版不随包 (主人 2026-10-08 选的),
// 要收口时把它加进那张表就行, 见 docs/DSH-LW-2.5.0-批次7-开发计划.md
val seedAssets = layout.buildDirectory.dir("generated/seed-assets")

/** 随包发的技能: 目录名 = frontmatter 里的 `name` */
val shippedSkills = listOf("web-search", "weather", "calendar", "photo-edit")

/** 随包发的样例快捷指令: 文件名去掉 `.md` 就是它在设置页里的名字 */
val shippedQuickCommands = listOf("制定旅游计划", "今天要做什么")

/**
 * 随包的浮标外观插件 (2.7.10 起, 主人: "将鲸鱼娘插件入包, 不用用户自己安装")
 *
 * **源在仓库外**: 签好的 `.lwp` 只住在插件仓库那一侧 (`D:\apk\luwi-plugins\packages\`), 主人
 * 2026-10-11 定过 "`.lwp` 不进 Luwi 仓库" —— 所以按相对路径从兄弟目录取, 落地形状是
 * `assets/lw-plugins/`, 由 `host/LwPluginSeed.kt` 首启装进 `$DSH_HOME`
 *
 * 这里先把它变成 `File`: 配置缓存**不许**动作里碰脚本级的 project / directory 对象
 * (见下面 `fetchSherpaOnnxAar` 那段注释), 而 `File` 是可以带进动作的
 */
val bundledBallTheme: File =
    rootProject.file("../luwi-plugins/packages/whalegirl-balltheme-1.1.3.lwp")

/**
 * 酒馆的源码在仓库外 (2026-10-29, C 方案): 公开仓只留 `LuwiTavernStub.kt`, 完整版构建把这份
 * 私有目录并进来
 *
 * `-PluwiTavernDir=<目录>` 可以指到别处 (另一次导出 / 另一台机器); 目录不存在就按公开构建算 ——
 * stub 进编译, 自定义预设与宿主插件也不装
 */
val tavernRoot: File? = run {
    val dir = File(providers.gradleProperty("luwiTavernDir").orNull ?: "D:/apk/Luwi-private/tavern")
    if (dir.isDirectory) dir else null
}
val withTavern: Boolean = tavernRoot != null


// 语音转写要的那套 sherpa-onnx 不在 Maven 上: 上游只把它发成 GitHub Release 里的 AAR, 所以这
// 一个依赖由构建自己取。app/libs/sherpa-onnx.aar 放了本地文件就用那一份 (离线构建、或用自己
// 编的版本), 否则按下面的版本与 sha256 下载到 build/ 里, 校验过才算数
// 取 static-link-onnxruntime 那一版是有原因的: 本应用已经带了 onnxruntime-android-qnn (端侧
// OCR 用), 普通版 AAR 会再带一份同名的 libonnxruntime.so, 打成 APK 时会撞名
val sherpaVersion = "1.13.8"
val sherpaAar = layout.buildDirectory.file("sherpa-onnx/sherpa-onnx-static-link-onnxruntime-$sherpaVersion.aar")
val sherpaAarLocal = rootProject.file("app/libs/sherpa-onnx.aar")
val sherpaAarSha256 = "b22c3fc1b6a45666d28892bb2f7694beeb77a8362d7ebd77c1a5431ec9435471"

// 短名要 import 才用得了: 脚本里 `java` 会被解析成 Gradle 那个 `java` 扩展, 所以 `java.security.*`
// 与 `java.net.*` 在这里是"在扩展上找成员", 编译期直接报 Unresolved reference
// 配置缓存的安全写法: 动作里**不许**碰脚本级的东西 (上面那个 `sha256Of` 是脚本类的成员函数,
// 而 `logger` 是脚本属性) —— 引用了就等于把整个脚本对象塞进任务, 配置缓存会以
// "cannot serialize Gradle script object references" 拒绝, 构建在 :app:compileDebugKotlin
// **成功之后**才失败 (看着像编译错, 其实不是)。所以取哈希与打印都在动作内部就地写
val fetchSherpaOnnxAar = tasks.register("fetchSherpaOnnxAar") {
    group = "luwi"
    description = "Fetch the sherpa-onnx AAR the app links for on-device speech recognition"
    val target = sherpaAar.get().asFile
    val expected = sherpaAarSha256
    val source = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$sherpaVersion/" +
        "sherpa-onnx-static-link-onnxruntime-$sherpaVersion.aar"
    outputs.file(target)
    doLast {
        fun digestOf(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { stream ->
                val buffer = ByteArray(1 shl 16)
                while (true) {
                    val read = stream.read(buffer)
                    if (read <= 0) break
                    digest.update(buffer, 0, read)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
        if (target.isFile && digestOf(target) == expected) return@doLast
        target.parentFile.mkdirs()
        println("fetching $source")
        URI(source).toURL().openStream().use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }
        val actual = digestOf(target)
        if (actual != expected) {
            target.delete()
            throw GradleException("the sherpa-onnx AAR is not the pinned one: sha256 $actual")
        }
    }
}

/** The submodule files whose change must invalidate the packed tree */
val dshSources = fileTree(dshCheckout.asFile) {
    include(
        "packages/*/*/src/**",
        "packages/*/*/package.json",
        "apps/*/src/**",
        "apps/*/package.json",
        "vendor/*/src/**",
        "vendor/*/package.json",
        "native/system/packages/*/src/**",
        "native/system/packages/*/package.json",
    )
}

/** Commit the tree is built from, which the pack step refuses to violate */
val dshPin: Provider<String> = providers.exec {
    commandLine("git", "-C", dshCheckout.asFile.absolutePath, "rev-parse", "HEAD")
    isIgnoreExitValue = true
}.standardOutput.asText.map { it.trim().ifEmpty { "unknown" } }

/**
 * 传给 packHostTree 的 PATH (2026-11-06)
 *
 * Gradle 守护进程沿用**首次启动**时的环境变量, 而 DSH 的自动化 shell 把 MSYS 目录
 * (`@dsh-ops\...\ucrt64\bin`、`...\usr\bin`, 里面有会报 0xC0000022 的 tar.exe) 排在最前。
 * dsh 的 scripts/release/pack.ts 校验 tarball 时 spawn('tar', ...), 于是 packHostTree 必挂:
 * `Error: tar -tzf ....tgz exited with 3221225794`。env.ps1 已在 shell 层清洗, 但守护进程里的
 * 旧 PATH 不会跟着变 —— 这里在构建脚本侧再清洗一遍并显式交给 Exec, 与调用方是谁无关。
 * 口径与 tools/pack-host.mjs 的 sanitizedPath() 一致
 */
val sanitizedExecPath: String = run {
    val sep = System.getProperty("path.separator")
    val fs = System.getProperty("file.separator")
    val systemRoot = System.getenv("SystemRoot") ?: "C:\\Windows"
    val system32 = systemRoot + fs + "System32"
    val msys = Regex("(?i)\\\\(?:usr|ucrt64)\\\\bin\\\\?$")
    val keep = (System.getenv("PATH") ?: "")
        .split(sep)
        .filter { it.isNotBlank() }
        .filterNot { it.contains("@dsh-ops", ignoreCase = true) }
        .filterNot { msys.containsMatchIn(it) }
        .filterNot { it.equals(system32, ignoreCase = true) }
    (listOf(system32) + keep).joinToString(sep)
}

val packHostTree = tasks.register<Exec>("packHostTree") {
    group = "luwi"
    description = "Rebuild dsh at the pinned commit and install the flat host tree the APK ships"
    workingDir = rootProject.projectDir
    environment("PATH", sanitizedExecPath)
    // npm 的 cache 与临时目录同样显式交给这一步: 本机 `%LOCALAPPDATA%\npm-cache` 对 Gradle 子进程会
    // EPERM (mkdtemp 直接失败), 而守护进程的环境变量不会跟着命令行变, 只靠 shell 里 export 不可靠
    val packTmp = layout.buildDirectory.dir("tmp/pack-host").get().asFile
    val npmCache = layout.buildDirectory.dir("tmp/npm-cache").get().asFile
    doFirst {
        packTmp.mkdirs()
        npmCache.mkdirs()
    }
    environment("TEMP", packTmp.absolutePath)
    environment("TMP", packTmp.absolutePath)
    environment("npm_config_cache", npmCache.absolutePath)
    // `--install` 是必须的: 子模块的 node_modules 里只有 workspace 链接, 各包自己的依赖没装, 而
    // dsh root 的 `pnpm run check` 要 tsc / tsdown —— 少了它构建会死在"某个包缺 typescript"上。
    // pnpm 那一份由 tools/pack-host.mjs 自己找 (并把 npm_execpath 补齐, 见那个文件里的长注释)
    commandLine(
        "node",
        "tools/pack-host.mjs",
        "--dsh", dshCheckout.asFile.absolutePath,
        "--out", hostTree.get().asFile.absolutePath,
        "--install",
        *(if (tavernRoot != null) arrayOf("--tavern-root", tavernRoot.absolutePath) else emptyArray()),
    )
    inputs.file(rootProject.file("tools/pack-host.mjs"))
    // The plugin is copied into the tree rather than built, so its sources are an input too
    inputs.dir(rootProject.file("host-plugin"))
    // Luwi 加 (G1-2): 随包的第三方 host 插件也在 `host-plugins/` 里被拷进树 (luwi-dsh-sync 那一份),
    // 少了这一行改插件的源码不会让这个任务失效 —— 出包时会拿到上游那一份
    inputs.dir(rootProject.file("host-plugins"))
    // The image backend is copied over sharp the same way, so it is one as well
    inputs.dir(rootProject.file("image-backend"))
    // 三份预设声明与内置的 dsh-custom-mode 也从仓库拷进树 (见 tools/pack-host.mjs 那两段),
    // 所以 preset 那几份源码也是这一步的输入
    inputs.dir(rootProject.file("presets"))
    // 安卓那份 node-pty 预编译 (2026-11-07): pack-host.mjs 的末尾把 jniLibs 里的 liblwpty.so
    // 拷成树里的 `node_modules/node-pty/prebuilds/android-arm64/pty.node`, 所以它也是这一步的输入
    //
    // 少了这两行, 只换 .so 时这个任务判 UP-TO-DATE, 树里那份 pty.node 还是上一次的 (或者干脆没有):
    // 2026-11-07 13:35 就是这么丢掉一次的 —— 包里有 `lib/arm64-v8a/liblwpty.so`, 树里却没有
    // `prebuilds/android-arm64`。只声明这两个文件, 不声明整个 jniLibs (那里还有 68 MB 的 libnode.so
    // 与 33 MB 的 libwicudata.so, 全量哈希会拖慢每次配置)
    inputs.files(rootProject.file("app/src/main/jniLibs/arm64-v8a/liblwpty.so"))
    inputs.files(rootProject.file("app/src/main/jniLibs/arm64-v8a/liblwptyhelper.so"))
    // 酒馆在仓库外: 它的源进了构建, 改了就得重打这棵树
    tavernRoot?.let { inputs.dir(it) }
    inputs.property("dshPin", dshPin)
    inputs.files(dshSources)
    outputs.dir(hostTree)
}

val zipHostTree = tasks.register<Exec>("zipHostTree") {
    group = "luwi"
    description = "Archive the host tree and stamp its version for the app to compare"
    workingDir = rootProject.projectDir
    commandLine(
        "node",
        "tools/zip-host.mjs",
        "--tree", hostTree.get().asFile.absolutePath,
        "--out", hostAssets.get().asFile.absolutePath,
        "--dsh", dshCheckout.asFile.absolutePath,
    )
    dependsOn(packHostTree)
    inputs.file(rootProject.file("tools/zip-host.mjs"))
    inputs.dir(hostTree)
    outputs.dir(hostAssets)
}

/**
 * 把随包的技能与样例快捷指令拷成 assets 的形状
 *
 * 用 `Copy` 而不是让 app 直接读仓库的那两处: APK 里只有 assets, 而源必须是一份 (仓库那份),
 * 所以这里拷一次, 而不是在仓库里再放一份副本等着它漂开
 */
val copySeedAssets = tasks.register<Copy>("copySeedAssets") {
    group = "luwi"
    description = "Copy the shipped skills and sample quick commands into the apk's assets"
    val skills = rootProject.layout.projectDirectory.dir("skills")
    val commands = rootProject.layout.projectDirectory.dir("quick-commands")
    shippedSkills.forEach { name ->
        from(skills.file("$name/SKILL.md")) { into("skills/$name") }
    }
    shippedQuickCommands.forEach { name ->
        from(commands.file("$name.md")) { into("quick-commands") }
    }
    // 探索那张任务卡的初始版 (2.7.8 批次 8): 源在仓库根, 落到 assets 根上, 由 ExploreTask 首启抄进
    // `$DSH_HOME/lw/explore-card.md` —— 之后它会随每次探索被改写, 所以这里只是一份种子
    from(rootProject.layout.projectDirectory.file("explore-card.md"))
    // 应用对应的那一份技能目录 (2.7.0 那一批): 整目录抄, 条数由 catalog.json 自己说了算 —— 加一条
    // 只写两个文件 (catalog.json 一行 + 一个 SKILL.md), 不用回来动构建脚本
    from(rootProject.layout.projectDirectory.dir("app-skills")) { into("app-skills") }
    // 随包的浮标外观插件 (见上面 [bundledBallTheme]): 文件在不在由下面 doFirst 当场说, Copy 自己遇到
    // 缺文件是静默跳过的 —— 那种结果是一个没有外观的包, 而"球变回内置画法"没人会去查
    //
    // **先落到一个本地 val 再用**: 动作里引用脚本级的属性等于把整个脚本对象塞进任务, 配置缓存会以
    // "cannot serialize Gradle script object references" 拒绝 (与 `fetchSherpaOnnxAar` 那条同一个坑)
    val bundle = bundledBallTheme
    // 同理: 脚本级的 `seedAssets` 是个 Provider, 带进动作一样会被配置缓存拒掉 —— 先落成 File
    val seedRoot = seedAssets.get().asFile
    from(bundle) { into("lw-plugins") }
    doFirst {
        if (!bundle.isFile) {
            throw GradleException(
                "随包的浮标外观不在 ${bundle.absolutePath} —— 先把 " +
                    "whalegirl-balltheme-1.1.3.lwp 放进 luwi-plugins/packages (它由 ball-art 的签名那一步产出)",
            )
        }
        // **先清掉上一个版本那么一份**: 换文件名时 Copy 不会删旧文件, 不清的话 APK 里会同时躺着
        // 1.1.0 与 1.1.1 两份 17 MB 的素材, 而 LwPluginSeed 只认新的那一份 (2026-10-25 撞上)
        val old = seedRoot.resolve("lw-plugins")
        if (old.isDirectory) old.deleteRecursively()
    }
    into(seedAssets)
}

android {
    namespace = "io.github.yuloong07star.luwi"
    compileSdk {
        version = release(37)
    }

    /**
     * 签名: **固定的那一把 debug keystore**
     *
     * 为什么写死而不是让工具链自己找 (2026-10-06 踩的): 默认那条路是 `${user.home}/.android/debug.keystore`,
     * 而 `user.home` 跟着**谁在跑 gradle** 走 —— 这台机器上 Android 的家目录是 `D:\apk\.android`
     * (AVD / cache / studio 都在那儿, 10-03 装的工具链建的), 真机上装的那一版就是用它的
     * `debug.keystore` (`65:20:84:A9…`) 签的; 而在 `C:\Users\30216` 下跑一次 gradle 会**当场新建
     * 一把新的** (`83:37:F1:E8…`), 签出来的包与真机上那版**签名不同, 覆盖安装必失败** —— 那条路
     * 只剩"卸载重装", 而卸载会删掉 files/dsh-home (会话 / 凭据 / 设置)
     *
     * 所以这里点名 `D:\apk\.android\debug.keystore`: 谁跑、在哪个用户下跑, 签出来的都是同一把。
     * 换机器时用 `LW_DEBUG_KEYSTORE` 指过去 (它必须仍是**同一把旧 key**, 否则真机装不上)
     *
     * 2026-11-12: 加一条绝对路径兜底 —— 工单工作树在 `D:\apk\.lwtmp\sa\work\<单名>` 下, `../.android`
     * 会落到 `.lwtmp\sa\work\.android` (不存在), 于是同一个仓库在工位里出不了包。**先挑存在的那份**,
     * 挑不到就退回原来的相对路径 (报错信息仍对着它), 签名身份不变
     */
    val debugKeystoreCandidates = listOfNotNull(
        providers.environmentVariable("LW_DEBUG_KEYSTORE").orNull,
        providers.environmentVariable("ANDROID_SDK_HOME").map { "$it/.android/debug.keystore" }.orNull,
        rootProject.file("../.android/debug.keystore").absolutePath,
        "D:/apk/.android/debug.keystore",
    )
    val debugKeystore = debugKeystoreCandidates.firstOrNull { File(it).isFile } ?: debugKeystoreCandidates.first()

    /**
     * 签名: 2.8.0 的发布包**仍然用这把旧 debug keystore** 签 (2026-11-12, #36 第二次派单)
     *
     * 先把账说清: 这一版要解决的是"发布包带 `application-debuggable`"这个调试口子 (issue #50),
     * 不是换 key。换 key 的代价是包名相同而签名不同 —— 安卓只回 INSTALL_FAILED_UPDATE_INCOMPATIBLE,
     * 只能卸载重装, 而卸载会带走 files/dsh-home (会话 / 凭据 / 设置), 用户数据就这么丢了
     *
     * 所以 2.8.0 只做两件事: 发布包改走 release 变体 (不带 debuggable), 签名照旧走上面那把
     * `D:\apk\.android\debug.keystore` (CN=Android Debug, 证书摘要 652084a9…) —— 2.7.10 能被 2.8.0
     * 直接覆盖安装, 数据一个字节都不动
     *
     * **换 key 推到 2.9.0**, 并且只能走 APK Signature Scheme v3 的签名轮换 (lineage, 用旧 key 签字
     * 授权新 key, 每版都带同一份 lineage), 那一版才既换掉 key 又保住"覆盖安装不丢数据"
     * 新 key 已经生成好了 (`D:\apk\.android\luwi-release.jks`, CN=Luwi Release), 生成与体检见
     * tools/lw-make-release-keystore.ps1
     */
    signingConfigs {
        getByName("debug") {
            storeFile = file(debugKeystore)
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    defaultConfig {
        applicationId = "io.github.yuloong07star.luwi"
        // 33 used to be forced by miuix-blur; the blur went away on 2026-09-22, so nothing in the
        // dependency graph demands it any more and this is now a choice. Lowering it is a separate
        // decision: the accessibility tree path needs API 30, and nothing here has been run below 33.
        minSdk = 33
        targetSdk = 37
        // 2.6.5: 唤醒那一摊的整批修 (内置 custom 预设随包安装 + 语音开新会话回退 / 唤醒召回调参 +
        // 命中去抖 / 唤醒到开麦的延迟 / 在线引擎念回答时的半双工闸 / 球的状态优先级改成"想 > 说 > 听" /
        // 说完一句就收窗 / 自动指令的冷却由主人自己定)
        // 2.6.7: 球在念/听时的呼吸与涟漪 (说往外扩、听往回收) / 状态词改成"念 > 想/听 (谁最近变得谁上)" /
        // 同一场起了新轮就掐播报 / 新一轮出现就把"正在听"收回来
        // 2.7.4: LW 插件第二批 (伴侣 APK 那一层 —— 鲸鱼娘桌面小组件、从链接装入) 与设置页新加的
        // 「技能」那一段 (按已装应用把技能装进 dsh 家), 以及全仓图标换成 Luwi 自己的标记
        // (球上那圈标记 0.378 → 0.65)。这一批在 git 里的开发者标签是 v2.7.0…v2.7.3, 收口时定名 2.7.4
        // 2.7.7: 浮标外观能放人物立绘了 —— `theme/ball.json` 收 `fit` (cover/contain), contain 那一档
        // 不裁圆; 球尺寸 48 → 72 dp; 涟漪窗跟着 96 → 132 dp; peeked/失败/完成 三档都能配素材
        // 2.7.9: 自动更新提示 / 删捐赠页 (签到那一页不进包, 只留 ⋮ 一行) / docx 与 pptx 进右栏预览 /
        // 探索预算两条滑块与四项读数 / 无障碍与 OCR 并进特权通道 / 手机锁竖屏 / 设置页 ⋮ 第一条反馈 /
        // 语音预录填音与只读状态出口 / 同步插件 0.3.5 (扫码配对、P2P 卡、签到) / dsh 升到 0.2.1-rc.3
        // 2.7.10: 酒馆 (角色卡/故事书/存档/主题/主动说话, 最多十人一桌) / 账号与签到 (官网设备码登录,
        // 签到只在官网, 应用里没有写操作) / 开屏 (图标 + 转圈 + 加载日志, splash.json 可配) /
        // 老 WebView 兼容层 (文档开始垫 polyfill, 还缺就弹窗让人去更新) / 一状态多支动作 (ball.json 的
        // frames 收数组) / 立绘按高贴满 / 半隐改一半 (0.35 → 0.5) / 鲸鱼娘外观随包发 / API 音色库 /
        // 接口文档那一段
        // 2.8.0: 稳定手机核心 —— 余额快路径 (先显示旧值, 网络预算 6 s, 同一 seq 只刷一次) / 探索到上限或
        // 到时先释放自己建的虚拟屏 / 手机直连优先原生 API 与 Intent (常见动作不建屏, 快应用失败即 unsupported) /
        // 主动对话从探索里拆开 (保 30 分钟闸, 取消每日次数上限) / 规则引擎加日历临近, 电量与通知摘要,
        // 规则搬进 rules/ 且 settings.json 不再当规则读
        versionCode = 19
        versionName = "2.8.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        ndkVersion = "29.0.14206865"
        ndk {
            // Everything native in this app is arm64 only, the shipped runtime included, so
            // building the launcher for anything else would only add an ABI nothing can use
            abiFilters += "arm64-v8a"
        }
    }

    buildTypes {
        // 1.2.0: debug 也吃 R8 与资源裁剪 —— 那时候发的是 debug 包, 而优化对哪个 build type 都适用
        // 关掉优化时 dex 是 69.6 MiB (十一个 classes*.dex), 那是这一版最大的一笔
        // 2.8.0 #36 起正式包改走 release 变体 (下面那一段), dev 循环仍然走 debug, 两边的优化与规则同一份
        debug {
            optimization {
                enable = true
            }
            // 默认只有 release 才吃 proguard-rules.pro; dev 包也要跑同一套 (它与正式包只差 debuggable
            // 与签名), 所以显式挂上 —— 那份规则里最要紧的一条是特权进程的入口类名 (见文件里的注释)
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        release {
            // 2.8.0 #36: 发的换成 release 变体, 于是它要接过 debug 那一份的账 —— R8 与资源裁剪开着,
            // 规则文件也是同一份 (那份里最要紧的一条是特权进程的入口类名, 见 proguard-rules.pro)
            // 关掉优化时 dex 69.6 MiB, 那是这一版最大的一笔, 正式包不能这么发
            optimization {
                enable = true
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // `application-debuggable` 这一行由 build type 给: release 本来就不带, 这里写明是判据
            // (tools/lw-release-check.ps1 会拿 aapt2 dump badging 再核一次), 谁把这条改成 true 都看得见
            isDebuggable = false
            // 签名仍是那把旧 debug key (理由见上面 signingConfigs 前那一段): 2.8.0 要能被 2.7.10 覆盖安装,
            // 用户数据不能靠卸载重装来换一个"好看的证书主体"
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    kotlin {
        jvmToolchain(21)
    }
    buildFeatures {
        compose = true
    }
    // The privileged launcher is the one native piece this app builds itself: it is a cmake
    // executable named liblauncher.so, because Android only executes what sits in nativeLibraryDir
    externalNativeBuild {
        cmake {
            path = file("src/main/native/CMakeLists.txt")
            version = "3.22.1"
        }
    }
    packaging {
        jniLibs {
            // Node ships as libnode.so in jniLibs and is exec'd from
            // nativeLibraryDir. That requires install-time extraction, otherwise
            // the libs stay compressed in the APK with nothing to exec.
            // QNN needs the same treatment for a different reason: fastrpc loads
            // libQnnHtpV73Skel.so by path, and ADSP_LIBRARY_PATH points at
            // nativeLibraryDir, so it has to be a real file
            useLegacyPackaging = true
            // 六代 Hexagon 骨架全带 (2026-10-29): 以前只留 V73, 注释写 "this device is v73", 代价是
            // 8 Elite (V79) 的用户装上直接 QNN_DEVICE_ERROR_INVALID_CONFIG —— 那一档的 NPU 永远建不
            // 起来, 而界面只会显示一个回落后的 CPU。deflate 后六代合计约 25.7 MB, 换来 888 到
            // 8 Elite Gen 2 都不用挑版本。libQnnHtpPrepare.so 是图编译器, jit 那条路要它
            excludes += listOf(
                // GPU / classic-DSP backends are another 11 MB and OCR only ever asks for HTP
                "**/libQnnGpu*.so",
                "**/libQnnDsp*.so",
            )
        }
    }
    androidResources {
        // The host archive is already deflated, so compressing it again buys nothing and the
        // app reads it as a plain stored asset
        noCompress += "zip"
    }
    // AGP 9 refuses Provider-backed source directories in the classic SourceSet API, so the
    // generated directory is named as a plain file and the dependency on the task filling it is
    // declared below
    sourceSets["main"].assets.srcDir(hostAssets.get().asFile)
    // 随包的技能与样例快捷指令同理: 源在仓库里, 进包的形状由 copySeedAssets 拼
    sourceSets["main"].assets.srcDir(seedAssets.get().asFile)
    // 酒馆 (C 方案): 有私有目录就用它, 没有就用 `src/tavern-stub` 那份空实现 —— 两份声明的是
    // 同一个 object, 所以两个目录永远只会进来一个
    if (tavernRoot != null) {
        sourceSets["main"].kotlin.srcDir(File(tavernRoot, "app/src/main/java"))
        sourceSets["test"].kotlin.srcDir(File(tavernRoot, "app/src/test/java"))
    } else {
        sourceSets["main"].kotlin.srcDir("src/tavern-stub/java")
    }
}

// Every variant's asset merge has to wait for the archive. `tasks.named` fails the build if AGP
// ever renames that task, which is the failure a missing dependency would otherwise hide
// Every variant's asset merge has to wait for the archive. AGP registers the merge tasks after
// onVariants runs, so this matches them as they appear rather than naming one now; the app
// reports a missing or stale archive on its own, and `assembleDebug --dry-run` shows
// `merge<variant>Assets` in the graph if this ever needs rechecking
//
// 2.8.0 #36: 发布包改走 release 变体之后, 第一次真的跑到 lintVital (它只跟 release 走), 而 lint
// 的模型任务是**直接读源集里那两个生成目录**的 —— 没连边就被 Gradle 判成 implicit dependency
// (`:app:generateReleaseLintVitalReportModel` uses output of `:app:zipHostTree`), 整趟构建当场红
// 于是把 lint 那几个读 assets 的任务也一起连上, 别只连 merge<variant>Assets
androidComponents {
    onVariants { variant ->
        val cap = variant.name.replaceFirstChar(Char::uppercaseChar)
        val assetReaders = setOf(
            "merge${cap}Assets",
            "generate${cap}LintVitalReportModel",
            "generate${cap}LintModel",
            "lintVitalAnalyze${cap}",
        )
        tasks.matching { it.name in assetReaders }
            .configureEach {
                dependsOn(zipHostTree)
                dependsOn(copySeedAssets)
            }
    }
}


// 取 AAR 那一步要排在编译之前: 上面用的是普通文件依赖, 它自己带不上 builtBy 这条边, 所以
// 这里把 preBuild 连过去。本地放了 app/libs/sherpa-onnx.aar 就不需要下载了
if (!sherpaAarLocal.isFile) {
    tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(fetchSherpaOnnxAar) }
}
dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material.icons.extended)

    // Miuix UI: theme, icons, nav, preferences, squircle. No miuix-blur: the app has no blur.
    implementation(libs.miuix.ui)
    implementation(libs.miuix.preference)
    implementation(libs.miuix.icons)
    implementation(libs.miuix.nav)
    implementation(libs.miuix.squircle)

    implementation(libs.kotlinx.serialization.json)
    // 扫码配对 (2026-10-20): 二维码的解码用 ZXing 的 core (纯 Java, 不依赖 Android 也不依赖它那个
    // 旧 camera 包 —— 相机那一路是我们自己的 Camera2, 见 sync/QrScanner.kt)
    implementation(libs.zxing.core)
    // LW 插件的接口那一份 (手写 Binder 的两个接口 + 常量, 批次 9): 伴侣样例与这里引的是同一个模块,
    // 于是"两侧同一份接口"不是一句口号 —— 描述符与 transaction code 只有一处定义
    implementation(project(":lwplugin-api"))
    // 「Edge 在线」那条朗读引擎: 那条接口是 WebSocket, 用它比手写握手可靠
    implementation(libs.okhttp)
    // 老 WebView 那条兼容层 (2.7.10): dsh 的前端产物用了 `Promise.withResolvers` (Chrome 119 才有),
    // 而 22 年出厂、一直没更新过 WebView 的机器停在 100~116 —— 界面会永远停在"连接中"。这一条依赖
    // 只为了拿到 `WebViewCompat.addDocumentStartJavaScript` (文档开始前注入一段 polyfill),
    // WebView 自己那一层没有等价的钩子
    implementation(libs.androidx.webkit)

    // The privileged channel: Shizuku's API and provider, plus libsu for the root shell
    implementation(libs.shizuku.api)
    implementation(libs.shizuku.provider)
    implementation(libs.libsu)

    // 端侧 OCR: PP-OCR 的 det + rec 跑在 ONNX Runtime 上, NPU 走 QNN EP
    // 版本是本机与 B:\Git\Inferencer 一起验过的组合 (那台小米 13 上真建起过 QNN session),
    // 不要随手升: onnxruntime-android-qnn 与 qnn-runtime 的版本是配对的
    implementation("com.microsoft.onnxruntime:onnxruntime-android-qnn:1.26.0")
    implementation("com.qualcomm.qti:qnn-runtime:2.46.0")


    // 语音转写: sherpa-onnx 的 Android AAR (见上面的 fetchSherpaOnnxAar)。它自带
    // libsherpa-onnx-jni.so, 里面静态链接了 onnxruntime, 与 OCR 那套 onnxruntime-android
    // 各走各的, 不是同一份
    implementation(files(sherpaAarLocal.takeIf { it.isFile } ?: sherpaAar.get().asFile))
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
