/* ==========================================================================
   UU&Mixt Demo · 本地内容层（localStorage）
   目的：让 Demo 具备「写作台提交 → 站点立即可见」的完整闭环，无需后端。
   真实实现里这一层由 Astro 构建期读取 Markdown 取代，接口语义保持不变：
     - 文章提交即可见（无审核环节）：非草稿状态直接进入面首页/归档/分类
     - 分类由各面作者自行维护：UU 面预置 5 个，Mixt 面初始为空
   ========================================================================== */
(function () {
  "use strict";

  var KEY = "uum-demo-store-v1";
  var VERSION = 1;

  var SEED = {
    version: VERSION,
    posts: [
      { id: "uu-1", face: "uu", title: "用 Boost.Asio 搭一个可优雅退出的异步 TCP 服务器",
        slug: "asio-graceful-shutdown", date: "2026-09-05", category: "工程实践",
        tags: ["boost-asio", "cpp", "优雅退出"], words: "3.2k", minutes: 12,
        desc: "主线程 accept、IO 线程池、独立逻辑线程的三层模型，加上 signal_set 驱动的停机序列，让服务器可以不丢连接地退出。完整实现与踩坑记录。",
        featured: true, draft: false, detail: "uu-post.html" },
      { id: "uu-2", face: "uu", title: "Mercury 复现笔记（一）：把 HPCC 的 INT 反馈链路跑进 NS-3.17",
        slug: "mercury-hpcc-int-ns3", date: "2026-08-28", category: "科研复现",
        tags: ["ns-3", "hpcc", "拥塞控制"], words: "2.6k", minutes: 10,
        desc: "从 OURS 模拟器源码与原始论文出发，梳理 HPCC 基于 INT 的反馈机制与 U 驱动的窗口调整，记录在 Ubuntu 18.04 + gcc-5 环境下跑通基线的全过程。",
        featured: false, draft: false },
      { id: "uu-3", face: "uu", title: "muduo 源码阅读：EventLoop 怎么兑现 one loop per thread",
        slug: "muduo-event-loop", date: "2026-08-16", category: "源码阅读",
        tags: ["muduo", "reactor"], words: "1.9k", minutes: 8,
        desc: "从 EventLoop::loop() 的 poll + channel 分发读起，理清 Poller、Channel、EventLoop 三者的所有权关系，以及 eventfd 唤醒线程的用途。",
        featured: false, draft: false },
      { id: "uu-4", face: "uu", title: "co_await 发生时，栈到底去了哪里：C++20 协程帧的布局拆解",
        slug: "cpp20-coroutine-frame", date: "2026-08-02", category: "C++",
        tags: ["cpp20", "协程", "coroutine-handle"], words: "2.2k", minutes: 9,
        desc: "用 -fcoroutines 编译一段最小协程，对照汇编看 promise、协程帧与局部变量的摆放，理解「暂停即返回、恢复即跳回」在机器层面意味着什么。",
        featured: false, draft: false },
      { id: "uu-5", face: "uu", title: "从三次握手到 epoll：一次服务端 accept 的完整路径",
        slug: "tcp-accept-to-epoll", date: "2026-07-19", category: "网络编程",
        tags: ["epoll", "tcp", "linux"], words: "2.8k", minutes: 11,
        desc: "半连接队列、全连接队列、惊群、EPOLLEXCLUSIVE——沿着内核源码把 listen 到 accept 之间的每一步走一遍，配 strace 验证。",
        featured: false, draft: false },
      { id: "uu-6", face: "uu", title: "Effective Modern C++ 精读：条款 14 与 lambda 的捕获陷阱",
        slug: "emc-item14-lambda-capture", date: "2025-12-30", category: "C++",
        tags: ["effective-modern-cpp", "lambda"], words: "1.5k", minutes: 6,
        desc: "按值捕获、按引用捕获、init capture、广义捕获——四种形式各配一段会在生产环境炸掉的代码，以及对应的修复姿势。",
        featured: false, draft: false },
      { id: "uu-7", face: "uu", title: "给 Qt 客户端配一个 INI 配置层：QSettings 的正确姿势",
        slug: "qt-qsettings-ini", date: "2025-11-11", category: "工程实践",
        tags: ["qt", "qsettings"], words: "1.8k", minutes: 7,
        desc: "配置读写与工作目录的坑、CMake 的 POST_BUILD 拷贝、以及为什么不要在构造函数里直接读相对路径。",
        featured: false, draft: false },
      { id: "mixt-1", face: "mixt", title: "glibc 2.35 tcache 结构体布局与保护机制速览",
        slug: "tcache-layout-glibc235", date: "2026-08-20", category: "堆利用（示例）",
        tags: ["pwn", "glibc", "tcache"], words: "2.4k", minutes: 10,
        desc: "从 chunk 头与 tcache_entry 的字段布局讲起，把 safe-linking、key 校验与常见触发条件下的行为差异梳理清楚。",
        featured: true, draft: false, detail: "mixt-post.html" },
      { id: "mixt-2", face: "mixt", title: "堆布局手法对比：适用版本与关键约束",
        slug: "heap-techniques-compare", date: "2026-07-30", category: "堆利用（示例）",
        tags: ["pwn", "heap"], words: "3.1k", minutes: 13,
        desc: "把几种常见手法按 glibc 版本、前置条件与利用代价做成表格，说明各自在什么场景下会失效。",
        featured: false, draft: false },
      { id: "mixt-3", face: "mixt", title: "一道 CTF pwn 题的完整思路复盘",
        slug: "ctf-pwn-walkthrough", date: "2026-07-02", category: "CTF（示例）",
        tags: ["ctf", "pwn"], words: "2.0k", minutes: 9,
        desc: "从信息收集到偏移计算，记录每一步的判断依据；所有地址与细节均已打码，仅保留思路。",
        featured: false, draft: false },
      { id: "mixt-4", face: "mixt", title: "环境自建：用 Docker 搭一套可复现的 pwn 调试环境",
        slug: "pwn-env-docker", date: "2026-06-18", category: "工具链（示例）",
        tags: ["docker", "gdb", "工具链"], words: "1.6k", minutes: 7,
        desc: "固定 glibc 版本、配好 pwndbg 与 ASLR 开关，让每次实验都在同一套环境里复现。",
        featured: false, draft: false }
    ],
    /* 分类由各面作者自行维护；Mixt 面初始为空（PRD 3.5） */
    categories: {
      uu: [
        { slug: "cpp", name: "C++", desc: "语言与标准库：Effective 系列精读、协程、lambda 与现代惯用法。" },
        { slug: "network-programming", name: "网络编程", desc: "从内核到用户态的网络栈拆解：epoll、三次握手、accept 全路径。" },
        { slug: "source-reading", name: "源码阅读", desc: "带着问题读源码：muduo、Asio 等工业级库的结构与取舍。" },
        { slug: "research", name: "科研复现", desc: "论文复现笔记：拥塞控制、INT 反馈链路、模拟器与实验矩阵。" },
        { slug: "engineering", name: "工程实践", desc: "真实项目的架构与踩坑：异步服务器、配置层、优雅退出。" }
      ],
      mixt: []
    },
    /* 作者简介：写作台「设置」可改，面页侧栏与作者页动态读取。
       正式实现里简介落在仓库的作者配置中（构建期渲染进侧栏与作者页）。 */
    authors: {
      uu: { bio: "写 C++ 后端与网络编程，做过异步服务器与 Qt 客户端，也在复现 AI 集群的集合通信拥塞控制。落笔偏好可复现的细节与可验证的结论——不写「应该可以」，写「我实测是」。" },
      mixt: { bio: "主攻 PWN 二进制安全。写漏洞分析、利用技巧与 CTF writeup，关注机制层面「为什么可行」与「什么条件下失效」。所有内容遵守合规措辞规则：自建环境、伪代码与打码、不提供可直接复用的完整利用程序。" }
    },
    /* 友链 = 站点级共享数据（入口页卡组展示，两位作者均可维护；PRD E8）
       数据形态：名称 / 地址 / 头像（可选，缺省用站名首字）/ 简介 */
    friends: [
      { id: "fr-1",  name: "云端牧码",   url: "https://example.com/yunmuma",    avatar: "", desc: "写云计算与分布式系统的实验记录，偏好可复现的部署清单。" },
      { id: "fr-2",  name: "栈外",       url: "https://example.com/zhanwai",    avatar: "", desc: "聊编程语言之外的事：编译器、运行时与一点哲学。" },
      { id: "fr-3",  name: "像素底片",   url: "https://example.com/pixelphoto", avatar: "", desc: "复古游戏美术与独立开发日志，偶尔更新像素画教程。" },
      { id: "fr-4",  name: "夜航西飞",   url: "https://example.com/nightfly",   avatar: "", desc: "网络工程方向，BGP 与数据中心网络的踩坑合集。" },
      { id: "fr-5",  name: "炉边谈话",   url: "https://example.com/hearth",     avatar: "", desc: "安全研究员的随笔：漏洞之外，还有生活。" },
      { id: "fr-6",  name: "零点客栈",   url: "https://example.com/inn0",       avatar: "", desc: "后端与数据库，PostgreSQL 深度爱好者。" },
      { id: "fr-7",  name: "拾荒者手记", url: "https://example.com/scavenger",  avatar: "", desc: "在开源项目里捡宝贝：源码阅读与提交考古。" },
      { id: "fr-8",  name: "南方小院",   url: "https://example.com/southyard",  avatar: "", desc: "自建服务器的折腾史：NAS、家庭实验室与电费账单。" },
      { id: "fr-9",  name: "白板与咖啡", url: "https://example.com/whiteboard", avatar: "", desc: "算法竞赛退役选手的复出训练场。" },
      { id: "fr-10", name: "回声谷",     url: "https://example.com/echovalley", avatar: "", desc: "音频编程与信号处理，用代码做声音的实验。" },
      { id: "fr-11", name: "折纸引擎",   url: "https://example.com/origami",    avatar: "", desc: "图形学与渲染管线，WebGPU 尝鲜系列。" },
      { id: "fr-12", name: "慢速快门",   url: "https://example.com/slowshutter",avatar: "", desc: "摄影 + 前端，把照片做成会动的网页。" },
      { id: "fr-13", name: "候鸟电台",   url: "https://example.com/migratory",  avatar: "", desc: " weekly 技术播客的文字稿与延伸阅读。" },
      { id: "fr-14", name: "齿轮与诗",   url: "https://example.com/gearpoem",   avatar: "", desc: "机械键盘、固件改造与一点工业设计审美。" },
      { id: "fr-15", name: "面包屑导航", url: "https://example.com/breadcrumb", avatar: "", desc: "产品与工程的交叉地带，写原型背后的思考。" },
      { id: "fr-16", name: "北极星组件", url: "https://example.com/polaris",    avatar: "", desc: "前端架构与设计系统，组件库的长期主义。" }
    ]
  };


  /* 部分种子文章的 Markdown 正文（演示动态详情页的渲染与目录） */
  var BODIES = {
    "mercury-hpcc-int-ns3": [
      "## 复现目标",
      "",
      "把 HPCC 的 INT 反馈链路搬进 NS-3.17 的 master tree，先跑通单链路基线，再换真实流量分布。这篇只记录「跑起来」这一段：环境、编译、第一次出图。",
      "",
      "## 环境与依赖",
      "",
      "- Ubuntu 18.04 + Docker（宿主机不装任何仿真依赖）",
      "- NS-3.17 + waf 1.7 + gcc-5 + Python 2（run.py 是 py2 语法）",
      "- OURS 模拟器源码与 HPCC master tree 基线各一套",
      "",
      "## 关键改动",
      "",
      "HPCC 靠 INT 把链路利用率 U 带回发送端，再用 U 调整窗口。复现时最容易出错的是**反馈的时延**：",
      "",
      "```cpp",
      "// 伪代码：INT 头携带的 U，回到发送端后才参与窗口更新",
      "if (ack.int_valid) {",
      "    u = ack.u;                      // 链路利用率",
      "    w = (u < U_LOW) ? w * (1 + alpha) :",
      "        (u > U_HIGH) ? w * (1 - beta) : w;",
      "}",
      "```",
      "",
      "> 注意：U 的采样窗口与窗口更新的时间尺度必须对齐，否则会出现「反馈振荡」——曲线看起来很公平，实际吞吐在抖。",
      "",
      "## 首次结果",
      "",
      "1. 单链路：吞吐达到链路容量，收敛时间与论文量级一致",
      "2. 多链路：公平性指标偏乐观，怀疑是采样窗口偏小",
      "3. 待办：换真实 AI 流量分布，跑三算法对比矩阵",
      "",
      "## 下一步",
      "",
      "把 PC4 拉进来做对照，并固定同一套流量分布与随机种子。"
    ].join("\n"),

    "muduo-event-loop": [
      "## 问题",
      "",
      "`one loop per thread` 说起来一句话，落到代码里至少要回答三个问题：谁拥有 Poller？Channel 生命周期归谁？跨线程唤醒怎么做？",
      "",
      "## 三者的所有权",
      "",
      "- **EventLoop** 拥有 Poller 与唤醒用的 eventfd",
      "- **Channel** 只是 fd 的「事件登记表」，不拥有 fd",
      "- **线程** 可以没有 EventLoop，但一个 EventLoop 只属于一个线程",
      "",
      "```cpp",
      "void EventLoop::loop() {",
      "    while (!quit_) {",
      "        activeChannels_.clear();",
      "        pollReturnTime_ = poller_->poll(kPollTimeMs, &activeChannels_);",
      "        for (auto* ch : activeChannels_) ch->handleEvent();",
      "        doPendingFunctors();          // 跨线程任务在这里落地",
      "    }",
      "}",
      "```",
      "",
      "## eventfd 的用途",
      "",
      "阻塞在 `poll()` 上的线程无法被普通变量唤醒。muduo 用 eventfd 往 poll 里塞一个可读事件 —— 于是「跨线程投递任务」退化成「唤醒 + 排空队列」两件小事。",
      "",
      "## 与 Asio 的差别",
      "",
      "Asio 把这一层抽象成 `io_context` + `strand`，不暴露 fd；muduo 则把 fd 与 Channel 摆在你面前。读 muduo 更容易看清「事件循环到底在转什么」。"
    ].join("\n"),

    "cpp20-coroutine-frame": [
      "## 最小协程",
      "",
      "```cpp",
      "task<void> f() {",
      "    int local = 42;",
      "    co_await std::suspend_always{};",
      "    use(local);              // 恢复后 local 还在，它没在栈上",
      "}",
      "```",
      "",
      "## 帧里有什么",
      "",
      "用 `-fcoroutines` 编出来看汇编，协程帧至少包含：",
      "",
      "1. resume / destroy 函数指针（编译器生成）",
      "2. promise 对象（你自己定义的那个）",
      "3. 跨挂起点存活的局部变量与形参副本",
      "",
      "`co_await` 的第一个动作是把「返回地址」换成 `resume` 的地址 —— 所以「暂停即返回、恢复即跳回」在机器层面就是一次普通的函数调用与返回。",
      "",
      "> 踩坑：把大对象放进协程帧会让帧膨胀；能 `move` 进帧的就别让它留在栈上被整份拷贝。"
    ].join("\n"),

    "heap-techniques-compare": [
      "## 为什么要做表格",
      "",
      "手法本身不难记，难记的是**适用版本与前置条件**。同一个名字在 2.27 能用、在 2.35 要换写法，光看 writeup 很容易踩空。",
      "",
      "## 对照表（节选）",
      "",
      "| 维度 | 老版本 | 新版本 |",
      "| --- | --- | --- |",
      "| 指针编码 | 明文 | safe-linking 混淆 |",
      "| 结构校验 | 无 | key 字段 |",
      "| 触发条件 | 单次写入 | 需配合二次分配 |",
      "",
      "## 判断顺序",
      "",
      "1. 先确认 glibc 版本（这决定一半以上的可用手法）",
      "2. 再看可写入次数与可控长度",
      "3. 最后才选手法，而不是反过来",
      "",
      "> 本文不含完整利用程序；所有地址与偏移已打码，仅保留判断思路（PRD 3.7）。"
    ].join("\n"),

    "ctf-pwn-walkthrough": [
      "## 信息收集",
      "",
      "拿到二进制先做三件事：`checksec` 看保护、看菜单交互、找可疑的输入长度。这道题的线索是**长度校验写在拷贝之后**。",
      "",
      "## 判断链",
      "",
      "- 保护：NX 开、canary 开、PIE 开 → 先想办法泄露",
      "- 交互：菜单有「查看」与「编辑」两个入口 → 大概率能给读原语",
      "- 输入：编辑时长度可以写到分配大小之外 → 堆溢出",
      "",
      "## 打码后的关键片段",
      "",
      "```c",
      "// 原题此处长度校验在 memcpy 之后",
      "memcpy(dst, src, len);          // len 未与 capacity 比较",
      "if (len > capacity) return -1;  // 校验来得太晚",
      "```",
      "",
      "## 复盘",
      "",
      "1. 先泄露 libc 基址，再算 one_gadget 约束",
      "2. 全程在自建容器里复现，版本固定",
      "3. 结论：这类题的难点不是手法，而是**信息收集的完整度**"
    ].join("\n"),

    "pwn-env-docker": [
      "## 为什么要固定环境",
      "",
      "同一个二进制在不同 glibc 下行为完全不同。复现别人的 writeup 时，第一件事不是看代码，而是**把版本对齐**。",
      "",
      "## 最小 Dockerfile",
      "",
      "```dockerfile",
      "FROM ubuntu:22.04",
      "RUN apt-get update && apt-get install -y gdb python3-pip patchelf",
      "RUN pip3 install pwntools",
      "WORKDIR /work",
      "```",
      "",
      "## 三件事",
      "",
      "1. 固定 `libc.so.6` 与 `ld.so`，必要时用 patchelf 改 interp",
      "2. 配好调试器插件，别在容器里现装",
      "3. 关掉 ASLR 只在需要时，默认保持开启，才接近真实场景",
      "",
      "> 环境自建是合规要求的一部分：所有实验都在自己的容器里完成。"
    ].join("\n")
  };

  /* 把正文挂到种子文章上（没有单独的 body 字段时） */
  SEED.posts.forEach(function (p) {
    if (!p.body && BODIES[p.slug]) p.body = BODIES[p.slug];
  });

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var db = JSON.parse(raw);
      if (!db || db.version !== VERSION) return null;
      return db;
    } catch (e) { return null; }
  }

  function write(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { return false; }
  }

  function db() {
    var d = read();
    if (!d) { d = clone(SEED); write(d); return d; }
    /* 旧存档惰性迁移：补 friends 集合（不丢弃用户已有文章/分类，VERSION 不动） */
    if (!d.friends) { d.friends = clone(SEED.friends); write(d); }
    /* 旧存档惰性迁移：补作者简介（写作台设置面板可改） */
    if (!d.authors) { d.authors = clone(SEED.authors); write(d); }
    return d;
  }

  function uid(face) {
    return face + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function sortPosts(list) {
    return list.slice().sort(function (a, b) {
      if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
      return (b.date || "").localeCompare(a.date || "");
    });
  }

  window.UUMStore = {
    /** 已发布的文章（面页可见） */
    published: function (face) {
      return sortPosts(db().posts.filter(function (p) {
        return p.face === face && !p.draft;
      }));
    },
    /** 全部文章（写作台用，含草稿） */
    allPosts: function (face) {
      return sortPosts(db().posts.filter(function (p) { return p.face === face; }));
    },
    getPost: function (id) {
      var r = db().posts.filter(function (p) { return p.id === id; });
      return r.length ? r[0] : null;
    },
    /** 新建即发布：非草稿立刻在站点可见（PRD：不设审核环节） */
    addPost: function (data) {
      var d = db();
      var p = {
        id: uid(data.face),
        face: data.face,
        title: (data.title || "").trim(),
        slug: (data.slug || "").trim(),
        date: data.date || new Date().toISOString().slice(0, 10),
        category: data.category || "",
        tags: data.tags || [],
        words: data.words || "—",
        minutes: data.minutes || 5,
        desc: (data.desc || "").trim(),
        featured: !!data.featured,
        draft: !!data.draft,
        body: data.body || "",
        createdAt: Date.now()
      };
      d.posts.unshift(p);
      write(d);
      return p;
    },
    updatePost: function (id, patch) {
      var d = db();
      d.posts = d.posts.map(function (p) {
        return p.id === id ? Object.assign({}, p, patch) : p;
      });
      write(d);
    },
    removePost: function (id) {
      var d = db();
      d.posts = d.posts.filter(function (p) { return p.id !== id; });
      write(d);
    },

    /** 分类 */
    categories: function (face) { return db().categories[face] || []; },
    categoryCount: function (face, name) {
      return db().posts.filter(function (p) {
        return p.face === face && !p.draft && p.category === name;
      }).length;
    },
    addCategory: function (face, cat) {
      var d = db();
      if (!d.categories[face]) d.categories[face] = [];
      if (d.categories[face].some(function (c) { return c.name === cat.name; })) return false;
      d.categories[face].push(cat);
      write(d);
      return true;
    },
    updateCategory: function (face, slug, patch) {
      var d = db();
      var oldName = null;
      d.categories[face] = (d.categories[face] || []).map(function (c) {
        if (c.slug !== slug) return c;
        oldName = c.name;
        return Object.assign({}, c, patch);
      });
      /* 分类改名时同步已发布文章，避免出现孤儿分类。
         文章的 category 字段存的是分类「名」，同步必须比对旧名而非 slug（v9 修复）。 */
      if (patch.name && oldName && oldName !== patch.name) {
        d.posts.forEach(function (p) {
          if (p.face === face && p.category === oldName) p.category = patch.name;
        });
      }
      write(d);
    },
    removeCategory: function (face, slug) {
      var d = db();
      d.categories[face] = (d.categories[face] || []).filter(function (c) { return c.slug !== slug; });
      write(d);
    },

    /** 友链（站点级共享数据；入口页卡组的数据源，写作台维护） */
    friends: function () {
      var list = db().friends;
      return list ? list.slice() : [];
    },
    addFriend: function (data) {
      var d = db();
      if (!d.friends) d.friends = clone(SEED.friends);
      if (d.friends.some(function (f) { return f.name === data.name; })) return false;
      d.friends.push({
        id: "fr-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: (data.name || "").trim(),
        url: (data.url || "").trim(),
        avatar: (data.avatar || "").trim(),
        desc: (data.desc || "").trim(),
        createdAt: Date.now()
      });
      write(d);
      return true;
    },
    updateFriend: function (id, patch) {
      var d = db();
      d.friends = (d.friends || []).map(function (f) {
        return f.id === id ? Object.assign({}, f, patch) : f;
      });
      write(d);
    },
    removeFriend: function (id) {
      var d = db();
      d.friends = (d.friends || []).filter(function (f) { return f.id !== id; });
      write(d);
    },

    /** 标签池（全站共享） */
    tags: function () {
      var set = {};
      db().posts.forEach(function (p) {
        (p.tags || []).forEach(function (t) { set[t] = (set[t] || 0) + 1; });
      });
      return Object.keys(set).sort().map(function (t) { return { name: t, count: set[t] }; });
    },

    /** 作者简介：面页侧栏与作者页展示，写作台「设置」维护 */
    authorBio: function (face) {
      var a = db().authors && db().authors[face];
      return a ? (a.bio || "") : "";
    },
    setAuthorBio: function (face, bio) {
      var d = db();
      if (!d.authors) d.authors = clone(SEED.authors);
      if (!d.authors[face]) d.authors[face] = { bio: "" };
      d.authors[face].bio = String(bio || "").trim();
      write(d);
    },

    reset: function () { write(clone(SEED)); },
    seed: function () { return clone(SEED); }
  };
})();
