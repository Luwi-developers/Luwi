"""Find the bytes in an APK that no zip entry accounts for.

用法: python tools/apk-bytes.py <path/to/app.apk> [--max-hole 65536]

`packageDebug` 会在旧 APK 上原地改写, 留下的空洞可达几十 MB (2.8.0 #26 实测
49,321,414 + 11,738,695 bytes)。干净构建的最大一条只应几 KB, 所以缺省把
"最大一条 > 64 KiB" 判 FAIL 并以非零退出码结束; 发布脚本 / 发版闸看见非零就不许发。
只做诊断时传 `--max-hole` 调大 (或者 `--no-fail` 关掉退出码)。
"""
import argparse
import os
import sys
import zipfile

DEFAULT_MAX_HOLE = 64 * 1024

parser = argparse.ArgumentParser(description="量 APK 里没有 zip 条目归属的字节")
parser.add_argument("path", help="要量的 APK")
parser.add_argument(
    "--max-hole",
    type=int,
    default=DEFAULT_MAX_HOLE,
    help=f"最大一条无归属区间的上限, 缺省 {DEFAULT_MAX_HOLE} 字节",
)
parser.add_argument("--no-fail", action="store_true", help="只打印, 不按阈值改退出码")
args = parser.parse_args()

path = args.path
size = os.path.getsize(path)
z = zipfile.ZipFile(path)
infos = sorted(z.infolist(), key=lambda i: i.header_offset)

total_c = sum(i.compress_size for i in infos)
total_u = sum(i.file_size for i in infos)
print(f"file            : {size:>12,} bytes  ({size / 1024 / 1024:.1f} MiB)")
print(f"sum compressed  : {total_c:>12,} bytes  ({total_c / 1024 / 1024:.1f} MiB)")
print(f"sum uncompressed: {total_u:>12,} bytes  ({total_u / 1024 / 1024:.1f} MiB)")
print(f"central dir at  : {z.start_dir:>12,}")
print(f"entries         : {len(infos)}")
print()

# Walk the local headers in file order and look for anything not covered by an entry.
holes = []
cursor = 0
for info in infos:
    start = info.header_offset
    if start > cursor:
        holes.append((cursor, start - cursor, "before " + info.filename))
    header = 30 + len(info.filename.encode("utf-8")) + len(info.extra)
    end = start + header + info.compress_size
    if info.flag_bits & 0x08:
        end += 16  # data descriptor, generous
    if end > cursor:
        cursor = end
if z.start_dir > cursor:
    holes.append((cursor, z.start_dir - cursor, "before the central directory"))

holes.sort(key=lambda h: -h[1])
print("largest unaccounted regions:")
for offset, length, what in holes[:15]:
    print(f"  {offset:>12,} .. {offset + length:>12,}  {length:>12,} bytes  ({length / 1024 / 1024:6.1f} MiB)  {what}")
print()
print(f"total unaccounted: {sum(h[1] for h in holes):,} bytes "
      f"({sum(h[1] for h in holes) / 1024 / 1024:.1f} MiB)")
print(f"signature block + EOCD tail: {size - z.start_dir:,} bytes "
      f"({(size - z.start_dir) / 1024 / 1024:.1f} MiB)")
print()

largest = holes[0][1] if holes else 0
limit = args.max_hole
if largest > limit:
    print(f"FAIL  largest unaccounted region {largest:,} bytes > limit {limit:,} bytes")
    print("      多半是 packageDebug 在旧 APK 上原地改写留下的洞: 先删 app-debug.apk 再干净构建")
    if not args.no_fail:
        sys.exit(1)
else:
    print(f"PASS  largest unaccounted region {largest:,} bytes <= limit {limit:,} bytes")
