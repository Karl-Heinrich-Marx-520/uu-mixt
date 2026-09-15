/* ==========================================================================
   UU&Mixt · pet.js —— 桌宠「小鹿」（PRD E1，规则引擎版；自 demo/assets/pet.js v7 接线）
   交互规格（UU 2026-09-14 规格 · 2026-09-15 增补拖动 · demo 验收基准，勿改）：
     · 像素鹿常驻左下角，可按住拖到屏幕任意位置（位置记忆，刷新不丢）；
     · 点击（位移 < 6px 视为点击）打开对话栏；对话栏手动拖放优先，否则四向跟随小鹿
       （上 → 右 → 左 → 下）；拖小鹿 = 回到跟随，拖对话栏 = 固定并记忆；
     · 回答严格限制在博客范围内：规则式检索本站内容，检索不到即明示
       「超出博客范围」并给建议问法——E1 后续换 LLM 转发端点（docs/06）时
       只改 respond()，范围约束与拒答话术全部保留。
   与 demo 的差异（接线层，交互零改动）：
     · 数据源：demo 用 UUMStore(localStorage)；正式站用构建期生成的全站文章索引
       /search-index.json（决策 7.13 产物复用），异步预热后按 published(face) 语义供给；
     · 站内链接：面入口 /uu/、/mixt/；文章链接用索引里的 url（构建期真实路由）；
     · 图片路径：/images/pet.png。
   ========================================================================== */
(function () {
  "use strict";

  if (window.__uumPet) return;                     /* 防重复注入 */
  window.__uumPet = true;

  var doc = document;

  /* ---------- 内容层适配（demo 接线点：UUMStore → 构建期索引） ----------
     语义对齐 demo：published(face) → [{ slug, title, detail }]（时间倒序）。
     索引含每篇正文摘录，体积不小且桌宠不在关键路径 —— 页面空闲后预热，
     未就绪时文章类问题走规则兜底，不阻塞寒暄。 */
  var store = (function () {
    var cache = null;
    var warming = false;
    function warm() {
      if (cache || warming) return;
      warming = true;
      try {
        fetch("/search-index.json")
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { if (d && d.posts) cache = d.posts; })
          .catch(function () { warming = false; });
      } catch (e) { warming = false; }
    }
    if (document.readyState === "complete") warm();
    else window.addEventListener("load", warm);    /* 首屏之后才拉，不抢关键路径带宽 */
    return {
      published: function (face) {
        warm();                                    /* 兜底：load 事件被跳过时再试 */
        if (!cache) return [];
        return cache.filter(function (p) { return p.face === face; }).map(function (p) {
          return { slug: p.slug, title: p.title, detail: p.url };
        });
      },
    };
  })();

  var PET_W = 64;
  var PET_H = 83;                                  /* 形象 256x330（h/w≈1.29），64 宽等比高约 83 */
  var DRAG_THRESHOLD = 6;                          /* 位移超过 6px 判定为拖动而非点击 */
  var POS_KEY = "uum-pet-pos";

  /* ---------- 常驻形象 ---------- */
  var pet = doc.createElement("button");
  pet.className = "pet";
  pet.type = "button";
  pet.id = "pet";
  pet.setAttribute("aria-label", "桌宠小鹿：点击打开对话，按住可拖动");
  pet.title = "小鹿 · 点我聊天，按住拖动";
  pet.innerHTML =
    '<img src="/images/pet.png" alt="" width="64" height="83">' +
    '<span class="pet-hint" aria-hidden="true">点我聊天</span>';
  /* 挂到 <html> 而不是 body：面页 body 有 perspective（翻转用），
     会使 body 成为 fixed 后代的包含块 → 桌宠被钉到整页底部而非视口底部 */
  doc.documentElement.appendChild(pet);

  /* ---------- 对话栏 ---------- */
  var drawer = doc.createElement("div");
  drawer.className = "pet-drawer";
  drawer.hidden = true;
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-label", "与小鹿对话");
  drawer.innerHTML =
    '<div class="pet-drawer-head">' +
      '<img src="/images/pet.png" alt="" width="34" height="44">' +
      '<div class="pet-drawer-who"><b>小鹿</b><span>博客向导 · 只聊这个站里的事</span></div>' +
      '<button class="pet-close" type="button" aria-label="收起对话">✕</button>' +
    "</div>" +
    '<div class="pet-log" data-pet-log aria-live="polite"></div>' +
    '<div class="pet-chips" data-pet-chips>' +
      '<button type="button" data-q="最近更新了什么文章？">最近更新</button>' +
      '<button type="button" data-q="UU 是谁？">UU 是谁</button>' +
      '<button type="button" data-q="Mixt 写什么？">Mixt 写什么</button>' +
    "</div>" +
    '<form class="pet-input" data-pet-form>' +
      '<input type="text" placeholder="问我这个博客里的事…" aria-label="向小鹿提问">' +
      '<button type="submit">发送</button>' +
    "</form>" +
    '<p class="pet-scope">我只聊这个博客里的事（文章、分类、作者、建站状态），别的领域我不懂哦。</p>';
  doc.documentElement.appendChild(drawer);

  var log = drawer.querySelector("[data-pet-log]");
  var form = drawer.querySelector("[data-pet-form]");
  var input = form.querySelector("input");
  var opened = false;

  /* ---------- 位置：恢复 / 钳制 / 持久化 ---------- */
  function clampX(x) {
    return Math.max(4, Math.min(x, window.innerWidth - PET_W - 4));
  }
  function clampY(y) {
    return Math.max(4, Math.min(y, window.innerHeight - PET_H - 4));
  }
  function setPetPos(x, y, save) {
    var cx = Math.round(clampX(x));
    var cy = Math.round(clampY(y));
    pet.style.left = cx + "px";
    pet.style.top = cy + "px";
    pet.style.bottom = "auto";
    /* 靠右半屏时提示气泡翻到左侧，避免弹出视口 */
    pet.querySelector(".pet-hint").classList.toggle("pet-hint--left", cx > window.innerWidth / 2 - PET_W);
    if (save) {
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: x, y: y })); } catch (e) {}
    }
  }
  /* 启动：恢复上次位置；没有则保持 CSS 默认（left:16 bottom:14，不动 style） */
  (function restorePos() {
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (typeof p.x === "number" && typeof p.y === "number") setPetPos(p.x, p.y, false);
    } catch (e) {}
  })();

  window.addEventListener("resize", function () {
    var r = pet.getBoundingClientRect();
    if (r.left > window.innerWidth - PET_W - 4 || r.top > window.innerHeight - PET_H - 4) {
      setPetPos(r.left, r.top, true);              /* setPetPos 内部会 clamp */
    }
    if (opened) placeDrawer();
  });

  /* ---------- 对话栏定位：手动拖放优先，否则四向跟随小鹿 ----------
     跟随顺序：上方 → 右侧 → 左侧 → 下方（小鹿在顶部时贴身走侧向，
     不再死板地只能待在下方）；所有落点经 setDrawerPos 统一 clamp。 */
  var DRAWER_POS_KEY = "uum-pet-drawer-pos";       /* 对话栏手动定位存档；存在即视为已固定 */
  var drawerPinned = false;                        /* true = 用户拖过对话栏，恢复存档位置 */
  (function restoreDrawerPin() {
    try { drawerPinned = !!localStorage.getItem(DRAWER_POS_KEY); } catch (e) {}
  })();

  function setDrawerPos(x, y, save) {
    var dw = drawer.offsetWidth || 344;
    var dh = drawer.offsetHeight || 300;
    var cx = Math.max(8, Math.min(Math.round(x), window.innerWidth - dw - 8));
    var cy = Math.max(8, Math.min(Math.round(y), window.innerHeight - dh - 8));
    drawer.style.left = cx + "px";
    drawer.style.top = cy + "px";
    drawer.style.right = "auto";
    drawer.style.bottom = "auto";
    if (save) {
      try { localStorage.setItem(DRAWER_POS_KEY, JSON.stringify({ x: x, y: y })); } catch (e) {}
    }
  }

  function placeDrawer() {
    if (drawerPinned) {                            /* 固定模式：按存档摆放（内部按当前视口 clamp） */
      try {
        var saved = JSON.parse(localStorage.getItem(DRAWER_POS_KEY) || "null");
        if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
          setDrawerPos(saved.x, saved.y, false);
          return;
        }
      } catch (e) {}
      drawerPinned = false;                        /* 存档无效 → 退回跟随 */
    }
    var dw = drawer.offsetWidth || 344;
    var dh = drawer.offsetHeight || 300;
    var w = window.innerWidth, h = window.innerHeight;
    var pr = pet.getBoundingClientRect();
    var cx = Math.round(pr.left + PET_W / 2 - dw / 2);
    var cy = Math.round(pr.top + (PET_H - dh) / 2);
    var x, y;
    if (pr.top - dh - 12 >= 8) {                   /* ① 首选：小鹿正上方留 12px */
      x = cx; y = pr.top - dh - 12;
    } else if (pr.left + PET_W + 12 + dw <= w - 8) {/* ② 右侧贴身 */
      x = pr.left + PET_W + 12; y = cy;
    } else if (pr.left - 12 - dw >= 8) {            /* ③ 左侧贴身 */
      x = pr.left - 12 - dw; y = cy;
    } else {                                        /* ④ 下方（最后手段） */
      x = cx; y = pr.top + PET_H + 12;
    }
    setDrawerPos(x, y, false);
  }

  /* ---------- 拖动（pointer 事件，阈值区分点击） ---------- */
  var dragging = false;          /* 已进入拖动态 */
  var pressActive = false;       /* 按下未抬起 */
  var justDragged = false;       /* 本次 pointer 序列发生过拖动（用于抑制随后的 click） */
  var startX = 0, startY = 0, origX = 0, origY = 0;

  pet.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (strolling) stopStroll();                   /* 按住散步中的小鹿：就地停步，避免拖动基准漂移 */
    pressActive = true;
    dragging = false;
    var r = pet.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origX = r.left;
    origY = r.top;
    try { pet.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();          /* 阻止触屏长按选择/滚动，见 CSS touch-action:none 兜底 */
  });

  pet.addEventListener("pointermove", function (e) {
    if (!pressActive) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    if (!dragging && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
      dragging = true;
      pet.classList.add("is-dragging");
      /* 拖小鹿 = 回到跟随模式：清除对话栏固定存档 */
      drawerPinned = false;
      try { localStorage.removeItem(DRAWER_POS_KEY); } catch (e) {}
    }
    if (dragging) {
      setPetPos(origX + dx, origY + dy, false);
      if (opened) placeDrawer();                   /* 全向实时跟随（上→右→左→下） */
    }
  });

  function endPress() {
    if (!pressActive) return;
    pressActive = false;
    if (dragging) {
      dragging = false;
      justDragged = true;
      pet.classList.remove("is-dragging");
      var r = pet.getBoundingClientRect();
      setPetPos(r.left, r.top, true);              /* 落点 clamp + 持久化 */
      playAction("is-land");                       /* 放下：落地回弹 */
      if (opened) placeDrawer();
      /* setTimeout 归零：让随后的合成 click 先被抑制 */
      setTimeout(function () { justDragged = false; }, 0);
    }
  }
  pet.addEventListener("pointerup", endPress);
  pet.addEventListener("pointercancel", endPress);

  /* ---------- 对话栏拖动：按住标题栏移动，落点记忆 ---------- */
  var head = drawer.querySelector(".pet-drawer-head");
  var dActive = false, dStartX = 0, dStartY = 0, dOrigX = 0, dOrigY = 0;
  head.title = "按住可拖动对话栏";

  head.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".pet-close")) return;    /* 关闭按钮照常点击，不触发拖动 */
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dActive = true;
    drawerPinned = true;                           /* 手动拖过 → 固定于落点（存档在抬手时写入） */
    var r = drawer.getBoundingClientRect();
    dStartX = e.clientX;
    dStartY = e.clientY;
    dOrigX = r.left;
    dOrigY = r.top;
    drawer.classList.add("is-drawer-drag");
    try { head.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  head.addEventListener("pointermove", function (e) {
    if (!dActive) return;
    setDrawerPos(dOrigX + (e.clientX - dStartX), dOrigY + (e.clientY - dStartY), false);
  });
  function endDrawerDrag() {
    if (!dActive) return;
    dActive = false;
    drawer.classList.remove("is-drawer-drag");
    var r = drawer.getBoundingClientRect();
    setDrawerPos(r.left, r.top, true);             /* 落点 clamp + 持久化 */
  }
  head.addEventListener("pointerup", endDrawerDrag);
  head.addEventListener("pointercancel", endDrawerDrag);

  /* ---------- 回答引擎：范围 = 本站内容（E1 LLM 版的范围约束与此一致） ---------- */
  function links(posts) {
    return posts.slice(0, 3).map(function (p) {
      var face = p.face || "uu";
      /* 正式链接在构建期索引的 url 字段里；此分支只是数据缺 detail 时的兜底 */
      var href = p.detail || ("/" + face + "/posts/" + encodeURIComponent(p.slug) + "/");
      return '<a href="' + href + '">' + p.title + "</a>";
    });
  }

  function answer(q) {
    var s = q.toLowerCase();

    /* 站内文章检索（依赖内容层；索引未就绪时跳过，走规则兜底） */
    if (store && /最新|更新|文章|写了|看看|推荐/.test(q)) {
      var all = [];
      ["uu", "mixt"].forEach(function (f) {
        try {
          store.published(f).slice(0, 5).forEach(function (p) {
            all.push({ face: f, slug: p.slug, title: p.title, detail: p.detail });
          });
        } catch (e) {}
      });
      all.sort(function (a, b) { return (b.slug || "").localeCompare(a.slug || ""); });
      if (all.length) {
        return "最近的两面更新在这里（点标题直达）：\n" + links(all).join("<br>") +
          '<br><span class="pet-note">完整列表看两面的「归档」或「分类」页。</span>';
      }
    }
    if (/uu/.test(s) && !/mixt/.test(s)) {
      return "UU 是这一面的作者：C++ 后端与网络编程方向，写异步服务器、源码阅读和科研复现。去 <a href=\"/uu/\">UU 的一面</a> 看全部文章。";
    }
    if (/mixt/.test(s)) {
      return "Mixt 是另一面的作者：PWN 与二进制安全方向，写漏洞分析与 CTF 复盘（文首都带合规声明）。去 <a href=\"/mixt/\">Mixt 的一面</a> 看全部文章。";
    }
    if (/友链|朋友|交换|链接/.test(q)) {
      return "友链卡片在入口页，点牌堆它们会连成一排带倾斜的卡链，悬停可看介绍。";
    }
    if (/备案|服务器|域名|上线|部署/.test(q)) {
      return "域名 uuandmixt.com 已注册，ICP 备案审核中（通过前用 IP:8080 预览）。上线后这里会有正式备案号。";
    }
    if (/你是谁|你是什么|能做|会什么/.test(q)) {
      return "我是小鹿，这个博客的向导。我知道两面所有文章、两位作者和建站状态——超出博客范围的问题我会直接说不懂。";
    }
    if (/你好|您好|hi|hello|在吗|嗨/.test(s)) {
      return "你好呀！可以问我「最近更新了什么」，或者聊聊 UU 和 Mixt 都在写什么。";
    }
    if (/分类|归档|标签/.test(q)) {
      return "两面的分类各自独立（Mixt 面由本人维护），「归档」按年份倒序。右上角翻面按钮可以在两面之间切换。";
    }
    /* 范围兜底：明确拒答 */
    return "这个问题超出我的博客范围啦。你可以问我：最近更新的文章、UU / Mixt 在写什么、分类与归档怎么用、建站进展。";
  }

  /* ---------- 气泡：向对话记录追加消息（who = "pet" | "me"） ----------
     html=true 仅用于站内固定文案（含 <a>/<br>）；用户输入一律纯文本防注入。 */
  function bubble(text, who, html) {
    var m = doc.createElement("div");
    m.className = "pet-msg pet-msg--" + (who === "me" ? "me" : "pet");
    if (html) m.innerHTML = text;
    else m.textContent = text;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }
  function typing() {
    var t = doc.createElement("div");
    t.className = "pet-msg pet-msg--pet pet-typing";
    t.textContent = "···";
    log.appendChild(t);
    log.scrollTop = log.scrollHeight;
    return t;
  }

  function respond(q) {
    playAction("is-nod");                          /* 回答时点头 */
    var t = typing();
    setTimeout(function () {
      t.remove();
      bubble(answer(q), "pet", true);
    }, 420 + Math.random() * 380);
  }

  function greet() {
    if (log.children.length) return;
    bubble("嗨，我是小鹿 🦌 这个博客有什么想了解的，尽管问；博客之外的我可不会哦。", "pet", false);
  }

  function setOpen(on) {
    opened = on;
    drawer.hidden = !on;
    pet.classList.toggle("is-active", on);
    try { localStorage.setItem("uum-pet-hint", "1"); } catch (e) {}
    pet.querySelector(".pet-hint").hidden = on;
    if (on) {
      stopStroll();                                /* 滑行中开聊天框：就地停步，再定位对话栏 */
      playAction("is-hop");                        /* 打开聊天框：开心跳一下 */
      placeDrawer();
      greet();
      setTimeout(function () { input.focus(); }, 80);
    }
  }

  pet.addEventListener("click", function () {
    if (justDragged) return;                       /* 拖动结束的合成点击不打开对话 */
    setOpen(!opened);
  });
  drawer.querySelector(".pet-close").addEventListener("click", function () { setOpen(false); });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && opened) setOpen(false);
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    bubble(q, "me");
    input.value = "";
    respond(q);
  });
  [].forEach.call(drawer.querySelectorAll("[data-pet-chips] button"), function (b) {
    b.addEventListener("click", function () {
      bubble(b.dataset.q, "me");
      respond(b.dataset.q);
    });
  });

  /* ---------- 动作动画：随机 idle + 事件触发（CSS 类短暂挂到 img 上） ---------- */
  var petImg = pet.querySelector("img");
  var ACTION_MS = { "is-wiggle": 950, "is-hop": 950, "is-look": 1250, "is-flip": 1250, "is-nod": 1150, "is-land": 600 };
  function playAction(cls) {
    petImg.classList.remove("is-wiggle", "is-hop", "is-look", "is-flip", "is-nod", "is-land");
    void petImg.offsetWidth;                       /* 强制回流：连续触发也能重启动画 */
    petImg.classList.add(cls);
    setTimeout(function () { petImg.classList.remove(cls); }, ACTION_MS[cls] || 900);
  }
  (function idleLoop(first) {
    setTimeout(function () {
      /* 聊天框打开（正和你聊天）或被拖拽时不插 idle 小动作 */
      if (!opened && !dragging && !dActive) {
        var pool = ["is-wiggle", "is-hop", "is-look", "is-flip"];
        playAction(pool[Math.floor(Math.random() * pool.length)]);
      }
      idleLoop(false);
    }, first ? 3500 + Math.random() * 2500 : 7000 + Math.random() * 8000);
  })(true);                                        /* 首次 3.5-6s 就来一下，之后 7-15s 随机 */

  /* ---------- 散步：空闲时自己走到视口里另一处 ----------
     位移用 left/top 过渡（.is-strolling），img 播走路颠簸，面朝移动方向；
     散步位置不持久化——刷新后仍回到用户最后放置的「家」。 */
  var strolling = false;
  function stopStroll() {
    if (!strolling) return;
    strolling = false;
    /* 冻结在当前视觉位置：transition 进行中 rect 即插值位置，先落 left/top 再撤类，
       避免撤类瞬间跳到目标点（拖动/开聊天框时尤其重要） */
    var r = pet.getBoundingClientRect();
    pet.style.left = Math.round(r.left) + "px";
    pet.style.top = Math.round(r.top) + "px";
    pet.style.bottom = "auto";
    pet.classList.remove("is-strolling");
    petImg.classList.remove("is-flipped");
  }
  function stroll() {
    if (opened || dragging || dActive || strolling) return;
    var w = window.innerWidth, h = window.innerHeight;
    var r = pet.getBoundingClientRect();
    var nx = r.left + (Math.random() * 2 - 1) * (120 + Math.random() * 240);
    var ny = r.top + (Math.random() * 2 - 1) * (80 + Math.random() * 200);
    nx = Math.max(8, Math.min(nx, w - PET_W - 8));
    ny = Math.max(8, Math.min(ny, h - PET_H - 8));
    if (Math.abs(nx - r.left) < 48 && Math.abs(ny - r.top) < 48) return;  /* 目标太近不值得演 */
    strolling = true;
    petImg.classList.toggle("is-flipped", nx > r.left);  /* 原图朝左：向右走才镜像 */
    pet.classList.add("is-strolling");
    setPetPos(nx, ny, false);                      /* 复用统一落点：clamp + 提示气泡朝向 */
    setTimeout(function () {
      stopStroll();
      if (opened) placeDrawer();
    }, 2500);
  }
  (function strollLoop(first) {
    setTimeout(function () {
      if (!opened && !dragging && !dActive) stroll();
      strollLoop(false);
    }, first ? 12000 + Math.random() * 8000 : 15000 + Math.random() * 15000);
  })(true);

  /* 首次访问：小鹿冒个提醒气泡（打开过一次就不再提示） */
  var hinted = false;
  try { hinted = !!localStorage.getItem("uum-pet-hint"); } catch (e) {}
  if (!hinted) {
    setTimeout(function () {
      if (!opened) pet.querySelector(".pet-hint").classList.add("is-visible");
      setTimeout(function () { pet.querySelector(".pet-hint").classList.remove("is-visible"); }, 5200);
    }, 1600);
  }
})();
