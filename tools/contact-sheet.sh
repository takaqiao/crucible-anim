#!/bin/bash
# 把一个 webm 均匀抽帧拼成一张联系表，用于判断动画的相位结构与锚点。
#
# JB2A / eskie-effects 的 webm 几乎全是 VP8/VP9 + alpha（alpha 平面存在 Matroska
# 的 BlockAdditions 里，容器上表现为 tag alpha_mode=1）。ffmpeg 的**默认原生解码器
# 不解这个 alpha 平面**，只吐 RGB：有的素材 RGB 平面碰巧是黑底预乘的（看着还行），
# 有的完全不是 —— 例如 jb2a.cast_generic.01.blue 会被解成「白底蓝漩涡」
# （边框平均亮度 244~251/255），跟它在游戏里的真实外观（透明底）南辕北辙，
# 据此做出的密度 / 亮度 / 可读性判断全是错的。
#
# 所以这里做两件事：
#   1) 先探 codec：VP8 走 libvpx、VP9 走 libvpx-vp9，把 alpha 平面真正解出来；
#   2) 把带 alpha 的帧合成到一块已知底色（0x303030 深灰）上再拼图 —— 只换解码器
#      是不够的：RGBA 的 PNG 在查看器里透明区照样被画成白色，一样误导。合成之后
#      透明区必定精确等于 0x303030，任何偏离底色的像素都是素材真的画上去的。
# 少数文件的 bitstream 不被 libvpx 接受，此时自动回退默认解码器并在 stderr 提示，
# 而不是整个失败。
#
# 抽帧步长算法与命令行约定跟旧版完全一致，stdout 仍然打印 `frames=N step=S`。
#
# 用法： tools/contact-sheet.sh <webm> <out.png> [cols] [rows]
set -euo pipefail

# ---- 工具定位：Windows 上常常只有 ffmpeg 没有 ffprobe ----
# 优先级：环境变量 -> PATH -> 已知的随附安装。两个变量都可单独覆盖。
FFMPEG="${CRUCIBLE_ANIM_FFMPEG:-}"
FFPROBE="${CRUCIBLE_ANIM_FFPROBE:-}"
[ -n "$FFMPEG" ]  || FFMPEG=$(command -v ffmpeg  2>/dev/null || true)
[ -n "$FFPROBE" ] || FFPROBE=$(command -v ffprobe 2>/dev/null || true)
[ -n "$FFMPEG" ] || for c in "${LOCALAPPDATA:-}/oopz/ffmpeg.exe" "$HOME/AppData/Local/oopz/ffmpeg.exe"; do
  [ -x "$c" ] && FFMPEG="$c" && break
done
if [ -z "$FFMPEG" ]; then
  echo "contact-sheet: 找不到 ffmpeg。设 CRUCIBLE_ANIM_FFMPEG 指向可执行文件。" >&2
  echo "contact-sheet: 必须是带 libvpx / libvpx-vp9 的构建——否则解不出 WebM 的容器级" >&2
  echo "contact-sheet: alpha（BlockAdditional），读图判断会全错。" >&2
  exit 4
fi

# ffprobe 缺席时用 ffmpeg -i 的 stderr 顶替：两个探针只取 codec 与帧数，
# ffmpeg 自己都打得出来，没必要为此再装一个二进制。
probe_codec() {
  if [ -n "$FFPROBE" ]; then
    "$FFPROBE" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$1" 2>/dev/null || true
  else
    # head 会让上游吃 SIGPIPE，pipefail + set -e 下整条脚本会静默退出——末尾的 || true 是必须的
    { "$FFMPEG" -hide_banner -i "$1" 2>&1 || true; } |
      grep -oE 'Video: [A-Za-z0-9_]+' | head -1 | cut -d' ' -f2 || true
  fi
}
probe_frames() {
  if [ -n "$FFPROBE" ]; then
    "$FFPROBE" -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$1" 2>/dev/null || true
  else
    { "$FFMPEG" -hide_banner -i "$1" -map 0:v:0 -c copy -f null - 2>&1 || true; } |
      grep -oE 'frame=[[:space:]]*[0-9]+' | tail -1 | grep -oE '[0-9]+' || true
  fi
}


if [ "$#" -lt 2 ]; then
  echo "contact-sheet: usage: $0 <webm> <out.png> [cols] [rows]" >&2
  exit 2
fi
F="$1"; OUT="$2"; C="${3:-6}"; R="${4:-2}"; N=$((C * R))

if [ ! -f "$F" ]; then
  echo "contact-sheet: no such file: $F" >&2
  exit 2
fi

# ---- 帧数与步长（与旧版逐字一致）----
TOT=$(probe_frames "$F")
case "$TOT" in
  ''|*[!0-9]*) echo "contact-sheet: cannot count frames of $F (got '$TOT')" >&2; exit 3 ;;
esac
[ "$TOT" -gt 0 ] || { echo "contact-sheet: zero video frames in $F" >&2; exit 3; }
STEP=$((TOT / N)); [ "$STEP" -lt 1 ] && STEP=1

# ---- 选解码器：只有 libvpx 系列会解出 WebM 的 alpha 平面 ----
CODEC=$(probe_codec "$F")
case "$CODEC" in
  vp8) DEC="-c:v libvpx" ;;
  vp9) DEC="-c:v libvpx-vp9" ;;
  *)   DEC="" ;;
esac

# 先抽帧缩放，再把选中的帧重新打到「每秒一帧」的时间轴上（setpts=N/TB），
# 底色源同样以 r=1 生成 —— 这样 overlay 的 framesync 与素材帧严格一一对应。
# （直接拿默认 25fps 的 color 源做 overlay 主输入会按 25fps 重采样：30fps 素材
#  会被悄悄丢帧，实测 14 帧掉成 11 帧，联系表上的格子就对不上 step 了。）
# scale2ref 让底色画布尺寸自动跟随缩放后的帧，不必硬编码分辨率。
# format=rgb24 保证底色精确落在 0x303030，且输出 PNG 不带 alpha 通道。
VF="[0:v]select='not(mod(n\,$STEP))',scale=170:-1,format=rgba,setpts=N/TB[fg];\
color=c=0x303030:s=16x16:r=1,format=rgb24[bgsrc];\
[bgsrc][fg]scale2ref[bg][fg2];\
[bg][fg2]overlay=shortest=1:format=rgb,format=rgb24,\
drawtext=text='%{n}':x=4:y=4:fontsize=14:fontcolor=yellow,\
tile=${C}x${R}:padding=2:color=0x101010"

sheet() {  # $1: 解码器参数，空串表示用默认解码器
  # shellcheck disable=SC2086
  "$FFMPEG" -y -v error $1 -i "$F" -filter_complex "$VF" -frames:v 1 -vsync 0 "$OUT"
}

if [ -n "$DEC" ]; then
  ERR=$(mktemp); trap 'rm -f "$ERR"' EXIT
  if sheet "$DEC" 2>"$ERR"; then
    cat "$ERR" >&2
  else
    echo "contact-sheet: $DEC failed on $F -- falling back to the default decoder (alpha may be lost)" >&2
    head -n 3 "$ERR" | sed 's/^/contact-sheet:   /' >&2
    sheet ""
  fi
else
  sheet ""
fi

echo "$F  frames=$TOT step=$STEP -> $OUT"
