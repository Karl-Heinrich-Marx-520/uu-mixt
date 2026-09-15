---
title: "从三次握手到 epoll：一次服务端 accept 的完整路径"
slug: tcp-accept-to-epoll
description: "半连接队列、全连接队列、惊群、EPOLLEXCLUSIVE——沿着内核源码把 listen 到 accept 之间的每一步走一遍，配 strace 验证。"
date: 2026-07-19
author: uu
category: 网络编程
tags: [epoll, tcp, linux]
featured: false
draft: false
---
## 为什么要走一遍内核路径

应用层的 accept 只是一行代码，但「连接从哪里来、谁来唤醒 acceptor、惊群到底惊在哪」这些问题，只有沿着内核路径走一遍才答得上来。

## 路径拆解

1. **三次握手**在软中断上下文完成，SYN 进半连接队列，ACK 到达后迁入全连接队列
2. **accept** 只是从全连接队列取一个已完成的 `struct sock`，与握手本身无关
3. **epoll_wait** 的唤醒依赖回调：全连接队列非空 → 唤醒等待在该事件上的进程

## 惊群与对策

多个 worker 共同 epoll 同一个 listener fd 时，一个新连接可能唤醒一群进程，最终只有一个 accept 成功——其余白白醒来。`EPOLLEXCLUSIVE` 让内核只唤醒一个，代价是不能与 `EPOLLONESHOT` 混用。

## 验证姿势

```bash
# 全连接队列溢出观察（watch 计数增长）
ss -lnt
# 系统调用级验证 accept 的阻塞与返回
strace -f -e trace=accept4,epoll_wait ./server
```

把「listen backlog = 全连接队列长度」这个等式亲手验证一遍，比背十遍结论都牢。
