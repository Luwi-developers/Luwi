package io.github.yuloong07star.luwi.channel

import android.util.Log
import java.io.File

/**
 * A picture of the phone's own screen
 *
 * 我们自己的虚拟屏不再走这里: 它们的画面在 app 进程的 ImageReader 里本来就有一份缓存 (见
 * [FrameCache]), 拍一张只是把那一帧写下来, 既不跑 `screencap` 也不用跨进程传文件。`screencap` 只
 * 留给 display 0 —— 那是唯一需要 shell uid 才拍得到的东西, 也是唯一没有别的取帧路径的屏
 *
 * The default display is the one display whose compositor id is not worth looking up: `-d` names a
 * mode the phone happens to be in, while saying nothing is the phone as it is now
 */
internal class LwCapture {

    /**
     * Capture the phone's own screen
     *
     * @returns an empty string once a picture is there, otherwise why there is none
     */
    fun capturePrimary(path: String): String =
        written(run(SCREENCAP, "-p", fresh(path)), path, "the phone's own screen")

    /**
     * Clear what an earlier capture left at this path, and answer the path
     *
     * `screencap` writes nothing at all when it fails, so without this the previous screen's
     * picture would be read back as this call's answer - and a stale screen is worse than no
     * screen, because nothing about the file says it is old
     */
    private fun fresh(path: String): String {
        File(path).delete()
        return path
    }

    /**
     * Say why there is no picture, and clean up when there is one
     *
     * @returns an empty string once the file has bytes in it, otherwise the sentence to hand back
     */
    private fun written(outcome: String, path: String, what: String): String {
        val size = File(path).length()
        if (size <= 0L) {
            Log.w(TAG, "the device wrote no picture for $what: $outcome")
            val said = outcome.trim().lines().firstOrNull { it.isNotBlank() }.orEmpty()
            return "the screen is there but the device wrote no picture of it: nothing has drawn on it" +
                " yet, so launch an app on that screen and take the picture again" +
                (if (said.isEmpty()) "" else " (screencap said: $said)")
        }
        Log.i(TAG, "captured $what into $path, $size bytes")
        return ""
    }

    /** Run a toolbox command and read what it said, empty when it could not start at all */
    private fun run(vararg command: String): String {
        val process = try {
            ProcessBuilder(*command).redirectErrorStream(true).start()
        } catch (error: Exception) {
            Log.w(TAG, "could not run ${command.first()}", error)
            return ""
        }
        return try {
            process.inputStream.bufferedReader().use { it.readText() }
        } catch (error: Exception) {
            Log.w(TAG, "could not read what ${command.first()} said", error)
            ""
        }
    }

    private companion object {
        const val TAG = "LwCapture"

        const val SCREENCAP = "/system/bin/screencap"
    }
}
