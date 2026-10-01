---
title: "glibc2.42草稿"
slug: glibc2-42
description: "malloc迎来大变"
date: 2026-10-01
author: mixt
category: IO_FILE
tags: [堆]
featured: false
draft: true
---
昨天打`largebin attack`的时候，发现glibc 2.42对这个横穿一个时代的利用手法进行了修复
搜索相关资料，发现2.42对整个chunk体系进行了大大小小的数十个整改
有时间的话我会整理一下这些改动以及影响的手法

