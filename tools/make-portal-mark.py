"""把品牌标记做成门户空态要的那张透明 PNG, 并把它内嵌进门户的 client.js

为什么内嵌: 门户那一层跑在 WebView 里, 页面是 host 发出来的 http 响应, 拿不到 app 的
assets / drawable; 而 dsh 的客户端模块只认单文件 (`package.json` 的 `dsh.client` 指向
`./lib/client.js`), 同目录再放一张 png 也不会被装载。192px 的图只有二十几 KB, 转成
base64 直接写成常量最省事

源图与 Android 那三处图标同一份 (`tools/brand/luwi-mark.png`), 抠法复用 `make-icons.py`
的"亮度当墨量": 蓝那一片亮度 135, 于是 alpha = (255 - L) / (255 - 135), 纸纹那点雾清掉

用法:
  python tools/make-portal-mark.py
  python tools/make-portal-mark.py --source <mark.png> --client presets/luwi-portal/lib/client.js

产物: `presets/luwi-portal/lib/client.js` 里 `MARK_PNG:BEGIN` / `MARK_PNG:END` 之间那一段
被就地替换, 其余一个字节都不动。再跑一次只替换同一段 (幂等)
"""

import argparse
import base64
import io
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - 只在没装 Pillow 的机器上会走到
    sys.exit('this script needs Pillow: python -m pip install Pillow')

# 与 `make-icons.py` 同一把尺子: 品牌图是"白纸 + 一层蓝", 蓝自己亮度 135
INK_LUMA = 135.0
ALPHA_FLOOR = 0.06

# 标记自己的颜色 (品牌图里那层蓝, 与 `make-icons.py` 的 MARK_RGB 同一个数)
MARK_RGB = (0x01, 0xB4, 0xFF)

# 门户里最大那一处显示 96 CSS px, 高密度屏按 2x 出图就够 (再大只是白白撑大 client.js)
MARK_PX = 192

# 图在画布上占多宽: 门户不是桌面图标, 没有 keyline 安全区要留, 于是贴着裁切框出 (0.82),
# 96px 显示时那一圈水环才够饱满; Android 那三处用的 0.46 是图标安全区, 别拿过来
INK_WIDTH = 0.82

BEGIN = '/* MARK_PNG:BEGIN */'
END = '/* MARK_PNG:END */'


def mark_mask(image):
    """哪几个像素是标记 (一张灰度遮罩), 与 `make-icons.py` 同一条算式"""
    flat = Image.alpha_composite(
        Image.new('RGBA', image.size, (255, 255, 255, 255)), image.convert('RGBA'))
    grey = flat.convert('L')
    table = [
        0 if value > 255 - ALPHA_FLOOR * (255 - INK_LUMA)
        else round(min(1.0, (255 - value) / (255 - INK_LUMA)) * 255)
        for value in range(256)
    ]
    return grey.point(table, 'L')


def render(mask, size):
    """抠出来, 按墨迹宽度缩放进一块 size x size 的透明画布, 并染成品牌蓝"""
    box = mask.getbbox() or (0, 0, mask.width, mask.height)
    patch = mask.crop(box)
    inner = max(1, round(size * INK_WIDTH))
    height = max(1, round(patch.height * inner / patch.width))
    patch = patch.resize((inner, height), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ink = Image.new('RGBA', (inner, height), MARK_RGB + (255,))
    ink.putalpha(patch)
    canvas.alpha_composite(ink, ((size - inner) // 2, (size - height) // 2))
    return canvas


def main():
    parser = argparse.ArgumentParser(description='Embed the Luwi mark into the portal client as a data URL')
    parser.add_argument('--source', default='tools/brand/luwi-mark.png', help="Luwi's own mark")
    parser.add_argument('--client', default='presets/luwi-portal/lib/client.js', help='the portal client')
    parser.add_argument('--size', type=int, default=MARK_PX, help='square side in pixels')
    parser.add_argument('--preview', metavar='PATH', help='also write the PNG here, for looking at')
    arguments = parser.parse_args()

    source_path = Path(arguments.source)
    client_path = Path(arguments.client)
    if not source_path.is_file():
        sys.exit(f'no such source image: {source_path}')
    if not client_path.is_file():
        sys.exit(f'no such client: {client_path}')

    source = Image.open(source_path)
    mask = mark_mask(source)
    box = mask.getbbox() or (0, 0, source.width, source.height)
    print(f'source {source_path} {source.width}x{source.height}')
    print(f'  mark box {box} = {box[2] - box[0]}x{box[3] - box[1]}')

    image = render(mask, arguments.size)
    buffer = io.BytesIO()
    image.save(buffer, 'PNG', optimize=True)
    png = buffer.getvalue()
    encoded = base64.b64encode(png).decode('ascii')
    print(f'  png {arguments.size}x{arguments.size} {len(png)} bytes, base64 {len(encoded)} chars')

    if arguments.preview:
        image.save(arguments.preview)
        print(f'  preview {arguments.preview}')

    body = (
        BEGIN + '\n'
        '    /** 品牌标记: 由 tools/make-portal-mark.py 生成, 别手改 (改了重跑就覆盖回来) */\n'
        "    var MARK_PNG = 'data:image/png;base64," + encoded + "'\n"
        '    ' + END
    )
    text = client_path.read_text(encoding='utf-8')
    pattern = re.compile(re.escape(BEGIN) + r'.*?' + re.escape(END), re.S)
    if pattern.search(text) is None:
        sys.exit(f'{client_path}: no {BEGIN} / {END} pair to replace')
    updated = pattern.sub(lambda _match: body, text, count=1)
    if updated == text:
        print('  client unchanged')
    else:
        client_path.write_text(updated, encoding='utf-8')
        print(f'  client {client_path} updated')


if __name__ == '__main__':
    main()
