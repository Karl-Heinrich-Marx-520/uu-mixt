#!/bin/sh
# ==========================================================================
# UU&Mixt 每日镜像：服务器主库 → GitHub（docs/09 T5-3 · 决策 7.19 修订：每天 1 次）
# 失败只写日志、绝不阻塞任何环节（GitHub 挂一整天也不影响写作台与发文，
# 有 24h 容忍窗口；「端点不可达」静默等次日重试）。
# cron: /etc/cron.d/uum-mirror（凌晨 4 点）
# 手动触发: /srv/uum/bin/uum-mirror.sh && tail /var/log/uum-mirror.log
# ==========================================================================
set -u

GIT_DIR="${GIT_DIR:-/srv/uum/repo.git}"
LOG="${LOG:-/var/log/uum-mirror.log}"
# 缺省走 SSH deploy key（git@github.com）；HTTPS+PAT 时：
#   export MIRROR_REMOTE="https://<TOKEN>@github.com/Karl-Heinrich-Marx-520/uu-mixt.git"
MIRROR_REMOTE="${MIRROR_REMOTE:-git@github.com:Karl-Heinrich-Marx-520/uu-mixt.git}"
# 专用 deploy key（无则注释掉，用默认 key）
GIT_SSH="${GIT_SSH:-/srv/uum/.ssh/id_ed25519_deploy}"

{
  echo "---- $(date '+%F %T') mirror start ----"
  if [ -f "$GIT_SSH" ]; then
    GIT_SSH_COMMAND="ssh -i $GIT_SSH -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
      git --git-dir="$GIT_DIR" push --mirror "$MIRROR_REMOTE" 2>&1
  else
    git --git-dir="$GIT_DIR" push --mirror "$MIRROR_REMOTE" 2>&1
  fi
  echo "exit=$? $(date '+%F %T')"
} >> "$LOG" 2>&1
