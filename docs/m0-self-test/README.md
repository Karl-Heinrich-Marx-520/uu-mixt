# M0 项目初始化 · 自测证据

| 项目 | 内容 |
|---|---|
| 里程碑 | M0 项目初始化 |
| 依据 | 《基于 Agent 的协作开发流程参考》v2.1 §1 |
| 执行日期 | 2026-09-12 |
| 环境 | Windows · Git Bash · `git version 2.55.0.windows.3` |
| 结论 | **通过** |

> **关于三连提交的说明**：流程文档 C5 要求「一次里程碑对应 `feat` + `test` + `docs` 三个提交」。M0 是纯初始化里程碑，**不产出任何功能代码**，因此三连提交退化为 `chore` + `docs` 两个类型。首个功能里程碑（M1）起恢复完整三连。

---

## 一、验收项与结果

| # | 验收项 | 判定方式 | 结果 |
|---|---|---|---|
| 1 | 仓库已初始化且默认分支为 `main` | `git symbolic-ref --short HEAD` | ✅ 输出 `main` |
| 2 | 首次提交已完成，历史可追溯 | `git log --format="%h %s"` | ✅ 5 个提交，信息完整可读 |
| 3 | 工作区无未提交的实质改动 | `git status --porcelain` | ✅ 本次提交后为空 |
| 4 | 凭据类文件被正确忽略 | `git check-ignore -v` 逐项验证 | ✅ 三项全部命中规则 |
| 5 | 换行符在仓库内统一为 LF | `git ls-files --eol` | ✅ 全部 `i/lf w/lf` |
| 6 | `AGENTS.md` 包含流程文档要求的四项要素 | 逐项人工核对 | ✅ 见第三节 |
| 7 | 需求文档已落地并被跟踪 | `git ls-files` | ✅ 8 个文件全部纳入版本管理 |

**失败项**：无。

---

## 二、命令与原始输出

### 2.1 分支名

```
$ git symbolic-ref --short HEAD
main
```

### 2.2 提交历史

```
$ git log --format="%h %s"
8824c27  chore: 添加 .gitattributes 统一换行符
31f9e85  chore(assets): 添加两位作者的头像占位文件
4eeff04  docs: 归档 PRD v1.0 与产品决策记录
c51656d  docs: 建立 AGENTS.md 协作规范
fe9432f  chore: 初始化仓库，添加 .gitignore 与 README
```

### 2.3 忽略规则生效性

```
$ git check-ignore -v .workbuddy/ .env deploy.local.sh
.gitignore:23:.workbuddy/       .workbuddy/
.gitignore:2:.env               .env
.gitignore:6:deploy.local.sh    deploy.local.sh
```

### 2.4 换行符统一性

```
$ git ls-files --eol | awk '{print $1, $2}' | sort -u
i/lf w/lf
```

索引（index）与工作区（working tree）均为 LF，无混用。

### 2.5 已跟踪文件清单

```
$ git ls-files
.gitattributes
.gitignore
AGENTS.md
README.md
assets/avatars/mixt.svg
assets/avatars/uu.svg
docs/01-产品需求文档-PRD.md
docs/02-产品决策记录.md
```

---

## 三、AGENTS.md 四项要素核对

流程文档 §1.2 要求 AGENTS.md 必须明确四项。逐项核对：

| 要求 | 本文件对应章节 | 是否满足 |
|---|---|---|
| 多 agent 分工（负责哪些模块/阶段，边界在哪） | §3.2 Agent 工作单元与边界（5 个工作单元，含「不能碰什么」列） | ✅ |
| 文件所有权（每个文件归属谁、谁有唯一修改权） | §3.1 人的所有权 + §3.3 文件所有权表 | ✅ |
| 提交与命名约定（Conventional Commits、分支、目录命名） | §4 提交与命名约定（含三连提交与共享改动 PR 流程） | ✅ |
| 强自测约束（可复现的自测脚本与证据归档） | §5 强自测约束（含 10 项本项目专属验收项） | ✅ |

**额外补充**（超出最低要求，但流程文档其他章节提到）：

- §0 全局约束 C1–C5（流程文档 §0 的原文固化）
- §2 权威文档分工 SSOT（对应流程文档 §2.5 的文档裁决思路，先做粗粒度分工，细粒度留待 §2.5）
- §6 安全与凭据纪律（对应 PRD 6.6）
- §7 环境与踩坑（对应流程文档的「踩坑即时沉淀」）

---

## 四、本次初始化发现并处理的问题

| # | 问题 | 处理 |
|---|---|---|
| 1 | 本机 `init.defaultBranch` 为 `master`，与流程要求的 `main` 不一致 | 初始化时显式使用 `git init -b main` |
| 2 | 本机 `core.autocrlf=true`，检出会转 CRLF；部署目标是 Linux 服务器 → 会产生整文件级假 diff | **新增 `.gitattributes`**，统一为仓库内 LF；`deploy.sh` 强制 LF |
| 3 | 仓库路径含 `&`（`UU&Mixt`），shell 中未加引号会被当作后台执行符 | 记入踩坑表；所有命令路径加引号 |
| 4 | 已在 `.gitignore` 中忽略 `.workbuddy/` | 项目长期知识已沉淀在 `docs/` 与 `AGENTS.md`，会话过程数据无需入库 |

---

## 五、未覆盖项（如实声明）

| 项 | 说明 |
|---|---|
| 双人协作验证 | 本里程碑仅由 UU 一侧执行，**Mixt 的 clone、身份配置与提交尚未验证**。待 Mixt 完成本地环境后补验 |
| 远端仓库 | **尚未创建 GitHub 私有仓库，也未配置 `origin`**。本地仓库已可用，但暂无异地副本 |
| 三连提交 | 见文首说明，M0 无功能代码，退化为 `chore` + `docs` |

---

## 六、复现方式

```bash
cd "D:/cppsoft/workbuddy/UU&Mixt"
git symbolic-ref --short HEAD
git log --format="%h %s"
git status --porcelain
git check-ignore -v .workbuddy/ .env deploy.local.sh
git ls-files --eol
git ls-files
```
