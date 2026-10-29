package io.github.yuloong07star.luwi.host

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import io.github.yuloong07star.luwi.tool.LwApiSpeech
import io.github.yuloong07star.luwi.tool.SpeakSettings
import java.io.File

/**
 * 「开放接口」那一份文档 (2026-10-25 主人: "接口文档不能只放开屏的，还要有浮标的状态等，其它开放的接口")
 *
 * 它讲的是 Luwi 对 agent / 脚本开放的那几条**文件接口** (开屏外观 / 浮标状态 / 浮标外观 / 语音状态 /
 * 快捷指令 / 技能 / 自动指令 / 探索卡 / API 朗读与音色库), 而不是某一项设置 —— 所以正文跟着版本走,
 * 而不是跟着某个功能走
 *
 * **只有一份来源**: `assets/interfaces/README.md`。每次开屏之前 [seed] 把它抄进
 * `$DSH_HOME/lw/interfaces.md`, 抄的时候把 `$DSH_HOME` 换成这台机器的真实路径, 并把 API 朗读那四样
 * (地址 / 补全后的端点 / 密钥 / 模型 / 当前音色) 填进占位符 —— 于是设置页弹窗里看到的、剪贴板里
 * 复制的、agent 用 `cat` 读到的, 是同一份、同一条路径
 *
 * **为什么那几样要进文档** (2026-10-25 主人: "说话里的 api 地址，密钥和模型都开放到接口文档里"
 * 之后又改成 "接口文档里带着明文密钥，删掉，不能放"): 地址与模型给 agent 用, **密钥只报有没有
 * 设置** —— 明文永远不落进这份文档, 也永远不进回执与日志
 *
 * 内容一致就一个字节都不动: 每趟启动都重写一份同样的文件, 只会让"谁最后写"变成一件没意义的事;
 * 而文档真跟着版本变了、或者那四样设置变了, 这里会覆盖 —— 它是接口说明, 不是用户的创作
 */
internal object LwInterfaces {

    private const val TAG = "LwInterfaces"

    /** asset 里那份正文 */
    private const val ASSET = "interfaces/README.md"

    /** 落到 `$DSH_HOME/lw/` 下 (与球、语音、开屏那几份小文件同一层) */
    private const val NAME = "interfaces.md"

    /** 占位符: 正文里写这几个, [render] 把它们换成本机的实况 */
    internal const val API_URL = "{{API_URL}}"
    internal const val API_ENDPOINT = "{{API_ENDPOINT}}"
    /** 只报"有没有设置", **不是密钥本身** (2026-10-25 主人: "接口文档里带着明文密钥，删掉，不能放") */
    internal const val API_KEY_STATE = "{{API_KEY_STATE}}"
    internal const val API_MODEL = "{{API_MODEL}}"
    internal const val API_VOICE = "{{API_VOICE}}"

    private const val EMPTY = "（还没填）"

    /** 密钥那一条只有两种说法, 任一种都不含那串字符 */
    private const val KEY_SET = "已设置（值不写进文档）"
    private const val KEY_EMPTY = "还没填（请求不带 Authorization）"

    /**
     * 偏好监听只装一次, 而且**必须留一个强引用** —— Android 的 SharedPreferences 对 listener 是弱
     * 引用, 只存在局部变量里的话下一次 GC 就没了 (那时改设置文档不再更新, 而且没有任何报错)
     */
    private var watcher: SharedPreferences.OnSharedPreferenceChangeListener? = null

    fun docFile(context: Context): File = File(DshHost.settingsDirectory(context), NAME)

    /** 正文, 其中 `$DSH_HOME` 与 API 那几样都已经换成本机实况 */
    fun docText(context: Context): String {
        val raw = runCatching {
            context.assets.open(ASSET).bufferedReader().use { it.readText() }
        }.getOrDefault("")
        val home = File(context.filesDir, DshHost.HOME_DIR).absolutePath
        return render(raw, home, SpeakSettings.storedApi(context))
    }

    /**
     * 纯替换: 没有设备也能量 (见 LwInterfacesTest)
     *
     * 用 `String.replace` 而**不是正则**: 地址与模型里带 `$`、`\` 这类字符是最正常不过的事, 正则
     * 的替换串会把它们当分组引用。**密钥不在这一份里**: 它只变成"有没有设置"那一句话
     */
    internal fun render(raw: String, home: String, api: SpeakSettings.ApiConfig): String {
        val endpoint = LwApiSpeech.endpoint(api.url)
        return raw
            .replace("\$DSH_HOME", home)
            .replace(API_URL, api.url.ifBlank { EMPTY })
            .replace(API_ENDPOINT, endpoint.ifBlank { EMPTY })
            .replace(API_KEY_STATE, if (api.key.isBlank()) KEY_EMPTY else KEY_SET)
            .replace(API_MODEL, api.model.ifBlank { EMPTY })
            .replace(API_VOICE, api.voice.ifBlank { EMPTY })
    }

    /** 把文档抄进沙盒 (开屏之前叫一次, 设置页那段也用同一份) */
    fun seed(context: Context) {
        watchSettings(context)
        runCatching {
            val target = docFile(context)
            val text = docText(context)
            if (text.isBlank()) return
            if (target.isFile && target.readText() == text) return
            target.parentFile?.mkdirs()
            target.writeText(text)
            Log.i(TAG, "the interface doc is now ${target.absolutePath}")
        }.onFailure { Log.w(TAG, "the interface doc could not be written", it) }
    }

    /**
     * 盯 API 那四样的偏好: 改了就重写文档
     *
     * 只在 host 服务起来过之后生效 (那是 [seed] 的调用点) —— 界面那一侧读的是 [docText] 的实况,
     * 所以就算监听没装上, 设置页弹窗里看到的也永远是最新的
     */
    private fun watchSettings(context: Context) {
        if (watcher != null) return
        val app = context.applicationContext
        val created = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == null || !key.startsWith(SpeakSettings.API_KEY_PREFIX)) {
                return@OnSharedPreferenceChangeListener
            }
            seed(app)
        }
        watcher = created
        app.getSharedPreferences(SpeakSettings.STORE, Context.MODE_PRIVATE)
            .registerOnSharedPreferenceChangeListener(created)
    }
}
