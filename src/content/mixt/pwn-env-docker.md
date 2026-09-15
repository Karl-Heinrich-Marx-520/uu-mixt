---
title: "环境自建：用 Docker 搭一套可复现的 pwn 调试环境"
slug: pwn-env-docker
description: "固定 glibc 版本、配好调试器与 ASLR 开关，让每次实验都在同一套自建容器环境里复现；环境自建本身也是合规要求的一部分。"
date: 2026-06-18
author: mixt
category: 工具链
tags: [docker, gdb, 工具链]
featured: false
draft: false
---
## 为什么要固定环境

同一个二进制在不同 glibc 下行为完全不同。复现别人的 writeup 时，第一件事不是看代码，而是**把版本对齐**。

## 最小 Dockerfile

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y gdb python3-pip patchelf
RUN pip3 install pwntools
WORKDIR /work
```

## 三件事

1. 固定 `libc.so.6` 与 `ld.so`，必要时用 patchelf 改 interp
2. 配好调试器插件，别在容器里现装
3. 关掉 ASLR 只在需要时，默认保持开启，才接近真实场景

> 环境自建是合规要求的一部分：所有实验都在自己的容器里完成。
