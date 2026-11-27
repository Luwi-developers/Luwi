package io.github.yuloong07star.luwi.host

/**
 * host 那个 URL 的对外形态: 令牌打码
 *
 * `dsh web` 把连接令牌放在 URL 的 query 里 (`http://127.0.0.1:3080/?token=<32 位>`), 手机自己那条
 * WebView 靠它换一次 cookie 之后就改用 cookie, 但**那个字面串一旦被抄到别处就是一把钥匙**:
 * 工具结果是直接喂给模型的, 模型再写进聊天记录、日志、或者随手 `curl`, 令牌就跟着走出去了。
 *
 * 于是口径定成两句:
 *  - 应用内部要真连的时候用原串 ([HostStatus.Running.url]), 一个字节不改
 *  - 凡是给人看 / 给模型看的地方 ([LwOverlay] 的 `url` 与 `host` 两个字段) 一律走 [masked]
 *
 * 打码只盖值、不盖参数名: 看的人仍然知道"这是带令牌的那条地址", 但拿不到令牌本身
 */
internal object HostUrl {

    /** `token=` / `auth=` / `password=` / `key=` 后面那一段 (大小写都算, 停在 `&` 或 `#`) */
    private val SECRET_PARAM = Regex(
        "([?&](?:token|auth|password|key)=)([^&#\\s]+)",
        RegexOption.IGNORE_CASE,
    )

    /** 把 URL 里的密钥打成 `••••<后四位>`, 其余一个字不动 */
    fun masked(url: String): String = SECRET_PARAM.replace(url) { match ->
        val secret = match.groupValues[2]
        match.groupValues[1] + if (secret.length <= 4) "••••" else "••••" + secret.takeLast(4)
    }
}
