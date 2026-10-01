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

## 一. UAF：悬空指针利用

* 内核分配的对象地址由内核管理，用户态一般来说拿不到直接指针
* 而如果内核中存在一个可控指针，指向了一块已经释放的内存，内核没有把它置空(悬空指针)
* 之后当内核因为其他操作重新分配内存时，完全可能把同一块物理内存分配给一个新的内核对象
* 在实际利用中，通常会选择打开设备时创建的管理结构体作为占位对象

## 二. 例：[CISCN-2017]babydriver



