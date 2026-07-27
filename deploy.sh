#!/usr/bin/env bash
# ============================================================
# MedPaper 一键部署脚本
#   用法: ./deploy.sh "提交说明（可选）"
#   流程: 构建验证 → 提交并推送 main → 按 Pages 子路径重建 → 发布 gh-pages
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-更新部署 $(date '+%Y-%m-%d %H:%M')}"
REPO="https://github.com/wannengxiaodie/medpaper.git"

echo "▸ 1/4 构建验证（本地预览版本）…"
npm run build > /tmp/medpaper-build.log 2>&1 || { tail -20 /tmp/medpaper-build.log; exit 1; }

echo "▸ 2/4 提交并推送 main…"
git add -A
if git diff --cached --quiet; then
  echo "  （无源码改动，跳过提交）"
else
  git commit -q -m "$MSG"
fi
git push -q origin main

echo "▸ 3/4 按 GitHub Pages 子路径构建…"
npm run build -- --base=/medpaper/ > /tmp/medpaper-build-pages.log 2>&1 || { tail -20 /tmp/medpaper-build-pages.log; exit 1; }
cp dist/index.html dist/404.html   # SPA 路由回退

echo "▸ 4/4 发布到 gh-pages…"
rm -rf dist/.git
git -C dist init -q -b gh-pages
git -C dist config user.name "wangpengfei"
git -C dist config user.email "wangpengfei@localhost"
git -C dist add -A
git -C dist commit -q -m "$MSG"
git -C dist remote add origin "$REPO" 2>/dev/null || git -C dist remote set-url origin "$REPO"
git -C dist push -q -f origin gh-pages

echo ""
echo "✅ 部署完成，约 1 分钟后生效："
echo "   线上 https://wannengxiaodie.github.io/medpaper/"
echo "   仓库 https://github.com/wannengxiaodie/medpaper"
