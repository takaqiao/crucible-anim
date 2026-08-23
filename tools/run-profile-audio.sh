#!/bin/bash
# 全库音频量测（含频谱）。跑完写 data/audio-profiles.json，可中断续跑。
set -u
cd "$(dirname "$0")/.."
for ns in psfx ggg-sfx blfx canim; do
  echo "########## $ns  $(date '+%H:%M:%S') ##########"
  node tools/profile-audio.mjs --ns "$ns" --jobs 10 --redo 2>&1 | grep -vE '^  [0-9]+/'
done
for d in modules/animated-spell-effects-cartoon modules/psfx systems/crucible/assets/sfx; do
  echo "########## $d ##########"
  node tools/profile-audio.mjs --dir "$d" --jobs 10 --redo 2>&1 | grep -vE '^  [0-9]+/'
done
echo "########## 音频全部完成（含频谱）$(date '+%H:%M:%S') ##########"
