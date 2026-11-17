/**
 * 开发台那一套的接口 (2.8.1)
 *
 * 里面只有两份手写 Binder 与一份常量 —— **零依赖, 零资源**, 于是 app / 安卓开发工具 / 开发台三处引的是同一个
 * 模块, "两侧同一份接口"不是一句口号: 描述符、transaction code、权限名与 action 只有一处定义
 *
 * 与 `:lwplugin-api` 同一个体例: 仓库里不许出现 `.aidl` (生成 Java 会把 AGP 那条坏掉的资源管线拉回构建)
 */
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "io.github.yuloong07star.luwi.dev.api"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        minSdk = 33
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    kotlin {
        jvmToolchain(21)
    }
}
