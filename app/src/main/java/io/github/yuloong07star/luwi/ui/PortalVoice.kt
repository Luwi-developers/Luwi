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
 * 2026-11-27 (2.8.1 #F10) 多了一条**增量**的那一跳: 页面每 `VOICE_CHUNK_MS` 把这一段新增的 PCM
 * 封一小块走 `op=voice-chunk` 送来, 这里认完只把文字回推, 页面追加到波形行下面那层实时文字上 ——
 * 于是"边说边出字", 而松手时那一次整段转写仍然是草稿的权威来源.
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

    /** 一次最多按住多久: 与 `client.js` 的 `VOICE_MAX_MS` 同一个数 (判据钉住) */
    const val MAX_SECONDS = 300

    /** 300 s × 16 kHz × 2 B = 9.6 MB; 再宽一点就到这道闸 (与官方 8 MiB 那条无关, 这是 UI 的上限) */
    const val MAX_BYTES = 12 * 1024 * 1024

    /**
     * 流式那一块的节拍: 与 `client.js` 的 `VOICE_CHUNK_MS` 同一个数 (判据钉住)
     *
     * 0 = 关掉流式 —— 页面一整段都不送块, 松手时照旧走整段转写; 这一侧只当读数用
     */
    const val VOICE_CHUNK_MS = 1500

    /** 一块最多多大: 1.5 s 的 16 kHz PCM16 约 48 KB, 这条路再宽也不该过 1 MB */
    const val CHUNK_BYTES = 1024 * 1024

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
        if (bytes.size > MAX_BYTES) return refusal(id, "这一段太长了, 分几段说")
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

    /**
     * 收**一小块** (增量) 录音, 认完把文字回推页面 —— 实时文字层那一趟 (2.8.1 #F10)
     *
     * 与 [transcribe] 走同一条单线程 executor, 于是块与块之间天然有序 (页面按 `seq` 追加), 但
     * **不抬 `generation`**: 抬了的话在途的下一块一回来就成"过时", 整段实时层会缺字. 作废仍只有
     * 三处 —— 开新一趟 ([transcribe] 那条整段路) / [cancel] / 页面退出语音态.
     *
     * 一段最长 `VOICE_SEGMENT_MS` (60 s) 那道滚段边界**不在这里**: 页面到点把这一段封成
     * `final` 一块送来, 文字回来自己落草稿并接着录 —— 这里只在 `MAX_BYTES` 这道总闸上拒绝.
     *
     * @param id 页面给的这一趟编号 (回推时原样带回)
     * @param seq 这一趟里块的序号 (原生日志 `chunk=N` 就是它, 页面按它去重)
     * @param data base64 的 16 kHz 单声道 PCM16 wav 片段
     * @param fin 这一块是不是这一段的末块 (滚段 / 松手那两块)
     * @param done 回推那一步 (`PortalBridge` 里落到 `window.__LUWI_PORTAL__.voice`)
     * @returns 当场答应页面那一段 (`{ok:true, id, seq}`) 或一句拒绝
     */
    fun voiceChunk(
        context: Context,
        id: Int,
        seq: Int,
        data: String,
        language: String,
        fin: Boolean,
        done: (JSONObject) -> Unit,
    ): JSONObject {
        val bytes = decode(data) ?: return chunkRefusal(id, seq, fin, "录音解不开")
        if (bytes.size > CHUNK_BYTES) return chunkRefusal(id, seq, fin, "这一块太长了")
        if (!isWav(bytes)) return chunkRefusal(id, seq, fin, "这一段不是 wav")
        val token = generation.get()
        val engine = LwSpeech.engine(context)
        val target = File(wavDirectory(context).apply { mkdirs() }, chunkName(id, seq))
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
                // 这一趟已经被作废 (取消 / 又开了新的一趟): 这一块一个字都不许回写
                if (token != generation.get()) {
                    Log.i(TAG, "dropped a stale chunk (#" + id + "/" + seq + ")")
                    return@execute
                }
                val body = runCatching { JSONObject(answer.toString()) }.getOrDefault(JSONObject())
                // 真机读数认这一行: `LwPortalVoice: chunk=N take=M bytes=…`
                Log.i(TAG, "chunk=" + seq + " take=" + id + " bytes=" + bytes.size + if (fin) " final" else "")
                done(JSONObject().apply {
                    put("ok", true)
                    put("id", id)
                    put("kind", "chunk")
                    put("seq", seq)
                    put("final", fin)
                    put("text", body.optString("text", ""))
                    put("engine", body.optString("engine", engine))
                })
            } catch (error: Throwable) {
                Log.w(TAG, "chunk #" + id + "/" + seq + " failed: " + (error.message ?: error.toString()))
                if (token == generation.get()) {
                    done(refusal(id, failureOf(error)).apply {
                        put("kind", "chunk")
                        put("seq", seq)
                        put("final", fin)
                    })
                }
            } finally {
                runCatching { target.delete() }
            }
        }
        return JSONObject().put("ok", true).put("id", id).put("seq", seq)
    }

    /** 那一块的文件名; 纯函数 (与 [wavName] 同一个落点, 判据对得上) */
    fun chunkName(id: Int, seq: Int): String = "chunk-" + id + "-" + seq + ".wav"

    /**
     * 流式那一块的拒绝也要带 `kind` / `seq` / `final`
     *
     * 页面按 `kind` 分流: 少这几个字段的话, 一句"这一块太长了"会被当成整段转写的结果 ——
     * 录音当场被收摊, 人就看着面板消失
     */
    fun chunkRefusal(id: Int, seq: Int, fin: Boolean, reason: String): JSONObject =
        refusal(id, reason).apply {
            put("kind", "chunk")
            put("seq", seq)
            put("final", fin)
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
