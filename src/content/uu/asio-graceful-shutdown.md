---
title: "用 Boost.Asio 搭一个可优雅退出的异步 TCP 服务器"
slug: asio-graceful-shutdown
description: "主线程 accept、IO 线程池、独立逻辑线程的三层模型，加上 signal_set 驱动的停机序列，让服务器可以不丢连接地退出。完整实现与踩坑记录。"
date: 2026-09-05
author: uu
category: 工程实践
tags: [C++, 网络编程]
featured: false
draft: true
---
大部分教程写到这里就停了：`io_context::run()` 跑起来，服务器「能跑」。但生产环境里，一个不能体面退出的服务器等于不能上线——重启部署时在途的连接怎么办？半条消息写到一半怎么办？这篇文章记录我在自己的项目里落地的一套**三层线程模型 + 信号驱动的停机序列**，全部基于现代 C++ 写法。

## 为什么需要优雅退出

Ctrl+C 发出的 `SIGINT` 默认行为是终止进程，内核直接回收资源：**来不及回包、来不及落盘、来不及通知对端**。对长连接网关来说，粗暴 kill 意味着客户端只能靠超时感知断连。

优雅退出的目标可以拆成三条：

- 停止接受**新**连接（关 acceptor，不关 listener socket 的存量连接）
- 给**在途**连接一个收尾窗口（把队列里的事件处理完、回完最后一个包）
- 停机顺序可预期、可复现——每次退出都走同一条路径

## 三层线程模型

参照 muduo 的「one loop per thread」思路，但不照抄它的实现，线程职责切三层：

> **主线程**只做 accept 与信号等待；**IO 线程池**（N 个）共同 `run()` 同一个 `io_context`，负责读写；**逻辑线程**独立一条，只消费任务队列，保证业务处理不阻塞 IO。

层与层之间用 strand / 队列衔接，任何一层都不会同步等待另一层——这是后面停机序列能成立的前提。

## 关键实现

信号处理是一切的入口。老写法是 `signal()` 注册回调里直接做清理，但异步 IO 的世界里更自然的做法是把信号也变成一个「异步事件源」：

```cpp
// ① 停机信号：Ctrl+C 不再直接 kill，而是通知 io_context 收尾
boost::asio::signal_set signals(io, SIGINT, SIGTERM);
signals.async_wait([&](boost::system::error_code, int) {
    acceptor.close();   // 先停止接受新连接
    io.stop();          // 再排空事件循环
});

// ② IO 线程池：N 个线程共同 run() 同一个 io_context
for (auto& t : io_threads)
    t = std::thread{[&] { io.run(); }};
```

会话层用 C++20 协程写，可读性比回调链高一截。注意 `as_tuple` 把异常变成错误码，避免停机期半路杀出的异常打乱退出顺序：

```cpp
awaitable<void> session(tcp::socket socket) {
    for (;;) {
        char data[4096];
        auto [ec, n] = co_await socket.async_read_some(
            buffer(data), as_tuple(use_awaitable));
        if (ec) break;              // 对端关闭 / 停机
        co_await post_to_logic(     // 投递到逻辑线程
            std::span{data, n});
    }
}
```

## 停机序列

把三层的退出顺序固定为：**acceptor 关闭 → io_context 排空 → join IO 线程 → join 逻辑线程**。每一步都依赖上一步的可观察结果，所以不用 sleep 赌运气：

1. `acceptor.close()`：新连接直接被拒，存量连接不受影响
2. `io.stop()` 后各 IO 线程的 `run()` 自然返回，`join()` 不会卡
3. 逻辑线程的任务队列空了再 `join`，保证最后一个业务处理完

## 踩坑记录

**不要用 umbrella 头文件。**图省事 include 了 `<boost/beast.hpp>`，结果它把 websocket、zlib 全拉进来，在 MSVC 下编译直接雪崩，报错还全是不明所以的别名未定义——真正的元凶藏在前 50 行之外。精确包含 `core.hpp` / `http.hpp` / `ip/tcp.hpp` 之后一次通过。这类坑的通用的排查姿势：从最小编译单元开始二分。

另外，glibc 对象的销毁顺序与 `io_context` 的生命周期也要留心：任何 async 对象都得活过 `run()` 的最后一次返回，否则退出瞬间就是一次 use-after-free。








