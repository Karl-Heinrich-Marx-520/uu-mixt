# 任务包 2 自测证据（内容管线 + 内容层替换）

对应 `docs/03-开发任务书.md` 任务包 2 的 6 条验收标准。
复现方式：`node node_modules/astro/astro.js build`（仓库路径含 `&`，npm run 会解析错 astro bin）。

| 文件 | 验收项 | 结果 | 说明 |
|---|---|---|---|
| `2a-author-error.txt` | 2 · 写错 author | ✅ 构建失败（退出码 1） | 报错含文件路径 + 字段名 + 期望值 + 实际值 |
| `2b-category-error.txt` | 2 · 写错 category | ✅ 构建失败 | 额外列出本面已登记的分类清单，便于改正 |
| `2c-description-error.txt` | 2 · 写错 description | ✅ 构建失败 | Astro schema 层拦截（zod），含字段名与字符数下限 |
| `3-slug-conflict.txt` | 3 · 两篇同 slug | ✅ 构建失败 | 见下方「为什么要在文件层扫描」 |
| `4-rename-category.txt` | 4 · 分类改名同步 | ✅ 配置 1 处 + 文章 2 篇同步，无残留 | `scripts/rename-category.mjs` |

## 通过项（无报错，需构建产物验证）

| 验收项 | 结果 | 证据 |
|---|---|---|
| 1 · 正确 Markdown 自动出现 | ✅ | `/uu/` 7 张卡片；`/uu/writing/` 7 行 + 2026/2025 两个年份组；详情页 7 个 |
| 5 · 空分类降级 | ✅ | `/mixt/` 无卡片（走空状态）、无筛选条、不生成任何 Mixt 详情页；Mixt 面 4 篇为草稿 |
| 6 · 只改配置新增分类 | ✅（构图域） | 归档筛选 chip 由 `src/config/categories-uu.json` 生成；临时加「工具链」后构建即出现，未改任何代码 |
| 附加 | ✅ | 已发布文章用未登记分类 → 构建失败（`草稿放行 / 发布拦截`规则生效） |

## 为什么 slug 冲突要在「文件层」扫描

Astro 的 glob loader 会把 frontmatter 的 `slug` 当作 entry id；两个文件同 slug 时**只输出一条 WARN 并让后者覆盖前者**——集合里看不到冲突，`getCollection()` 拿到的只有一条。
因此 `src/lib/content-layer.ts` 在读取集合之前先用 `node:fs` 扫描 `src/content/<face>/*.md` 的 `slug:`，重复即报错。**这是本任务包最容易被漏掉的一处**。

## 已知偏离（如实记录）

- 任务书要求第 2、3 项「必须有报错截图」。此处提供的是**终端输出的原文捕获**（含退出码）+ 可复现命令，不是图片形式的截图——本机无头 Chrome 在 `--blink-settings=scriptEnabled=false` 下不出图（另见任务包 1 记录），如需图片证据可人工跑一次命令截屏。
- 验收 6 的「导航与分类页自动出现」部分：导航项与分类页属任务包 3 的页面迁移范围，本包只验证到**归档筛选条**与**校验放行**。
