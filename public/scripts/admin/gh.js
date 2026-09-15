/* ==========================================================================
   UU&Mixt · 写作台后端层（后端选型 B：GitHub Contents API 直提）
   —— 纯前端调用 GitHub REST API，不引入任何服务器端常驻服务（PRD 6.1）。
   身份与权限：
     · 作者各自粘贴自己的 fine-grained PAT（Contents: Read and write，仅本仓库）
     · 身份由 GET /user 的 login 判定 → 映射到 uu / mixt
     · 所有写路径强制拼接 src/content/<face>/ 与 src/config/categories-<face>.json，
       **接口不接受任何 face 参数**（面由会话推导）——技术强制"只管自己那一面"
   凭据：PAT 只存在作者自己的浏览器 localStorage，绝不进仓库、绝不进构建产物（PRD 6.6）。
   自测：加 ?mock=1（或在控制台 UUMGH.useMock(true)）→ 内存假后端，行为与真实层同接口。
   ========================================================================== */

(function () {
  "use strict";

  var OWNER = "Karl-Heinrich-Marx-520";
  var REPO = "uu-mixt";
  var API = "https://api.github.com";
  var BRANCH = "main";
  var SESSION_KEY = "uum-desk-session";

  /* GitHub 账号 → 面（身份映射） */
  var FACE_BY_LOGIN = {
    "karl-heinrich-marx-520": "uu",
    mixt170: "mixt",
  };

  function normalizeLogin(login) {
    return String(login || "").trim().toLowerCase();
  }

  function faceOfLogin(login) {
    return FACE_BY_LOGIN[normalizeLogin(login)] || null;
  }

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
      /* 友链种子 = src/data/friends.json 的副本：正式模式直接读仓库该文件（与入口页一致），
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

  /* ---------- 请求封装 ---------- */
  async function request(path, options) {
    var session = getSession();
    if (!session || !session.token) throw new Error("未登录：请重新进入写作台");
    var res = await fetch(API + path, Object.assign({}, options, {
      headers: Object.assign(
        {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + session.token,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        (options && options.headers) || {}
      ),
    }));
    if (res.status === 401) throw new Error("凭据无效或已过期（401）：请重新粘贴 token");
    if (res.status === 403) throw new Error("权限不足（403）：请确认 token 勾选了 Contents: Read and write");
    if (res.status === 404) throw new Error("仓库或路径不存在（404）");
    if (!res.ok) throw new Error("GitHub 返回 " + res.status + "：" + (await res.text()).slice(0, 200));
    return res.status === 204 ? null : res.json();
  }

  function encodeUtf8(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }
  function decodeUtf8(b64) {
    return decodeURIComponent(escape(atob(String(b64).replace(/\n/g, ""))));
  }

  var GH = {
    OWNER: OWNER,
    REPO: REPO,
    BRANCH: BRANCH,
    FACE_BY_LOGIN: FACE_BY_LOGIN,

    faceOfLogin: faceOfLogin,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    useMock: function (on) { mock = !!on; },
    isMock: function () { return mock; },

    /** 校验 token 并返回 { login, face } —— face 为 null 表示账号未授权 */
    async verifyToken(token) {
      if (mock) {
        return { login: "Mixt170", face: "mixt" };
      }
      var res = await fetch(API + "/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (res.status === 401) throw new Error("凭据无效（401）：请检查 token 是否过期或复制完整");
      if (!res.ok) throw new Error("校验失败：GitHub 返回 " + res.status);
      var user = await res.json();
      return { login: user.login, face: faceOfLogin(user.login) };
    },

    /** 列目录：返回 [{ name, path, sha, type }] */
    async listDir(path) {
      if (mock) {
        var store = mockStore();
        var prefix = path.replace(/^\//, "") + "/";
        return Object.keys(store)
          .filter(function (k) { return k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf("/") === -1; })
          .map(function (k) { return { name: k.slice(prefix.length), path: k, sha: "mock-sha-" + k, type: "file" }; });
      }
      var data = await request("/repos/" + OWNER + "/" + REPO + "/contents/" + path + "?ref=" + BRANCH);
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
        var data = await request("/repos/" + OWNER + "/" + REPO + "/contents/" + path + "?ref=" + BRANCH);
        return { content: decodeUtf8(data.content), sha: data.sha };
      } catch (e) {
        if (/404/.test(e.message)) return null;
        throw e;
      }
    },

    /** 写文本文件（新建或更新）：sha 为空则新建 */
    async writeFile(path, text, message, sha) {
      if (mock) {
        var store = mockStore();
        store[path.replace(/^\//, "")] = text;
        mockWrite(store);
        return { ok: true };
      }
      var body = { message: message, content: encodeUtf8(text), branch: BRANCH };
      if (sha) body.sha = sha;
      return request("/repos/" + OWNER + "/" + REPO + "/contents/" + path, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },

    /** 删除文件 */
    async removeFile(path, message, sha) {
      if (mock) {
        var store = mockStore();
        delete store[path.replace(/^\//, "")];
        mockWrite(store);
        return { ok: true };
      }
      return request("/repos/" + OWNER + "/" + REPO + "/contents/" + path, {
        method: "DELETE",
        body: JSON.stringify({ message: message, sha: sha, branch: BRANCH }),
      });
    },

    /** 上传二进制（图片）：base64 直传，落 public/images/<face>/ */
    async uploadBinary(path, base64, message) {
      if (mock) {
        var store = mockStore();
        store[path.replace(/^\//, "")] = "binary:" + base64.slice(0, 24);
        mockWrite(store);
        return { ok: true };
      }
      return request("/repos/" + OWNER + "/" + REPO + "/contents/" + path, {
        method: "PUT",
        body: JSON.stringify({ message: message, content: base64, branch: BRANCH }),
      });
    },
  };

  window.UUMGH = GH;
})();
