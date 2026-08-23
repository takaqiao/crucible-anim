#!/bin/bash
# 全库视觉量测。--redo 让先前用旧口径（step 2 / 不缩放）量的 1300 条统一重来，
# 免得一份索引里混着两种量测规格。
set -u
cd "$(dirname "$0")/.."
for ns in jb2a blfx eskie jaamod jb2a-extras animated-spell-effects-cartoon; do
  echo "########## $ns  $(date '+%H:%M:%S') ##########"
  node tools/profile-family.mjs --ns "$ns" --jobs 24 --redo 2>&1 | grep -vE '^  [0-9]+/[0-9]+$'
done
echo "########## 全部完成 $(date '+%H:%M:%S') ##########"
node -e "const j=require('./data/asset-profiles.json');console.log('累计量测',Object.keys(j.profiles).length,'条')"
