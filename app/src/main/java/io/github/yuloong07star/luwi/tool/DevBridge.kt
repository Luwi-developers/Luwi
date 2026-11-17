package io.github.yuloong07star.luwi.tool

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import android.util.Log
import io.github.yuloong07star.luwi.dev.api.DevApi
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 连两件伴侣软件的那一条公共路 (2.8.1)
 *
 * 三道检查, 一个都不省:
 *
 * 1. **装没装**: 没装就回"先下…", 不去绑
 * 2. **签名对不对**: `checkSignatures` 与 Luwi 比一遍 —— Service 那条 `signature` 级权限本来就会挡,
 *    但"绑不上"与"知道为什么绑不上"是两件事, 后者由这一句负责
 * 3. **绑得上绑不上**: 1500 ms 的预算, 超时回一句原因 (伴侣进程没起 / 被系统限流)
 */
internal object DevBridge {

    private const val TAG = "LwDevBridge"

    /** 一次绑定最多等这么久 */
    private const val BIND_TIMEOUT_MS = 1_500L

    /** 这个包现在装着没有 */
    fun installed(context: Context, packageName: String): Boolean =
        runCatching { context.packageManager.getPackageInfo(packageName, 0) }.isSuccess

    /** 签名对不对; 对就是 null */
    fun signatureProblem(context: Context, packageName: String): String? {
        if (!installed(context, packageName)) return "$packageName 还没装: 到设置 → 开发里下一下"
        val match = runCatching {
            context.packageManager.checkSignatures(context.packageName, packageName)
        }.getOrDefault(PackageManager.SIGNATURE_NO_MATCH)
        return if (match == PackageManager.SIGNATURE_MATCH) {
            null
        } else {
            "$packageName 的签名与 Luwi 不是同一张证书, 这一条连不上 (装的是别人改过的包?)"
        }
    }

    /**
     * 绑上 → 用一下 → 解绑
     *
     * @param onService 拿远端 binder 干活; 回一份 `Bundle` 给人看
     */
    fun <T> with(
        context: Context,
        packageName: String,
        action: String,
        adapter: (IBinder) -> T?,
        onService: (T) -> android.os.Bundle,
    ): android.os.Bundle {
        signatureProblem(context, packageName)?.let { return DevApi.result(false, it, "NOT_READY") }
        val latch = CountDownLatch(1)
        val binder = java.util.concurrent.atomic.AtomicReference<IBinder?>(null)
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                binder.set(service)
                latch.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName?) {
                Log.i(TAG, "$packageName disconnected")
            }
        }
        val intent = Intent(action).setPackage(packageName)
        val bound = runCatching {
            context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }.getOrElse {
            return DevApi.result(false, "绑不上 $packageName: ${it.message ?: it.javaClass.simpleName}", "BIND_FAILED")
        }
        if (!bound) return DevApi.result(false, "系统不肯绑 $packageName (service 的 intent-filter 对不上?)", "BIND_REFUSED")
        return try {
            if (!latch.await(BIND_TIMEOUT_MS, TimeUnit.MILLISECONDS) || binder.get() == null) {
                DevApi.result(false, "$packageName 没在 ${BIND_TIMEOUT_MS}ms 内连上", "TIMEOUT")
            } else {
                val service = adapter(binder.get()!!)
                    ?: return DevApi.result(false, "$packageName 回了个不认识的 binder", "BAD_BINDER")
                onService(service)
            }
        } catch (error: Throwable) {
            DevApi.result(false, "调 $packageName 失败: ${error.message ?: error.javaClass.simpleName}", "FAILED")
        } finally {
            runCatching { context.unbindService(connection) }
        }
    }
}
