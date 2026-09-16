# UU&Mixt uum-server · master 部署说明（一页）

> | 项 | 值 |
> |---|---|
> | 服务 | 写作台写入 API（verify/list/read/write/delete）+ AI 摘要助手（/api/assist）+ 标签池（/api/tags、/api/tags/add\|rename\|remove）+ 桌宠 LLM 转发（/api/pet/chat）+ **构建发布（/api/rebuild，决策 7.24）**，同进程 |
> | 依据 | docs/09（T5-1/T5-3 · 决策 7.19；§8.2 正式版接线 · 决策 7.20-7.23；§8.3 构建发布 · 决策 7.24）/ 决策 7.18 / docs/06 §4 |
> | 形态 | Go 标准库零依赖单二进制，内存 < 50MB，只监听 `127.0.0.1:8787` |
> | 分工 | 本页所有命令 **由 master 在服务器上执行**（UI agent 不持有 SSH 凭据） |

---

## 1. 交付物清单（本目录）

| 文件 | 说明 |
|---|---|
| `main.go` `store.go` `petchat.go` `assist.go` `tagpool.go` `go.mod` | 服务源码（Go ≥ 1.22） |
| `uum-server-linux-amd64` | 已交叉编译的 linux/amd64 二进制（不入 git，可重编：见 §2） |
| `config.example.json` | 配置样例（token hash 表 / 仓库路径 / 上游 LLM 三元组） |
| `selftest.sh` | 冒烟自测（curl 全接口，26 项断言，本地已全绿） |
| `deploy/uum-server.service` | systemd 单元 |
| `deploy/uum-mirror.sh` | 每日镜像脚本（主库 → GitHub） |
| `deploy/uum-mirror.cron` | cron 定义（凌晨 4 点） |

## 2. 二进制（两种方式任选）

```bash
# 方式 A：直接用 UI agent 交付的本地文件（Windows 工作区已编译好）
#   D:\cppsoft\workbuddy\UU&Mixt\uum-server\uum-server-linux-amd64  → scp 到服务器

# 方式 B：服务器上重编（或本地重编）
cd uum-server && GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o uum-server-linux-amd64 .
```

## 3. 服务器 git 主库 + 工作副本（一次性）

> 铁律：主库与工作副本**不得**位于 Nginx 站点根（`/srv/uum/dist`）之下。

```bash
sudo mkdir -p /srv/uum/bin /etc/uum
# ① 主库（bare）：从 GitHub 镜像克隆初始化（自带 origin，天然适配每日 push --mirror）
sudo git clone --mirror git@github.com:Karl-Heinrich-Marx-520/uu-mixt.git /srv/uum/repo.git
#   （HTTPS + PAT 亦可：https://<TOKEN>@github.com/... ；deploy key 建议只给写权限）
# ② 工作副本：写作台写入 API 的 commit 目标，origin 指向主库
sudo git clone /srv/uum/repo.git /srv/uum/work
sudo chown -R <运行用户>: <运行用户> /srv/uum
```

## 4. 配置 /etc/uum/config.json

```bash
# ① 生成两位作者的 token（线下私发给 UU / Mixt，不进仓库不进聊天）
openssl rand -hex 32   # → 给 UU 的明文 token
openssl rand -hex 32   # → 给 Mixt 的明文 token
# ② 算 hash（服务自带工具）
./uum-server-linux-amd64 -hash "<UU 的明文>"     # → 填 tokens[0].hash
./uum-server-linux-amd64 -hash "<Mixt 的明文>"   # → 填 tokens[1].hash
```

从 `config.example.json` 复制修改：`repoPath=/srv/uum/work`、填两个 hash、`pet.*` 保持默认
（DeepSeek 三元组；Key 放环境变量 `UUM_LLM_KEY`，见 §5，不落盘）。
`chmod 600 /etc/uum/config.json`。**吊销 = 删一条 tokens 记录并重启服务（即时生效）。**

## 5. systemd + Nginx

```bash
sudo cp deploy/uum-server.service /etc/systemd/system/   # 按需改 User 与 UUM_LLM_KEY
# 建议：Key 放 /etc/uum/pet.env（600）并在 unit 里 EnvironmentFile= 引用
sudo systemctl daemon-reload && sudo systemctl enable --now uum-server
curl -s 127.0.0.1:8787/healthz    # 期望 {"ok":true,...}
```

Nginx（**8080 预览与正式 443 两个 server 块都加**——docs/09 拍板后写作台预览期即可用）：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_read_timeout 35s;
    client_max_body_size 3m;   # 图片上限 2MB + multipart 开销
}

# 站内 404 页（dist/404.html 构建自带；盲测轮 1 P2：此前 404 是 Nginx 默认页，
# 无返回出路且 server 头暴露 nginx 版本——error_page 与 server_tokens 一起配）
error_page 404 /404.html;
server_tokens off;
```

## 6. 每日镜像（主库 → GitHub，每天一次 · 决策 7.19 修订）

```bash
sudo cp deploy/uum-mirror.sh /srv/uum/bin/ && sudo chmod +x /srv/uum/bin/uum-mirror.sh
# 脚本内 MIRROR_REMOTE 默认走 SSH deploy key；如用 HTTPS+PAT，export MIRROR_REMOTE=https://<TOKEN>@github.com/...
sudo cp deploy/uum-mirror.cron /etc/cron.d/uum-mirror
# 手动触发一次验证：
sudo /srv/uum/bin/uum-mirror.sh && tail -5 /var/log/uum-mirror.log
```

失败只写 `/var/log/uum-mirror.log`（「GitHub 端点不可达」不是错误，静默等次日重试，有 24h 容忍窗口）。

## 7. UU 本地切换（主库验证首条 commit 后，master 与 UU 确认再切；切换前照旧走 GitHub）

```bash
git remote add server ssh://<user>@47.116.143.98/srv/uum/repo.git   # 端口按实际
# 发布流（G4 三条命令不变）：
git pull server main && npm run build && node scripts/check-pages.mjs && ./deploy.sh
```

验证：Mixt 在写作台发一篇 → UU 本地 `git pull server main` 能拉到 `content(mixt): …` 提交（含图片）→ 构建部署后线上可见。

## 8. 验收清单（对照 docs/09 §4）

- [ ] Mixt 普通浏览器（不开代理）登录 → 写文章 → 分类/友链/媒体各操作一次，全程无网络错误
- [ ] DevTools Network 面板**零 `api.github.com` 请求**
- [ ] UU 本地从 server 主库 pull 到 Mixt 的 commit 并构建可见
- [ ] 越面写入 403（接口无 face 参数，face 由 token 推导）
- [ ] 错 token 401 / 越权 403 / 超限 413 / sha 冲突 409，全部中文报错
- [ ] cron 手动触发 `push --mirror` 成功（§6）
- [ ] `?mock=1` 全流程仍可用；构建 / check-pages / 桌宠 / 搜索不受影响

## 8.1 已上线服务升级（决策 7.20-7.23 正式版接线，2026-09-15）

服务器上已在跑旧版二进制时，按此更新（新增 /api/assist 与 /api/tags* 端点，旧接口零改动）：

```bash
# 1. 上传新二进制（UI agent 已在工作区编译好 linux/amd64）
scp uum-server-linux-amd64 <user>@47.116.143.98:/tmp/uum-server-new

# 2. 服务器上原子替换并重启
ssh <user>@47.116.143.98
sudo systemctl stop uum-server
sudo install -m 755 /tmp/uum-server-new /usr/local/bin/uum-server   # 路径按 unit 的 Exec=
sudo systemctl start uum-server
curl -s http://127.0.0.1:8787/healthz   # 确认 uptime 重新起算、petModel 正常

# 3. 确认 UUM_LLM_KEY 仍在环境里（pet.env，unit 的 EnvironmentFile）
systemctl show uum-server -p EnvironmentFiles
# 若 Key 缺失：/api/pet/chat 与 /api/assist 会 502，写作台其余功能不受影响

# 4. Nginx 无需改动（/api/ 前缀整体反代，新端点自动可达）
```

升级后新功能验收：写作台设置面板改简介保存 → 仓库出现 `config(uu): 更新个人简介与标签` 提交；
文章表单留空 description 保存 → 出现 AI 生成摘要；标签池面板改名 → 全站文章 frontmatter 一次提交同步。

## 8.2 构建发布功能部署（master 执行 · 决策 7.24）

新增 `/api/rebuild` 端点（写作台手动触发服务器端构建）+ 服务器构建脚本 + 加固版镜像脚本。
**config.json 无需新增字段**（`rebuildScript` 缺省即 `/srv/uum/bin/uum-rebuild.sh`）。本服务器实际
路径为 `ExecStart=/srv/uum/bin/uum-server`、运行用户 `uum`（下例按此写，其他机器按 unit 校正）。

```bash
# 1. 上传三个文件（本地 uum-server/ 目录）
scp uum-server-linux-amd64 root@47.116.143.98:/tmp/uum-server-new
scp deploy/uum-rebuild.sh deploy/uum-mirror.sh root@47.116.143.98:/tmp/

# 2. 服务器上安装并重启
sudo systemctl stop uum-server
sudo install -m 755 -o uum -g uum /tmp/uum-server-new /srv/uum/bin/uum-server
sudo install -m 755 -o uum -g uum /tmp/uum-rebuild.sh /srv/uum/bin/uum-rebuild.sh
sudo install -m 755 -o uum -g uum /tmp/uum-mirror.sh  /srv/uum/bin/uum-mirror.sh  # 加固版覆盖旧版
sudo systemctl start uum-server
curl -s http://127.0.0.1:8787/healthz    # uptime 重新起算

# 3. 构建环境自检（本机 2026-09-15 已核：Node v22.23.2 / swap 2.0Gi，缺了再装）
node -v        # 期望 v22.x（NodeSource）
free -h        # swap ≥ 2G —— 2C2G 构建防 OOM 的保险
#   缺 Node：curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs
#   缺 swap：fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile（并写入 fstab）

# 4. 首次构建（让 Mixt 已删文章立即从前台消失——本次 bug 的原始诉求；也可直接在写作台点按钮）
sudo -u uum /srv/uum/bin/uum-rebuild.sh && tail -15 /srv/uum/rebuild.log
#   期望日志尾：rebuild OK -> /srv/uum/dist（首次会多一步 npm install，约 1-3 分钟）
```

**验收点**：

- [ ] 写作台侧边菜单出现「构建发布」→ 点击 → confirm → 按钮进构建态 → 数分钟后提示「构建完成（N 秒）：前台已更新」
- [ ] 构建后打开 `IP:8080` 内容页：Mixt 已删的文章与分类不再出现（原 bug 闭环）
- [ ] 带 token `GET /api/rebuild` 返回 `exitCode:0`；无 token 401；一分钟内第三笔 429（每面限频 2 次/分）
- [ ] 失败演练（可选）：故意构造非法内容触发 → 前台保持旧版不空白，`/srv/uum/rebuild.log` 尾有 FAILED
- [ ] `sudo -u uum /srv/uum/bin/uum-mirror.sh` 手动跑一次成功（加固版行为：push 前先判断分叉，绝不强推）

## 9. 故障与回滚

| 情形 | 处置 |
|---|---|
| uum-server 挂了 | 站点与访客完全不受影响；`systemctl status uum-server` 看日志；写作台不可写、构建按钮不可用而已 |
| **构建失败（决策 7.24）** | **旧 dist 自动保留，前台不空白**；看 `/srv/uum/rebuild.log` 定位（npm / build / check-pages 三段各有 FAILED 标记）；修复后重新点「构建发布」 |
| 依赖升级后构建异常 | `rm -rf /srv/uum/work/node_modules` 后再触发一次（重建依赖） |
| 主库磁盘损坏 | GitHub 镜像即灾备：重新 `git clone --mirror` GitHub → 恢复（≤24h 数据差） |
| 镜像分叉告警 | mirror.sh 检测到主库与 GitHub 互无祖先时放弃推送（绝不强推）；人工确认保留哪条线后合并，再手动补跑 |
| token 疑似泄露 | `/etc/uum/config.json` 删该条 hash + 重启；重发新 token |
