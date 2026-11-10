package io.github.yuloong07star.luwi.link

/**
 * What another app is allowed to ask Luwi, named one scope at a time
 *
 * The list is deliberately short and closed: a scope is either here or it does not exist, and a
 * request for anything else is refused rather than guessed. Adding a scope means adding a row here
 * plus a branch in [LinkState.reply], so the thing a caller can read is always the thing that was
 * written down
 */
internal enum class LinkScope(val id: String, val methods: List<String>) {

    /** 宿主 / 通道 / 无障碍 / 虚拟屏 / 存储这几项现在什么样 */
    STATE_READ("state.read", listOf("snapshot")),
    ;

    companion object {

        /**
         * 说出去的版本号
         *
         * 换形状就抬这里, 调用方按它决定要不要重新读 [describe]
         */
        const val API = "lw-link/1"

        /** 按 id 找, 没有就是 null, 调用方不该自己拼字符串 */
        fun of(id: String): LinkScope? = entries.firstOrNull { it.id == id }

        /**
         * describe 的答案
         *
         * 只报这一版真正能调的 scope: 文档里写了但这里没写的, 就等于没开
         */
        fun describeJson(): String = buildString {
            append("{\"api\":\"").append(API).append("\",\"scopes\":[")
            entries.forEachIndexed { index, scope ->
                if (index > 0) append(',')
                append("{\"id\":\"").append(scope.id).append("\",\"methods\":[")
                scope.methods.forEachIndexed { i, method ->
                    if (i > 0) append(',')
                    append('"').append(method).append('"')
                }
                append("]}")
            }
            append("],\"pending\":[\"status.read\",\"notify.post\",\"speak.request\",\"widget.attach\",\"prompt.write\"]}")
        }
    }
}

/**
 * 一次调用的三种结局
 *
 * 用封闭的结果而不是抛异常: 拒绝也是正常答案, 需要写进审计
 */
internal sealed interface LinkDecision {

    /** 放行 */
    data object Allow : LinkDecision

    /**
     * 拒
     *
     * @param code 给调用方看的短码, 稳定不改
     * @param because 给人看的一句, 说明缺什么
     */
    data class Deny(val code: String, val because: String) : LinkDecision
}
