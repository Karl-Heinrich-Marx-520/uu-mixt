# -*- coding: utf-8 -*-
"""生成 src/content 下的种子文章（数据 = demo/assets/demo-store.js 的 seed，与 Demo 一致）"""
import io, os, sys

OUT = {
    "uu": r"D:\cppsoft\workbuddy\UU&Mixt\src\content\uu",
    "mixt": r"D:\cppsoft\workbuddy\UU&Mixt\src\content\mixt",
}
for d in OUT.values():
    os.makedirs(d, exist_ok=True)

POSTS = [
    # ---------- UU 面（7 篇，全部发布） ----------
    dict(face="uu", slug="asio-graceful-shutdown", title="用 Boost.Asio 搭一个可优雅退出的异步 TCP 服务器",
         date="2026-09-05", updated="2026-09-12", category="工程实践",
         tags=["boost-asio", "cpp", "优雅退出"], featured=True, draft=False,
         desc="主线程 accept、IO 线程池、独立逻辑线程的三层模型，加上 signal_set 驱动的停机序列，让服务器可以不丢连接地退出。完整实现与踩坑记录。",
         body="""大部分教程写到这里就停了：`io_context::run()` 跑起来，服务器「能跑」。但生产环境里，一个不能体面退出的服务器等于不能上线——重启部署时在途的连接怎么办？半条消息写到一半怎么办？这篇文章记录我在自己的项目里落地的一套**三层线程模型 + 信号驱动的停机序列**，全部基于现代 C++ 写法。

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

另外，glibc 对象的销毁顺序与 `io_context` 的生命周期也要留心：任何 async 对象都得活过 `run()` 的最后一次返回，否则退出瞬间就是一次 use-after-free。"""),

    dict(face="uu", slug="mercury-hpcc-int-ns3", title="Mercury 复现笔记（一）：把 HPCC 的 INT 反馈链路跑进 NS-3.17",
         date="2026-08-28", category="科研复现",
         tags=["ns-3", "hpcc", "拥塞控制"], featured=False, draft=False,
         desc="从 OURS 模拟器源码与原始论文出发，梳理 HPCC 基于 INT 的反馈机制与 U 驱动的窗口调整，记录在 Ubuntu 18.04 + gcc-5 环境下跑通基线的全过程。",
         body="""## 复现目标

把 HPCC 的 INT 反馈链路搬进 NS-3.17 的 master tree，先跑通单链路基线，再换真实流量分布。这篇只记录「跑起来」这一段：环境、编译、第一次出图。

## 环境与依赖

- Ubuntu 18.04 + Docker（宿主机不装任何仿真依赖）
- NS-3.17 + waf 1.7 + gcc-5 + Python 2（run.py 是 py2 语法）
- OURS 模拟器源码与 HPCC master tree 基线各一套

## 关键改动

HPCC 靠 INT 把链路利用率 U 带回发送端，再用 U 调整窗口。复现时最容易出错的是**反馈的时延**：

```cpp
// 伪代码：INT 头携带的 U，回到发送端后才参与窗口更新
if (ack.int_valid) {
    u = ack.u;                      // 链路利用率
    w = (u < U_LOW) ? w * (1 + alpha) :
        (u > U_HIGH) ? w * (1 - beta) : w;
}
```

> 注意：U 的采样窗口与窗口更新的时间尺度必须对齐，否则会出现「反馈振荡」——曲线看起来很公平，实际吞吐在抖。

## 首次结果

1. 单链路：吞吐达到链路容量，收敛时间与论文量级一致
2. 多链路：公平性指标偏乐观，怀疑是采样窗口偏小
3. 待办：换真实 AI 流量分布，跑三算法对比矩阵

## 下一步

把 PC4 拉进来做对照，并固定同一套流量分布与随机种子。"""),

    dict(face="uu", slug="muduo-event-loop", title="muduo 源码阅读：EventLoop 怎么兑现 one loop per thread",
         date="2026-08-16", category="源码阅读",
         tags=["muduo", "reactor"], featured=False, draft=False,
         desc="从 EventLoop::loop() 的 poll + channel 分发读起，理清 Poller、Channel、EventLoop 三者的所有权关系，以及 eventfd 唤醒线程的用途。",
         body="""## 问题

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

Asio 把这一层抽象成 `io_context` + `strand`，不暴露 fd；muduo 则把 fd 与 Channel 摆在你面前。读 muduo 更容易看清「事件循环到底在转什么」。"""),

    dict(face="uu", slug="cpp20-coroutine-frame", title="co_await 发生时，栈到底去了哪里：C++20 协程帧的布局拆解",
         date="2026-08-02", category="C++",
         tags=["cpp20", "协程", "coroutine-handle"], featured=False, draft=False,
         desc="用 -fcoroutines 编译一段最小协程，对照汇编看 promise、协程帧与局部变量的摆放，理解「暂停即返回、恢复即跳回」在机器层面意味着什么。",
         body="""## 最小协程

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

> 踩坑：把大对象放进协程帧会让帧膨胀；能 `move` 进帧的就别让它留在栈上被整份拷贝。"""),

    dict(face="uu", slug="tcp-accept-to-epoll", title="从三次握手到 epoll：一次服务端 accept 的完整路径",
         date="2026-07-19", category="网络编程",
         tags=["epoll", "tcp", "linux"], featured=False, draft=False,
         desc="半连接队列、全连接队列、惊群、EPOLLEXCLUSIVE——沿着内核源码把 listen 到 accept 之间的每一步走一遍，配 strace 验证。",
         body="""## 为什么要走一遍内核路径

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

把「listen backlog = 全连接队列长度」这个等式亲手验证一遍，比背十遍结论都牢。"""),

    dict(face="uu", slug="emc-item14-lambda-capture", title="Effective Modern C++ 精读：条款 14 与 lambda 的捕获陷阱",
         date="2025-12-30", category="C++",
         tags=["effective-modern-cpp", "lambda"], featured=False, draft=False,
         desc="按值捕获、按引用捕获、init capture、广义捕获——四种形式各配一段会在生产环境炸掉的代码与修复姿势，最后给出一团队代码评审清单。",
         body="""## 四种捕获形式，四种炸法

```cpp
std::vector<int> data{1, 2, 3};

// ① 按引用捕获：lambda 比变量活得久 → 悬垂
auto f1 = [&data] { return data.size(); };   // data 析构后调用即 UB

// ② 按值捕获：捕获的是指针的值，不是对象
auto ptr = std::make_unique<std::vector<int>>(3, 0);
auto f2 = [ptr] {};                          // 编不过（unique_ptr 不可复制）

// ③ init capture（C++14）：move 进闭包，正确姿势
auto f3 = [v = std::move(data)] { return v.size(); };

// ④ 默认捕获 [=] / [&]：看不见的依赖，重构时最容易漏
struct Widget { int x; };
auto w = Widget{42};
auto f4 = [=] { return w.x; };               // 捕获的是 this？不，这里拷贝了 w
```

## 评审清单

1. 捕获列表**显式列出**每个名字，禁用 `[=]` / `[&]`
2. 生命周期超过当前作用域的 lambda，一律 init capture + move
3. 捕获 `this` 的 lambda 不许逃出对象生命周期
4. 成员函数里的 lambda 需要成员值时，先拷贝到局部再捕获

条款 14 的原话是「使用 init capture 把对象 move 进闭包」——而实践中更重要的，是让评审者一眼看出**捕获了什么**。"""),

    dict(face="uu", slug="qt-qsettings-ini", title="给 Qt 客户端配一个 INI 配置层：QSettings 的正确姿势",
         date="2025-11-11", category="工程实践",
         tags=["qt", "qsettings"], featured=False, draft=False,
         desc="配置读写依赖工作目录的经典坑、CMake POST_BUILD 自动拷贝配置文件，以及为什么不要在构造函数里直接读相对路径，附一完整可抄的最小实现。",
         body="""## 问题现场

同一份程序，双击运行能读到配置，从 IDE 里跑就读不到——十有八九是**工作目录**在作怪：`QSettings` 的相对路径按进程 CWD 解析，而 IDE 默认 CWD 是 build 目录。

## 正确姿势

```cpp
// ① 启动早期把配置路径钉死为「可执行文件同目录」
const QString cfgPath = QCoreApplication::applicationDirPath() + "/config.ini";
QSettings settings(cfgPath, QSettings::IniFormat);

// ② 需要默认值的读取封装
template <typename T>
T readOr(QSettings& s, const QString& key, const T& def) {
    const QVariant v = s.value(key);
    return v.isValid() ? v.value<T>() : def;
}
```

```cmake
# ③ CMake：把配置文件拷到 exe 目录（不依赖 CWD）
add_executable(client main.cpp)
configure_file(config.ini.in ${CMAKE_BINARY_DIR}/config.ini)
add_custom_command(TARGET client POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            ${CMAKE_BINARY_DIR}/config.ini $<TARGET_FILE_DIR:client>)
```

## 三条纪律

1. 配置路径**永远**从 `applicationDirPath()` 推导，不信 CWD
2. 所有键给默认值，删掉配置文件也要能起
3. 写回时用 `sync()` 并检查 `status()`，静默失败等于没存"""),

    # ---------- Mixt 面（4 篇，草稿：分类未登记的示例形态，见 content-layer 的草稿放行规则） ----------
    dict(face="mixt", slug="tcache-layout-glibc235", title="glibc 2.35 tcache 结构体布局与保护机制速览",
         date="2026-08-20", category="堆利用（示例）",
         tags=["pwn", "glibc", "tcache"], featured=True, draft=True,
         desc="从 chunk 头与 tcache_entry 的字段布局讲起，把 safe-linking、key 校验与常见触发条件下的行为差异梳理清楚，全部实验在自建环境完成。",
         body="""## 从一个结构体开始

（草稿）tcache 的核心就两个结构：每线程一个的 `tcache_perthread_struct`，和挂在 bin 上的 `tcache_entry`。2.35 的字段布局与保护机制如下（地址已打码）：

```c
// 伪代码：字段布局示意
struct tcache_entry {
    struct tcache_entry *next;   // safe-linking: ptr ^ (addr >> 12)
    uintptr_t            key;    // 指向 perthread_struct，双重释放检测
};
```

## 保护机制对照

| 机制 | 引入版本 | 绕过思路（打码） |
| --- | --- | --- |
| safe-linking | 2.32 | 已知堆地址即可还原 |
| key 校验 | 2.29 | 换 key 或先 free 再 UAF 改写 |
| 对齐检查 | 2.32 | 保持 16 字节对齐 |

## 正文待补

（此篇为种子草稿：Mixt 面分类初始为空，示例分类仅保留 Demo 形态；正文由本人经写作台补齐后，先登记分类再发布。）"""),

    dict(face="mixt", slug="heap-techniques-compare", title="堆布局手法对比：适用版本与关键约束",
         date="2026-07-30", category="堆利用（示例）",
         tags=["pwn", "heap"], featured=False, draft=True,
         desc="把几种常见手法按 glibc 版本、前置条件与利用代价做成表格，说明各自在什么场景下会失效，所有偏移与地址均打码，仅保留判断思路。",
         body="""## 为什么要做表格

（草稿）手法本身不难记，难记的是**适用版本与前置条件**。同一个名字在 2.27 能用、在 2.35 要换写法，光看 writeup 很容易踩空。

## 对照表（节选）

| 维度 | 老版本 | 新版本 |
| --- | --- | --- |
| 指针编码 | 明文 | safe-linking 混淆 |
| 结构校验 | 无 | key 字段 |
| 触发条件 | 单次写入 | 需配合二次分配 |

## 判断顺序

1. 先确认 glibc 版本（这决定一半以上的可用手法）
2. 再看可写入次数与可控长度
3. 最后才选手法，而不是反过来

> 本文不含完整利用程序；所有地址与偏移已打码，仅保留判断思路（PRD 3.7）。"""),

    dict(face="mixt", slug="ctf-pwn-walkthrough", title="一道 CTF pwn 题的完整思路复盘",
         date="2026-07-02", category="CTF（示例）",
         tags=["ctf", "pwn"], featured=False, draft=True,
         desc="从信息收集到偏移计算，记录每一步的判断依据与排除过程；所有地址与细节均已打码，实验全程在自建容器环境中复现，仅保留思路。",
         body="""## 信息收集

（草稿）拿到二进制先做三件事：`checksec` 看保护、看菜单交互、找可疑的输入长度。这道题的线索是**长度校验写在拷贝之后**。

## 判断链

- 保护：NX 开、canary 开、PIE 开 → 先想办法泄露
- 交互：菜单有「查看」与「编辑」两个入口 → 大概率能给读原语
- 输入：编辑时长度可以写到分配大小之外 → 堆溢出

## 打码后的关键片段

```c
// 原题此处长度校验在 memcpy 之后
memcpy(dst, src, len);          // len 未与 capacity 比较
if (len > capacity) return -1;  // 校验来得太晚
```

## 复盘

1. 先泄露 libc 基址，再算 one_gadget 约束
2. 全程在自建容器里复现，版本固定
3. 结论：这类题的难点不是手法，而是**信息收集的完整度**"""),

    dict(face="mixt", slug="pwn-env-docker", title="环境自建：用 Docker 搭一套可复现的 pwn 调试环境",
         date="2026-06-18", category="工具链（示例）",
         tags=["docker", "gdb", "工具链"], featured=False, draft=True,
         desc="固定 glibc 版本、配好调试器与 ASLR 开关，让每次实验都在同一套自建容器环境里复现；环境自建本身也是合规要求的一部分。",
         body="""## 为什么要固定环境

（草稿）同一个二进制在不同 glibc 下行为完全不同。复现别人的 writeup 时，第一件事不是看代码，而是**把版本对齐**。

## 最小 Dockerfile

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y gdb python3-pip patchelf
RUN pip3 install pwntools
WORKDIR /work
```

## 三件事

1. 固定 `libc.so.6` 与 `ld.so`，必要时用 patchelf 改 interp
2. 配好调试器插件，别在容器里现装
3. 关掉 ASLR 只在需要时，默认保持开启，才接近真实场景

> 环境自建是合规要求的一部分：所有实验都在自己的容器里完成。"""),
]

bad = []
for p in POSTS:
    n = len(p["desc"])
    if not (60 <= n <= 120):
        bad.append((p["slug"], n))

if bad:
    print("描述长度不合规（需 60-120）:", bad)
    sys.exit(1)

for p in POSTS:
    fm = [
        "---",
        f'title: "{p["title"]}"',
        f'slug: {p["slug"]}',
        f'description: "{p["desc"]}"',
        f'date: {p["date"]}',
    ]
    if p.get("updated"):
        fm.append(f'updated: {p["updated"]}')
    fm += [
        f'author: {p["face"]}',
        f'category: {p["category"]}',
        f'tags: [{", ".join(p["tags"])}]',
        f'featured: {str(p["featured"]).lower()}',
        f'draft: {str(p["draft"]).lower()}',
        "---",
        "",
    ]
    path = os.path.join(OUT[p["face"]], p["slug"] + ".md")
    io.open(path, "w", encoding="utf-8", newline="\n").write("\n".join(fm) + p["body"] + "\n")
    print("write", path.split("content")[-1], "desc", len(p["desc"]), "字")

print("done:", len(POSTS), "篇（UU 7 发布 / Mixt 4 草稿）")
