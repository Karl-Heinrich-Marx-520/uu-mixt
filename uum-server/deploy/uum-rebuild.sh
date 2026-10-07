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

FAIL=0
while :; do
  rm -f "$PENDING"
  log "---- rebuild start ----"
  cd "$WORK" || { log "FATAL: work 目录不可达"; FAIL=1; break; }

  # 同步主库：写作台提交与外部 push（如 UU 本地推 server）都先落在 bare 主库，
  # 工作副本不自动跟进——构建前必须对齐 origin/main，否则永远构建旧内容
  # （2026-09-15 验收实测：work 滞后导致前台拿不到新前端与新提交。
  #   注意不能 fetch 进当前检出的 refs/heads/main——git 会拒绝；
  #   用默认 refspec 更新远程跟踪 origin/main 后再 reset）
  if git fetch origin >>"$LOG" 2>&1 \
     && git reset --hard origin/main >>"$LOG" 2>&1; then
    log "work 已对齐主库 $(git rev-parse --short HEAD)"
  else
    log "WARN: work 同步主库失败，沿用当前工作副本构建"
  fi

  export ASTRO_TELEMETRY_DISABLED=1
  export NODE_OPTIONS="--max-old-space-size=1536"

  if [ ! -d node_modules ]; then
    log "npm install（首次）..."
    npm install --no-audit --no-fund --registry=https://registry.npmmirror.com >>"$LOG" 2>&1 \
      || { log "npm install FAILED"; FAIL=1; break; }
  fi

  rm -rf dist
  # content layer 缓存必须清：写作台删除/改名文章后，旧 data-store 会让构建校验
  # 报「文件已删但仍被校验」而失败（本地实测踩坑，2026-09-15）。
  # 但**只清这一个文件就够了**——真正的陈旧数据就是 data-store.json；
  # 清整个 .astro 目录会把 Shiki 高亮与资源处理的缓存一起扔掉，实测构建从
  # ~17s 涨到 ~29s（2026-10-07 实测）。构建时间随文章/图片增长而变长，
  # 这里贡献了最大的一块，所以改成精确清除。
  rm -f node_modules/.astro/data-store.json
  if npm run build >>"$LOG" 2>&1 && [ -d dist ]; then
    if node scripts/check-pages.mjs >>"$LOG" 2>&1; then
      # 图片压缩是"可选优化"：sharp 缺失时脚本会打印警告但仍退出 0，以免一个优化
      # 把发布卡住。代价是它可能静默不生效（2026-10-06 实测：npm audit fix --omit=dev
      # 剪掉了 dev 依赖 sharp，构建照常成功、图片却全未压缩，且没人看得见）。
      # 这里加一道兜底检查：产物里只要还有超过 PRD 单图 400KB 红线的图片就写进日志
      # ——不阻断发布，但运维在日志里一定看得到。
      BIG=$(find dist -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \) -size +400k -print -quit 2>/dev/null)
      if [ -n "$BIG" ]; then
        log "WARN: 产物存在 >400KB 的图（如 $BIG）——图片压缩可能未生效，请检查 sharp 是否已安装（npm ls sharp）"
      fi
      if rsync -a --delete dist/ "$DIST/"; then
        log "rebuild OK -> $DIST"
      else
        log "rsync FAILED —— 保留旧 dist"; FAIL=1
      fi
    else
      log "check-pages FAILED —— 保留旧 dist"; FAIL=1
    fi
  else
    log "astro build FAILED —— 保留旧 dist"; FAIL=1
  fi

  [ -f "$PENDING" ] || break
  log "构建期间有新变更（pending），继续下一轮"
done
# 失败必须可见：非零退出码经 /api/rebuild 传给写作台展示（exitCode != 0）
exit "$FAIL"
