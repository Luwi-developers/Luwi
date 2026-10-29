package io.github.yuloong07star.luwi.account

import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * 官网账号那两条**读**接口 (2026-10-25)
 *
 * 用 OkHttp 是因为它已经在这个包 (酒馆那一层在用); 超时 5 / 10 秒, 与反馈那一趟同一个尺度
 * 这里**不重试**: 登录那条由 [LuwiAccount] 的轮询循环负责, 到期那条失败就当这次没读到
 *
 * 应用里没有写操作 —— 签到与购买只在官网 `/tavern` 页面里发生 (签到 2026-10-26 恢复)
 */
internal object AccountApi {

    private const val CONNECT_TIMEOUT_S = 5L
    private const val READ_TIMEOUT_S = 10L

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_S, TimeUnit.SECONDS)
            .build()
    }

    /** 问一次官网: 浏览器里登录完了没有 */
    suspend fun poll(state: String): PollResult = withContext(Dispatchers.IO) {
        val reply = try {
            get(SITE_BASE + POLL_PATH + "?state=" + encode(state))
        } catch (problem: IOException) {
            return@withContext PollResult.Failed(unreachable(problem), transient = true)
        }
        AccountWire.parsePoll(reply.code, reply.body)
    }

    /** 读一次到期 (官网里续费过, 回到应用靠这一下把日期改过来) */
    suspend fun refresh(token: String): RefreshResult = withContext(Dispatchers.IO) {
        val reply = try {
            get(SITE_BASE + ENTITLEMENT_PATH + "?token=" + encode(token))
        } catch (problem: IOException) {
            return@withContext RefreshResult.Failed(unreachable(problem))
        }
        AccountWire.parseRefresh(reply.code, reply.body)
    }

    /** 一次应答: 状态码 + 正文 (非 2xx 的应答也有正文, 官网那几条都是 JSON) */
    private data class Reply(val code: Int, val body: String)

    private fun get(url: String): Reply {
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            // GitHub 与 Cloudflare 都认这个; 也方便那一侧从日志里认出是谁
            .header("User-Agent", "Luwi")
            .get()
            .build()
        client.newCall(request).execute().use { answer ->
            return Reply(answer.code, answer.body?.string().orEmpty())
        }
    }

    private fun encode(text: String): String = URLEncoder.encode(text, "UTF-8")

    private fun unreachable(problem: IOException): String =
        "连不上官网: ${problem.message ?: problem.javaClass.simpleName}"
}
