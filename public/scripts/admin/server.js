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
  var mock = /[?&]mock=1/.test(location.search);
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
        return { login: "Mixt170", face: "mixt" };
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
  };

  /* 全局名沿用 UUMGH：desk.js 与登录页一行不改（仅换本适配器文件） */
  window.UUMGH = UUM;
})();
