/* ==========================================================================
   UU&Mixt · 写作台传输层（后端选型 D：服务器写入 API · docs/09 T5-2 · 决策 7.19）
   —— 写、读、登录验证全部走本站同源 /api/（服务器 git 主库工作副本），与 GitHub
      彻底解耦；GitHub 降级为服务器 cron 每日一次的异步备份。
   全局名沿用 UUMGH：desk.js 与登录页零改动，仅换本适配器（决策 7.12 接口语义
   抽象的回报点）。硬性检查：改造后全流程零 api.github.com 请求。
   身份与权限：
     · token 由 master 线下私下发放（服务端只存 SHA-256 hash，吊销即时生效）
     · face 由 token 推导，接口不接受 face 参数——越面写入做不到
   凭据：token 只存在作者浏览器 localStorage（键 uum-desk-session-v2），
   旧 gh.js 时代的 GitHub PAT 会话键不同，切换后自动失效、需重新登录。
   失败分类（docs/09）：网络失败 / 凭据无效 / 越权 / 乐观锁冲突，各给中文指引。
   自测：加 ?mock=1（或控制台 UUMGH.useMock(true)）→ 内存假后端，行为与真实层同接口。
   ========================================================================== */

(function () {
  "use strict";

  var API_BASE = ""; /* 同源：Nginx 把 /api/ 反代到本机小服务，无跨域 */
  var SESSION_KEY = "uum-desk-session-v2"; /* v2：gh.js 时代 GitHub PAT 会话自动失效 */

  /* ---------- 会话（token 只在本地浏览器） ---------- */
  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function setSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* ---------- 假后端（仅供自测：接口与真实层一致） ---------- */
  /* mock 开关：URL 参数 ?mock=1 显式开启，并把标记写入 sessionStorage——
     登录页跳转 /admin/desk/ 不携带查询串，靠会话标记让 mock 模式跨页存活
     （盲测轮 1 P1：mock 只认 URL 导致登录后四个面板全 401）。
     sessionStorage 关标签即清，不会在真实使用中长期驻留。 */
  var MOCK_FLAG = "uum-desk-mock";
  var mock = /[?&]mock=1/.test(location.search);
  try {
    if (mock) {
      sessionStorage.setItem(MOCK_FLAG, "1");
    } else if (sessionStorage.getItem(MOCK_FLAG) === "1") {
      mock = true;
    }
  } catch (eMockFlag) { /* storage 不可用时退回仅 URL 参数判定 */ }
  /* 真实模式显式清标记：防止先 mock 后真实登录的同一会话误入假后端 */
  if (!mock) { try { sessionStorage.removeItem(MOCK_FLAG); } catch (eMockClr) {} }
  /* v2：种子加入 src/data/friends.json 后升版，旧 mock store（无友链键）自然失效 */
  var MOCK_KEY = "uum-desk-mock-store-v2";
  function mockStore() {
    try {
      var raw = localStorage.getItem(MOCK_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var seed = {
      /* 友链种子 = src/data/friends.json 的副本：正式模式直接读服务器仓库该文件（与入口页一致），
         mock 仅自测用；⚠️ 两处需同步维护，正式数据以 src/data/friends.json 为准。 */
      "src/data/friends.json": JSON.stringify(
        [
          { name: "云端牧码", url: "https://example.com/yunmuma", avatar: "", desc: "写云计算与分布式系统的实验记录，偏好可复现的部署清单。" },
          { name: "栈外", url: "https://example.com/zhanwai", avatar: "", desc: "聊编程语言之外的事：编译器、运行时与一点哲学。" },
          { name: "像素底片", url: "https://example.com/pixelphoto", avatar: "", desc: "复古游戏美术与独立开发日志，偶尔更新像素画教程。" },
          { name: "夜航西飞", url: "https://example.com/nightfly", avatar: "", desc: "网络工程方向，BGP 与数据中心网络的踩坑合集。" },
          { name: "炉边谈话", url: "https://example.com/hearth", avatar: "", desc: "安全研究员的随笔：漏洞之外，还有生活。" },
          { name: "零点客栈", url: "https://example.com/inn0", avatar: "", desc: "后端与数据库，PostgreSQL 深度爱好者。" },
          { name: "拾荒者手记", url: "https://example.com/scavenger", avatar: "", desc: "在开源项目里捡宝贝：源码阅读与提交考古。" },
          { name: "南方小院", url: "https://example.com/southyard", avatar: "", desc: "自建服务器的折腾史：NAS、家庭实验室与电费账单。" },
          { name: "白板与咖啡", url: "https://example.com/whiteboard", avatar: "", desc: "算法竞赛退役选手的复出训练场。" },
          { name: "回声谷", url: "https://example.com/echovalley", avatar: "", desc: "音频编程与信号处理，用代码做声音的实验。" },
          { name: "折纸引擎", url: "https://example.com/origami", avatar: "", desc: "图形学与渲染管线，WebGPU 尝鲜系列。" },
          { name: "慢速快门", url: "https://example.com/slowshutter", avatar: "", desc: "摄影 + 前端，把照片做成会动的网页。" },
          { name: "候鸟电台", url: "https://example.com/migratory", avatar: "", desc: "weekly 技术播客的文字稿与延伸阅读。" },
          { name: "齿轮与诗", url: "https://example.com/gearpoem", avatar: "", desc: "机械键盘、固件改造与一点工业设计审美。" },
          { name: "面包屑导航", url: "https://example.com/breadcrumb", avatar: "", desc: "产品与工程的交叉地带，写原型背后的思考。" },
          { name: "北极星组件", url: "https://example.com/polaris", avatar: "", desc: "前端架构与设计系统，组件库的长期主义。" },
        ],
        null,
        2
      ) + "\n",
      "src/config/categories-mixt.json": JSON.stringify(
        [
          { slug: "heap", name: "堆利用", desc: "堆与分配器的机制拆解。" },
          { slug: "ctf", name: "CTF", desc: "CTF pwn 题的思路复盘。" },
        ],
        null,
        2
      ) + "\n",
      "src/content/mixt/tcache-layout.md": [
        "---",
        'title: "tcache 结构体布局"',
        "slug: tcache-layout",
        'description: "从 chunk 头与 tcache_entry 的字段布局讲起，梳理 safe-linking、key 校验与常见触发条件下的行为差异，全部实验在自建环境完成。"',
        "date: 2026-08-20",
        "author: mixt",
        "category: 堆利用",
        "tags: [pwn, glibc]",
        "featured: false",
        "draft: false",
        "---",
        "",
        "## 结构",
        "",
        "正文……",
      ].join("\n"),
    };
    localStorage.setItem(MOCK_KEY, JSON.stringify(seed));
    return seed;
  }
  function mockWrite(store) {
    localStorage.setItem(MOCK_KEY, JSON.stringify(store));
  }

  /* ---------- mock：AI 摘要助手 + 标签池（语义与 Go 服务端一一对应） ---------- */
  var TAG_POOL_FILE = "src/config/tag-pool.json";

  function mockScanTags(store) {
    var out = {};
    Object.keys(store).forEach(function (k) {
      if (/^src\/content\/.+\.md$/.test(k)) {
        var m = /^tags:[ \t]*\[([^\]]*)\][ \t]*$/m.exec(store[k]);
        if (m) {
          out[k] = m[1].split(",").map(function (t) {
            return t.trim().replace(/^["']|["']$/g, "");
          }).filter(Boolean);
        }
      }
    });
    return out;
  }
  function mockReadPool(store) {
    if (!store[TAG_POOL_FILE]) return [];
    try {
      var p = JSON.parse(store[TAG_POOL_FILE]);
      return Array.isArray(p) ? p : [];
    } catch (e) {
      return [];
    }
  }
  function mockWritePool(store, pool) {
    store[TAG_POOL_FILE] = JSON.stringify(pool, null, 2) + "\n";
  }

  /* mockAssist：demo genDesc/genTags 的移植，仅自测用（真实模式由服务端转发上游） */
  function mockAssist(title, body) {
    var desc = "";
    var lines = String(body || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      if (/^(#|>|!|\||```|---|tags:)/.test(t)) continue;
      t = t.replace(/^[*`]+|[*`]+$/g, "").trim();
      if (!t) continue;
      desc = t;
      break;
    }
    if (!desc) desc = "关于「" + title + "」的内容摘要（mock 自测生成）。";
    if (desc.length > 72) desc = desc.slice(0, 72) + "……";
    var dict = [
      ["c++", "cpp"], ["asio", "asio"], ["beast", "beast"], ["epoll", "epoll"],
      ["tcp", "tcp"], ["http", "http"], ["协程", "协程"], ["coroutine", "coroutine"],
      ["muduo", "muduo"], ["qt", "qt"], ["ns-3", "ns-3"], ["hpcc", "hpcc"],
      ["拥塞", "拥塞控制"], ["pwn", "pwn"], ["glibc", "glibc"], ["堆", "堆利用"],
      ["ctf", "ctf"], ["docker", "docker"], ["内核", "内核"], ["mercury", "mercury"],
    ];
    var low = String(body || "") + " " + title;
    low = low.toLowerCase();
    var tags = [];
    for (var j = 0; j < dict.length && tags.length < 5; j++) {
      if (low.indexOf(dict[j][0]) !== -1) tags.push(dict[j][1]);
    }
    if (!tags.length) tags = ["笔记"];
    return { description: desc, tags: tags, via: "mock" };
  }

  /* mockTagChange：computeTagChange 的 JS 移植（add / rename 级联 / remove 级联） */
  function mockTagChange(op) {
    var store = mockStore();
    var pool = mockReadPool(store);
    var postTags = mockScanTags(store);
    var changed = {};
    var res = { posts: 0, merged: false, exists: false, pool: pool.slice(), commit: "mock" };

    if (op.add) {
      if (pool.indexOf(op.add) !== -1) {
        res.exists = true;
      } else {
        res.pool.push(op.add);
        mockWritePool(store, res.pool);
        mockWrite(store);
      }
      return res;
    }

    if (op.from) {
      var to = op.to;
      var toExists = pool.indexOf(to) !== -1;
      Object.keys(postTags).forEach(function (k) {
        if (!toExists && postTags[k].indexOf(to) !== -1) toExists = true;
      });
      Object.keys(postTags).forEach(function (k) {
        var tags = postTags[k];
        if (tags.indexOf(op.from) === -1) return;
        var next = [];
        tags.forEach(function (t) {
          if (t === op.from) {
            if (tags.indexOf(to) !== -1) return; /* 同篇双标签：旧名并入新名，只移除旧名 */
            next.push(to);
            return;
          }
          next.push(t);
        });
        changed[k] = next;
      });
      res.posts = Object.keys(changed).length;
      res.merged = toExists;
      res.pool = pool.filter(function (t) { return t !== op.from; });
      if (!toExists && res.posts === 0 && res.pool.indexOf(to) === -1) res.pool.push(to); /* 纯池改名 */
    }

    if (op.remove) {
      res.pool = pool.filter(function (t) { return t !== op.remove; });
      Object.keys(postTags).forEach(function (k) {
        var tags = postTags[k];
        if (tags.indexOf(op.remove) === -1) return;
        changed[k] = tags.filter(function (t) { return t !== op.remove; });
      });
      res.posts = Object.keys(changed).length;
    }

    Object.keys(changed).forEach(function (k) {
      store[k] = store[k].replace(
        /^tags:[ \t]*\[[^\]]*\][ \t]*$/m,
        "tags: [" + changed[k].join(", ") + "]"
      );
    });
    if (JSON.stringify(pool) !== JSON.stringify(res.pool)) mockWritePool(store, res.pool);
    mockWrite(store);
    return res;
  }

  function mockGetTags() {
    var store = mockStore();
    var counts = {};
    var postTags = mockScanTags(store);
    Object.keys(postTags).forEach(function (k) {
      postTags[k].forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var names = Object.keys(counts);
    mockReadPool(store).forEach(function (t) {
      if (!(t in counts)) names.push(t);
    });
    var tags = names.map(function (n) { return { name: n, count: counts[n] || 0 }; });
    tags.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return { tags: tags, pool: mockReadPool(store) };
  }

  /* ---------- 错误分类（docs/09：网络失败 / 凭据无效 / 越权，各给中文指引） ---------- */
  function networkError() {
    return new Error(
      "网络请求失败：无法连接本站服务（Failed to fetch）。请检查网络后重试；持续失败请联系 master。"
    );
  }
  async function toError(res) {
    var detail = "";
    try {
      var text = await res.text();
      try {
        var j = JSON.parse(text);
        if (j && j.error) detail = j.error;
      } catch (e) {}
      if (!detail) detail = text.slice(0, 200);
    } catch (e) {}
    if (res.status === 401) return new Error(detail || "凭据无效（401）：token 不正确或已被吊销，请找 master 核对。");
    if (res.status === 403) return new Error(detail || "权限不足（403）：不能操作这个路径。");
    if (res.status === 404) return new Error(detail || "文件不存在（404）。");
    if (res.status === 409) return new Error(detail || "内容已被另一端修改（409）：请刷新页面后重试。");
    if (res.status === 413) return new Error(detail || "文件超过大小限制（413）：Markdown ≤ 200KB，图片 ≤ 2MB。");
    if (res.status === 429) return new Error(detail || "操作过于频繁（429）：请稍后再试。");
    return new Error(detail || "服务器返回 " + res.status);
  }

  /* ---------- 请求封装（同源 + Bearer token） ---------- */
  async function request(path, options) {
    var session = getSession();
    if (!session || !session.token) throw new Error("未登录：请重新进入写作台");
    var res;
    try {
      res = await fetch(API_BASE + path, Object.assign({}, options, {
        headers: Object.assign(
          { Authorization: "Bearer " + session.token },
          (options && options.headers) || {}
        ),
      }));
    } catch (e) {
      throw networkError();
    }
    if (!res.ok) {
      var err = await toError(res);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function base64ToBytes(b64) {
    var bin = atob(String(b64));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  var UUM = {
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    useMock: function (on) { mock = !!on; },
    isMock: function () { return mock; },

    /** 校验 token 并返回 { login, face } —— 服务器端验证（替代 GET api.github.com/user） */
    async verifyToken(token) {
      if (mock) {
        /* mock 档任意 token 可进；token 含 "uu" 进 UU 面，否则 Mixt 面（盲测两面对称用） */
        return /uu/i.test(token) ? { login: "UU", face: "uu" } : { login: "Mixt170", face: "mixt" };
      }
      var res;
      try {
        res = await fetch(API_BASE + "/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token }),
        });
      } catch (e) {
        throw networkError();
      }
      if (!res.ok) throw await toError(res);
      return res.json();
    },

    /** 写作台首屏数据包（决策 7.41）：一次请求拿齐文章 + 分类 + 简介 + 友链 + 标签池，
        替代此前 1 次 list + N 次 read 的串行往返（作者侧实测 18 次往返 ≈ 9-10s）。
        形状：{ posts:[{path,sha,content}], categories|author|friends: {path,sha,content}|null,
               tags:{tags:[{name,count}], pool:[...]} }
        mock 与失败一律返回 null，调用方回落到逐文件接口（新端点未部署时也不会空面板）。 */
    async deskBundle() {
      if (mock) return null;
      try {
        return await request("/api/desk");
      } catch (e) {
        return null;
      }
    },

    /** 列目录：返回 [{ name, path, sha, type }]（服务器 git 工作副本的最新状态） */
    async listDir(path) {
      if (mock) {
        var store = mockStore();
        var prefix = path.replace(/^\//, "") + "/";
        return Object.keys(store)
          .filter(function (k) { return k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf("/") === -1; })
          .map(function (k) { return { name: k.slice(prefix.length), path: k, sha: "mock-sha-" + k, type: "file" }; });
      }
      var data = await request("/api/list?path=" + encodeURIComponent(path));
      return Array.isArray(data) ? data : [data];
    },

    /** 读文本文件：{ content, sha }；不存在返回 null */
    async readFile(path) {
      if (mock) {
        var store = mockStore();
        var key = path.replace(/^\//, "");
        if (!(key in store)) return null;
        return { content: store[key], sha: "mock-sha-" + key };
      }
      try {
        return await request("/api/read?path=" + encodeURIComponent(path));
      } catch (e) {
        if (e.status === 404 || /404/.test(e.message)) return null;
        throw e;
      }
    },

    /** 写文本文件（新建或更新）：sha 为空则新建；
        返回保持 GitHub Contents API 形状 { content: { sha } }——desk.js 的
        writeCategories/writeFriends 读取 r.content.sha 刷新乐观锁。 */
    async writeFile(path, text, message, sha) {
      if (mock) {
        var store = mockStore();
        store[path.replace(/^\//, "")] = text;
        mockWrite(store);
        return { ok: true, content: { sha: "mock-sha-" + path } };
      }
      var r = await request("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path, content: text, message: message, sha: sha || "" }),
      });
      return { content: { sha: r.sha } };
    },

    /** 删除文件（query 里的参数都过 encodeURIComponent） */
    async removeFile(path, message, sha) {
      if (mock) {
        var store = mockStore();
        delete store[path.replace(/^\//, "")];
        mockWrite(store);
        return { ok: true };
      }
      var q = "path=" + encodeURIComponent(path) + "&message=" + encodeURIComponent(message || "");
      if (sha) q += "&sha=" + encodeURIComponent(sha);
      return request("/api/file?" + q, { method: "DELETE" });
    },

    /** 删除分类（决策 7.26）：服务端级联——配置条目移除 + 该分类文章 category
        改「未分类」+ 兜底自动种子，单次提交。返回 {cascaded, fallback, commit}。
        mock：内存里做同样的级联，语义与真实端点一致。 */
    async categoryRemove(name) {
      if (mock) {
        var store = mockStore();
        var key = "src/config/categories-" + FACE + ".json";
        var cats = JSON.parse(store[key] || "[]");
        var victim = null;
        cats = cats.filter(function (c) {
          if (c.name === name) { victim = c; return false; }
          return true;
        });
        if (!victim) return { cascaded: 0, fallback: "未分类", commit: "mock" };
        var hasFallback = cats.some(function (c) { return c.name === "未分类"; });
        if (!hasFallback) cats.push({ slug: "uncategorized", name: "未分类", desc: "未归入其他分类的文章。" });
        store[key] = JSON.stringify(cats, null, 2) + "\n";
        var cascaded = 0;
        Object.keys(store).forEach(function (k) {
          if (k.indexOf("src/content/" + FACE + "/") !== 0 || k.slice(-3) !== ".md") return;
          var re = new RegExp("^category:[ \\t]*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \\t]*$", "m");
          if (re.test(store[k])) {
            store[k] = store[k].replace(re, "category: 未分类");
            cascaded++;
          }
        });
        mockWrite(store);
        return { cascaded: cascaded, fallback: "未分类", commit: "mock" };
      }
      return request("/api/categories/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name }),
      });
    },

    /** 上传二进制（图片）：multipart 直传，落 public/images/<face>/；
        不带 sha（媒体面板不跟踪图片 sha，服务器允许同名覆盖）。 */
    async uploadBinary(path, base64, message) {
      if (mock) {
        var store = mockStore();
        store[path.replace(/^\//, "")] = "binary:" + base64.slice(0, 24);
        mockWrite(store);
        return { ok: true };
      }
      var fd = new FormData();
      fd.append("path", path);
      fd.append("message", message || "");
      fd.append("file", new Blob([base64ToBytes(base64)]), path.split("/").pop());
      return request("/api/write", { method: "POST", body: fd });
    },

    /** AI 生成摘要与标签（POST /api/assist，决策 7.20）：
        服务端持上游 Key 转发，Key 不进前端；返回 {description, tags}。 */
    async assist(title, body) {
      if (mock) return mockAssist(title, body);
      return request("/api/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title, body: body }),
      });
    },

    /** 标签池（站点级共享，决策 7.23）：GET /api/tags → {tags:[{name,count}], pool:[…]} */
    async getTags() {
      if (mock) return mockGetTags();
      return request("/api/tags");
    },

    /** 池新增：返回 {posts, merged, exists, pool, commit}（重复幂等 exists=true） */
    async addTag(tag) {
      if (mock) return mockTagChange({ add: tag });
      return request("/api/tags/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: tag }),
      });
    },

    /** 改名级联全站文章（单次提交，服务端记发起者审计） */
    async renameTag(from, to) {
      if (mock) return mockTagChange({ from: from, to: to });
      return request("/api/tags/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: from, to: to }),
      });
    },

    /** 删除级联全站文章 + 池（标签不存在时幂等 posts=0） */
    async removeTag(tag) {
      if (mock) return mockTagChange({ remove: tag });
      return request("/api/tags/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: tag }),
      });
    },

    /** 手动触发服务器端重新构建（POST /api/rebuild，决策 7.24）：
        异步启动（flock 单实例 + running 防重复），立即返回 {status,message}。 */
    async rebuildStart() {
      if (mock) return mockRebuildStart();
      return request("/api/rebuild", { method: "POST" });
    },

    /** 构建状态：{running, exitCode(-1=没跑过), elapsedSec, tail=日志尾部} */
    async rebuildStatus() {
      if (mock) return mockRebuildStatus();
      return request("/api/rebuild");
    },
  };

  /* 全局名沿用 UUMGH：desk.js 与登录页一行不改（仅换本适配器文件） */
  window.UUMGH = UUM;
})();
