#!/bin/sh
# ==========================================================================
# UU&Mixt 服务器端即时构建（决策 7.24 · 2026-09-15）
# 触发：写作台「构建发布」按钮 -> uum-server POST /api/rebuild（异步执行，
#       running 防重 + 每面限频 2 次/分）；也可 root 手动执行本脚本。
#       （本脚本对调用方无假设，future 如需 post-receive 自动触发可直接挂）
# 语义：
#   · flock 单实例：构建中再来触发直接退出，靠 pending 标志合并为下一轮
#     （连续 7 次删除只构建 1-2 轮，每轮都读到 work 最新状态）
#   · 构建成功且 check-pages 通过才 rsync 替换 /srv/uum/dist；
#     失败保留旧站点只写日志——写作台与前台访客完全无感
#   · 与 GitHub 无关（灾备见 uum-mirror.sh）
# 依赖变更时手动：rm -rf /srv/uum/work/node_modules 后触发一次
# 手动触发: /srv/uum/bin/uum-rebuild.sh && tail /srv/uum/rebuild.log
# ==========================================================================
set -u

WORK="${WORK:-/srv/uum/work}"
DIST="${DIST:-/srv/uum/dist}"
LOCK="${LOCK:-/srv/uum/.rebuild.lock}"
PENDING="${PENDING:-/srv/uum/.rebuild.pending}"
LOG="${LOG:-/srv/uum/rebuild.log}"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

touch "$PENDING" 2>>"$LOG" || { log "FATAL: 无法写 pending 标志 $PENDING"; exit 1; }
exec 9>"$LOCK" 2>>"$LOG" || { log "FATAL: 无法打开锁文件 $LOCK"; exit 1; }
flock -n 9 || exit 0   # 已有实例在跑；它收尾时会看见 pending 自动补一轮

while :; do
  rm -f "$PENDING"
  log "---- rebuild start ----"
  cd "$WORK" || { log "FATAL: work 目录不可达"; break; }

  export ASTRO_TELEMETRY_DISABLED=1
  export NODE_OPTIONS="--max-old-space-size=1536"

  if [ ! -d node_modules ]; then
    log "npm install（首次）..."
    npm install --no-audit --no-fund --registry=https://registry.npmmirror.com >>"$LOG" 2>&1 \
      || { log "npm install FAILED"; break; }
  fi

  rm -rf dist
  # content layer 缓存必须清：写作台删除/改名文章后，旧 data-store 会让构建校验
  # 报「文件已删但仍被校验」而失败（本地实测踩坑，2026-09-15）
  rm -rf node_modules/.astro
  if npm run build >>"$LOG" 2>&1 && [ -d dist ]; then
    if node scripts/check-pages.mjs >>"$LOG" 2>&1; then
      rsync -a --delete dist/ "$DIST/" && log "rebuild OK -> $DIST"
    else
      log "check-pages FAILED —— 保留旧 dist"
    fi
  else
    log "astro build FAILED —— 保留旧 dist"
  fi

  [ -f "$PENDING" ] || break
  log "构建期间有新变更（pending），继续下一轮"
done
