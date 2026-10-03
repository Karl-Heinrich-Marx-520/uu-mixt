---
title: "Boost.Asio学习（3）：异步读写"
slug: boost-asio-3
description: "讲解 Boost.Asio 异步读写：async_ 系列 API 与回调签名、回调执行线程与串行化规则，并实现一个基于 shared_ptr 保活的异步回声服务器。"
date: 2026-10-03
author: uu
category: Boost.Asio
tags: [C++, Boost.Asio, 异步编程, 网络编程]
featured: false
draft: false
---
第 2 篇的同步 API 有个天花板：`read`/`write`/`accept` 阻塞线程，一个线程同时只能伺候一个连接。本篇进入 Asio 的主菜——**异步读写**：发起操作后立即返回，完成时由回调通知。伴随这个模式而来的三件事是本篇的核心：**回调在哪个线程执行、回调链上对象如何保活、`io_context::run()` 如何驱动一切**。

## 异步 API 总览

与第 2 篇的同步三兄弟一一对应，异步版本在名字前加 `async_`：

| **分类** | **函数**                    | **完整性**       | **回调签名**                  |
| ------ | ------------------------- | ------------- | ------------------------- |
| 写      | `socket.async_write_some` | ❌ 可能部分写       | `(ec, bytes_transferred)` |
| 写      | `async_write`（全局）         | ✅ 循环写完        | `(ec, bytes_transferred)` |
| 写      | `socket.async_send`       | ❌ 部分，支持 flags | `(ec, bytes_transferred)` |
| 读      | `socket.async_read_some`  | ❌ 有多少读多少      | `(ec, bytes_transferred)` |
| 读      | `async_read`（全局）          | ✅ 循环读满        | `(ec, bytes_transferred)` |
| 读      | `socket.async_receive`    | ❌ 部分，支持 flags | `(ec, bytes_transferred)` |

flags 参数（如 `MSG_PEEK`）异步版同样存在，同样极少使用，不再展开。

**回调签名要看操作类型**：读写类是 `(error_code, bytes_transferred)`；`async_accept` 的回调只有 `(error_code)`（移动接受版本多一个新 socket）；定时器 `async_wait` 也只有 `(error_code)`。

异步调用的语义是**注册**：函数立即返回，I/O 在后台由 `io_context` 的完成队列驱动，完成时回调被调度执行。

## 回调在哪个线程执行

一条铁律：**回调执行在调用 `io_context::run()` 的线程里**。

* 单线程 `run()`：所有回调在这个唯一线程里**串行**执行——天然线程安全，不需要任何锁；
* 多个线程 `run()` 同一个 `io_context`：回调可能在不同线程**并发**执行——共享状态需要显式串行化（strand 或 mutex），第 4 篇展开。

关于线程安全的准确规则是：**不同 Asio 对象可以被不同线程并发使用；同一个对象的成员函数（或其回调）并发使用则不安全**。单线程 `run()` 模式下回调天然串行，这条规则自动满足——这也是本篇示例不加任何锁的原因。

串行化的专用工具是 `boost::asio::strand`：它把一组回调"排队"，即使多个线程在 `run()`，同一 strand 里的回调也一个一个执行。单线程模型用不上它，多线程模型（第 4 篇）里它是保护会话内部状态的首选。

## async\_accept：异步接收连接

```cpp
tcp::socket socket(io_context);

// 版本 A：自己准备 socket，accept 完成后它就是那条新连接
acceptor.async_accept(socket,
    [](const boost::system::error_code& ec) {
        if (!ec) { /* socket 可用 */ }
    });

// 版本 B：移动接受——不传 socket，accept 成功才在回调里拿到新连接
acceptor.async_accept(
    [](const boost::system::error_code& ec, tcp::socket peer) {
        if (!ec) { /* std::move(peer) 交给会话对象 */ }
    });
```

版本 B 是协程风格（第 6 篇）的主力用法：`tcp::socket peer = co_await acceptor.async_accept(use_awaitable);` 本质就是它的 co\_await 形式。accept 永远是被动等待，不存在"指定要 accept 哪个地址"；对端地址随用随查 `socket.remote_endpoint()` 即可。本篇与第 4 篇采用版本 A——先建会话、accept 落到会话的 socket 成员上，socket 与会话的绑定关系一目了然。

## 动手：异步回声服务器

三个文件：`Session`（一个连接的会话）、`Server`（监听并管理所有会话）、`main`（驱动事件循环）。

```cpp
// Session.h
#pragma once

#include <array>
#include <memory>
#include <string>

#include <boost/asio.hpp>
#include <boost/uuid/uuid_generators.hpp>
#include <boost/uuid/uuid_io.hpp>

class Server;

class Session : public std::enable_shared_from_this<Session> {
public:
    Session(boost::asio::io_context& ioc, Server& server);

    boost::asio::ip::tcp::socket& Socket() { return socket_; }
    const std::string& GetUuid() const { return uuid_; }
    void Start();

private:
    void DoRead();
    void HandleRead(const boost::system::error_code& ec, std::size_t bytes_transferred);
    void DoWrite(std::size_t bytes_transferred);
    void HandleWrite(const boost::system::error_code& ec, std::size_t bytes_transferred);

    boost::asio::ip::tcp::socket socket_;
    std::string uuid_;
    Server& server_;
    std::array<char, 1024> buf_{};
};
```

```cpp
// Session.cpp
#include "Session.h"

#include <iostream>
#include <string_view>

#include "Server.h"

Session::Session(boost::asio::io_context& ioc, Server& server)
    : socket_(ioc), server_(server) {
    uuid_ = boost::uuids::to_string(boost::uuids::random_generator()());
}

void Session::Start() {
    DoRead();
}

void Session::DoRead() {
    auto self = shared_from_this();  // 保活
    socket_.async_read_some(
        boost::asio::buffer(buf_),
        [self](const boost::system::error_code& ec, std::size_t bytes) {
            self->HandleRead(ec, bytes);
        });
}

void Session::HandleRead(const boost::system::error_code& ec,
                         std::size_t bytes_transferred) {
    if (ec == boost::asio::error::eof) {
        std::cout << "session " << uuid_ << ": peer closed gracefully\n";
        server_.RemoveSession(uuid_);  // 单线程模型：这里直接调用是安全的
        return;                        // 不再发起读，回调链结束
    }
    if (ec) {
        std::cout << "session " << uuid_ << ": read error " << ec.message() << "\n";
        server_.RemoveSession(uuid_);
        return;
    }

    std::cout << "session " << uuid_ << " received "
              << std::string_view(buf_.data(), bytes_transferred) << "\n";
    DoWrite(bytes_transferred);
}

void Session::DoWrite(std::size_t bytes_transferred) {
    auto self = shared_from_this();  // 保活
    boost::asio::async_write(
        socket_, boost::asio::buffer(buf_, bytes_transferred),
        [self](const boost::system::error_code& ec, std::size_t) {
            if (ec) {
                std::cout << "session " << self->uuid_ << ": write error "
                          << ec.message() << "\n";
                self->server_.RemoveSession(self->uuid_);
                return;
            }
            self->DoRead();  // 回显完成，进入下一轮读——读、写交替的串行链
        });
}
```

```cpp
// Server.h
#pragma once

#include <memory>
#include <string>
#include <unordered_map>

#include <boost/asio.hpp>

class Session;

class Server {
public:
    Server(boost::asio::io_context& ioc, unsigned short port);
    void RemoveSession(const std::string& uuid);

private:
    void DoAccept();

    boost::asio::io_context& ioc_;
    boost::asio::ip::tcp::acceptor acceptor_;
    std::unordered_map<std::string, std::shared_ptr<Session>> sessions_;  // 只做插入删除
};
```

```cpp
// Server.cpp
#include "Server.h"

#include <iostream>

#include "Session.h"

Server::Server(boost::asio::io_context& ioc, unsigned short port)
    : ioc_(ioc), acceptor_(ioc, boost::asio::ip::tcp::endpoint(boost::asio::ip::tcp::v4(), port)) {
    DoAccept();
}

void Server::DoAccept() {
    auto new_session = std::make_shared<Session>(ioc_, *this);
    acceptor_.async_accept(
        new_session->Socket(),
        [this, new_session](const boost::system::error_code& ec) {
            if (!ec) {
                sessions_.emplace(new_session->GetUuid(), new_session);
                new_session->Start();
            } else {
                std::cout << "accept failed: " << ec.message() << "\n";
            }
            DoAccept();  // 继续等下一个连接——accept 回调链同样是"注册 → 完成 → 再注册"
        });
}

void Server::RemoveSession(const std::string& uuid) {
    sessions_.erase(uuid);
}
```

```cpp
// main.cpp
#include <iostream>

#include "Server.h"

int main() {
    try {
        boost::asio::io_context ioc;
        Server server(ioc, 8082);
        std::cout << "Server running on port 8082. Ctrl+C to stop.\n";
        ioc.run();  // 阻塞驱动事件循环：只要还有挂起的异步操作就不会返回
    } catch (const std::exception& e) {
        std::cerr << "Fatal: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
```

几个要点：

* **回调链保活**。异步世界最大的坑是"回调触发时对象已经死了"。本例的保活链条是：`Server::sessions_` 强持有每个 `Session`（`shared_ptr`），同时每个异步回调都捕获 `self = shared_from_this()`——读写链不断，会话就活着。
* **同一时刻每个会话只有一个挂起操作**。`Start → DoRead → HandleRead → DoWrite → DoRead → …` 是一条交替的串行链：写回调完成才发下一轮读。这保证了 `buf_` 不会被读和写同时触碰。
* **eof 的处理**。`async_read_some` 收到对端关闭时 `ec == eof` 且 `bytes_transferred == 0`，此时结束会话并从服务器注销。
* **`Server&` 裸引用为什么安全**：`server` 是 `main` 的栈对象，活到 `main` 结束；所有回调都执行在 `ioc.run()` 期间，`run()` 返回后不会再有回调碰它。第 4 篇引入多线程后这个前提会重新审视，那里升级为 `weak_ptr`。

## io\_context::run() 的语义

`run()` 阻塞当前线程驱动事件循环，**直到 `io_context` 内部的工作计数归零**。计数由两部分构成：每个挂起的异步操作（挂起的 `async_accept`、进行中的读写）各占 1；`make_work_guard(io_context)` 创建的 **work guard** 也占 1，重置它才释放。

本篇的服务器靠前者"续命"：accept 回调末尾立刻再挂下一个 `async_accept`，任何时刻都恰好有一个挂起的 accept，计数永不归零，`run()` 因此不返回。这也是一个陷阱——如果哪条代码路径忘记重新挂 accept（比如某个错误分支提前 return），计数归零，`run()` 返回，服务器**静默退出**，没有任何报错。

第 4 篇的线程池会引入 work guard：把 `run()` 显式"钉住"，直到 `Stop()` 释放——那时停止时机由代码决定，而不是由"恰好还有没有挂起操作"决定。本例停止服务器的方式是 Ctrl+C 强杀——**优雅退出（信号 + 资源清理）留到第 4 篇**。

## 构建与自测

```bash
g++ -std=c++20 -Wall -Wextra Session.cpp Server.cpp main.cpp -o server3.exe -lws2_32 -lmswsock
```

每个连接对应一个会话对象、按 uuid 注销——多连接管理到这里已经成型。第 4 篇在它之上补齐：多线程 `io_context`、发送队列、粘包协议、逻辑线程与优雅退出。

