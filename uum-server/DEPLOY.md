# UU&Mixt uum-server · master 部署说明（一页）

> | 项 | 值 |
> |---|---|
> | 服务 | 写作台写入 API（verify/list/read/write/delete）+ 桌宠 LLM 转发（/api/pet/chat），同进程 |
> | 依据 | docs/09（T5-1/T5-3 · 决策 7.19）/ 决策 7.18 / docs/06 §4 |
> | 形态 | Go 标准库零依赖单二进制，内存 < 50MB，只监听 `127.0.0.1:8787` |
> | 分工 | 本页所有命令 **由 master 在服务器上执行**（UI agent 不持有 SSH 凭据） |

---

## 1. 交付物清单（本目录）

| 文件 | 说明 |
|---|---|
| `main.go` `store.go` `petchat.go` `go.mod` | 服务源码（Go ≥ 1.22） |
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

## 9. 故障与回滚

| 情形 | 处置 |
|---|---|
| uum-server 挂了 | 站点与访客完全不受影响；`systemctl status uum-server` 看日志；写作台不可写而已 |
| 主库磁盘损坏 | GitHub 镜像即灾备：重新 `git clone --mirror` GitHub → 恢复（≤24h 数据差） |
| 镜像滞后 | 主库为准；`uum-mirror.sh` 手动补跑 |
| token 疑似泄露 | `/etc/uum/config.json` 删该条 hash + 重启；重发新 token |
