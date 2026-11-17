package io.github.yuloong07star.luwi.forge

import java.io.File
import java.util.zip.CRC32
import java.util.zip.Deflater
import java.util.zip.ZipFile

/**
 * 把一份 APK 重新排一遍, 让 `resources.arsc` **不压缩且 4 字节对齐** (2.8.1)
 *
 * 2026-11-17 真机装工坊成品时报的错:
 * `Failed parse during installPackageLI: Targeting R+ (version 30 and above) requires the resources.arsc of
 * installed APKs to be stored uncompressed and aligned on a 4-byte boundary`
 *
 * 这不是可选项 —— targetSdk >= 30 的包在这一步被系统直接拒, 而侧载用不上 `zipalign` 那个可执行件
 * (工具链里只有 aapt2 / d8 / apksigner). 于是自己写: 按 zipalign 的做法重写 zip, 只动两件事:
 *
 * - `resources.arsc` (以及 `lib` 下的 `.so`) 改成 STORED
 * - 所有 STORED 条目的数据起点用一段 extra field 垫到 4 的倍数 (ID 用 zipalign 的 `0xD935`)
 *
 * 其余条目原样 DEFLATE, 时间戳 / 名字 / CRC 都抄过去
 */
internal object ForgeAligner {

    private const val ALIGN = 4
    private const val LOCAL_HEADER = 30
    private const val CENTRAL_HEADER = 46
    private const val ZIP_ALIGN_ID = 0xD935

    /**
     * [source] → [target]
     *
     * @return 成功回 null, 失败回一句人话 (调用方把它当这一步的错)
     */
    fun align(source: File, target: File): String? {
        if (!source.isFile) return "要对齐的那份不在了: ${source.absolutePath}"
        target.parentFile?.mkdirs()
        target.delete()
        val records = mutableListOf<Record>()
        try {
            ZipFile(source).use { zip ->
                target.outputStream().buffered().use { raw ->
                    val out = Counting(raw)
                    zip.entries().asSequence().forEach { entry ->
                        if (entry.isDirectory) return@forEach
                        val name = entry.name
                        val bytes = zip.getInputStream(entry).use { it.readBytes() }
                        val store = name == "resources.arsc" || name.endsWith(".so")
                        val crc = CRC32().apply { update(bytes) }.value
                        val payload = if (store) bytes else deflate(bytes)
                        val nameBytes = name.toByteArray(Charsets.UTF_8)
                        val headerAt = out.count
                        val extraLen = if (store) paddingFor(headerAt, nameBytes.size) else 0
                        val extra = if (extraLen == 0) ByteArray(0) else ByteArray(extraLen).also {
                            it[0] = (ZIP_ALIGN_ID and 0xFF).toByte()
                            it[1] = ((ZIP_ALIGN_ID shr 8) and 0xFF).toByte()
                            it[2] = ((extraLen - 4) and 0xFF).toByte()
                            it[3] = (((extraLen - 4) shr 8) and 0xFF).toByte()
                        }
                        writeLocalHeader(
                            out = out,
                            name = nameBytes,
                            extra = extra,
                            method = if (store) 0 else 8,
                            crc = crc,
                            compressed = payload.size.toLong(),
                            size = bytes.size.toLong(),
                            time = entry.time,
                        )
                        out.write(nameBytes)
                        out.write(extra)
                        out.write(payload)
                        records += Record(
                            name = nameBytes,
                            method = if (store) 0 else 8,
                            crc = crc,
                            compressed = payload.size.toLong(),
                            size = bytes.size.toLong(),
                            time = entry.time,
                            offset = headerAt,
                        )
                    }
                    val centralAt = out.count
                    records.forEach { record -> writeCentral(out, record) }
                    writeEnd(out, centralAt, records.size)
                }
            }
        } catch (error: Throwable) {
            target.delete()
            return "对齐没做成: ${error.message ?: error.javaClass.simpleName}"
        }
        return null
    }

    private data class Record(
        val name: ByteArray,
        val method: Int,
        val crc: Long,
        val compressed: Long,
        val size: Long,
        val time: Long,
        val offset: Long,
    )

    /** DOS 时间那一对; 全零系统也认 (1980-01-01) */
    private fun dosTime(time: Long): Pair<Int, Int> {
        if (time <= 0L) return 0 to 0
        val calendar = java.util.Calendar.getInstance().apply { timeInMillis = time }
        val year = calendar.get(java.util.Calendar.YEAR)
        if (year < 1980) return 0 to 0
        val dosDate = ((year - 1980) shl 9) or
            ((calendar.get(java.util.Calendar.MONTH) + 1) shl 5) or
            calendar.get(java.util.Calendar.DAY_OF_MONTH)
        val dosTimeValue = (calendar.get(java.util.Calendar.HOUR_OF_DAY) shl 11) or
            (calendar.get(java.util.Calendar.MINUTE) shl 5) or
            (calendar.get(java.util.Calendar.SECOND) / 2)
        return dosTimeValue to dosDate
    }

    /** 垫到 4 的倍数: 返回 extra field 总长 (0 表示不用垫) */
    private fun paddingFor(offset: Long, nameLen: Int): Int {
        val base = offset + LOCAL_HEADER + nameLen
        val slack = ((ALIGN - (base + 4) % ALIGN) % ALIGN).toInt()
        return 4 + slack
    }

    private fun writeLocalHeader(
        out: Counting,
        name: ByteArray,
        extra: ByteArray,
        method: Int,
        crc: Long,
        compressed: Long,
        size: Long,
        time: Long,
    ) {
        val (dosTimeValue, dosDate) = dosTime(time)
        out.u32(0x04034b50)
        out.u16(20)
        out.u16(0x0800)
        out.u16(method)
        out.u16(dosTimeValue)
        out.u16(dosDate)
        out.u32(crc)
        out.u32(compressed)
        out.u32(size)
        out.u16(name.size)
        out.u16(extra.size)
    }

    private fun writeCentral(out: Counting, record: Record) {
        val (dosTimeValue, dosDate) = dosTime(record.time)
        out.u32(0x02014b50)
        out.u16(20)
        out.u16(20)
        out.u16(0x0800)
        out.u16(record.method)
        out.u16(dosTimeValue)
        out.u16(dosDate)
        out.u32(record.crc)
        out.u32(record.compressed)
        out.u32(record.size)
        out.u16(record.name.size)
        out.u16(0)
        out.u16(0)
        out.u16(0)
        out.u16(0)
        out.u32(0)
        out.u32(record.offset)
        out.write(record.name)
    }

    private fun writeEnd(out: Counting, centralAt: Long, count: Int) {
        val centralSize = out.count - centralAt
        out.u32(0x06054b50)
        out.u16(0)
        out.u16(0)
        out.u16(count)
        out.u16(count)
        out.u32(centralSize)
        out.u32(centralAt)
        out.u16(0)
    }

    private fun deflate(bytes: ByteArray): ByteArray {
        val deflater = Deflater(Deflater.BEST_COMPRESSION, true)
        try {
            deflater.setInput(bytes)
            deflater.finish()
            val out = java.io.ByteArrayOutputStream(maxOf(64, bytes.size / 2))
            val buffer = ByteArray(64 * 1024)
            while (!deflater.finished()) {
                val read = deflater.deflate(buffer)
                if (read <= 0) break
                out.write(buffer, 0, read)
            }
            return out.toByteArray()
        } finally {
            deflater.end()
        }
    }

    /** 数着写过多少字节的小包装 (对齐靠它) */
    private class Counting(private val delegate: java.io.OutputStream) {
        var count: Long = 0
            private set

        fun write(bytes: ByteArray) {
            delegate.write(bytes)
            count += bytes.size
        }

        fun u16(value: Int) {
            write(byteArrayOf((value and 0xFF).toByte(), ((value shr 8) and 0xFF).toByte()))
        }

        fun u32(value: Long) {
            write(
                byteArrayOf(
                    (value and 0xFF).toByte(),
                    ((value shr 8) and 0xFF).toByte(),
                    ((value shr 16) and 0xFF).toByte(),
                    ((value shr 24) and 0xFF).toByte(),
                ),
            )
        }
    }
}
