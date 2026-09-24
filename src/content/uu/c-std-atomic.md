---
title: "C++ std::atomic 精讲"
slug: c-std-atomic
description: "讲解 C++ std::atomic 的原子操作、CAS 与内存序，对比 mutex 的选型场景，并给出无锁编程的工程实践要点。"
date: 2026-09-22
author: uu
category: C++
tags: [C++, 并发, 异步编程]
featured: false
draft: false
---
## 一、为什么需要 atomic：从数据竞争说起

**原子操作 = 不可分割的操作**：要么全部执行完，要么完全不执行，不会出现"执行到一半被打断"的中间状态。

**无原子操作则存在数据竞争问题：**&#x43;++ 标准规定：多线程无同步地访问同一变量且至少有一个是写，就是**未定义行为。**

### 两种解法对比

| **方案**        | **写法**                   | **代价**             |
| ------------- | ------------------------ | ------------------ |
| `std::mutex`  | `lock()` / `unlock()` 包住 | 可能阻塞、上下文切换，有竞争时开销大 |
| `std::atomic` | `++counter;`             | 硬件级原子操作，不阻塞        |

```cpp
#include <atomic>
#include <thread>
#include <iostream>

std::atomic<int> counter(0);

void increment(int n) {
    for (int i = 0; i < n; ++i)
        ++counter;                       // 原子操作，线程安全
}

int main() {
    std::thread t1(increment, 100000);
    std::thread t2(increment, 100000);
    t1.join(); t2.join();
    std::cout << counter << std::endl;   // 恒为 200000
}
```

> **为什么换成 `std::atomic<int>` 就安全了？** 同样的 `++counter`，编译器会把它变成一个不可分割的原子"读+改+写"操作，中间插不进其他线程。这就是 atomic 的核心价值。

***

## 二、基本用法

### 2.1 支持的类型

| **类型**                        | **说明**                                   |
| ----------------------------- | ---------------------------------------- |
| 整型：`int`、`long`、`unsigned` 系列 | 功能最全：`++`、`fetch_add`、位运算都支持             |
| `bool`                        | 最常用：标志位、开关                               |
| 指针 `T*`                       | 支持 `fetch_add(1)`（移动一个 T 的长度）            |
| 自定义类型 `atomic<T>`             | 要求 T 可平凡复制；只能 `load/store`，不能 `++`（了解即可） |

浮点数 float / double 要 C++20 才支持原子运算。

### 2.2 常用接口

```cpp
std::atomic<int> counter{0};

counter.load();           // 读
counter.store(42);        // 写
counter.exchange(100);    // 设为 100，返回旧值

counter.fetch_add(1);     // 原子 +1，返回【加之前】的旧值
++counter;                // 返回【加之后】的新值（注意区别）

counter.fetch_sub(1);     // 原子 -1
```

### 2.3 比较并交换（CAS）

```cpp
std::atomic<int> counter(100);

int expected = counter.load();
bool ok = counter.compare_exchange_strong(expected, 999);
//  while(counter.load() == expected)
//      bool ok = counter.compare_exchange_weak(expected, 999);
//
    含义：如果 counter == expected（说明没人动过），就改成 999，返回 true
    如果 counter != expected（别人改过了），返回 false， 并把 expected 自动更新为 counter 的当前值
```

CAS 回答的问题是：**"从我看到它到我要改它，这期间有没有别人动过？"** 没人动过才允许写数据，相当于把"检查 + 修改"合并成了一次原子操作（对比第四章的 balance 反例）。

**weak 和 strong 怎么选?   放在循环里用 weak，单次判断用 strong**。weak 在某些平台上可能"条件满足也返回失败"，循环场景下多转一圈就行，速度更快。

### 2.4 两个小注意点

```cpp
std::atomic<int> a(0);
// std::atomic<int> b = a;    // ❌ 原子变量禁止拷贝和移动
std::atomic<int> b;
b.store(a.load());            // ✅ 只能 load 出来再存进去
```

含 atomic 成员的类也就没有默认拷贝构造——放进容器或按值传参前要想一下。

***

## 三、内存序：共有六档，这里只讲三档

每个原子操作可以带一个 `memory_order_*` 参数，控制"这个操作前后的代码允许被重排到什么程度"。约束越弱越快，越强越安全。

**初学者记住这三档就够了**：

| **内存序**                   | **一句话理解**                      | **典型场景**  |
| ------------------------- | ------------------------------ | --------- |
| `relaxed`                 | 只保证这个操作本身原子，其他什么都不管            | 纯计数、统计    |
| `acquire` / `release`（成对） | release 之前的所有写入，acquire 之后都能看到 | 标志位发布数据、锁 |
| `seq_cst`                 | 默认值，最强最安全                      | 拿不准就用它    |

### 3.1 release / acquire：必会的"存储-载入"模型

```cpp
std::atomic<bool> ready(false);
int data = 0;    // 普通变量，不是 atomic

// 线程 1（生产者）
data = 42;                                     // ① 先写数据
ready.store(true, std::memory_order_release);  // ② 再置标志

// 线程 2（消费者）
while (!ready.load(std::memory_order_acquire)) // ③ 等标志
    ;
// ④ 这里保证读到 data == 42
```

记忆口诀：

> **release**："我之前写的所有东西，都准备好了"（存储）
> **acquire**："看到标志的那一刻，之前的写入我全都能看到"（载入）

关键点：**`data` 是普通变量也安全**——一个 atomic 标志位就能安全发布一大片普通数据，这是这套配对的价值。顺序反了（先 release 置标志、后写数据）就没有这个保证，所以"先写数据、再置标志"这个顺序不能乱。

### 3.2 简略介绍 relaxed 与 seq\_cst&#x20;

* **relaxed**：适合事件计数这类场景——只关心最终总数对，不关心它和其他变量的先后关系。好处是比默认的 seq\_cst 快不少。
* **seq\_cst**：默认值，保证所有线程对所有 seq\_cst 类型的原子操作的先后顺序看法一致。

**注意它也不是魔法**：线程 1 刚写完，线程 2 并不保证"立刻"读到新值，仍可能读到旧值——并发程序的正确性靠的是设计好同步点（join、condition\_variable、acquire/release 配对），而不是光把变量改成 atomic 就万事大吉。

专业的说，它只保证 seq\_cst 类型的内存操作对于所有线程存在全局顺序一致性，但不保证某个操作在这个串行化里排在哪，所以它无法限制并发线程的执行时序交错。详细踩坑可见 three threads with two false 场景（此篇文档按下不表）。

* 另外还有个 `acq_rel`（读改写操作两头都管，如自旋锁内部），知道名字即可。

***

## 四、atomic vs mutex：应用场景选择 + 经典误区

### 4.1 选型表

| **场景**                | **选择**              |
| --------------------- | ------------------- |
| 单个计数器 / 标志位           | ✅ atomic            |
| 多个变量要一起改（如转账：A 减 B 加） | ✅ mutex（atomic 做不到） |
| 复杂数据结构（链表、树、哈希表）      | ✅ mutex             |
| 临界区长、含 I/O            | ✅ mutex（atomic 会干等） |
| 临界区极短、对延迟敏感           | ✅ atomic            |

一句话总结：**atomic 只保护"一个变量的一次操作"；只要逻辑跨越多个变量或多个步骤，就用 mutex。**

### 4.2 高频误区：check-then-act 不是原子的

```cpp
// ❌ 错误：以为 atomic 能保护这段逻辑
std::atomic<int> balance(100);

void withdraw(int amount) {
    if (balance.load() >= amount) {              // ① 检查
        balance.store(balance.load() - amount);  // ② 扣款
    }
}
```

① 和 ② 是**两次独立的原子操作**，中间的空隙别的线程可以插进来——两个线程同时通过检查，就双双超额扣款。

正确写法：用 CAS 把"检查 + 扣款"合并成一次原子操作：

```cpp
// ✅ CAS 循环
void withdraw(int amount) {
    int expected = balance.load();
    while (expected >= amount) {
        if (balance.compare_exchange_weak(expected, expected - amount))
            break;   // 成功：说明整个期间没人动过，安全扣款
        // 失败：expected 已被自动更新为最新值，循环重新检查
    }
}
```

这个"CAS + 循环重试"的模式非常重要，下一章展开。

***

## 五、性能量级（心里有数即可）

| **操作**             | **单次延迟量级** |
| ------------------ | ---------- |
| 普通 int 读写          | \~1 ns     |
| atomic 操作          | \~几 ns     |
| mutex 无竞争          | \~几十 ns    |
| mutex 高竞争（触发上下文切换） | 微秒级，且不稳定   |

两个结论：

1. **atomic vs mutex 的差距在竞争下拉开**：atomic 永远是纳秒级常数；mutex 一旦多线程抢锁，可能陷入内核、线程切换，慢百倍以上。
2. **atomic 也不是免费的**：默认的 seq\_cst 比普通读写慢几倍，热点路径上显式选 relaxed 能省回来。

***

## 六、工程实践：高频的6个场景

### 6.1 CAS 循环：无锁编程的万能模板

**思想**：乐观地尝试"读 → 算 → 写"，写的时候用 CAS 确认没人动过；被人抢先了就拿到最新值重试。

```cpp
std::atomic<int> var;

void update() {
    int expected = var.load();                       // ① 读旧值
    do {
        int desired = expected * 2;                  // ② 基于旧值算新值（纯计算）
    } while (!var.compare_exchange_weak(expected, desired));  // ③ 没人动过才提交
}
```

两个注意点：

* **失败时 expected 自动变最新值**，所以循环体不用重新 load；
* **循环体里只放纯计算**，别放有副作用的操作（new、打日志），否则重试会重复执行。

### 6.2 原子 ID 生成器：fetch\_add 返回旧值

```cpp
std::atomic<uint64_t> next_id{0};

uint64_t gen_id() {
    return next_id.fetch_add(1, std::memory_order_relaxed);
    // 第一个调用者拿 0，第二个拿 1……每人拿到不重复的 ID
}
```

比"锁 + 计数器"简洁且更快，统计计数同理都用 relaxed。

### 6.3 优雅退出标志：atomic\ 最常见的用法

```cpp
std::atomic<bool> running{true};

void worker() {
    while (running) {        // 每轮循环看一眼标志
        // ... 处理任务 ...
    }
}

int main() {
    std::thread t(worker);
    // ... 
    running = false;         // 通知退出
    t.join();
}
```

考察点：为什么不能用普通 `bool`？——数据竞争是 UB，而且编译器可能发现循环里没人改 `running`，把它优化成死循环。`atomic<bool>` 同时解决这两个问题。

### 6.4 自旋锁：理解锁的本质

```cpp
class SpinLock {
    std::atomic_flag flag_{};
public:
    void lock() {
        while (flag_.test_and_set(std::memory_order_acquire));  // 抢不到就自旋
    }
    void unlock() {
        flag_.clear(std::memory_order_release);                 // 释放并发布
    }
};
```

`test_and_set` 原子地"读旧值 + 置 true"：读出 false 说明抢锁成功。acquire/release 配对保证**临界区里的数据修改**对下一个拿锁的线程可见——**锁的本质就是 acquire/release**，这个说法在面试里很加分。

使用纪律：临界区必须极短、不能有 I/O，否则自旋的线程白烧 CPU；这种场景该用 mutex 让出 CPU。

### 6.5 线程安全单例：标准答案两步走

**首选：Meyers 单例**（C++11 起标准保证局部 static 初始化线程安全，一行搞定）：

```cpp
Singleton& instance() {
    static Singleton inst;   // C++11 保证：多线程同时首次调用也只构造一次
    return inst;
}
```

**加分项：能讲清 DCLP（双重检查锁定，新标准下已弃用）为什么需要 atomic**：

```cpp
Singleton* p = inst_.load(std::memory_order_acquire);   // 无锁快路径
if (p == nullptr) {
    std::lock_guard<std::mutex> lk(mtx_);               // 加锁慢路径
    p = inst_.load(std::memory_order_relaxed);
    if (p == nullptr) {
        p = new Singleton;
        inst_.store(p, std::memory_order_release);      // 构造完成后才发布指针
    }
}
```

关键在 release/acquire：没有它们，`new Singleton` 的构造过程可能被重排到指针赋值之后，别的线程拿到非空指针时对象还没构造完。回答模板："**先说 Meyers 单例够用，再补一句 DCLP 的坑在指令重排、要用 atomic 的 acquire/release 修复**"

### 6.6 shared\_ptr 的线程安全性：超高频

分两层回答，千万别混：

| **操作**                                      | **线程安全？** | **原因**                                                |
| ------------------------------------------- | --------- | ----------------------------------------------------- |
| 不同线程各自操作**自己的副本**（拷贝、析构指向同一对象的 shared\_ptr） | ✅         | 引用计数的增减是原子操作                                          |
| 多个线程同时**读写同一个** shared\_ptr 对象              | ❌         | 计数原子 ≠ 指针本身原子，需要 mutex 或 C++20 的 `atomic<shared_ptr>` |

一句话："**shared\_ptr 的引用计数是原子的，但 shared\_ptr 变量本身不是**"。

### 6.7 误用清单（review 代码时对照用）

1. **volatile ≠ atomic**：volatile 只禁止编译器把变量缓存到寄存器，不保证原子性，多线程同步用它仍是 UB。这是面试最爱挖的坑。
2. **check-then-act 竞态**：`if (a.load() > 0) a.store(a.load() - 1)` 不是原子的，复合逻辑合并成一次 CAS（见 4.2）。
3. **跨变量顺序**："先写数据、再置标志"必须用 release/acquire；两个都写 relaxed 就没有先后保证。
4. **fetch\_add 返回旧值**：`int x = counter.fetch_add(1);` 拿到的是加之前的值；要新值写 `++counter`。
5. **默认参数的开销**：不写内存序就是 seq\_cst，最安全也最贵；纯计数记得显式 relaxed。

***

## 七、速答卡

| **问题**                 | **30 秒答案**                                                                |
| ---------------------- | ------------------------------------------------------------------------- |
| atomic 解决什么问题？         | 数据竞争：保证单次操作的**原子性**，并按内存序保证**可见性**，不需要锁。                                  |
| `counter++` 为什么不安全？    | 读-加-写三步会被其他线程打断，造成丢失更新；atomic 把三步合并为不可分割的操作。                              |
| atomic 和 mutex 怎么选？    | 单变量的简单读写/计数用 atomic；多变量复合操作、复杂结构、长临界区用 mutex。                             |
| CAS 是什么？               | Compare-And-Swap：值还等于我看到的旧值才写入新值，否则失败。配合循环重试实现"逻辑上的原子"。                   |
| weak 和 strong CAS 区别？  | 循环里用 weak（可能伪失败但更快），单次判断用 strong。失败时 expected 自动更新为最新值。                   |
| 内存序常用哪三档？              | relaxed（纯计数）、acquire/release（成对，发布-订阅）、seq\_cst（默认，拿不准就用）。                |
| acquire/release 什么含义？  | release："我之前的写入都已就绪"；acquire："看到标志后，之前的写入我全可见"。                           |
| volatile 能替代 atomic 吗？ | 不能。volatile 只防编译器优化，不保证原子性和顺序，多线程同步用它仍是 UB。                               |
| shared\_ptr 线程安全吗？     | 引用计数是原子的（各线程操作各自的副本安全）；但同一个 shared\_ptr 对象的并发读写不安全。                       |
| 线程安全单例怎么写？             | 首选 Meyers（局部 static，C++11 保证安全）；DCLP 需 atomic 指针 + release/acquire 防构造重排。 |

***

## 附：进阶导引

如果面试官聊到无锁容器/无锁栈，记住一个关键词就够了——**ABA 问题**：CAS 只比较"值一样"，不比较"历史"，地址被 A→B→A 折腾过之后 CAS 会误判"没变过"；工业界的解法是给指针带版本号或延迟内存回收。被问到时答出"知道有这回事 + 关键词"，比硬撑着展开要稳。

> 参考：[cppreference - std::atomic](https://en.cppreference.com/w/cpp/atomic/atomic)、《C++ Concurrency in Action》第 5 章

