package io.github.yuloong07star.luwi.link

/**
 * 谁能调, 能调几次
 *
 * 这一版只认**同一把签名**: 判据是 `PackageManager.checkSignatures` 回 SIGNATURE_MATCH, 也就
 * 是"这个 apk 和我用同一张证书签的"。第三方逐 scope 授权那一档还没开, 所以它的答案一律是
 * [LinkDecision.Deny], 而不是"默认放行"
 *
 * 判定写成纯函数 (只吃 [LinkCaller] 与时间), 是为了能在 JVM 单测里把每条拒绝路径都钉住:
 * 真机上造一个不同签名的 apk 成本太高, 容易变成"只测了放行那一条"
 */
internal object LinkGrants {

    /** 一分钟内同一个 uid 最多调这么多次 */
    private const val BURST = 30

    private const val WINDOW_MS = 60_000L

    /**
     * 调用方是谁
     *
     * @param uid 真实的调用 uid, 由 Binder 给出, 不从参数里读
     * @param packageName 由系统按 uid 反查
     * @param sameSignature 与 Luwi 同签名
     */
    data class LinkCaller(val uid: Int, val packageName: String, val sameSignature: Boolean)

    /**
     * 一次判定
     *
     * @param caller 调用方
     * @param scope 他要的 scope, 拿不到就是 null
     * @param method scope 里的方法名
     * @param nowMs 现在, 由调用方给, 单测才能控时间
     * @param used 这个 uid 在当前窗口里已经用了几次
     */
    fun decide(
        caller: LinkCaller,
        scope: LinkScope?,
        method: String,
        nowMs: Long,
        used: Int,
    ): LinkDecision {
        if (scope == null) {
            return LinkDecision.Deny("unknown-scope", "this build does not offer that scope")
        }
        if (method !in scope.methods) {
            return LinkDecision.Deny(
                "unknown-method",
                "${scope.id} takes ${scope.methods.joinToString(" / ")}, not $method",
            )
        }
        if (!caller.sameSignature) {
            return LinkDecision.Deny(
                "not-same-signature",
                "only an app signed with the same certificate may call ${scope.id}",
            )
        }
        if (used >= BURST) {
            return LinkDecision.Deny(
                "too-many",
                "at most $BURST calls a minute; wait a moment and ask again",
            )
        }
        return LinkDecision.Allow
    }

    /**
     * 按 uid 记次数
     *
     * 只在内存里, 进程一重启就清空: 这一版不做跨进程持久计数, 因为它防的是脚本刷接口, 不是
     * 记账。窗口一过就整条丢掉, 免得这张表越攒越长
     */
    class Counter(private val windowMs: Long = WINDOW_MS) {

        private class Window(var startedAt: Long, var used: Int)

        private val windows = HashMap<Int, Window>()

        /** 取一次并加一, 返回这一次之前已经用了几次 */
        fun take(uid: Int, nowMs: Long): Int {
            val window = windows[uid]
            if (window == null || nowMs - window.startedAt >= windowMs) {
                windows[uid] = Window(nowMs, 1)
                return 0
            }
            val usedBefore = window.used
            window.used = usedBefore + 1
            return usedBefore
        }
    }
}
