---
title: "Boost.Asio学习（2）：同步读写"
slug: boost-asio-2
description: "梳理 Boost.Asio 同步收发 API：send/write_some/write 与 receive/read_some/read 的分工、buffer 长度推导、返回值与 eof 判断，并给出回显示例。"
date: 2026-09-29
author: uu
category: Boost.Asio
tags: [C++, 网络编程, Boost.Asio, 异步编程]
featured: false
draft: false
---
第 1 篇我们已经能让客户端发一条、服务器回一条。本篇把同步收发的 API 讲全：发送的 `send` / `write_some` / `write`，接收的 `receive` / `read_some` / `read`，以及它们共同依赖的 `asio::buffer`。读完你会知道：**六个函数各管什么、返回值怎么读、对端关闭怎么判断**。

## buffer：收发的内存视图

收发函数都不直接接受 `std::string` 或数组，而是接受 `asio::buffer(...)` 创建的缓冲对象——它只描述"**从哪块内存开始、有多长**"，不拥有内存：

```cpp
char raw[64];                              // 可写内存
auto wbuf = asio::buffer(raw);             // mutable_buffer：用于收（数据写进这里）

const char* data = "hello";
auto cbuf = asio::buffer(data, 5);         // const_buffer：用于发（只读）
```

规则一句话：**收（read/receive）要传可写缓冲 `mutable_buffer`，发（write/send）要传只读缓冲 `const_buffer`**。`asio::buffer(...)` 根据实参的常量性自动选择，不需要手动区分。

### 长度怎么来的

不手动指定长度时，`buffer` 按实参类型推导：

| **实参**                            | **推导出的长度** | **说明**                         |
| --------------------------------- | ---------- | ------------------------------ |
| `char[N]` / `std::array<char, N>` | N（整个数组）    | 注意是数组全长，不是字符串长度                |
| `std::vector<char>`               | `size()`   | ​                              |
| `std::string`                     | `size()`   | ​                              |
| 裸指针 `char*`                       | ❌ 无法推导     | **必须手动给长度**：`buffer(ptr, len)` |

一个经典误区：

```cpp
char data[100] = "hello";
socket.send(asio::buffer(data));   // 发送 100 字节！"hello" 后面的 95 个 '\0' 会被原样发出去
socket.send(asio::buffer(data, 5)); // 只发 "hello" —— 需要精确长度时手动指定
```

`data` 的后 95 个字节是聚合初始化的 `'\0'`（不是垃圾值），但它们仍会被发送——**数组形式的 buffer 永远是数组全长**，只发有效内容就手动给长度。

## 发送：send / write\_some / write

三个发送函数的分工：

```cpp
// ① write_some：成员函数，"尽量写"，可能只写一部分
std::size_t n = socket.write_some(asio::buffer(msg), ec);

// ② send：成员函数，同样只写一次，但支持底层 flags
std::size_t n = socket.send(asio::buffer(msg), 0, ec);

// ③ write：全局函数，内部循环 write_some，直到整个 buffer 写完
std::size_t n = boost::asio::write(socket, asio::buffer(msg), ec);
```

| **​**         | **`send`**         | **`write_some`** | **`write`** |
| ------------- | ------------------ | ---------------- | ----------- |
| 类型            | 成员函数               | 成员函数             | 全局函数        |
| 完整性           | ❌ 只写一次，不保证发完       | ❌ 只写一次，不保证发完     | ✅ 循环写完全部    |
| flags 参数      | ✅ 支持               | ❌                | ❌           |
| 多块缓冲（scatter） | ✅                  | ✅                | ✅           |
| 典型场景          | 需要 `MSG_OOB` 等底层标志 | 自己控制写节奏          | **默认选择**    |

要点：六个收发函数**全部支持多块缓冲**（BufferSequence）——把多段内存一次交给内核做 scatter/gather，例如：

```cpp
std::vector<asio::const_buffer> parts{
    asio::buffer(header),   // 帧头
    asio::buffer(body),     // 帧体
};
boost::asio::write(socket, parts);  // 两段内存一次写完
```

"部分写"在同步阻塞模式下很少见（发送缓冲区满时才会发生），但 `write_some`/`send` 的返回值是**本次实际写入的字节数**，返回小于请求长度是合法的——要么自己循环补发，要么直接用 `write`。

（`send` 与 `receive` 还多一个 `flags` 参数，映射底层 BSD socket 标志如 `MSG_PEEK`——实践中极少用到，本文不展开。）

## 接收：receive / read\_some / read

三个接收函数与发送侧对称：

```cpp
// ① read_some：成员函数，"有多少读多少"，绝不阻塞等待填满
std::size_t n = socket.read_some(asio::buffer(buf), ec);

// ② receive：成员函数，同样只读一次，支持 flags（如 MSG_PEEK 窥探）
std::size_t n = socket.receive(asio::buffer(buf), 0, ec);

// ③ read：全局函数，内部循环 read_some，直到读满整个 buffer
std::size_t n = boost::asio::read(socket, asio::buffer(buf), ec);
```

| **​**        | **`receive`** | **`read_some`** | **`read`**    |
| ------------ | ------------- | --------------- | ------------- |
| 类型           | 成员函数          | 成员函数            | 全局函数          |
| 完整性          | ❌ 有多少读多少      | ❌ 有多少读多少        | ✅ 循环直到读满      |
| flags 参数     | ✅ 支持          | ❌               | ❌             |
| 多块缓冲（gather） | ✅             | ✅               | ✅             |
| 典型场景         | `MSG_PEEK` 窥探 | 配合自定义边界逻辑       | **已知长度的完整消息** |

`read_some` 的"some"就是字面意思：**内核接收缓冲里此刻有什么就搬什么，一块可能是一个字节**。第 1 篇的回显一次就读到了完整消息，纯属消息足够小；要"读满 N 字节"必须用 `read`——文末的示例会直观对比这两者。

## 返回值与错误处理

六个函数都提供异常版和 `error_code` 版，返回值规则一致：

| **情况** | **异常版**                         | **`error_code` 版**             |
| ------ | ------------------------------- | ------------------------------ |
| 成功     | 返回传输的字节数                        | 同左                             |
| 出错     | 抛 `boost::system::system_error` | **返回已传输的字节数（可能是部分值）**，错误在 `ec` |
| 空缓冲    | 返回 0，不抛不挂                       | 返回 0                           |

两个容易记错的点：`error_code` 版出错时返回的不是 0，而是**出错前已经传输的字节数**；`read`/`write` 的"循环"遇到错误会带着部分结果返回，不会把错误吞掉。

### 判断对端关闭

对端**正常关闭**（发来 FIN）时，读操作以 `boost::asio::error::eof` 收尾；连接被**异常重置**（RST）时则是 `connection_reset`。判断永远看 `ec`，不要看返回值是否为 0——而且**两个家族的 eof 行为不同**：

* **`read_some` / `receive`（单次读）**：eof 那次调用**恒返回 0 字节。**&#x6587;末服务端的 `if (ec == eof) break;` 因此不会丢数据。

```cpp
std::array<char, 1024> buf{};
std::size_t len = socket.read_some(asio::buffer(buf), ec);

if (ec == asio::error::eof) {
    std::cout << "对端正常关闭\n";                  // read_some 的 eof 恒为 0 字节
} else if (ec) {
    std::cout << "错误: " << ec.message() << "\n";  // 如 connection_reset
} else {
    std::cout << "收到 " << len << " 字节\n";
}
```

* **全局 `read`**：目标是"读满"，部分读取后遇 eof 时**返回已读字节数并置 `ec`**——这批尾巴是真实收到的数据。正确顺序是先消费 `len`、再判 `ec`：

```cpp
std::size_t len = boost::asio::read(socket, asio::buffer(buf), ec);
if (len > 0) {
    // EOF 前收到的尾巴也是数据，先处理
}
if (ec == asio::error::eof) {
    // 对端正常关闭
} else if (ec) {
    // 其他错误，如 connection_reset
}
```

两种情形里"返回值 0"的含义不同：`read_some` 的 0 表示"这次调用没读到数据"，`read` 的 0 表示"从头到尾一个字节都没收到"。所以判断对端关闭用 `ec`，而不是返回值。

## 实践：对比 read 与 read\_some 的回显程序

服务端用 **256 字节的小缓冲**循环 `read_some` 回显（演示"有多少读多少"），客户端发 1000 字节、用 **`read` 一次读满 1000**（演示"循环直到读满"），最后半关闭触发服务端的 eof：

```cpp
// server2.cpp —— 循环 read_some 回显；小缓冲会逼出"部分读"
#include <array>
#include <iostream>

#include <boost/asio.hpp>

int main() {
    try {
        namespace asio = boost::asio;
        using tcp = asio::ip::tcp;

        asio::io_context io_context;
        tcp::acceptor acceptor(io_context, tcp::endpoint(tcp::v4(), 8081));
        std::cout << "Echo server listening on port 8081...\n";

        tcp::socket socket(io_context);
        acceptor.accept(socket);
        std::cout << "Client connected from " << socket.remote_endpoint() << "\n";

        std::array<char, 256> buf{};  // 故意用小缓冲：一条消息要读好几轮
        std::size_t total = 0;
        for (;;) {
            boost::system::error_code ec;
            const std::size_t len = socket.read_some(asio::buffer(buf), ec);
            if (ec == asio::error::eof) {
                std::cout << "Peer closed connection (eof). Echoed "
                          << total << " bytes in total.\n";
                break;
            }
            if (ec) {
                std::cerr << "Receive failed: " << ec.message() << "\n";
                return 1;
            }
            total += len;
            boost::asio::write(socket, asio::buffer(buf.data(), len));  // 收多少回多少
        }
    } catch (const std::exception& e) {
        std::cerr << "Exception: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
```

```cpp
// client2.cpp —— write 完整写、read 读满、shutdown_send 触发对端 eof
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
        socket.connect(tcp::endpoint(asio::ip::make_address("127.0.0.1"), 8081));

        // write：内部循环 write_some，直到 1000 字节全部写完
        const std::string msg(1000, 'x');
        const std::size_t sent = boost::asio::write(socket, asio::buffer(msg));
        std::cout << "Sent " << sent << " bytes\n";

        // read：内部循环 read_some，直到读满 1000 字节（服务端分了 4 块回，read 替你拼齐）
        std::array<char, 1000> echo{};
        const std::size_t received = boost::asio::read(socket, asio::buffer(echo));
        std::cout << "Received " << received << " bytes, content "
                  << (std::string_view(echo.data(), received) == msg ? "matches" : "MISMATCH")
                  << "\n";

        // 半关闭：告诉服务器"我发完了"。服务器下一次 read_some 会看到 eof
        socket.shutdown(tcp::socket::shutdown_send);
    } catch (const std::exception& e) {
        std::cerr << "Exception: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
```

这个程序把本篇三个核心语义都串了起来：**`write` 的"写满"、`read` 的"读满"、`read_some` 的"有多少读多少"**——客户端用 `read` 免去了自己循环拼接，服务端用 `read_some` 保留逐块处理的自由度。

## 构建与自测

```bash
g++ -std=c++20 -Wall -Wextra server2.cpp -o server2.exe -lws2_32 -lmswsock
g++ -std=c++20 -Wall -Wextra client2.cpp -o client2.exe -lws2_32 -lmswsock
```

先启动 `server2.exe`，再运行 `client2.exe`。预期结果：

```text
server2: Echo server listening on port 8081...
         Client connected from 127.0.0.1:xxxxx
         Peer closed connection (eof). Echoed 1000 bytes in total.

client2: Sent 1000 bytes
         Received 1000 bytes, content matches
```

服务端"Echoed 1000 bytes"证明 1000 字节被 256 的小缓冲分块读齐；客户端的 `matches` 证明 `read` 原样拼回了完整消息。TCP 没有消息边界——想按"条"收发，需要自己定协议，第 4 篇从粘包问题讲起。




