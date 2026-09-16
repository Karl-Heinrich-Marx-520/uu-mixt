---
title: "Proto+C++使用"
slug: proto-c
description: "讲解 protobuf 编译生成 C++ 代码后的消息字段读写、序列化、Arena 分配器，以及 gRPC 四种流式调用的客户端用法。"
date: 2026-09-16
author: uu
category: 工程实践
tags: [C++, 网络编程, 并发]
featured: false
draft: true
---
# proto+C++使用

Proto 编译生成 C++ 代码后，使用方式主要分为 **消息（Message）操作** 和 **服务（Service）调用** 两大部分。下面从编译到实战进行完整讲解。

***

### 1. 编译生成

#### 编译命令

```bash
protoc --cpp_out=. \
       --grpc_out=. \
       --plugin=protoc-gen-grpc=$(which grpc_cpp_plugin) \
       user.proto
```

每个 `.proto` 文件会生成 **4 个文件**：

| **生成文件**          | **内容**                     |
| ----------------- | -------------------------- |
| `user.pb.h`       | 消息类的头文件（字段访问器、序列化接口）       |
| `user.pb.cc`      | 消息类的实现                     |
| `user.grpc.pb.h`  | gRPC 服务 Stub/Skeleton 的头文件 |
| `user.grpc.pb.cc` | gRPC 服务 Stub/Skeleton 的实现  |

> ⚠️ 编译时需要链接 `libprotobuf` 和 `libgrpc++` 库。CMake 示例见文末。

***

### 2. 消息类的使用

假设有如下 proto 定义：

```protobuf
syntax = "proto3";
package example;

message User {
  string name = 1;
  int32 age = 2;
  repeated string tags = 3;
  map<string, string> metadata = 4;
  
  oneof contact {
    string email = 5;
    string phone = 6;
  }
}
```

#### 2.1 基本字段读写

生成的 C++ 类为 `example::User`，继承自 `google::protobuf::Message`。

```cpp
#include "user.pb.h"

example::User user;

// ===== 标量字段 =====
// string: set_xxx() / xxx() / mutable_xxx()
user.set_name("Alice");
const std::string& n = user.name();        // 只读引用（零拷贝）
std::string* pn = user.mutable_name();     // 可写指针（自动分配）

// int/bool: set_xxx() / xxx()
user.set_age(25);
int32_t a = user.age();

// 判断是否被显式设置（proto3 中仅对 message 字段和 oneof 有效）
// 标量字段始终有默认值，has_xxx() 在 proto3 中不可用
```

> 💡 **性能关键**：对于 string/bytes/message 字段，优先使用 `mutable_xxx()` 直接写入，避免 `set_xxx(std::string)` 带来的额外拷贝。

#### 2.2 Repeated 字段（数组）

```cpp
// 添加元素
user.add_tags("vip");
user.add_tags("active");

// 读取
int count = user.tags_size();
const std::string& tag0 = user.tags(0);    // 只读
std::string* ptag = user.mutable_tags(1);  // 可写

// 遍历
for (int i = 0; i < user.tags_size(); ++i) {
    std::cout << user.tags(i) << "\n";
}

// C++11 range-for（通过重复字段代理）
for (const auto& t : user.tags()) {
    std::cout << t << "\n";
}
```

#### 2.3 Map 字段

Map 在 C++ 中表现为一个特殊的 `Map<Key, Value>` 容器：

```cpp
// 插入/修改
(*user.mutable_metadata())["role"] = "admin";
(*user.mutable_metadata())["region"] = "cn-east";

// 查找
auto it = user.metadata().find("role");
if (it != user.metadata().end()) {
    std::cout << it->second << "\n";
}

// 遍历
for (const auto& kv : user.metadata()) {
    std::cout << kv.first << " => " << kv.second << "\n";
}

// 大小 & 清空
int sz = user.metadata_size();
user.clear_metadata();
```

#### 2.4 Oneof 字段

```cpp
// 设置（自动清除另一个）
user.set_email("alice@example.com");
// 此时 has_phone() == false

// 判断当前设置了哪个
switch (user.contact_case()) {
    case example::User::kEmail:
        std::cout << "email: " << user.email() << "\n";
        break;
    case example::User::kPhone:
        std::cout << "phone: " << user.phone() << "\n";
        break;
    case example::User::CONTACT_NOT_SET:
        std::cout << "no contact set\n";
        break;
}

// 清除 oneof
user.clear_contact();
```

#### 2.5 序列化与反序列化

```cpp
// ===== 二进制序列化 =====
std::string binary;
user.SerializeToString(&binary);          // 序列化到 string
user.SerializeToArray(buf, buf_size);     // 序列化到预分配 buffer

// ===== 二进制反序列化 =====
example::User parsed;
parsed.ParseFromString(binary);           // 从 string 解析
parsed.ParseFromArray(buf, len);          // 从 buffer 解析

// ===== JSON（需额外库，如 protobuf-json） =====
// 官方不内置 JSON，常用 google/protobuf/util/json_util.h
#include <google/protobuf/util/json_util.h>

std::string json;
google::protobuf::util::JsonPrintOptions opts;
opts.preserve_proto_field_names = true;   // 保持 snake_case
MessageToJsonString(user, &json, opts);

example::User from_json;
google::protobuf::util::JsonParseOptions jopts;
jopts.ignore_unknown_fields = true;
JsonStringToMessage(json, &from_json, jopts);
```

#### 2.6 Arena 分配器（高性能场景必知）

当频繁创建/销毁大量小消息时，Arena 可将内存分配批量化，减少 malloc/free 开销：

```cpp
#include <google/protobuf/arena.h>

google::protobuf::Arena arena;
auto* user = google::protobuf::Arena::CreateMessage<example::User>(&arena);
user->set_name("Bob");
user->add_tags("test");

// arena 析构时一次性释放所有内存，无需手动 delete
// ⚠️ Arena 上的对象不能单独 delete
```

> 📊 实测在高吞吐服务中，Arena 可减少 **30%-70%** 的内存分配耗时。

***

### 3. gRPC 服务的使用

假设 proto 定义了：

```protobuf
service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc ListUsers (ListUsersRequest) returns (stream User);
  rpc UploadAvatar (stream UploadRequest) returns (UploadResponse);
  rpc Chat (stream ChatMsg) returns (stream ChatMsg);
}
```

#### 3.1 客户端 Stub

```cpp
#include "user.grpc.pb.h"
#include <grpcpp/grpcpp.h>

// 创建 Channel + Stub
auto channel = grpc::CreateChannel(
    "localhost:50051", grpc::InsecureChannelCredentials());
auto stub = example::UserService::NewStub(channel);

// ===== Unary RPC =====
{
    example::GetUserRequest req;
    req.set_user_id("u123");
    example::User resp;
    grpc::ClientContext ctx;
    
    grpc::Status status = stub->GetUser(&ctx, req, &resp);
    if (status.ok()) {
        std::cout << resp.name() << "\n";
    } else {
        std::cerr << status.error_code() << ": " 
                  << status.error_message() << "\n";
    }
}

// ===== Server Streaming =====
{
    example::ListUsersRequest req;
    req.set_dept("engineering");
    grpc::ClientContext ctx;
    
    auto reader = stub->ListUsers(&ctx, req);
    example::User user;
    while (reader->Read(&user)) {
        std::cout << user.name() << "\n";
    }
    grpc::Status status = reader->Finish();
}

// ===== Client Streaming =====
{
    grpc::ClientContext ctx;
    example::UploadResponse resp;
    
    auto writer = stub->UploadAvatar(&ctx, &resp);
    
    example::UploadRequest chunk;
    chunk.set_seq(0); chunk.set_data("...");
    writer->Write(chunk);
    
    chunk.set_seq(1); chunk.set_data("...");
    writer->Write(chunk);
    
    writer->WritesDone();
    grpc::Status status = writer->Finish();
}

// ===== Bidirectional Streaming =====
{
    grpc::ClientContext ctx;
    auto stream = stub->Chat(&ctx);
    
    // 发送线程
    std::thread send([&]() {
        example::ChatMsg msg;
        msg.set_text("hello");
        stream->Write(msg);
        stream->WritesDone();
    });
    
    // 接收
    example::ChatMsg reply;
    while (stream->Read(&reply)) {
        std::cout << "recv: " << reply.text() << "\n";
    }
    send.join();
    stream->Finish();
}
```

#### 3.2 服务端实现

```cpp
class UserServiceImpl final : public example::UserService::Service {
public:
    // Unary
    grpc::Status GetUser(
        grpc::ServerContext* context,
        const example::GetUserRequest* request,
        example::User* response) override 
    {
        // 业务逻辑...
        response->set_name("Alice");
        response->set_age(25);
        return grpc::Status::OK;
        
        // 返回错误
        // return grpc::Status(grpc::NOT_FOUND, "user not found");
    }
    
    // Server Streaming
    grpc::Status ListUsers(
        grpc::ServerContext* context,
        const example::ListUsersRequest* request,
        grpc::ServerWriter<example::User>* writer) override
    {
        for (int i = 0; i < 100; ++i) {
            example::User u;
            u.set_name("user_" + std::to_string(i));
            if (!writer->Write(u)) break;  // 客户端断开则停止
        }
        return grpc::Status::OK;
    }
    
    // Client Streaming / Bidi 类似，分别用 ServerReader / ServerReaderWriter
};

// 启动服务器
void RunServer() {
    std::string addr = "0.0.0.0:50051";
    UserServiceImpl service;
    
    grpc::ServerBuilder builder;
    builder.AddListeningPort(addr, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);
    builder.SetMaxReceiveMessageSize(16 * 1024 * 1024); // 16MB
    
    auto server = builder.BuildAndStart();
    std::cout << "Server listening on " << addr << "\n";
    server->Wait();
}
```

***

### 4. CMake 集成模板

```cmake
find_package(Protobuf REQUIRED)
find_package(gRPC CONFIG REQUIRED)

# Proto 代码生成
protobuf_generate_cpp(PROTO_SRCS PROTO_HDRS user.proto)
get_target_property(GRPC_PLUGIN gRPC::grpc_cpp_plugin LOCATION)
protobuf_generate_grpc_cpp(GRPC_SRCS GRPC_HDRS user.proto)

add_library(user_proto ${PROTO_SRCS} ${GRPC_SRCS})
target_include_directories(user_proto PUBLIC 
    ${CMAKE_CURRENT_BINARY_DIR}
    ${Protobuf_INCLUDE_DIRS})
target_link_libraries(user_proto PUBLIC 
    protobuf::libprotobuf 
    gRPC::grpc++)
```

***

### 5. 常见陷阱与最佳实践

| **问题**         | **说明**                               | **解决方案**                                                            |
| -------------- | ------------------------------------ | ------------------------------------------------------------------- |
| **字符串生命周期**    | `xxx()` 返回的 `const string&` 指向消息内部内存 | 消息销毁/修改后引用失效，需要持久化时务必拷贝                                             |
| **线程安全**       | Message 对象**不是**线程安全的                | 多线程读写同一消息需加锁；不同消息可并发                                                |
| **默认值歧义**      | Proto3 无法区分"未设置"和"设为零值"              | 需要区分时使用 `optional`（proto3 ≥ 3.15）或包装类型 `google.protobuf.Int32Value` |
| **大消息性能**      | 单次 Serialize > 1MB 考虑分片              | 使用 Streaming RPC 或压缩 `grpc_compression_algorithm`                   |
| **版本兼容**       | 新旧客户端共存                              | 永远遵守向后兼容三原则；新增字段用新编号                                                |
| **内存泄漏**       | Arena 上对象被误 delete                   | Arena 管理的对象禁止手动释放                                                   |
| **Context 复用** | `ClientContext` 只能用于一次 RPC           | 每次调用必须创建新的 Context                                                  |

掌握以上内容即可在 C++ 项目中完整使用 Protobuf/gRPC。如需了解异步 API（Callback/Reactor）、拦截器（Interceptor）、健康检查、TLS 配置等进阶主题，可以继续提问。

