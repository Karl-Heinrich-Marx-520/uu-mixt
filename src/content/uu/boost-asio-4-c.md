---
title: "Boost.Asio学习（4）：实现一个现代 C++ 风格的完备服务器"
slug: boost-asio-4-c
description: "在 Boost.Asio 异步读写基础上补齐粘包处理、发送队列、逻辑线程解耦与 io_context 多线程执行，并用 strand 保证会话回调串行、信号实现优雅退出。"
date: 2026-09-27
author: uu
category: Boost.Asio
tags: [C++, 网络编程, 异步编程, Boost.Asio]
featured: false
draft: false
---
# Boost.Asio学习（4）：实现一个现代 C++ 风格的完备服务器

在《Boost.Asio学习（3）：异步读写》中，我们用异步读写封装了最简单的会话和服务器。本篇在此基础上补齐一个"完备"服务器需要的四块能力：**粘包处理、发送队列、逻辑线程解耦、io_context 多线程执行**，最后用信号实现优雅退出。

## 粘包问题

TCP 只保证**字节流有序**，但**不保留应用层消息边界**：两次 `Send` 的数据可能被合并成一次到达（粘包），一次 `Send` 也可能分多次到达（拆包）。所以接收端必须按自定义协议把字节流重新切分成完整消息。

本篇采用变长帧格式（id-length-value）：

```text
+--------------+---------------+---------------------+
| msg_id (2B)  | msg_len (2B)  | data (msg_len 字节)  |
+--------------+---------------+---------------------+
  网络字节序      网络字节序       原样载荷
```

## 协议常量与消息 id（const.h）

协议常量用 `constexpr` 组织，消息 id 用 `enum class` 并限定合法范围：

```cpp
// const.h
#pragma once

#include <cstddef>

namespace msg {

inline constexpr std::size_t kMaxBufferLength = 1024;  // 单次读取缓冲上限
inline constexpr std::size_t kMsgLengthLimit  = 1024;  // 单条消息 data 部分上限
inline constexpr std::size_t kHeadTotalLength = 4;     // id(2) + len(2)
inline constexpr std::size_t kHeadIdLength    = 2;
inline constexpr std::size_t kHeadDataLength  = 2;
inline constexpr std::size_t kMaxSendQueue    = 1000;
inline constexpr unsigned short kMsgIdMax     = 1024;  // 合法 id 上限（含 1001）

enum class MsgId : unsigned short {
    kHelloWorld = 1001,
};

}  // namespace msg
```

## 消息节点（MsgNode.h）

消息体用 `std::vector<char>` 统一管理内存，通过访问器暴露长度与数据，外部不再直接触碰内部成员。发送节点在构造时直接写成 wire 格式——id 与长度转大端序，用公开的 `boost::endian` 完成字节序转换。几个小类都很短，直接头文件内联，不需要单独的 .cpp：

另外注意 `virtual ~MsgNode() = default;` 这一行。`data_` 是 RAII 成员，析构、拷贝、移动全都可以交给编译器生成的默认版本（Rule of Zero），本来不需要手写任何特殊成员函数；但 `MsgNode` 是 `RecvNode`/`SendNode` 的基类，只要存在经基类接口销毁派生对象的可能（比如 `std::unique_ptr<MsgNode>` 指向派生对象，或裸 `delete` 基类指针），基类析构就必须为虚（Core Guidelines C.35：基类析构要么 public + virtual，要么 protected + 非虚）。

写上它，任何销毁路径都正确，代价只是一个虚表指针。作为对比：`std::shared_ptr<RecvNode>` 直接持有最终类型时，即使基类析构非虚也是安全的——shared_ptr 在控制块里记录了实际类型的删除器，销毁时调用的是派生类析构。

```cpp
// MsgNode.h
#pragma once

#include <algorithm>
#include <cstddef>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include <boost/endian/conversion.hpp>

#include "const.h"

// 消息体的统一内存表示：连续缓冲区 + 当前填充长度。
class MsgNode {
public:
    explicit MsgNode(std::size_t total_len)
        : data_(total_len + 1, '\0'), total_len_(total_len) {}  // 多 1 字节 '\0'，便于调试打印

    // 多态基类：经基类接口销毁派生对象时保证正确析构（Core Guidelines C.35）
    virtual ~MsgNode() = default;

    void Clear() {
        std::fill(data_.begin(), data_.end(), '\0');
        cur_len_ = 0;
    }

    std::string GetString() const { return std::string(data_.data(), cur_len_); }

    std::vector<char>& data() { return data_; }
    std::size_t total_len() const { return total_len_; }
    std::size_t cur_len() const { return cur_len_; }
    void set_cur_len(std::size_t len) { cur_len_ = len; }

protected:
    std::vector<char> data_;
    std::size_t total_len_;
    std::size_t cur_len_ = 0;
};

// 接收节点：只装 data 部分，id 由解析层保存。
class RecvNode : public MsgNode {
public:
    RecvNode(std::size_t max_len, unsigned short msg_id)
        : MsgNode(max_len), msg_id_(msg_id) {}

    unsigned short GetMsgId() const { return msg_id_; }

private:
    unsigned short msg_id_;
};

// 发送节点：wire 格式 = id(2, 大端) + len(2, 大端) + data。
class SendNode : public MsgNode {
public:
    SendNode(std::string_view payload, unsigned short msg_id)
        : MsgNode(msg::kHeadTotalLength + payload.size()), msg_id_(msg_id) {
        const auto id_net  = boost::endian::native_to_big(msg_id);
        const auto len_net = boost::endian::native_to_big(
            static_cast<unsigned short>(payload.size()));
        std::memcpy(data_.data(), &id_net, msg::kHeadIdLength);
        std::memcpy(data_.data() + msg::kHeadIdLength, &len_net, msg::kHeadDataLength);
        std::memcpy(data_.data() + msg::kHeadTotalLength, payload.data(), payload.size());
        cur_len_ = total_len_;
    }

private:
    unsigned short msg_id_;
};
```

## 单例基类（Singleton.h）

逻辑系统和线程池都以单例方式使用，先给出最简的 Meyers 单例模板：

```cpp
// Singleton.h
#pragma once

template <typename T>
class Singleton {
public:
    static T& GetInstance() {
        static T instance;  // C++11 起局部静态初始化线程安全
        return instance;
    }

    Singleton(const Singleton&) = delete;
    Singleton& operator=(const Singleton&) = delete;

protected:
    Singleton() = default;
    ~Singleton() = default;  // protected 且非 virtual：单例不经基类指针销毁
};
```


## 会话类（CSession.h / CSession.cpp）

这是本篇核心。线程池有 N 个线程并发跑同一个 `io_context`，任意回调可能在任意线程执行——同一个会话的读回调、写回调若并发访问 `read_buf_`、`msg_node_` 就是数据竞争。因此会话持有自己的 **strand**，socket 直接构造在该 strand 上，所有回调与写操作发起都串行到这里。

成员命名统一用尾下划线风格；发送队列采用"循环写"模式：`writing_` 标志保证同一 socket 上同一时刻只有一个 `async_write`，队列非空时由写回调自动续发：

```cpp
// CSession.h
#pragma once

#include <array>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <string_view>

#include <boost/asio.hpp>
#include <boost/uuid/uuid_generators.hpp>
#include <boost/uuid/uuid_io.hpp>

#include "const.h"
#include "MsgNode.h"

class CServer;

class CSession : public std::enable_shared_from_this<CSession> {
public:
    CSession(boost::asio::io_context& ioc, std::weak_ptr<CServer> server);

    boost::asio::ip::tcp::socket& Socket() { return socket_; }
    const std::string& GetUuid() const { return uuid_; }

    void Start();
    void Send(std::string_view text, unsigned short msg_id);
    void Close();

private:
    void DoRead();
    void HandleRead(const boost::system::error_code& ec, std::size_t bytes_transferred);
    void StartWrite();  // 仅在 strand 上调用
    void OnError(std::string message);  // 记日志 + 关闭 + 向服务器注销自己

    boost::asio::strand<boost::asio::io_context::executor_type> strand_;
    boost::asio::ip::tcp::socket socket_;  // 构造于 strand executor 上
    std::string uuid_;
    std::weak_ptr<CServer> server_;  // 反向弱引用：服务器经 sessions_ 强持有本会话

    std::array<char, msg::kMaxBufferLength> read_buf_{};

    bool head_parsed_ = false;
    // 解析状态为会话内独占所有权：unique_ptr 足矣
    std::unique_ptr<MsgNode> head_node_ =
        std::make_unique<MsgNode>(msg::kHeadTotalLength);
    std::unique_ptr<RecvNode> msg_node_;

    std::mutex send_mutex_;  // 保护发送队列：逻辑线程与 IO 线程都会入队
    std::queue<std::unique_ptr<SendNode>> send_queue_;
    bool writing_ = false;   // strand 上判断是否有写操作挂起
};

// 投递给逻辑线程的一条消息：
// 消息体所有权从会话移交给逻辑线程，用 unique_ptr 表达独占移交；
// 会话本身由服务器表、回调链、逻辑队列多方保活，才是 shared_ptr 的正当场景
class LogicNode {
public:
    LogicNode() = default;
    LogicNode(std::shared_ptr<CSession> session, std::unique_ptr<RecvNode> node)
        : session_(std::move(session)), recv_node_(std::move(node)) {}

    std::shared_ptr<CSession> session_;
    std::unique_ptr<RecvNode> recv_node_;
};
```

```cpp
// CSession.cpp
#include "CSession.h"

#include <algorithm>
#include <cstring>
#include <iostream>

#include "CServer.h"
#include "LogicSystem.h"

CSession::CSession(boost::asio::io_context& ioc, std::weak_ptr<CServer> server)
    : strand_(boost::asio::make_strand(ioc)),
      socket_(strand_),  // socket 直接构造在 strand 上
      server_(std::move(server)) {
    uuid_ = boost::uuids::to_string(boost::uuids::random_generator()());
}

void CSession::Start() {
    boost::asio::post(strand_, [self = shared_from_this()] { self->DoRead(); });
}

void CSession::DoRead() {
    auto self = shared_from_this();
    socket_.async_read_some(
        boost::asio::buffer(read_buf_),
        boost::asio::bind_executor(strand_,
            [self](const boost::system::error_code& ec, std::size_t bytes) {
                self->HandleRead(ec, bytes);
            }));
}

void CSession::HandleRead(const boost::system::error_code& ec,
                          std::size_t bytes_transferred) {
    if (ec) {
        OnError("read failed: " + ec.message());
        return;
    }

    std::size_t offset = 0;
    while (bytes_transferred > 0) {
        if (!head_parsed_) {
            // ---- 阶段一：凑齐 4 字节头 ----
            const std::size_t head_need =
                msg::kHeadTotalLength - head_node_->cur_len();
            const std::size_t take = std::min(head_need, bytes_transferred);
            std::memcpy(head_node_->data().data() + head_node_->cur_len(),
                        read_buf_.data() + offset, take);
            head_node_->set_cur_len(head_node_->cur_len() + take);
            offset += take;
            bytes_transferred -= take;

            if (head_node_->cur_len() < msg::kHeadTotalLength) {
                break;  // 头还没收齐，剩下的字节等下一批
            }

            // ---- 阶段二：解析头 ----
            unsigned short msg_id = 0;
            unsigned short msg_len = 0;
            std::memcpy(&msg_id, head_node_->data().data(), msg::kHeadIdLength);
            std::memcpy(&msg_len,
                        head_node_->data().data() + msg::kHeadIdLength,
                        msg::kHeadDataLength);
            msg_id  = boost::endian::big_to_native(msg_id);
            msg_len = boost::endian::big_to_native(msg_len);

            // id 用无符号类型并校验合法范围：
            // 若用有符号 short，高位为 1 的包会转成负数而绕过检查
            if (msg_id == 0 || msg_id > msg::kMsgIdMax) {
                OnError("invalid msg id: " + std::to_string(msg_id));
                return;
            }
            if (msg_len == 0 || msg_len > msg::kMsgLengthLimit) {
                OnError("invalid msg len: " + std::to_string(msg_len));
                return;
            }

            msg_node_ = std::make_unique<RecvNode>(msg_len, msg_id);
            head_parsed_ = true;
            head_node_->Clear();
            continue;
        }

        // ---- 阶段三：按 msg_len 凑齐消息体 ----
        const std::size_t body_need =
            msg_node_->total_len() - msg_node_->cur_len();
        const std::size_t take = std::min(body_need, bytes_transferred);
        std::memcpy(msg_node_->data().data() + msg_node_->cur_len(),
                    read_buf_.data() + offset, take);
        msg_node_->set_cur_len(msg_node_->cur_len() + take);
        offset += take;
        bytes_transferred -= take;

        if (msg_node_->cur_len() == msg_node_->total_len()) {
            // 消息体所有权移交给逻辑线程，msg_node_ 移动后自动为空
            LogicSystem::GetInstance().Post(
                LogicNode{shared_from_this(), std::move(msg_node_)});
            head_parsed_ = false;  // 继续消费本缓冲区里可能残留的下一个包
            head_node_->Clear();
        }
    }

    DoRead();  // 本批数据处理完毕，继续读
}

void CSession::Send(std::string_view text, unsigned short msg_id) {
    // 超长消息直接拒绝，避免 size_t → unsigned short 静默窄化
    if (text.size() > msg::kMsgLengthLimit) {
        std::cerr << "session " << uuid_ << " message too long: "
                  << text.size() << "\n";
        return;
    }
    auto node = std::make_unique<SendNode>(text, msg_id);
    {
        std::lock_guard<std::mutex> lock(send_mutex_);
        if (send_queue_.size() >= msg::kMaxSendQueue) {
            std::cerr << "session " << uuid_ << " send queue full\n";
            return;
        }
        send_queue_.push(std::move(node));
    }
    // 发起写操作必须回到 strand 上：Send 可能从逻辑线程调用
    boost::asio::post(strand_, [self = shared_from_this()] { self->StartWrite(); });
}

void CSession::StartWrite() {  // strand 上执行
    if (writing_) {
        return;  // 已有写操作挂起，等它的回调来续发
    }
    // 把待发包从队列移出：所有权直接交给写回调，写完（或失败）即析构，
    // 回调里不再回队列 pop——队列里永远是"还没发"的包
    std::unique_ptr<SendNode> node;
    {
        std::lock_guard<std::mutex> lock(send_mutex_);
        if (send_queue_.empty()) {
            return;
        }
        node = std::move(send_queue_.front());
        send_queue_.pop();
    }
    writing_ = true;
    auto self = shared_from_this();
    // 先求 buffer 再 move：async_write 的实参求值顺序未指定，若初始化捕获
    // node = std::move(node) 先执行，buffer(node->total_len()) 会解引用空指针
    auto payload = boost::asio::buffer(node->data().data(), node->total_len());
    boost::asio::async_write(
        socket_, payload,
        boost::asio::bind_executor(strand_,
            [self, node = std::move(node)](  // node 保活：payload 指向它的内存
                const boost::system::error_code& ec, std::size_t) {
                self->writing_ = false;
                if (ec) {
                    self->OnError("write failed: " + ec.message());
                    return;
                }
                self->StartWrite();  // 队列里还有就继续发
            }));
}

void CSession::Close() {
    boost::system::error_code ignore;
    socket_.close(ignore);  // 幂等：重复 close 无害；挂起的操作以 aborted 收尾
}

void CSession::OnError(std::string message) {
    std::cerr << "session " << uuid_ << ": " << message << "\n";
    Close();
    // 反向引用是 weak_ptr：服务器还在才注销自己；已销毁则无事可做
    if (auto server = server_.lock()) {
        server->ClearSession(uuid_);
    }
}
```

几个要点：

- **发送队列的两把锁分工**：`send_mutex_` 保护队列本身，因为入队可能来自逻辑线程；`writing_` 只在 strand 上读写，负责"同一 socket 上同一时刻只有一个 `async_write`"——这是第 3 篇强调过的规则。
- **粘包状态机**：`head_parsed_` 在"凑头 → 解析头 → 凑体 → 投递"之间流转，每次 `min(need, remaining)` 只取需要的字节，一次 `async_read_some` 读到几个包就处理几个，缓冲区消费完再发起下一次读。
- **两处校验**：id 必须落在 `[1, kMsgIdMax]`，长度必须落在 `[1, kMsgLengthLimit]`，任一非法直接断开连接——协议校验宁可严格。
- **所有权表达**：`head_node_`、`msg_node_`、发送队列元素都是 `unique_ptr`——解析缓冲与待发包在任一时刻只有一个所有者，移交一律用 `std::move`（消息体移交给逻辑线程、待发包移交给写回调）。真正用 `shared_ptr` 的只有 `CSession` 本身：它的生命期由服务器表、回调链上的 `self`、逻辑队列多方共同保活。判据一句话：**默认 `unique_ptr`，确有多方共享保活才升级 `shared_ptr`**。
- **踩坑：实参求值顺序 × 初始化捕获**。`StartWrite` 里把 `buffer(node->total_len())` 和 `[node = std::move(node)]` 写在同一个 `async_write` 调用中，是潜伏的空指针崩溃：函数实参求值顺序未指定，MinGW GCC 13 从右向左，初始化捕获先把 `node` 掏空，随后 `buffer(node->total_len())` 解引用空 `this`——回包瞬间进程无声消失，日志一行不剩。规则：**被 move 进捕获的变量，不得在同一调用的其他实参中解引用**；先把需要的值算进局部变量（本例的 `payload`），再 move 进捕获。这个坑长期不为人察觉，是因为同款写法若捕获 `shared_ptr`（拷贝、不掏空外层）或编译器求值顺序恰好相反，都不会触发。

## 服务器类（CServer.h / CServer.cpp）

`sessions_` 的插入发生在 accept 回调（某个 IO 线程），删除发生在各会话的错误清理（可能是另一个 IO 线程），两个回调可能**并发**执行，所以用 `std::mutex` 保护这张表：

```cpp
// CServer.h
#pragma once

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

#include <boost/asio.hpp>

class CSession;

class CServer : public std::enable_shared_from_this<CServer> {
public:
    CServer(boost::asio::io_context& ioc, unsigned short port);
    void Start();  // 构造完成后调用：开始接受连接
    void ClearSession(const std::string& uuid);

private:
    void DoAccept();

    boost::asio::io_context& ioc_;
    boost::asio::ip::tcp::acceptor acceptor_;

    std::mutex session_mutex_;  // 保护 sessions_：accept 回调与各会话错误清理并发
    std::unordered_map<std::string, std::shared_ptr<CSession>> sessions_;
};
```

```cpp
// CServer.cpp
#include "CServer.h"

#include <iostream>

#include "CSession.h"

CServer::CServer(boost::asio::io_context& ioc, unsigned short port)
    : ioc_(ioc),
      acceptor_(ioc, boost::asio::ip::tcp::endpoint(boost::asio::ip::tcp::v4(), port)) {
    // 不能在构造函数里直接 DoAccept()：它要把 weak_from_this() 传给会话，
    // 而构造期内对象尚未被任何 shared_ptr 接管。启动统一放在 Start()。
}

void CServer::Start() {
    DoAccept();
}

void CServer::DoAccept() {
    auto new_session = std::make_shared<CSession>(ioc_, weak_from_this());
    acceptor_.async_accept(
        new_session->Socket(),
        [this, new_session](const boost::system::error_code& ec) {
            if (!ec) {
                {
                    std::lock_guard<std::mutex> lock(session_mutex_);
                    sessions_.emplace(new_session->GetUuid(), new_session);
                }
                new_session->Start();
            } else {
                std::cerr << "accept failed: " << ec.message() << "\n";
            }
            DoAccept();  // 继续接受下一个连接
        });
}

void CServer::ClearSession(const std::string& uuid) {
    std::lock_guard<std::mutex> lock(session_mutex_);
    sessions_.erase(uuid);
}
```

**会话表的两个设计选择**值得展开：

- **会话反向只持 `weak_ptr<CServer>`**。服务器经 `sessions_` 表**强持有**每个会话；若会话反向也持 `shared_ptr<CServer>`，就是循环引用，两个对象都永远不会释放。裸指针能工作，但依赖"服务器活得比所有回调久"这条不会编译报错的隐含约定；`weak_ptr` 把约定变成机制——使用前 `lock()`（见 `CSession::OnError`），服务器已销毁就静默放弃清理。为此 `CServer` 继承 `enable_shared_from_this<CServer>`，`main` 里相应改用 `std::make_shared` 创建。这里有个必须知道的约束：**`shared_from_this()` / `weak_from_this()` 在构造函数里不可用**——对象此刻尚未被任何 `shared_ptr` 接管，所以接受连接的启动逻辑从构造函数挪到了 `Start()`，由 `main` 在创建完成后调用。
- **会话表用 `unordered_map` 而非 `map`**：这张表只有按 uuid 的插入与删除，永远不需要有序遍历，`map` 的红黑树维护（O(log n) + 每节点额外的父/子/颜色指针）是白付的；uuid 哈希分布均匀、无退化风险，`unordered_map` 平均 O(1) 正合适。

## 逻辑处理类（LogicSystem.h / LogicSystem.cpp）

会话收到完整消息后不能在 IO 线程里直接做业务处理，否则会阻塞后续收发——所以把消息投递给专门的逻辑线程。JSON 处理用 nlohmann/json：解析失败会抛 `parse_error`，回调里捕获并给客户端回错误包，而不是静默吞掉：

```cpp
// LogicSystem.h
#pragma once

#include <atomic>
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <unordered_map>

#include <nlohmann/json.hpp>

#include "CSession.h"
#include "Singleton.h"

class LogicSystem : public Singleton<LogicSystem> {
public:
    using Callback = std::function<void(std::shared_ptr<CSession>,
                                        unsigned short, const std::string&)>;

    ~LogicSystem();
    void Post(LogicNode msg);  // 按值收，内部 move 入队：所有权移交给逻辑线程

private:
    friend class Singleton<LogicSystem>;
    LogicSystem();
    LogicSystem(const LogicSystem&) = delete;
    LogicSystem& operator=(const LogicSystem&) = delete;

    void RegisterCallbacks();
    void DealMessages();
    void HandleHelloWorld(std::shared_ptr<CSession> session,
                          unsigned short msg_id, const std::string& body);

    std::queue<LogicNode> msg_queue_;
    std::mutex queue_mutex_;
    std::condition_variable queue_cv_;
    std::thread worker_;
    std::atomic<bool> stop_{false};
    std::unordered_map<unsigned short, Callback> callbacks_;
};
```

```cpp
// LogicSystem.cpp
#include "LogicSystem.h"

#include <iostream>

LogicSystem::LogicSystem() {
    RegisterCallbacks();
    worker_ = std::thread([this] { DealMessages(); });
}

LogicSystem::~LogicSystem() {
    stop_ = true;
    queue_cv_.notify_all();
    if (worker_.joinable()) {
        worker_.join();
    }
}

void LogicSystem::Post(LogicNode msg) {
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        msg_queue_.push(std::move(msg));
    }
    queue_cv_.notify_one();
}

void LogicSystem::RegisterCallbacks() {
    callbacks_[static_cast<unsigned short>(msg::MsgId::kHelloWorld)] =
        [this](std::shared_ptr<CSession> session, unsigned short id,
               const std::string& body) {
            HandleHelloWorld(std::move(session), id, body);
        };
}

void LogicSystem::HandleHelloWorld(std::shared_ptr<CSession> session,
                                   unsigned short msg_id,
                                   const std::string& body) {
    nlohmann::json parsed;
    try {
        parsed = nlohmann::json::parse(body);
    } catch (const nlohmann::json::parse_error& e) {
        std::cerr << "invalid json: " << e.what() << "\n";
        session->Send(nlohmann::json{{"error", 1001}, {"msg", "invalid json"}}.dump(),
                      msg_id);
        return;
    }

    std::cout << "receive msg id: " << parsed.value("id", 0)
              << " data: " << parsed.value("data", std::string{}) << "\n";

    nlohmann::json reply{
        {"id", parsed.value("id", 0)},
        {"data", "server has received msg: " + parsed.value("data", std::string{})}};
    session->Send(reply.dump(), msg_id);
}

void LogicSystem::DealMessages() {
    while (true) {
        LogicNode node;
        {
            std::unique_lock<std::mutex> lock(queue_mutex_);
            queue_cv_.wait(lock, [this] { return stop_ || !msg_queue_.empty(); });
            if (stop_ && msg_queue_.empty()) {
                break;  // 退出前把队列清空
            }
            node = std::move(msg_queue_.front());
            msg_queue_.pop();
        }
        const auto msg_id = node.recv_node_->GetMsgId();
        if (auto it = callbacks_.find(msg_id); it != callbacks_.end()) {
            it->second(std::move(node.session_), msg_id, node.recv_node_->GetString());
        }
    }
}
```

注意：`session->Send(...)` 是从**逻辑线程**发起的，而它内部会把写操作 `post` 回会话的 strand——所以这个跨线程调用是安全的。

## io_context 多线程执行（AsioThreadPool.h / AsioThreadPool.cpp）

我们把线程与 io_context 封装成一个线程池单例：单个 `io_context`，N 个线程同时 `run()`。所有回调共用一个就绪队列，由 N 个线程并发消费——这意味着**不同会话的回调可能在不同线程并行执行**。这正是前面会话内部用 strand、服务器会话表用 mutex 的原因；理解了这一点，第 3 篇的 strand 规则才算真正落地：

```cpp
// AsioThreadPool.h
#pragma once

#include <thread>
#include <vector>

#include <boost/asio.hpp>

#include "Singleton.h"

// 单 io_context + N 线程：所有回调共用一个就绪队列，N 个线程并发消费。
// 注意：不同会话的回调可能在不同线程并行执行——
// 共享状态必须显式串行化（会话内部用 strand，会话表用 mutex）。
class AsioThreadPool : public Singleton<AsioThreadPool> {
public:
    boost::asio::io_context& GetIOContext() { return io_context_; }
    void Stop();
    ~AsioThreadPool();

private:
    friend class Singleton<AsioThreadPool>;
    AsioThreadPool();
    AsioThreadPool(const AsioThreadPool&) = delete;
    AsioThreadPool& operator=(const AsioThreadPool&) = delete;

    boost::asio::io_context io_context_;
    boost::asio::executor_work_guard<boost::asio::io_context::executor_type> work_guard_;
    std::vector<std::thread> threads_;
};
```

```cpp
// AsioThreadPool.cpp
#include "AsioThreadPool.h"

#include <algorithm>

AsioThreadPool::AsioThreadPool()
    : work_guard_(boost::asio::make_work_guard(io_context_)) {
    const auto thread_count = std::max(1u, std::thread::hardware_concurrency());
    threads_.reserve(thread_count);
    for (std::size_t i = 0; i < thread_count; ++i) {
        threads_.emplace_back([this] { io_context_.run(); });
    }
}

void AsioThreadPool::Stop() {
    work_guard_.reset();     // 摘掉"保活"，事件队列清空后 run 会返回
    io_context_.stop();      // 立即打断（见正文"安全退出"的说明）
    for (auto& t : threads_) {
        if (t.joinable()) {
            t.join();
        }
    }
}

AsioThreadPool::~AsioThreadPool() {
    Stop();
}
```

## 服务器如何安全退出（main.cpp）

退出路径：注册 `signal_set` 捕获 Ctrl+C → 信号回调里 `set_value()` 唤醒主线程 → 主线程停池。需要说明的是，`io_context::stop()` 是**立即打断**——尚未执行的 handler 被丢弃、进行中的读写以错误收尾，所以这里给出的是"尽快退出"而非"等所有会话优雅收尾"；如果想要后者，可以去掉 `stop()`、只 `work_guard_.reset()` 让 run 自然排空，留作练习：

```cpp
// main.cpp
#include <csignal>
#include <cstdlib>
#include <future>
#include <iostream>

#include <boost/asio.hpp>

#include "AsioThreadPool.h"
#include "CServer.h"

int main() {
    try {
        auto& io_context = AsioThreadPool::GetInstance().GetIOContext();
        auto server = std::make_shared<CServer>(io_context, 10086);
        server->Start();  // 不能在 CServer 构造函数里启动：weak_from_this() 构造期不可用

        std::promise<void> exit_signal;
        auto exit_future = exit_signal.get_future();

        boost::asio::signal_set signals(io_context, SIGINT, SIGTERM);
        signals.async_wait(
            [&exit_signal](const boost::system::error_code&, int signal_number) {
                std::cout << "\nSignal " << signal_number
                          << " received, stopping server...\n";
                exit_signal.set_value();
            });

        std::cout << "Server running on port 10086. Press Ctrl+C to stop.\n";
        exit_future.wait();                       // 主线程阻塞等信号
        AsioThreadPool::GetInstance().Stop();     // 摘 work guard + stop + join
        std::cout << "Server stopped.\n";
    } catch (const std::exception& e) {
        std::cerr << "Fatal: " << e.what() << "\n";
        return EXIT_FAILURE;
    }
    return 0;
}
```

## 构建

vcpkg 依赖：`boost-asio`、`boost-endian`、`boost-uuid`（三者均 header-only）、`nlohmann-json`，C++20 编译。

自测路径：启动服务后，用任意 TCP 客户端连接 10086，发送一帧 `id=1001`、data 为 `{"id":1001,"data":"hello"}` 的 JSON（按本篇帧格式封包），应收到 `server has received msg: hello` 的回包；Ctrl+C 后观察日志中各线程依次退出。


