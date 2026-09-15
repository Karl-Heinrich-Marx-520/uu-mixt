---
title: "glibc 2.35 tcache 结构体布局与保护机制速览"
slug: tcache-layout-glibc235
description: "从 chunk 头与 tcache_entry 的字段布局讲起，把 safe-linking、key 校验与常见触发条件下的行为差异梳理清楚，全部实验在自建环境完成。"
date: 2026-08-20
author: mixt
category: 堆利用
tags: [pwn, glibc, tcache]
featured: true
draft: false
---
## 从一个结构体开始

tcache 的核心就两个结构：每线程一个的 `tcache_perthread_struct`，和挂在 bin 上的 `tcache_entry`。2.35 的字段布局与保护机制如下（地址已打码）：

```c
// 伪代码：字段布局示意
struct tcache_entry {
    struct tcache_entry *next;   // safe-linking: ptr ^ (addr >> 12)
    uintptr_t            key;    // 指向 perthread_struct，双重释放检测
};
```

## 保护机制对照

| 机制 | 引入版本 | 绕过思路（打码） |
| --- | --- | --- |
| safe-linking | 2.32 | 已知堆地址即可还原 |
| key 校验 | 2.29 | 换 key 或先 free 再 UAF 改写 |
| 对齐检查 | 2.32 | 保持 16 字节对齐 |

## 正文待补

（本文为初始内容，由 UU 代为迁移；Mixt 本人可经写作台继续修订与补充。）
