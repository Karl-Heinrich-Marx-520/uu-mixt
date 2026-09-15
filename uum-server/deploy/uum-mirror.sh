#!/bin/sh
# ==========================================================================
# UU&Mixt GitHub 灾备镜像（决策 7.24：GitHub 降级为纯灾备，不再参与前台更新链路）
# 触发：cron 每日 4 点兜底补推（/etc/cron.d/uum-mirror）；也可手动执行。
#       （flock 防并发，手动与 cron 撞车时后到者直接放弃）
# 安全设计：
#   · flock 防并发（事件与 cron 同时触发时后到者直接放弃）
#   · push --mirror 前先 fetch 判断分叉：GitHub 领先则先快进主库；
#     互无祖先（分叉）则放弃镜像并告警——绝不强推覆盖任何一方的提交
#   · 失败只写日志、绝不阻塞写作台（GitHub 挂一整天不影响在线功能）
# 手动触发: /srv/uum/bin/uum-mirror.sh && tail /var/log/uum-mirror.log
# ==========================================================================
set -u

GIT_DIR="${GIT_DIR:-/srv/uum/repo.git}"
LOG="${LOG:-/var/log/uum-mirror.log}"
MIRROR_REMOTE="${MIRROR_REMOTE:-git@github.com:Karl-Heinrich-Marx-520/uu-mixt.git}"
GIT_SSH="${GIT_SSH:-/srv/uum/.ssh/id_ed25519_deploy}"
LOCK="${LOCK:-/srv/uum/.mirror.lock}"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

exec 9>"$LOCK" 2>>"$LOG" || { log "FATAL: 无法打开锁文件 $LOCK"; exit 1; }
flock -n 9 || exit 0

if [ -f "$GIT_SSH" ]; then
  export GIT_SSH_COMMAND="ssh -i $GIT_SSH -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi

log "---- mirror start ----"

# ① 拉取 GitHub 最新 main 到临时 ref（不动 heads/main）
if ! git --git-dir="$GIT_DIR" fetch --prune "$MIRROR_REMOTE" \
     "+refs/heads/main:refs/remotes/mirror-in/main" >>"$LOG" 2>&1; then
  log "fetch 失败（GitHub 不可达？），放弃本次镜像，等下次触发"
  exit 0
fi

LOCAL=$(git --git-dir="$GIT_DIR" rev-parse refs/heads/main)
REMOTE=$(git --git-dir="$GIT_DIR" rev-parse refs/remotes/mirror-in/main)

if [ "$LOCAL" != "$REMOTE" ]; then
  if git --git-dir="$GIT_DIR" merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
    : # 主库领先，正常镜像
  elif git --git-dir="$GIT_DIR" merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
    # GitHub 领先（如 UU 本地直接推了 GitHub）：主库先快进，避免 --mirror 抹掉它
    if git --git-dir="$GIT_DIR" update-ref refs/heads/main "$REMOTE" "$LOCAL" >>"$LOG" 2>&1; then
      log "主库落后 GitHub，main 已快进 -> ${REMOTE}"
    fi
  else
    log "分叉告警：主库 ${LOCAL} 与 GitHub ${REMOTE} 互无祖先关系，放弃镜像（需人工合并）"
    exit 1
  fi
fi

# ② 全量镜像推送（灾备）
if git --git-dir="$GIT_DIR" push --mirror "$MIRROR_REMOTE" >>"$LOG" 2>&1; then
  log "mirror OK main=$(git --git-dir="$GIT_DIR" rev-parse --short refs/heads/main)"
else
  log "push --mirror FAILED"
  exit 1
fi
