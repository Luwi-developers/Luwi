"""把主人给的图标集图做成 Android 要的那几档资源 (2026-11-22, 图标切换)

与 `make-icons.py` 的分工: 那份是**内置**那套 (鲸尾, 白底单色, 靠"亮度当墨量"抠 alpha);
这一份吃**已经带 alpha 的彩色插画**, 于是不走抠图, 直接按 alpha 的 bbox 裁紧再缩进画布。
两边的背景渐变 / 通知内缩 / 密度档是同一把尺子 (常量照抄, 改动要两边一起看)。

为什么每套要两套尺寸形状:
  1. `ic_mark_<id>.png` 给应用内那几处 (球 / 开屏 / 组件 / 门户头像) —— 满幅紧裁, 由代码按
     `markInkRatio` 缩, 不再留 keyline 安全区
  2. `ic_launcher_<id>*` 给桌面图标 —— 必须留安全区 (自适应图标的 108dp 画布里只有中间 66dp 保证
     不被裁), 所以内容只占 0.62

用法:
  python tools/make-icon-sets.py
  python tools/make-icon-sets.py --source tools/brand/luwi-maid.png --id maid --res app/src/main/res

生成 (以 id = maid 为例):
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_maid.webp            方形 (渐变打底 + 内容)
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_maid_round.webp      圆
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_maid_foreground.webp 自适应前景 (108dp 画布)
  mipmap-anydpi/ic_launcher_maid.xml                           自适应图标
  drawable-nodpi/ic_mark_maid.png                              应用内标记 (透明底, 紧裁)
  drawable-nodpi/ic_launcher_maid_mono.png                     单色层 (alpha 白模)
  drawable-nodpi/ic_notification_maid.png                      通知小图标 (24dp 白模)

**不进构建**: 产物提交进仓库, Gradle 不认识这个脚本, 换图时手工跑一次
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - 只在没装 Pillow 的机器上会走到
    sys.exit('this script needs Pillow: python -m pip install Pillow')

# Android 的密度档与它对应的传统启动器图标边长, 单位是像素 (与 `make-icons.py` 同一份)
DENSITIES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}

# 自适应图标的前景画布是 108dp, 于是各密度下的像素边长是 108 * (dpi / 160)
FOREGROUND_PX = {
    'mdpi': 108,
    'hdpi': 162,
    'xhdpi': 216,
    'xxhdpi': 324,
    'xxxhdpi': 432,
}

# 自适应图标的安全区是中间 66/108 = 0.611; 内容按高度占 0.62 正好贴着那圈不出界
LAUNCHER_CONTENT = 0.62

# 应用内标记: 内容占方形画布的 0.96, 四周留 2% 透明边 (球 / 开屏 / 门户再按 inkRatio 缩一次)
MARK_CONTENT = 0.96

# 单色层与通知小图标: 通知那 24dp 里图案只占中间这一段 (与 `make-icons.py` 的 0.12 同一个数)
MONO_CONTENT = 0.62
NOTIFICATION_INSET = 0.12

# 应用内标记那张图的边长: 1024 够 3x 屏上任何一处显示, 再大只是占包体
MARK_PX = 1024

# 单色层按 xxxhdpi 的 108dp 出图 (432), 系统自己缩
MONO_PX = 432

# 通知小图标取密度最高的那一档就够 (系统自己按屏幕缩放), 与 `make-icons.py` 同一个数
NOTIFICATION_PX = 96

# 背景渐变与 `drawable/ic_launcher_background.xml` 同一条 ((0,0) 到 (108,108))
BACKGROUND_STOPS = (
    (0.14, (0xD4, 0xDB, 0xE9)),
    (0.49, (0xFB, 0xFB, 0xFB)),
    (0.83, (0xE1, 0xE6, 0xEE)),
)


def content_box(image):
    """内容实际占的那块矩形 (alpha 非零的 bbox), 兜底是整张图"""
    alpha = image.convert('RGBA').split()[3]
    return alpha.getbbox() or (0, 0, image.width, image.height)


def fitted(image, size, height_ratio):
    """裁紧 → 按高度占比缩放 → 居中放进 size x size 的透明画布"""
    patch = image.convert('RGBA').crop(content_box(image))
    target_h = max(1, round(size * height_ratio))
    target_w = max(1, round(patch.width * target_h / patch.height))
    if target_w > size:
        # 横图 (这一套不会出现, 但要挡一下): 先按宽度收进画布
        target_w = size
        target_h = max(1, round(patch.height * target_w / patch.width))
    resized = patch.resize((target_w, target_h), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - target_w) // 2, (size - target_h) // 2))
    return canvas


def background(size):
    """自适应图标那条背景渐变 (与 `make-icons.py` 逐行同一条算式)"""
    stops = BACKGROUND_STOPS
    data = bytearray()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            if t <= stops[0][0]:
                colour = stops[0][1]
            elif t >= stops[-1][0]:
                colour = stops[-1][1]
            else:
                colour = stops[-1][1]
                for index in range(len(stops) - 1):
                    low, high = stops[index], stops[index + 1]
                    if low[0] <= t <= high[0]:
                        blend = (t - low[0]) / (high[0] - low[0])
                        colour = tuple(
                            round(low[1][channel] + (high[1][channel] - low[1][channel]) * blend)
                            for channel in range(3)
                        )
                        break
            data.extend(colour)
    return Image.frombytes('RGB', (size, size), bytes(data))


def launcher_icon(image, size, round_corners):
    """一档位图回退: 渐变打底 + 内容 (圆那份当场裁, 不让系统裁)"""
    icon = background(size).convert('RGBA')
    content = fitted(image, size, LAUNCHER_CONTENT)
    icon.alpha_composite(content)
    if round_corners:
        circle = Image.new('L', (size, size), 0)
        ImageDraw.Draw(circle).ellipse((0, 0, size - 1, size - 1), fill=255)
        icon.putalpha(circle)
    return icon


def monochrome(image, size, height_ratio):
    """单色层: 内容自己的 alpha 当遮罩, 颜色刷白 (系统会按主题再染一次)"""
    content = fitted(image, size, height_ratio)
    mask = content.split()[3]
    white = Image.new('RGBA', content.size, (255, 255, 255, 255))
    white.putalpha(mask)
    return white


def notification(image, size, inset):
    """通知小图标: 与 `make-icons.py` 的 `glyph()` 同一套 (内缩后居中) 的白模"""
    patch = image.convert('RGBA').crop(content_box(image))
    inner = max(1, round(size * (1 - 2 * inset)))
    scale = inner / max(patch.width, patch.height)
    target = (max(1, round(patch.width * scale)), max(1, round(patch.height * scale)))
    patch = patch.resize(target, Image.LANCZOS)
    mask = patch.split()[3]
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ink = Image.new('RGBA', target, (255, 255, 255, 255))
    ink.putalpha(mask)
    canvas.paste(ink, ((size - target[0]) // 2, (size - target[1]) // 2), ink)
    return canvas


def adaptive_xml(name, background_ref, foreground_ref, mono_ref):
    """自适应图标: 背景沿用内置那一份渐变, 只换前景与单色层"""
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!-- 图标集「' + name + '」的自适应图标 (2026-11-22, 设置 -> 外观 -> Luwi 图标)\n'
        '\n'
        '     由 tools/make-icon-sets.py 生成, 别手改: 换图重跑那一步\n'
        '     背景直接复用内置那一份渐变 (`ic_launcher_background`), 于是两套只在图案上不同 -->\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="' + background_ref + '" />\n'
        '    <foreground android:drawable="' + foreground_ref + '" />\n'
        '    <monochrome android:drawable="' + mono_ref + '" />\n'
        '</adaptive-icon>\n'
    )


def main():
    parser = argparse.ArgumentParser(description='Render one switchable Luwi icon set')
    parser.add_argument('--source', required=True, help='the RGBA artwork this set is rendered from')
    parser.add_argument('--id', required=True, help='resource suffix, e.g. maid -> ic_mark_maid')
    parser.add_argument('--res', default='app/src/main/res', help='where the resources live')
    parser.add_argument('--preview', metavar='DIR', help='write PNG copies of everything here, for looking at')
    arguments = parser.parse_args()

    source_path = Path(arguments.source)
    if not source_path.is_file():
        sys.exit(f'no such source image: {source_path}')
    res = Path(arguments.res)
    if not res.is_dir():
        sys.exit(f'no such resource directory: {res}')
    set_id = arguments.id
    if not set_id.replace('-', '').isalnum():
        sys.exit(f'bad set id: {set_id}')

    source = Image.open(source_path).convert('RGBA')
    box = content_box(source)
    print(f'source {source_path} {source.width}x{source.height}')
    print(f'  content box {box} = {box[2] - box[0]}x{box[3] - box[1]}')

    preview = Path(arguments.preview) if arguments.preview else None
    if preview:
        preview.mkdir(parents=True, exist_ok=True)

    # 一、应用内标记: 透明底、内容占 0.96 (球 / 开屏 / 组件 / 门户共用一份)
    mark = fitted(source, MARK_PX, MARK_CONTENT)
    mark_dir = res / 'drawable-nodpi'
    mark_dir.mkdir(parents=True, exist_ok=True)
    mark_path = mark_dir / f'ic_mark_{set_id}.png'
    mark.save(mark_path, 'PNG', optimize=True)
    print(f'  {mark_path} {MARK_PX}x{MARK_PX}')
    if preview:
        mark.save(preview / f'ic_mark_{set_id}.png')

    # 二、传统位图回退 (方形 + 圆形), 五档
    for density, size in DENSITIES.items():
        directory = res / f'mipmap-{density}'
        directory.mkdir(parents=True, exist_ok=True)
        for suffix, rounded in (('', False), ('_round', True)):
            icon = launcher_icon(source, size, rounded)
            target = directory / f'ic_launcher_{set_id}{suffix}.webp'
            icon.save(target, 'WEBP', lossless=True, quality=100)
            print(f'  {target} {size}x{size}')
            if preview:
                icon.save(preview / f'{density}-ic_launcher_{set_id}{suffix}.png')

    # 三、自适应前景 (108dp 画布, 内容 0.62)
    for density, size in FOREGROUND_PX.items():
        directory = res / f'mipmap-{density}'
        directory.mkdir(parents=True, exist_ok=True)
        foreground = fitted(source, size, LAUNCHER_CONTENT)
        target = directory / f'ic_launcher_{set_id}_foreground.webp'
        foreground.save(target, 'WEBP', lossless=True, quality=100)
        print(f'  {target} {size}x{size}')
        if preview:
            foreground.save(preview / f'{density}-ic_launcher_{set_id}_foreground.png')

    # 四、单色层与通知小图标 (都是白模, 系统按主题/模板染色)
    mono_path = mark_dir / f'ic_launcher_{set_id}_mono.png'
    monochrome(source, MONO_PX, LAUNCHER_CONTENT).save(mono_path, 'PNG', optimize=True)
    print(f'  {mono_path} {MONO_PX}x{MONO_PX}')

    notification_path = mark_dir / f'ic_notification_{set_id}.png'
    notification(source, NOTIFICATION_PX, NOTIFICATION_INSET).save(notification_path, 'PNG', optimize=True)
    print(f'  {notification_path} {NOTIFICATION_PX}x{NOTIFICATION_PX}')
    if preview:
        notification(source, NOTIFICATION_PX, NOTIFICATION_INSET).save(preview / f'ic_notification_{set_id}.png')

    # 五、自适应图标那份 xml
    anydpi = res / 'mipmap-anydpi'
    anydpi.mkdir(parents=True, exist_ok=True)
    xml_path = anydpi / f'ic_launcher_{set_id}.xml'
    xml_path.write_text(
        adaptive_xml(
            set_id,
            '@drawable/ic_launcher_background',
            f'@mipmap/ic_launcher_{set_id}_foreground',
            f'@drawable/ic_launcher_{set_id}_mono',
        ),
        encoding='utf-8',
    )
    print(f'  {xml_path}')

    print(f'done, now point IconTheme at the {set_id} set and build')


if __name__ == '__main__':
    main()
