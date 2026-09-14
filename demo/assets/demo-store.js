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
    }
  };

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
    if (!d) { d = clone(SEED); write(d); }
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
      d.categories[face] = (d.categories[face] || []).map(function (c) {
        return c.slug === slug ? Object.assign({}, c, patch) : c;
      });
      /* 分类改名时同步已发布文章，避免出现孤儿分类 */
      if (patch.name) {
        d.posts.forEach(function (p) {
          if (p.face === face && p.category === slug) p.category = patch.name;
        });
      }
      write(d);
    },
    removeCategory: function (face, slug) {
      var d = db();
      d.categories[face] = (d.categories[face] || []).filter(function (c) { return c.slug !== slug; });
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

    reset: function () { write(clone(SEED)); },
    seed: function () { return clone(SEED); }
  };
})();
