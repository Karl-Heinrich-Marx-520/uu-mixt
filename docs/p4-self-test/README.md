# 任务包 4 自测证据（写作台后端接线 · 方案 B）

自测方式：**同接口的内存假后端**（`/admin/desk/?mock=1`）驱动真实工作台代码；
生成的 Markdown 落盘后跑一次真实构建，验证「写作台产物 → 构建 → 上线可见」的闭环。
真实 GitHub API 调用未实测（无凭据，不应索取）——首次由作者用真实 PAT 验证。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 1 · 身份锁定（只管自己面） | ✅ | 以 Mixt 身份操作后，仓库层只出现 `src/content/mixt/**` 与 `src/config/categories-mixt.json`，**无任何 uu 路径**；写作台接口无 face 参数（见 `public/scripts/admin/desk.js`） |
| 2 · 发文提交（含分类/标签） | ✅ | `desk-generated.md` 为工作台实际生成的文件全文（frontmatter 字段与 PRD 3.2 一一对应） |
| 3 · 同名标题 slug 去重 | ✅ | 标题「tcache layout」与既有 `tcache-layout` 冲突 → 自动生成 `tcache-layout-2` |
| 4 · 分类改名同步文章 | ✅ | 改名「堆利用 → 堆利用与分配器」后，2 篇文章的 `category` 字段同步更新（新文章与种子文章均在列） |
| 5 · 构建后可见 | ✅ | 生成物落盘 → 构建：Mixt 列表 7→8 张卡片、归档 8 行、分类页含该文、详情页 `/mixt/posts/tcache-layout-2/` 生成 |
| 6 · 草稿不进构建产物 | ✅ | 同一文件转 `draft: true` → 列表回到 7、详情页消失、**全产物 grep 该 slug 命中 0 处** |
| 附加 | ✅ | 未登记分类的**已发布**文章被构建拦截（`5-category-unregistered-blocks.txt`——生成物里分类是 mock 仓库改名后的值，真实配置无此分类，构建即失败） |

## 自测发现并修复的缺陷

- **保存成功提示被立即清空**：`resetEditor()` 里清空了 `[data-post-msg]`，导致作者看不到提交结果。已修（并保留注释说明原因）。
