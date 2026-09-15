# -*- coding: utf-8 -*-
"""Mixt 面内容补齐：登记分类 + 既有 4 篇草稿转发布 + 新增 3 篇（合规：伪代码/打码/自建环境）"""
import io, json, os

OUT = r'D:\cppsoft\workbuddy\UU&Mixt\src\content\mixt'
CFG = r'D:\cppsoft\workbuddy\UU&Mixt\src\config\categories-mixt.json'
os.makedirs(OUT, exist_ok=True)

# ---------- ① 分类登记（4 个） ----------
cats = [
    {"slug": "heap", "name": "堆利用", "desc": "堆与分配器的机制拆解：结构布局、保护机制与利用条件。"},
    {"slug": "stack-fmt", "name": "栈与格式化字符串", "desc": "栈帧布局、canary、ROP 链构造与格式化字符串的读写原语。"},
    {"slug": "ctf", "name": "CTF", "desc": "CTF pwn 题的完整思路复盘：从信息收集到利用链的组织。"},
    {"slug": "toolchain", "name": "工具链", "desc": "调试器、追踪与可复现环境：把实验条件固定下来。"},
]
io.open(CFG, 'w', encoding='utf-8', newline='\n').write(json.dumps(cats, ensure_ascii=False, indent=2) + '\n')
print('① Mixt 分类已登记:', ' / '.join(c['name'] for c in cats))

# ---------- ② 既有 4 篇：草稿转发布 + 分类对齐 ----------
fixes = {
    'tcache-layout-glibc235.md': ('堆利用（示例）', '堆利用'),
    'heap-techniques-compare.md': ('堆利用（示例）', '堆利用'),
    'ctf-pwn-walkthrough.md': ('CTF（示例）', 'CTF'),
    'pwn-env-docker.md': ('工具链（示例）', '工具链'),
}
for f, (oldc, newc) in fixes.items():
    p = os.path.join(OUT, f)
    s = io.open(p, encoding='utf-8').read()
    if f'category: {oldc}' not in s:
        print('② 跳过（已处理）:', f)
        continue
    s = s.replace(f'category: {oldc}', f'category: {newc}', 1)
    s = s.replace('draft: true', 'draft: false', 1)
    # 正文里的「草稿」标注去掉（已发布）
    s = s.replace('（此篇为种子草稿：Mixt 面分类初始为空，示例分类仅保留 Demo 形态；正文由本人经写作台补齐后，先登记分类再发布。）',
                  '（本文为初始内容，由 UU 代为迁移；Mixt 本人可经写作台继续修订与补充。）')
    s = s.replace('（草稿）', '')
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('② 已发布:', f, '→', newc)

# ---------- ③ 新增 3 篇 ----------
NEW = [
    dict(slug="stack-overflow-to-rop", title="从栈溢出到 ROP 链：把控制流一步步接回来",
         date="2026-08-10", category="栈与格式化字符串",
         tags=["pwn", "rop", "stack"], featured=True, draft=False,
         desc="从栈帧布局与 canary 的检查时机讲起，逐步说明如何在只有局部覆盖能力的前提下收集 gadget、组织调用链，以及哪些条件下这条路径会失效。",
         body="""## 起点：栈帧长什么样

在 x86-64 上，一个典型的函数栈帧自高地址向低地址依次是：调用者的局部变量、返回地址、保存的 rbp、被调用者的局部变量与缓冲区。**溢出的方向决定了你能改到什么**——从缓冲区往上写，最先够到的是保存的 rbp，然后是返回地址。

```c
// 伪代码：危险的读入（长度未与缓冲区大小比较）
void greet(void) {
    char buf[64];
    read(0, buf, 512);   // 长度由外部控制
    puts(buf);
}
```

## canary 的检查时机

栈保护插入的 canary 在**函数返回前**才比对。这意味着：

- 覆盖过程本身不会被立刻拦住
- 但如果你想改返回地址，就会连带改掉 canary——除非能先泄露出它的值

## 三个必要环节

1. **确定偏移**：从缓冲区起点到返回地址的字节数（用可控长度的输入在不同长度下观察崩溃点）
2. **拿到 gadget**：从目标二进制与它加载的 libc 里找 `pop rdi; ret` 这类片段，拼出参数传递
3. **组织调用链**：按调用约定把参数放进寄存器，再跳到目标函数

```python
# 伪代码：调用链骨架（地址与偏移已打码）
payload  = b"A" * OFFSET
payload += canary
payload += b"B" * 8          # saved rbp
payload += p64(pop_rdi_ret)  # 参数 1
payload += p64(binsh_addr)
payload += p64(system_addr)
```

## 什么条件下会失效

- 栈不可执行且找不到足够 gadget（片段被裁剪）
- 存在 PIE 且拿不到任何泄露点
- 保护组合导致必须一次成型（没有第二次输入机会）

> 本文仅用于安全研究与防御，全部实验在自建容器环境中完成；代码为伪代码，地址与偏移均已打码，不包含可直接复用的完整利用程序（PRD 3.7）。"""),

    dict(slug="format-string-read-write", title="格式化字符串：一次输入换来的读原语与写原语",
         date="2026-07-14", category="栈与格式化字符串",
         tags=["pwn", "format-string"], featured=False, draft=False,
         desc="把 printf 家族的参数读取规则讲清楚，说明为什么一次可控的格式串既能读出栈上的数据，也能向任意地址写入——以及现代编译期检查能拦住哪些写法。",
         body="""## 问题的本质

`printf` 的参数数量由**格式串自己**决定。如果格式串来自外部输入，调用者没传的实参就会从寄存器与栈上「顺延」读取——这既是泄露的来源，也是写入的入口。

## 读原语

```c
// 伪代码：格式串来自输入
printf(user_input);     // 输入 "%p %p %p" 会依次读出栈上的值
```

用 `%N$p` 可以定向读第 N 个参数位置，从而在多次运行之间定位稳定可读的位置。

## 写原语

`%n` 家族把「已输出字符数」写回指针参数指向的地址。配合宽度控制，理论上可以写入任意值——但现代编译器会对此类格式串发出警告，`_FORTIFY_SOURCE` 与部分加固选项也会直接拒绝。

## 实用顺序

1. 先用 `%p` 扫描，定位「自己的输入在栈上第几个参数位置」
2. 再用该位置做定向读写
3. 写入尽量选低位地址 + 分次写（避免一次写巨量字符）

## 编译期检查能挡住什么

- 字面量格式串中的 `%n`：编译期报警
- 变量格式串：多数发行版会在构建时警告（但不会自动修复）
- 真正的修复只有一条：**不要用外部输入当格式串**

> 本文仅用于安全研究与防御，实验在自建环境完成；示例为伪代码且已打码，不含可直接复用的利用程序（PRD 3.7）。"""),

    dict(slug="pwndbg-workflow", title="调试器工作流：把 pwndbg 用成顺手的实验记录本",
         date="2026-06-01", category="工具链",
         tags=["gdb", "pwndbg", "工具链"], featured=False, draft=False,
         desc="整理一套可复用的调试流程：断点与观察点该怎么放、堆状态用什么命令看、如何把一次会话中的关键命令与输出保存下来，让下次实验能直接对照重放，而不是每次从零摸索。",
         body="""## 目标：让每次实验都能重放

调试的价值不在"看到内存"，而在**能重复看到同一处内存**。因此流程围绕两件事：固定环境（见另一篇容器环境笔记）+ 保存会话记录。

## 常用姿势

```text
# 观察点：只在值变化时停下（比断点更适合跟踪堆操作）
watch *(long *)$rdi

# 堆视角（pwndbg 提供）
heap / bins / tcachebins

# 反汇编与源码对不上时，确认加载基址
vmmap / info proc mappings
```

## 三条经验

1. **先看映射再下断点**：PIE 打开时地址每次都变，用符号名或 `$base+offset` 下断
2. **把观察点放在写入侧**：跟踪"谁改了这个字段"比跟踪"谁读了这个字段"更有价值
3. **会话记录进仓库**：把关键命令与输出存成文本，和实验脚本放一起，下次直接对照

## 别做的事

- 不要关掉 ASLR 之后再声称结论成立（真实场景里它是开的）
- 不要用一次性脚本替代理解：脚本的价值是复现，前提是你知道它复现的是什么

> 本文仅用于安全研究与防御，所有实验在自建容器环境完成（PRD 3.7）。"""),
]

bad = [(n['slug'], len(n['desc'])) for n in NEW if not (60 <= len(n['desc']) <= 120)]
if bad:
    raise SystemExit('描述长度不合规: %s' % bad)

for n in NEW:
    fm = [
        '---',
        f'title: "{n["title"]}"',
        f'slug: {n["slug"]}',
        f'description: "{n["desc"]}"',
        f'date: {n["date"]}',
        f'author: mixt',
        f'category: {n["category"]}',
        f'tags: [{", ".join(n["tags"])}]',
        f'featured: {str(n["featured"]).lower()}',
        f'draft: {str(n["draft"]).lower()}',
        '---',
        '',
    ]
    p = os.path.join(OUT, n['slug'] + '.md')
    io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(fm) + n['body'] + '\n')
    print('③ 新增:', n['slug'], '| desc', len(n['desc']), '字')
print('完成：Mixt 面共 7 篇（4 转发布 + 3 新增），分类 4 个')
