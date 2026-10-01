---
title: "kernel UAF"
slug: kernel-uaf
description: "kernel UAF 是内核中释放后仍被引用的内存漏洞，常被用于提权与容器逃逸，需结合堆布局与对象生命周期分析。"
date: 2026-10-01
author: mixt
category: linux kernel pwn
tags: [UAF, kernel pwn]
featured: false
draft: true
---

# Use After Free

