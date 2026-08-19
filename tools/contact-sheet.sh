#!/bin/bash
# 把一个 webm 均匀抽帧拼成一张联系表，用于判断动画的相位结构与锚点。
# JB2A 的透明区在默认解码器下呈黑色，亮色特效在黑底上可读性良好。
#
# 用法： tools/contact-sheet.sh <webm> <out.png> [cols] [rows]
set -euo pipefail
F="$1"; OUT="$2"; C="${3:-6}"; R="${4:-2}"; N=$((C * R))
TOT=$(ffprobe -v error -count_frames -select_streams v:0 \
      -show_entries stream=nb_read_frames -of csv=p=0 "$F")
STEP=$((TOT / N)); [ "$STEP" -lt 1 ] && STEP=1
ffmpeg -y -v error -i "$F" \
  -vf "select='not(mod(n\,$STEP))',scale=170:-1,\
drawtext=text='%{n}':x=4:y=4:fontsize=14:fontcolor=yellow,\
tile=${C}x${R}:padding=2:color=0x202020" \
  -frames:v 1 -vsync 0 "$OUT"
echo "$F  frames=$TOT step=$STEP -> $OUT"
