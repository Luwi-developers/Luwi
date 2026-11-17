/**
 * 「Luwi 开发台」伴侣 APK (2.8.1)
 *
 * 它是**看得见的那一半**: 项目列表 / 元信息 / 图标 / 日志尾 / 构建进度. 只读项目目录, 一个字都不改 ——
 * 编辑由 Luwi 的 agent 与文件工具负责; 它唯一写的是自己的 `current.json`
 *
 * 与 Luwi 的连接是一条手写 Binder (`lw-devconsole/1`, 见 `:lwdev-api`), 护住 Service 的是 Luwi 声明的
 * 那条 signature 级权限. 进度不推事件, 只读 `<项目>/.lwforge/` 里那两个文件 (`progress.json` / `build.log`)
 */
plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "io.github.yuloong07star.luwi.devconsole"
    compileSdk {
        version = release(37)
    }

    val debugKeystore = providers.environmentVariable("LW_DEBUG_KEYSTORE")
        .orElse(providers.environmentVariable("ANDROID_SDK_HOME").map { "$it/.android/debug.keystore" })
        .getOrElse(rootProject.file("../.android/debug.keystore").absolutePath)
    signingConfigs {
        getByName("debug") {
            storeFile = file(debugKeystore)
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    defaultConfig {
        applicationId = "io.github.yuloong07star.luwi.devconsole"
        minSdk = 33
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    kotlin {
        jvmToolchain(21)
    }
}

dependencies {
    implementation(project(":lwdev-api"))
}
