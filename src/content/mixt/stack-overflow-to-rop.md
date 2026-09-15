---
title: "从栈溢出到 ROP 链：把控制流一步步接回来"
slug: stack-overflow-to-rop
description: "从栈帧布局与 canary 的检查时机讲起，逐步说明如何在只有局部覆盖能力的前提下收集 gadget、组织调用链，以及哪些条件下这条路径会失效。"
date: 2026-08-10
author: mixt
category: 栈与格式化字符串
tags: [pwn, rop, stack]
featured: true
draft: false
---
## 起点：栈帧长什么样

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

> 本文仅用于安全研究与防御，全部实验在自建容器环境中完成；代码为伪代码，地址与偏移均已打码，不包含可直接复用的完整利用程序（PRD 3.7）。
