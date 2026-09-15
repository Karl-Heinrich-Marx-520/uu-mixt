# pet-server —— 桌宠小鹿的 LLM 转发小服务

决策 7.17 / 7.18 的落地实现：前端桌宠（`public/scripts/pet.js`）只认自家端点
`POST /api/chat`；本服务把请求转发给任意 **OpenAI 兼容**上游，供应商可插拔。

标准库零依赖，编译产物是单个二进制。

## 换 API = 改三行配置

复制 `config.example.json` 为 `config.json`，改 `baseUrl` / `model` / `apiKeyEnv`：

| 供应商 | baseUrl | model 示例 | Key 环境变量 |
|---|---|---|---|
| DeepSeek（默认） | `https://api.deepseek.com` | `deepseek-chat` | `UUM_LLM_KEY` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `UUM_LLM_KEY` |
| Kimi（月之暗面） | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | `UUM_LLM_KEY` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | `UUM_LLM_KEY` |
| 通义 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` | `UUM_LLM_KEY` |
| 本地 Ollama | `http://127.0.0.1:11434/v1` | `llama3.2` 等 | 留空即可（自动免鉴权头） |

Key 永远放在环境变量（`apiKeyEnv` 指定变量名），**绝不写进 config 或仓库**（PRD 6.6）。

## 安全与滥用防线（内置）

- **system 强制注入**：范围约束（只聊本站）+ 可爱简短人设由服务端注入到消息首位，
  前端传什么 system 都会被覆盖——约束不可绕过；
- **per-IP 限流**（默认 10 次/分钟）+ **全局日配额**（默认 500 次/天），超限返回可爱话术；
- **答案缓存**：相同提问（归一化）1 小时内直接复用，不重复计费；
- **只监听 127.0.0.1**：公网入口由 Nginx 反代 `/api/`，服务本身不暴露；
- 请求体 64KB 上限、单条消息 2000 字截断、上游 30s 超时。

## 编译与运行

```bash
cd pet-server
go build -o uum-pet .            # Windows: go build -o uum-pet.exe .
UUM_LLM_KEY=sk-xxx ./uum-pet -config config.json
```

健康检查：`curl http://127.0.0.1:8787/healthz` → `{"ok":true,"model":"deepseek-chat","keySet":true,...}`

## 部署（与 docs/08 部署计划书 §5 对应）

1. 服务器上 `cd /opt/uum/pet-server && go build -o uum-pet .`（或本地交叉编译
   `GOOS=linux GOARCH=amd64 go build -o uum-pet .` 后上传）；
2. `cp config.example.json config.json` 并按上表修改；Key 写入
   `/etc/uum/uum.env`（`UUM_LLM_KEY=sk-...`，chmod 600）；
3. systemd 单元 `uum-pet.service`：

   ```ini
   [Service]
   WorkingDirectory=/opt/uum/pet-server
   EnvironmentFile=/etc/uum/uum.env
   ExecStart=/opt/uum/pet-server/uum-pet -config /opt/uum/pet-server/config.json
   Restart=always
   User=uum
   ```

4. Nginx 站点配置加一段（放在 `location /` 之前）：

   ```nginx
   location /api/ {
       proxy_pass http://127.0.0.1:8787;
       proxy_set_header Host $host;
       proxy_read_timeout 35s;
   }
   ```

5. `systemctl enable --now uum-pet && nginx -s reload`。

未部署本服务时，桌宠自动全程走本地规则引擎（前端已内置降级），站点功能不受影响。
