---
title: "muduo 源码阅读：EventLoop 怎么兑现 one loop per thread"
slug: muduo-event-loop
description: "从 EventLoop::loop() 的 poll + channel 分发读起，理清 Poller、Channel、EventLoop 三者的所有权关系，以及 eventfd 唤醒线程的用途。"
date: 2026-08-16
author: uu
category: 源码阅读
tags: [muduo, reactor]
featured: false
draft: false
---
## 问题

`one loop per thread` 说起来一句话，落到代码里至少要回答三个问题：谁拥有 Poller？Channel 生命周期归谁？跨线程唤醒怎么做？

## 三者的所有权

- **EventLoop** 拥有 Poller 与唤醒用的 eventfd
- **Channel** 只是 fd 的「事件登记表」，不拥有 fd
- **线程** 可以没有 EventLoop，但一个 EventLoop 只属于一个线程

```cpp
void EventLoop::loop() {
    while (!quit_) {
        activeChannels_.clear();
        pollReturnTime_ = poller_->poll(kPollTimeMs, &activeChannels_);
        for (auto* ch : activeChannels_) ch->handleEvent();
        doPendingFunctors();          // 跨线程任务在这里落地
    }
}
```

## eventfd 的用途

阻塞在 `poll()` 上的线程无法被普通变量唤醒。muduo 用 eventfd 往 poll 里塞一个可读事件 —— 于是「跨线程投递任务」退化成「唤醒 + 排空队列」两件小事。

## 与 Asio 的差别

Asio 把这一层抽象成 `io_context` + `strand`，不暴露 fd；muduo 则把 fd 与 Channel 摆在你面前。读 muduo 更容易看清「事件循环到底在转什么」。
