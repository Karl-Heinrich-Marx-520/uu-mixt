---
title: "一道 CTF pwn 题的完整思路复盘"
slug: ctf-pwn-walkthrough
description: "从信息收集到偏移计算，记录每一步的判断依据与排除过程；所有地址与细节均已打码，实验全程在自建容器环境中复现，仅保留思路。"
date: 2026-07-02
author: mixt
category: CTF
tags: [ctf, pwn]
featured: false
draft: false
---
## 信息收集

拿到二进制先做三件事：`checksec` 看保护、看菜单交互、找可疑的输入长度。这道题的线索是**长度校验写在拷贝之后**。

## 判断链

- 保护：NX 开、canary 开、PIE 开 → 先想办法泄露
- 交互：菜单有「查看」与「编辑」两个入口 → 大概率能给读原语
- 输入：编辑时长度可以写到分配大小之外 → 堆溢出

## 打码后的关键片段

```c
// 原题此处长度校验在 memcpy 之后
memcpy(dst, src, len);          // len 未与 capacity 比较
if (len > capacity) return -1;  // 校验来得太晚
```

## 复盘

1. 先泄露 libc 基址，再算 one_gadget 约束
2. 全程在自建容器里复现，版本固定
3. 结论：这类题的难点不是手法，而是**信息收集的完整度**
