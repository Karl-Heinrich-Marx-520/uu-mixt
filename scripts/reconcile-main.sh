#!/bin/sh
# ==========================================================================
# reconcile-main.sh —— master 本地提交后与服务器主库合并的标准流程
# （AGENTS.md §1.1 第 5 条配套工具：git 写操作收归 master 后，
#   服务器侧写作台的 content 提交与 master 的本地提交会频繁分叉，
#   本脚本把「side-ref 推送 → 服务器侧合并 → 本地 ff 对齐」固化成一条命令）
#
# 用法: sh scripts/reconcile-main.sh [本地提交SHA，缺省 HEAD]
# 前提: 本地工作已提交；远端名 server；bare 主库 sharedRepository=group
# 冲突: 两线改动同一文件时服务器侧 merge 会失败——此时手工到
#       /srv/uum/work 解决后 push，再本地 git fetch + ff
# ==========================================================================
set -e

SHA="${1:-HEAD}"
REF="inbox/reconcile-$(date +%s)"
KEY="$HOME/.ssh/vibe_agent.pem"
GIT_SSH="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

echo "[1/4] 推送本地提交到服务器 side-ref: $REF"
GIT_SSH_COMMAND="$GIT_SSH" git push server "$SHA:refs/heads/$REF"

echo "[2/4] 服务器侧合并进主库"
ssh -i "$KEY" root@47.116.143.98 "
  set -e
  sudo -u uum git -C /srv/uum/work fetch origin
  sudo -u uum git -C /srv/uum/work merge --no-edit 'origin/$REF'
  sudo -u uum git -C /srv/uum/work push origin HEAD:main
  git --git-dir=/srv/uum/repo.git update-ref -d refs/heads/$REF
  chown -R uum:uum /srv/uum/repo.git
"

echo "[3/4] 本地对齐服务器 main"
# 本机安全策略可能回滚 refs/remotes/ 的落盘（踩坑 #22 变体：fetch 显示成功、
# remote-tracking ref 消失，merge server/main 报 not something we can merge）——
# fetch 指定分支走 FETCH_HEAD（单文件），不依赖 remote-tracking ref。
GIT_SSH_COMMAND="$GIT_SSH" git fetch server main
git merge --ff-only FETCH_HEAD

echo "[4/4] 完成：本地与服务器 main = $(git rev-parse --short HEAD)"
