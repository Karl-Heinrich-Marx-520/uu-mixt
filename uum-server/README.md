# uum-server —— UU&Mixt 统一小服务

写作台写入 API + 桌宠 LLM 转发，**同进程**（决策 7.18 / 7.19 · docs/09）。
Go 标准库零依赖单二进制，只监听 `127.0.0.1`，公网入口仅 Nginx 反代 `/api/`。

**master 部署看 [DEPLOY.md](DEPLOY.md)（一页）**；本页只讲本地开发与自测。

## 接口一览

| 方法/路径 | 语义 | 鉴权 |
|---|---|---|
| `POST /api/verify` | 登录验证 `{token}` → `{login, face}` | 无（防爆破限频） |
| `GET /api/list?path=` | 列目录 → `[{name,path,sha,type}]` | Bearer token |
| `GET /api/read?path=` | 读文件 → `{content, sha}`；404=不存在 | Bearer token |
| `POST /api/write` | 写文件：JSON 文本 / multipart 图片 | Bearer token |
| `DELETE /api/file?path=&sha=&message=` | 删文件（sha 乐观锁） | Bearer token |
| `POST /api/pet/chat` | 桌宠 LLM 转发（OpenAI 兼容 messages） | 无（IP 限流+日配额） |
| `POST /api/chat` | 同上的兼容别名（pet.js 切换后移除） | 同上 |
| `GET /healthz` | 健康检查 | 无 |

**强制约束**：face 由 token 推导（接口不接受 face 参数）；路径白名单 =
`src/content/<face>/**` + `src/config/categories-<face>.json` + `src/data/friends.json`（站点级）+
`public/images/<face>/**`；拒绝 `..` / 绝对路径 / 反斜杠 / 符号链接；
Markdown ≤ 200KB、图片 ≤ 2MB；写/删即 `git commit` 并 push 到主库（失败仅告警不阻塞作者）。

## 本地自测（mock 模式，不碰 git）

```bash
go build -o uum-server.exe .
./uum-server.exe -hash "任意明文token"     # 生成 SHA-256 hash 填进配置
# config.dev.json 已含两个开发 token 的 hash：dev-uu-token / dev-mixt-token
./uum-server.exe -config config.dev.json   # mock=true：内存存储，8791 端口
sh selftest.sh                             # 26 项断言（BASE/token 可用环境变量覆盖）
```

## 本地自测（git 模式，真实 commit 链路）

建一个临时仓库（`git init -b main` + 任意首提交），写 `config.git.json`：
`mock=false`、`repoPath` 指向它；启动后走 `selftest.sh` 的写/删用例，
用 `git -C <repo> log --oneline` 验证每笔操作都有 commit；
无 origin 时响应带 `warning`（推送主库失败），挂 bare 库为 origin 后 warning 消失。

## 供应商切换（桌宠）

`config.json` 的 `pet` 三元组：`baseUrl + model + apiKeyEnv`。
Key 放环境变量，不落盘：`UUM_LLM_KEY=sk-xxx ./uum-server -config config.json`。

| 供应商 | baseUrl | model 示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| OpenAI | `https://api.openai.com` | `gpt-4o-mini` |
| Kimi | `https://api.moonshot.cn` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas` | `glm-4-flash` |
| 通义 Qwen | `https://dashscope.aliyuncs.com/compatible-mode` | `qwen-plus` |
| Ollama | `http://127.0.0.1:11434` | 本地模型名 |
