package io.github.yuloong07star.luwi.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import io.github.yuloong07star.luwi.tool.LwSpeech
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.json.JSONObject

/**
 * 门户那一颗「按住 说话」的宿主侧 (2026-11-20)
 *
 * 一条链只有三跳: **页面自己录** (`getUserMedia` + `ScriptProcessor`, 封成 16 kHz 单声道 PCM16
 * wav, base64 过桥) → **这里落一份临时 wav** → `LwSpeech.dispatch(op=transcribe)` 出字 → 回推页面。
 *
 * 三条分寸:
 *
 * 1. **引擎不在这里选**: `LwSpeech.engine(context)` 读 `lw/voice-source.json` —— 引导里选了
 *    「使用 DeepSeek 语音输入」的机器走云端 (`engine=deepseek`, 本地一个模型都不碰), 其余的走
 *    SenseVoice。页面上因此没有第二个开关, 换档仍只在设置 / 引导那一处
 * 2. **一次只跑一趟**: 转写在单线程 executor 上排队, 而每次开跑都抬一格 `generation` —— 退出语音态
 *    或又按了一次时, 上一趟回来也**不许再动草稿** (过时的那句话比不说更糟)
 * 3. **临时文件必须删**: wav 只活在这一次转写里 (`cacheDir/lw-voice`), `finally` 里清掉; 真机上一句
 *    话的 wav 是几百 KB 到两 MB, 留着就是白占
 */
internal object PortalVoice {

    private const val TAG = "LwPortalVoice"

    /** 一次最多认多久: 与 `client.js` 的 `VOICE_MAX_MS` 同一个数 (判据钉住) */
    const val MAX_SECONDS = 60

    /** 60 s × 16 kHz × 2 B = 1.92 MB; 再宽一点就到这道闸 (与官方 8 MiB 那条无关, 这是 UI 的上限) */
    const val MAX_BYTES = 2 * 1024 * 1024

    /** wav 头那一截: 44 字节 (RIFF + fmt + data) */
    const val WAV_HEADER_BYTES = 44

    /** 转写在别的线程上跑, 一次一趟 */
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "lw-portal-voice").apply { isDaemon = true }
    }

    /**
     * 这一趟的代号: 每开一趟 / 每次作废都抬一格
     *
     * 回来时对不上就说明**已经有更新的一趟了** (或者人退出了语音态) —— 那一份结果直接丢, 不动草稿
     */
    private val generation = AtomicInteger(0)

    /** 临时 wav 落在 cache 下, 不与任何别的东西混 (删起来也干净) */
    fun wavDirectory(context: Context): File = File(context.cacheDir, "lw-voice")

    /** 这一趟的文件名; 纯函数, 判据真跑 */
    fun wavName(id: Int): String = "say-" + id + ".wav"

    /**
     * base64 → 字节
     *
     * 用 `java.util.Base64` 的 MIME 解码器 (minSdk 33, 那一档就有了): 与 `android.util.Base64` 的
     * `DEFAULT` 一样容忍换行与空白, 好处是**这一个函数在 JVM 单测里能真跑** —— 桥那一侧收的正是
     * 这一段, "解不开"与"解出来是空"必须分得开
     * @param data 页面交上来的那一段 (标准 base64, 不带 data: 前缀)
     * @returns 解不开时 null (空串解出来是空数组, 由 [isWav] 判死)
     */
    fun decode(data: String): ByteArray? =
        runCatching { java.util.Base64.getMimeDecoder().decode(data) }.getOrNull()

    /**
     * 这是不是一段 wav (前 12 个字节认 RIFF/WAVE)
     *
     * 不认的话不必往 `LwSpeech` 里塞 —— 它那边读头失败只会抛一句更难懂的话
     * @param bytes 解出来的那些字节
     */
    fun isWav(bytes: ByteArray): Boolean {
        if (bytes.size <= WAV_HEADER_BYTES) return false
        if (bytes[0] != 'R'.code.toByte() || bytes[1] != 'I'.code.toByte()) return false
        if (bytes[2] != 'F'.code.toByte() || bytes[3] != 'F'.code.toByte()) return false
        if (bytes[8] != 'W'.code.toByte() || bytes[9] != 'A'.code.toByte()) return false
        if (bytes[10] != 'V'.code.toByte() || bytes[11] != 'E'.code.toByte()) return false
        return true
    }

    /**
     * 麦克风给没给 / 语音那一档现在能不能出字
     *
     * `ready` 只对本地那一档有意义: 云端 (`deepseek`) 缺的只是登录, 而"有没有登录"只有宿主知道,
     * 这一侧先答应下来, 真认的时候宿主会回一句"还没登录"
     */
    fun status(context: Context): JSONObject {
        val engine = LwSpeech.engine(context)
        val ready = LwSpeech.readyFor(context)
        return JSONObject().apply {
            put("ok", true)
            put("mic", ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED)
            put("engine", engine)
            put("ready", ready)
            put("maxSeconds", MAX_SECONDS)
            put("maxBytes", MAX_BYTES)
            // 只可能是本地那一档缺模型 (云端那条 `readyFor` 恒为真): 那句话就照本地写
            if (!ready) put("detail", "语音模型还没下: 设置 → 唤醒 → 语音模型")
        }
    }

    /**
     * 收一段录音, 转写, 把结果回推页面
     *
     * @param id 页面给的这一趟编号 (回推时原样带回, 页面拿它认人)
     * @param data base64 的 16 kHz 单声道 PCM16 wav
     * @param language `auto` 或那六种之一 (`LwSpeech` 自己兜底)
     * @param done 回推那一步 (在 `PortalBridge` 里落到 `window.__LUWI_PORTAL__.voice`)
     * @returns 当场答应页面那一段 (`{ok:true, id}`) 或一句拒绝 (`{ok:false, error}`)
     */
    fun transcribe(context: Context, id: Int, data: String, language: String, done: (JSONObject) -> Unit): JSONObject {
        val bytes = decode(data) ?: return refusal(id, "录音解不开")
        if (bytes.size > MAX_BYTES) return refusal(id, "这一段太长了, 60 秒以内再说")
        if (!isWav(bytes)) return refusal(id, "这一段不是 wav")
        val token = generation.incrementAndGet()
        val engine = LwSpeech.engine(context)
        val target = File(wavDirectory(context).apply { mkdirs() }, wavName(id))
        worker.execute {
            try {
                target.writeBytes(bytes)
                val answer = LwSpeech.dispatch(
                    context,
                    buildJsonObject {
                        put("op", "transcribe")
                        put("wav", target.absolutePath)
                        put("engine", engine)
                        put("language", language)
                    },
                )
                // 这一趟已经被更新的一趟顶掉了: 结果丢, 草稿一个字都不动
                if (token != generation.get()) {
                    Log.i(TAG, "dropped a stale transcript (#" + id + ")")
                    return@execute
                }
                val body = runCatching { JSONObject(answer.toString()) }.getOrDefault(JSONObject())
                done(JSONObject().apply {
                    put("ok", true)
                    put("id", id)
                    put("text", body.optString("text", ""))
                    put("engine", body.optString("engine", engine))
                })
            } catch (error: Throwable) {
                Log.w(TAG, "transcribing #" + id + " failed: " + (error.message ?: error.toString()))
                if (token == generation.get()) done(refusal(id, failureOf(error)))
            } finally {
                runCatching { target.delete() }
            }
        }
        return JSONObject().put("ok", true).put("id", id)
    }

    /** 作废在途那一趟: 退出语音态 / 又按了一次时调 */
    fun cancel() {
        generation.incrementAndGet()
    }

    /**
     * 权限那一问的结果回推页面 (`{kind:'permission', mic:…}`)
     *
     * 与转写同一条出口: 页面那一侧只认 `__LUWI_PORTAL__.voice(...)`
     * @param granted 系统弹窗里点了什么
     */
    fun reportPermission(granted: Boolean) {
        onMain {
            PortalState.run?.invoke(
                "window.__LUWI_PORTAL__ && window.__LUWI_PORTAL__.voice(" +
                    JSONObject().put("ok", true).put("kind", "permission").put("mic", granted).toString() + ")",
            )
        }
    }

    /** 一句拒绝 (页面把它原样显示在输入卡那行小字上) */
    fun refusal(id: Int, reason: String): JSONObject = JSONObject().apply {
        put("ok", false)
        put("id", id)
        put("error", reason)
    }

    /**
     * 失败那句话: 先翻成人话, 认不出来的异常也不许空着
     *
     * 宿主那条链回来的多半是英文与一长串 JSON (`the DeepSeek speech input answered 401: {...}`),
     * 而输入卡上那行小字只有十几个字的宽度 —— 所以常见的三档翻成一句中文, 其余截短
     * @param error 宿主 / 引擎抛出来的那一句
     */
    fun failureOf(error: Throwable): String = friendly(error.message.orEmpty())

    /**
     * 把一条错误正文翻成输入卡上那行小字 (纯函数, 判据真跑)
     * @param raw 原始那一句 (可能为空)
     */
    fun friendly(raw: String): String {
        val text = raw.trim()
        if (text.isEmpty()) return "这一句没认出来"
        val low = text.lowercase()
        return when {
            low.contains("401") || low.contains("authentication") || low.contains("api key") ->
                "语音口令不对: 设置 → 账号里重新登录"
            low.contains("not signed in") || low.contains("还没登录") ->
                "还没登录: 设置 → 账号"
            // 上游那几句"什么也没听见"要翻成人话 (2026-11-20 真机: 屏幕上飘的是英文原文)
            low.contains("heard nothing") || low.contains("no speech") || low.contains("empty transcript") ->
                "没听见声音, 再说一句"
            low.contains("not downloaded") || low.contains("the model is not installed") ->
                "语音模型还没下: 设置 → 唤醒 → 语音模型"
            low.contains("could not be reached") || low.contains("timeout") ->
                "语音那条路连不上: 稍后再试"
            text.length > 40 -> text.take(40) + "…"
            else -> text
        }
    }

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block()
        else Handler(Looper.getMainLooper()).post(block)
    }
}
