package io.github.yuloong07star.luwi.link

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 别的应用问 Luwi 的那扇门
 *
 * 协议是**手写的 Binder**, 和仓库里特权通道、插件两侧一样, 不引 `.aidl`: 一个 aidl 会让构建
 * 生成 Java, 把 AGP 9 的坏资源管线拉回来
 *
 * 两个事务:
 * - [TRANSACT_DESCRIBE] 回一段 JSON, 说这一版开了哪些 scope
 * - [TRANSACT_INVOKE] 收 scope / method / 参数, 回 `{ok, text, data}` 或 `{ok:false, code, because}`
 *
 * 门本身还有一道系统闸: 服务在 manifest 里带 `signature` 级权限, 不同签名的调用方连进都进不来
 * 我们这层再验一次 uid 的签名, 是防"同签名但走错进程"这类边角, 也是把拒绝路径做成可审计的
 */
class LwLinkService : Service() {

    private val counter = LinkGrants.Counter()

    private val binder = object : Binder() {

        override fun onTransact(code: Int, data: android.os.Parcel, reply: android.os.Parcel?, flags: Int): Boolean {
            if (reply == null) return false
            return when (code) {
                TRANSACT_DESCRIBE -> {
                    reply.writeString(LinkScope.describeJson())
                    true
                }

                TRANSACT_INVOKE -> {
                    val scopeId = data.readString() ?: ""
                    val method = data.readString() ?: ""
                    data.readString()
                    reply.writeString(invoke(scopeId, method))
                    true
                }

                else -> super.onTransact(code, data, reply, flags)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    /**
     * 一次调用
     *
     * 判定 → 执行 → 写审计, 三步都要走完: 拒绝也留一行, 否则"谁在敲这扇门"就查不出来
     */
    private fun invoke(scopeId: String, method: String): String {
        val started = System.currentTimeMillis()
        val caller = caller()
        val scope = LinkScope.of(scopeId)
        val nowMs = System.currentTimeMillis()
        val used = counter.take(caller.uid, nowMs)
        val decision = LinkGrants.decide(caller, scope, method, nowMs, used)
        val answer = when (decision) {
            LinkDecision.Allow -> reply(scope, method)
            is LinkDecision.Deny -> "{\"ok\":false,\"code\":\"${decision.code}\",\"because\":\"${escape(decision.because)}\"}"
        }
        val ms = System.currentTimeMillis() - started
        LinkAudit.record(this, LinkAudit.line(nowIso(started), caller, scopeId, method, decision, ms))
        return answer
    }

    /** 真正干活的地方, 一个 scope 一个分支, 这里没有的都进不来 */
    private fun reply(scope: LinkScope?, method: String): String {
        val data = when (scope) {
            LinkScope.STATE_READ -> when (method) {
                "snapshot" -> LinkSnapshot.read(this).toJson()
                else -> "{}"
            }
            null -> "{}"
        }
        return "{\"ok\":true,\"data\":$data}"
    }

    /** 调用方是谁, 全部由系统给, 不接受参数里的自称 */
    private fun caller(): LinkGrants.LinkCaller {
        val uid = Binder.getCallingUid()
        val packages = runCatching { packageManager.getPackagesForUid(uid) }.getOrNull()
        val name = runCatching { packageManager.getNameForUid(uid) }.getOrNull()
            ?: packages?.firstOrNull()
            ?: "uid:$uid"
        return LinkGrants.LinkCaller(
            uid = uid,
            packageName = name,
            sameSignature = LinkSignature.sameAsSelf(this, uid),
        )
    }

    companion object {

        /** describe(): 回这一版开了什么 */
        const val TRANSACT_DESCRIBE = 0x4c5701

        /** invoke(scope, method, params): 回一次调用 */
        const val TRANSACT_INVOKE = 0x4c5702

        /** 服务动作名, 调用方按它 bind */
        const val ACTION = "io.github.yuloong07star.luwi.link.BIND"

        private val ISO = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US)

        private fun nowIso(at: Long): String = ISO.format(Date(at))

        /** JSON 里只有引号与反斜杠会坏事, 而拒绝理由是我们自己写的英文句子 */
        private fun escape(text: String): String =
            text.replace("\\", "\\\\").replace("\"", "\\\"")

        /** 从别的组件拉服务用的意图 */
        fun intent(context: Context): Intent = Intent(ACTION).setPackage(context.packageName)
    }
}
