---
title: "co_await 发生时，栈到底去了哪里：C++20 协程帧的布局拆解"
slug: cpp20-coroutine-frame
description: "用 -fcoroutines 编译一段最小协程，对照汇编看 promise、协程帧与局部变量的摆放，理解「暂停即返回、恢复即跳回」在机器层面意味着什么。"
date: 2026-08-02
author: uu
category: C++
tags: [C++, 并发]
featured: false
draft: true
---
## 最小协程

```cpp
task<void> f() {
    int local = 42;
    co_await std::suspend_always{};
    use(local);              // 恢复后 local 还在，它没在栈上
}
```

## 帧里有什么

用 `-fcoroutines` 编出来看汇编，协程帧至少包含：

1. resume / destroy 函数指针（编译器生成）
2. promise 对象（你自己定义的那个）
3. 跨挂起点存活的局部变量与形参副本

`co_await` 的第一个动作是把「返回地址」换成 `resume` 的地址 —— 所以「暂停即返回、恢复即跳回」在机器层面就是一次普通的函数调用与返回。

> 踩坑：把大对象放进协程帧会让帧膨胀；能 `move` 进帧的就别让它留在栈上被整份拷贝。

