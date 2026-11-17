package io.github.yuloong07star.luwi.dev.api

import android.os.Binder
import android.os.Bundle
import android.os.IBinder
import android.os.Parcel

/**
 * 开发台让 Luwi 调的那一侧 (2.8.1)
 *
 * 两件事: `describe()` 自述 (接口版本 / 版本名 / 当前项目) 与 `invoke(op, args)` 干活. 信封一律是 `Bundle`.
 * 手写 Binder, 与 `:lwplugin-api` 同一个体例 —— 仓库里不许出现 `.aidl`
 *
 * 开发台这么用: `class ConsoleService : Service() { override fun onBind(...) = Console() }`,
 * 其中 `Console : IDevConsole()` 实现两个抽象方法.
 * Luwi 这么用: `IDevConsole.asInterface(binder)`
 */
abstract class IDevConsole : Binder() {

    /** 自述: `api` / `version` / `current` / `projects` */
    abstract fun describe(): Bundle

    /** 干一件: `ping` / `project.open` / `project.refresh` / `status` / `log.tail` */
    abstract fun invoke(op: String, args: Bundle?): Bundle

    override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
        when (code) {
            CODE_DESCRIBE, CODE_INVOKE -> data.enforceInterface(DevApi.DESCRIPTOR_CONSOLE)
            else -> return super.onTransact(code, data, reply, flags)
        }
        val result = when (code) {
            CODE_DESCRIBE -> describe()
            else -> invoke(data.readString().orEmpty(), data.readBundle(javaClass.classLoader))
        }
        if (reply != null) {
            reply.writeNoException()
            reply.writeBundle(result)
        }
        return true
    }

    companion object {
        const val CODE_DESCRIBE = 1
        const val CODE_INVOKE = 2

        /** 把一个远端 binder 包成本类的样子 */
        fun asInterface(binder: IBinder?): IDevConsole? = when {
            binder == null -> null
            binder is IDevConsole -> binder
            binder.queryLocalInterface(DevApi.DESCRIPTOR_CONSOLE) is IDevConsole ->
                binder.queryLocalInterface(DevApi.DESCRIPTOR_CONSOLE) as IDevConsole
            else -> Proxy(binder)
        }
    }

    private class Proxy(private val remote: IBinder) : IDevConsole() {
        override fun describe(): Bundle = transact(CODE_DESCRIBE) { }

        override fun invoke(op: String, args: Bundle?): Bundle =
            transact(CODE_INVOKE) {
                writeString(op)
                writeBundle(args)
            }

        private inline fun transact(code: Int, write: Parcel.() -> Unit): Bundle {
            val data = Parcel.obtain()
            val reply = Parcel.obtain()
            return try {
                data.writeInterfaceToken(DevApi.DESCRIPTOR_CONSOLE)
                data.write()
                remote.transact(code, data, reply, 0)
                reply.readException()
                reply.readBundle(javaClass.classLoader)
                    ?: DevApi.result(false, "开发台没有回东西 (code $code)", "EMPTY")
            } finally {
                reply.recycle()
                data.recycle()
            }
        }
    }
}
