package io.github.yuloong07star.luwi.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import io.github.yuloong07star.luwi.R
import io.github.yuloong07star.luwi.voice.ModelSetup
import io.github.yuloong07star.luwi.voice.SpeechModelDownload
import io.github.yuloong07star.luwi.wake.WakeWordDownload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.yukonga.miuix.kmp.basic.ButtonDefaults
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.MiuixTheme.colorScheme

/**
 * 模型说明窗 (2026-10-28 主人: 每次打开应用缺模型都提醒一次, 最多 3 次, 3 次后不再检测)
 *
 * 它自己判断、自己收口: 次数在 [ModelSetup.beginPrompt] 里加, **出现那一刻就算一次**, 于是进程
 * 中途被杀也不会白弹; 同一个进程只弹一次 (Activity 重建不算新的一次打开)。下载由
 * [ModelSetup.downloadMissing] 串起来, 两套下载器各自汇报进度; 下完唤醒词会补词表并按许可起监听
 */
@Composable
internal fun ModelSetupPrompt() {
    val context = LocalContext.current
    var prompt by remember { mutableStateOf<ModelSetup.Prompt?>(null) }
    LaunchedEffect(Unit) {
        // 先看次数再检测; 到 3 次之后 beginPrompt 连磁盘都不碰
        val asked = withContext(Dispatchers.IO) { ModelSetup.beginPrompt(context) }
        if (asked != null) prompt = asked
    }
    prompt?.let { asking ->
        ModelSetupDialog(
            needs = asking.needs,
            attempt = asking.count,
            onDismiss = { prompt = null },
        )
    }
}

@Composable
private fun ModelSetupDialog(needs: List<ModelSetup.Need>, attempt: Int, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var said by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf(false) }
    var wakeReady by remember { mutableStateOf(ModelSetup.Need.WAKE !in needs) }
    var speechReady by remember { mutableStateOf(ModelSetup.Need.SPEECH !in needs) }
    var microphone by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        microphone = granted
    }
    val done = wakeReady && speechReady
    val download = {
        if (!busy) {
            busy = true
            failed = false
            said = ""
            scope.launch {
                val outcome = withContext(Dispatchers.IO) {
                    runCatching { ModelSetup.downloadMissing(context) }
                }
                busy = false
                outcome.onSuccess { text ->
                    said = text
                    wakeReady = WakeWordDownload.present(context)
                    speechReady = SpeechModelDownload.present(context)
                    if (wakeReady && speechReady) failed = false
                }.onFailure { error ->
                    failed = true
                    said = error.message ?: error.toString()
                    // 失败可能停在下唤醒词之后、下语音之前: 已经完成的那个要如实显示成"已就位"
                    wakeReady = WakeWordDownload.present(context)
                    speechReady = SpeechModelDownload.present(context)
                }
            }
        }
    }
    val wakeBusy = WakeWordDownload.phase == WakeWordDownload.Phase.DOWNLOADING
    val speechBusy = SpeechModelDownload.phase == SpeechModelDownload.Phase.DOWNLOADING
    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val scrim = remember { MutableInteractionSource() }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.4f))
                .clickable(interactionSource = scrim, indication = null) { if (!busy) onDismiss() },
            contentAlignment = Alignment.Center,
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 28.dp)
                    .clickable(interactionSource = scrim, indication = null) {},
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.72f).dp)
                        .verticalScroll(rememberScrollState())
                        .padding(24.dp),
                ) {
                    Text(
                        text = stringResource(R.string.model_setup_title),
                        style = MiuixTheme.textStyles.title3,
                    )
                    Text(
                        text = stringResource(R.string.model_setup_summary),
                        style = MiuixTheme.textStyles.body2,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                    Text(
                        text = stringResource(
                            R.string.model_setup_attempt,
                            attempt,
                            ModelSetup.MAX_PROMPTS,
                        ),
                        style = MiuixTheme.textStyles.footnote1,
                        color = colorScheme.onSurfaceVariantActions,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    ModelRow(
                        title = stringResource(R.string.model_setup_wake),
                        note = stringResource(
                            R.string.model_setup_wake_note,
                            mb(ModelSetup.bytesOf(ModelSetup.Need.WAKE)),
                        ),
                        ready = wakeReady,
                    )
                    if (busy && wakeBusy) {
                        Text(
                            text = stringResource(
                                R.string.model_setup_progress,
                                mb(WakeWordDownload.received),
                                mb(WakeWordDownload.total),
                            ),
                            style = MiuixTheme.textStyles.footnote1,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    ModelRow(
                        title = stringResource(R.string.model_setup_speech),
                        note = stringResource(
                            R.string.model_setup_speech_note,
                            mb(ModelSetup.bytesOf(ModelSetup.Need.SPEECH)),
                        ),
                        ready = speechReady,
                    )
                    if (busy && speechBusy) {
                        Text(
                            text = stringResource(
                                R.string.model_setup_progress,
                                mb(SpeechModelDownload.received),
                                mb(SpeechModelDownload.total),
                            ),
                            style = MiuixTheme.textStyles.footnote1,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    if (!microphone) {
                        Text(
                            text = stringResource(R.string.model_setup_need_mic),
                            style = MiuixTheme.textStyles.footnote1,
                            color = colorScheme.error,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                        TextButton(
                            text = stringResource(R.string.model_setup_mic_action),
                            onClick = {
                                micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (said.isNotBlank()) {
                        Text(
                            text = said,
                            style = MiuixTheme.textStyles.footnote1,
                            color = if (failed) colorScheme.error else colorScheme.onSurfaceVariantActions,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                    if (done && !busy) {
                        Text(
                            text = stringResource(R.string.model_setup_done),
                            style = MiuixTheme.textStyles.footnote1,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                    TextButton(
                        text = when {
                            busy -> stringResource(R.string.model_setup_downloading)
                            done -> stringResource(R.string.button_confirm)
                            else -> stringResource(R.string.model_setup_download)
                        },
                        onClick = { if (done) onDismiss() else download() },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 16.dp),
                        colors = ButtonDefaults.textButtonColorsPrimary(),
                    )
                    TextButton(
                        text = stringResource(R.string.model_setup_later),
                        onClick = { if (!busy) onDismiss() },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

/** 一行: 模型名 + 体积 / 用途 + 现在的状态 (两行字, 只读) */
@Composable
private fun ModelRow(title: String, note: String, ready: Boolean) {
    Column(modifier = Modifier.padding(top = 14.dp)) {
        Text(text = title, style = MiuixTheme.textStyles.body1)
        Text(text = note, style = MiuixTheme.textStyles.footnote1)
        Text(
            text = if (ready) {
                stringResource(R.string.model_setup_ready)
            } else {
                stringResource(R.string.model_setup_missing)
            },
            style = MiuixTheme.textStyles.footnote1,
            color = if (ready) colorScheme.primary else colorScheme.onSurfaceVariantActions,
        )
    }
}

private fun mb(bytes: Long): String = "%.1f MB".format(bytes / 1024.0 / 1024.0)
