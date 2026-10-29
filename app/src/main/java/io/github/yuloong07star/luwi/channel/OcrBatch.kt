package io.github.yuloong07star.luwi.channel

/**
 * 识别任务的批量分组
 *
 * 识别模型每跑一次有一笔固定开销 (实测 48x320 上一行要 10~14 ms, 而这一行的字往往只有几个),
 * 所以"一次认几条"比"一条一次"省得多。分组只决定哪几段一起送进去, 补齐由调用方按零图垫上
 *
 * 抽成纯函数是为了能在这里量边界: 最后一组不满、总数比 batch 小、batch 为 1 时都必须与逐段
 * 跑完全等价
 */
object OcrBatch {

    /** 把 `total` 段按 `batch` 分组, 回每组的 0-based 下标 (闭区间); 空输入回空表 */
    fun groups(total: Int, batch: Int): List<IntRange> {
        if (total <= 0 || batch <= 0) return emptyList()
        val result = ArrayList<IntRange>((total + batch - 1) / batch)
        var start = 0
        while (start < total) {
            val end = minOf(start + batch, total) - 1
            result.add(start..end)
            start = end + 1
        }
        return result
    }
}
