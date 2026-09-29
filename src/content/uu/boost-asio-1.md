---
title: "Boost.Asio学习（1）：基础的客户端服务器"
slug: boost-asio-1
description: "用 Boost.Asio 同步模型搭建最小 TCP 服务器与客户端，讲解 io_context、endpoint、socket、acceptor 及错误处理方式。"
date: 2026-09-28
author: uu
category: Boost.Asio
tags: [C++, 网络编程, 异步编程, Boost.Asio]
featured: false
draft: false
---
学习 Asio 之前，建议先熟悉 Linux 下的 socket 套接字编程，对 C 风格的网络 API 有一手体感。本篇用 Asio 建立最基本的服务器与客户端模型，并介绍几个核心类：`endpoint`、`socket`、`acceptor`。全文为同步（阻塞）模型，异步读写留到第 3 篇。

## 服务器

一个最小但完整的服务器：监听 8080 端口、接受一个连接、读一条消息并原样回显：

```cpp
// server.cpp
#include <array>
#include <iostream>
#include <string_view>

#include <boost/asio.hpp>

int main() {
    try {
        namespace asio = boost::asio;
        using tcp = asio::ip::tcp;

        asio::io_context io_context;

        // 创建监听器并绑定 0.0.0.0:8080：
        // tcp::v4() 配 endpoint 时默认地址即 INADDR_ANY
        tcp::acceptor acceptor(io_context, tcp::endpoint(tcp::v4(), 8080));
        std::cout << "Server is listening on port 8080...\n";

        tcp::socket socket(io_context);
        acceptor.accept(socket);  // 同步阻塞，直到一个客户端连入
        std::cout << "Client connected from " << socket.remote_endpoint() << "\n";

        std::array<char, 1024> recv_buf{};
        boost::system::error_code ec;
        const std::size_t len = socket.read_some(asio::buffer(recv_buf), ec);
        if (ec) {
            std::cerr << "Receive failed: " << ec.message() << "\n";
            return 1;
        }
        std::cout << "Received " << len << " bytes: "
                  << std::string_view(recv_buf.data(), len) << "\n";

        // 原样回显给客户端
        boost::asio::write(socket, asio::buffer(recv_buf.data(), len), ec);
    } catch (const std::exception& e) {
        std::cerr << "Exception: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
```

**`io_context` 是 Asio 的核心：**&#x540C;步模型下它主要充当资源上下文——`socket`、`acceptor` 等所有 I/O 对象的构造都必须传入它；到异步模式（第 3 篇起）它会升级为驱动所有回调的事件循环，真正的价值那时才显现。现在记住一条即可：**每个 Asio I/O 对象都挂在一个 `io_context` 上**。

另外，所有收发都**不涉及 `'\0'`**：TCP 是字节流，按长度收发，字符串结尾符是应用层的事——收了多少字节（`len`）就处理多少，`read_some` 与 `write` 都以长度为准。

## 客户端

```cpp
// client.cpp
#include <array>
#include <iostream>
#include <string>
#include <string_view>

#include <boost/asio.hpp>

int main() {
    try {
        namespace asio = boost::asio;
        using tcp = asio::ip::tcp;

        asio::io_context io_context;

        tcp::socket socket(io_context);
        tcp::endpoint endpoint(asio::ip::make_address("127.0.0.1"), 8080);
        socket.connect(endpoint);  // 同步阻塞连接

        const std::string msg = "hello, asio";
        boost::system::error_code ec;
        const std::size_t len = boost::asio::write(socket, asio::buffer(msg), ec);
        if (ec) {
            std::cerr << "Send failed: " << ec.message() << "\n";
            return 1;
        }
        std::cout << "Sent " << len << " bytes\n";

        std::array<char, 1024> recv_buf{};
        const std::size_t rlen = socket.read_some(asio::buffer(recv_buf), ec);
        if (ec) {
            std::cerr << "Receive failed: " << ec.message() << "\n";
            return 1;
        }
        std::cout << "Echo: " << std::string_view(recv_buf.data(), rlen) << "\n";
    } catch (const std::exception& e) {
        std::cerr << "Exception: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
```

两个程序里错误都走了两条通道：**收发函数带 `boost::system::error_code&` 出参**（失败不抛异常，`ec` 里给原因），**连接与监听的建立阶段用异常**（端口被占、地址非法这类"启动期硬错误"直接 fail-fast）。

## endpoint：地址与端口的抽象

`endpoint` 相当于原生编程里的 `sockaddr_in`，是"IP 地址 + 端口"的组合：

```cpp
tcp::endpoint ep1(asio::ip::make_address("127.0.0.1"), 8080);  // 指定 IP
tcp::endpoint ep2(tcp::v4(), 8080);                            // 任意 IPv4 地址（INADDR_ANY）
```

常用成员：

| **成员**                   | **说明**                |
| ------------------------ | --------------------- |
| `address()` / `port()`   | 读取 IP 地址 / 端口号        |
| `address(a)` / `port(p)` | 设置 IP 地址 / 端口号        |
| `protocol()`             | 返回协议类型（如 `tcp::v4()`） |

### make\_address：字符串解析成地址

`asio::ip::make_address(str)` 把字符串解析为 `asio::ip::address`，提供异常与 `error_code` 两个重载：

```cpp
asio::ip::address make_address(const std::string& str);             // 解析失败抛异常
asio::ip::address make_address(const std::string& str,
                               boost::system::error_code& ec);      // 失败写 ec，不抛
```

启动期配置（如从配置文件读监听地址）适合异常版 fail-fast；解析运行期不可信输入时用 `ec` 版：

```cpp
boost::system::error_code ec;
auto addr = asio::ip::make_address(user_input, ec);
if (ec) {
    std::cerr << "Invalid address: " << ec.message() << "\n";
}
```

注意它**只接受 IP 字面量**——`"127.0.0.1"` 合法、`"example.com"` 直接解析失败；解析域名是 `tcp::resolver` 的职责，见下文 `connect` 一节。

## socket：类型安全的连接端点

Boost.Asio 把 socket 抽象为类，TCP 用 `asio::ip::tcp::socket`、UDP 用 `asio::ip::udp::socket`。构造必须传入 `io_context`（或执行器）：

```cpp
tcp::socket socket(io_context);  // 创建未连接的 socket
```

与 Linux 原生 socket 的对比：

| **差异点** | **Linux 原生 socket**                           | **Boost.Asio socket**             |
| ------- | --------------------------------------------- | --------------------------------- |
| 创建方式    | `socket(AF_INET, SOCK_STREAM, 0)` 返回 `int` fd | `tcp::socket(io_context)` 强类型对象   |
| 错误处理    | 手动检查 `errno`                                  | `error_code` 或异常                  |
| 关闭      | 手动 `close(fd)`                                | 析构自动关闭（RAII）                      |
| 异步支持    | 手写 epoll/select                               | 内置 `async_read` / `async_write` 等 |
| 跨平台     | POSIX 风格 API（Windows 为另一套 Winsock）            | 同一份代码覆盖 Windows / Linux / macOS   |

## connect：成员函数与全局函数

TCP 连接有两个同名成员：

```cpp
// ① socket 的成员函数：连接到指定的一个 endpoint
socket.connect(endpoint);

// ② 全局函数 boost::asio::connect：配合 resolver，依次尝试多个地址直到成功
tcp::resolver resolver(io_context);
auto results = resolver.resolve("example.com", "http");  // 域名 → 多个 endpoint
boost::asio::connect(socket, results);
```

区别一句话：**`socket.connect(ep)` 只试一个地址；`asio::connect(socket, results)` 对 DNS 解析出的多个候选逐个尝试**。域名解析就是 `resolver` 的职责——`make_address` 处理不了的字符串都交给它。

## acceptor：服务器的监听器

`tcp::acceptor` 是服务器专用类，一个构造函数等价于原生 API 的三步：

```cpp
// 等价于 socket() + bind() + listen()
tcp::acceptor acceptor(io_context, tcp::endpoint(tcp::v4(), 8080));
```

构造完成即处于监听状态，之后用 `accept` 接收连接：

```cpp
tcp::socket socket(io_context);
acceptor.accept(socket);  // 同步阻塞；连接建立后 socket 可用于收发
```

常用成员函数：

| **成员函数**                        | **说明**                                      |
| ------------------------------- | ------------------------------------------- |
| `accept(socket)`                | 同步阻塞，接收一个连接                                 |
| `async_accept(socket, handler)` | 异步接收，完成时回调（需 `io_context::run()` 驱动，见第 3 篇） |
| `is_open()` / `close()`         | 判断打开状态 / 关闭监听器                              |
| `local_endpoint()`              | 获取本地绑定的地址与端口                                |
| `set_option()` / `get_option()` | 设置/获取 socket 选项（如地址复用）                      |
| `native_handle()`               | 拿到底层 fd（与原生 API 交互时用）                       |
| `listen()` / `bind()`           | 显式调用（构造函数已隐含）                               |
| `cancel()`                      | 取消所有挂起的异步操作                                 |

## 同步与异步的对比

本篇全部是**同步**调用：`accept`、`connect`、`read_some`、`write` 都阻塞当前线程直到完成。异步版本把阻塞变成回调：

```cpp
// 同步：调用线程阻塞直到连接到来
acceptor.accept(socket);

// 异步：立即返回，连接到来时回调触发（需要 io_context::run() 驱动事件循环）
acceptor.async_accept(socket, [](const boost::system::error_code& ec) {
    if (!ec) {
        std::cout << "Client connected!\n";
    }
});
```

异步是 Asio 的主菜，但它的回调线程模型、生命周期管理都比同步复杂得多——先在同步模型里把 `endpoint` / `socket` / `acceptor` 三个类用熟，第 3 篇再进入异步。

## 构建与自测

Boost.Asio 是 header-only，C++20 编译，`CMakeLists.txt` 关键行：

```cmake
find_package(Boost CONFIG REQUIRED)
target_link_libraries(server PRIVATE Boost::headers)
target_compile_features(server PRIVATE cxx_std_20)
```

开两个终端，先启动 `server.exe`（打印 `Server is listening on port 8080...`），再运行 `client.exe`。预期结果：

```text
server: Client connected from 127.0.0.1:xxxxx
        Received 11 bytes: hello, asio

client: Sent 11 bytes
        Echo: hello, asio
```

服务器处理完这一个连接后正常退出（同步模型一次只服务一个连接，多连接留到第 4 篇）。



