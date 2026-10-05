# 线上 Nginx 配置存档（UU&Mixt）

本目录是**线上配置的副本**，用于灾难恢复与变更留痕。线上唯一权威仍在服务器上，改完请回拷一次。

| 仓库文件 | 线上位置 |
|---|---|
| `uum.conf` | `/etc/nginx/sites-available/uum.conf`（`sites-enabled/uum.conf` 为其软链） |
| `snippets/uum-sec.conf` | `/etc/nginx/snippets/uum-sec.conf` |
| `snippets/uum-hsts.conf` | `/etc/nginx/snippets/uum-hsts.conf` |
| —（仅服务器） | `/etc/nginx/nginx.conf` 的 `http {` 块内有 `server_tokens off;` |

内容速览：443 主站（Let's Encrypt + HSTS + 安全头 + 静态缓存）、80 强制跳转并保留 ACME 验证、8080 IP 预览（域名异常时的后路，含 `/api/` 反代到 `127.0.0.1:8787`）。

## 部署方式

```sh
scp uum.conf                root@<server>:/etc/nginx/sites-available/uum.conf
scp snippets/uum-sec.conf   root@<server>:/etc/nginx/snippets/uum-sec.conf
scp snippets/uum-hsts.conf  root@<server>:/etc/nginx/snippets/uum-hsts.conf
ssh root@<server> 'nginx -t && systemctl reload nginx'
```

## 维护时必读的两个坑

1. **`add_header` 会覆盖而不是叠加**：某个 `location` 内只要出现一条 `add_header`，server 级的全部 `add_header`（含 HSTS 与 4 条安全头）在该 location 内**静默失效**。因此凡自带 `add_header` 的 location（`/_astro/`、图片正则、`\.html$`、`/search-index.json`）都必须重复 `include snippets/uum-sec.conf;`。
2. **`location /_astro/` 必须用 `^~`**：否则后加的图片正则 location 优先级更高，会把 `/_astro/` 的资源拖出「一年 immutable」缓存。

## 验收（改完必跑）

```sh
curl -sI https://uuandmixt.com/ | grep -iE 'x-content-type|x-frame|referrer|permissions|strict-transport'
curl -sI https://uuandmixt.com/images/<任一图>.png | grep -iE 'cache-control|x-content-type'
curl -sI http://<server>:8080/ | grep -iE 'x-content-type|permissions'
```

首页之外的路径也要验：404 页、文章配图、`/_astro/` 静态资源——只验根路径会漏掉上述坑 1。
