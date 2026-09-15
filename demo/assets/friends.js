/* ==========================================================================
   UU&Mixt Demo · friends.js —— 友链卡组（入口页专用，PRD E8 的形态原型）
   交互（UU 2026-09-14 口述规格 · 2026-09-15 布局改版：两侧竖列）：
     · 入口页右上角一叠卡片；
     · 宽屏（≥1024px）：卡片分成左右两列沿屏幕两侧竖排——列内垂直居中、
       相邻留缝（放不下则压缩重叠），每张带 ±9° 交错倾斜，不挡中间字样；
     · 窄屏（<1024px）：回退底部横向卡链（首尾相连、±8° 交错倾斜），
       垂直卡在「提示文字」与「页脚」之间的空隙带里；
     · 鼠标悬停某张 → 转正、展开详细介绍（左列向右展开、右列向左展开、
       横链中心对齐；越界方向自动翻转让位）；
     · 卡片多时不必全铺：场上保持 ≤10 张，再次点击 = 收回最早的等量卡片、
       发出新卡替换空位；全部轮过一遍后再点 → 收回；Esc 也可收回。
   自包含：数据内联、无 fetch、file:// 可用。
   ========================================================================== */
(function () {
  "use strict";

  var doc = document;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 数据源：写作台维护（UUMStore.friends），store 不在场时用内联兜底 ----------
     正式实现为 JSON 配置 + 构建期渲染（PRD E8）；下面的内联数组只是无 store 时的降级副本。 */
  var INLINE_FRIENDS = [
    { name: "云端牧码",   url: "https://example.com/yunmuma",   desc: "写云计算与分布式系统的实验记录，偏好可复现的部署清单。" },
    { name: "栈外",       url: "https://example.com/zhanwai",   desc: "聊编程语言之外的事：编译器、运行时与一点哲学。" },
    { name: "像素底片",   url: "https://example.com/pixelphoto",desc: "复古游戏美术与独立开发日志，偶尔更新像素画教程。" },
    { name: "夜航西飞",   url: "https://example.com/nightfly",  desc: "网络工程方向，BGP 与数据中心网络的踩坑合集。" },
    { name: "炉边谈话",   url: "https://example.com/hearth",    desc: "安全研究员的随笔：漏洞之外，还有生活。" },
    { name: "零点客栈",   url: "https://example.com/inn0",      desc: "后端与数据库，PostgreSQL 深度爱好者。" },
    { name: "拾荒者手记", url: "https://example.com/scavenger", desc: "在开源项目里捡宝贝：源码阅读与提交考古。" },
    { name: "南方小院",   url: "https://example.com/southyard", desc: "自建服务器的折腾史：NAS、家庭实验室与电费账单。" },
    { name: "白板与咖啡", url: "https://example.com/whiteboard",desc: "算法竞赛退役选手的复出训练场。" },
    { name: "回声谷",     url: "https://example.com/echovalley",desc: "音频编程与信号处理，用代码做声音的实验。" },
    { name: "折纸引擎",   url: "https://example.com/origami",   desc: "图形学与渲染管线，WebGPU 尝鲜系列。" },
    { name: "慢速快门",   url: "https://example.com/slowshutter",desc: "摄影 + 前端，把照片做成会动的网页。" },
    { name: "候鸟电台",   url: "https://example.com/migratory", desc: " weekly 技术播客的文字稿与延伸阅读。" },
    { name: "齿轮与诗",   url: "https://example.com/gearpoem",  desc: "机械键盘、固件改造与一点工业设计审美。" },
    { name: "面包屑导航", url: "https://example.com/breadcrumb",desc: "产品与工程的交叉地带，写原型背后的思考。" },
    { name: "北极星组件", url: "https://example.com/polaris",   desc: "前端架构与设计系统，组件库的长期主义。" }
  ];

  /* 优先取写作台维护的数据（添加/编辑后刷新入口页立即生效）；store 不在场回退内联 */
  var FRIENDS = (function () {
    try {
      if (window.UUMStore && typeof window.UUMStore.friends === "function") {
        var list = window.UUMStore.friends();
        if (list && list.length) return list;
      }
    } catch (e) {}
    return INLINE_FRIENDS;
  })();

  var CAP_PER_BATCH = 10;          /* 场上容量 = 每次点牌堆发出的数量 */
  var SIDE_MIN_VW = 1024;          /* 宽于此值走两侧竖列，否则底部横链 */
  var dealt = [];                  /* 场上的 { data, el } */
  var nextIdx = 0;                 /* 下一个要发出的 FRIENDS 索引（换牌时与场上数量解耦） */
  var open = false;
  var twoCol = false;              /* 当前布局是否为两侧竖列（zoom 展开方向依赖它） */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function host(u) { return u.replace(/^https?:\/\//, "").replace(/\/$/, ""); }

  /* ---------- 牌堆（右上角，明暗切换按钮下方） ---------- */
  var deck = doc.createElement("button");
  deck.className = "friend-deck";
  deck.type = "button";
  deck.setAttribute("aria-label", "友链卡组：点击展开");
  deck.title = "友链（点击发牌 / 再点收回）";
  deck.innerHTML =
    '<span class="fd-card fd-card--b"></span>' +
    '<span class="fd-card fd-card--a"></span>' +
    '<span class="fd-card fd-card--top">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>' +
      '<b class="fd-count">友链 ' + FRIENDS.length + "</b>" +
    "</span>";
  /* 同 pet.js：挂 <html>，避开 body perspective 对 fixed 的包含块劫持 */
  doc.documentElement.appendChild(deck);

  var badge = deck.querySelector(".fd-count");

  /* ---------- 卡片尺寸 ----------
     布局期统一确定并写入 CSS 变量（--fc-w/--fc-h/--fc-zw/--fc-zh），
     JS 是尺寸的唯一来源；demo.css 里 width/height 全部走 var() 读取。 */
  var curW = 92, curH = 116;       /* 当前卡尺寸 */
  var ZW = 210, ZH = 224;          /* 悬停放大目标尺寸 */

  function applySizeVars() {
    var s = doc.documentElement.style;
    s.setProperty("--fc-w", curW + "px");
    s.setProperty("--fc-h", curH + "px");
    s.setProperty("--fc-zw", ZW + "px");
    s.setProperty("--fc-zh", ZH + "px");
  }

  /* ---------- 两侧竖列布局（宽屏） ---------- */
  function sidePoints(n) {
    var w = window.innerWidth, h = window.innerHeight;
    curW = 92;
    curH = 116;
    ZW = 210;
    ZH = 224;
    applySizeVars();

    var xl = 24;                          /* 左列：贴左，倾斜外扩 ~12px 仍在屏内 */
    var xr = w - 24 - curW - 10;          /* 右列：贴右，多留 10px 给倾斜与 zoom */

    /* 每列可用带：顶部避开牌堆/明暗按钮，底部避开页脚；列内垂直居中 */
    var bands = {
      l: { top: 96, bottom: h - 24 },
      r: { top: 190, bottom: h - 24 }     /* 右列多让出牌堆高度 */
    };
    var cols = { l: [], r: [] };
    for (var i = 0; i < n; i++) cols[i % 2 ? "r" : "l"].push(i);   /* 奇右偶左 */

    var ys = {};
    ["l", "r"].forEach(function (side) {
      var k = cols[side].length;
      if (!k) return;
      var band = bands[side];
      var usable = band.bottom - band.top;
      /* 行距：优先卡高 + 8px 缝；带高不足则压缩（下限 0.5×卡高，允许重叠但保持可读） */
      var stepMin = Math.round(curH * 0.5);
      var step = curH + 8;
      if (k > 1) step = Math.min(step, (usable - curH) / (k - 1));
      step = Math.max(stepMin, Math.floor(step));
      var colH = (k - 1) * step + curH;
      /* 列内垂直居中，但不允许负偏移把列顶推出带外 */
      var y0 = band.top + Math.max(0, Math.round((usable - colH) / 2));
      /* 底边硬顶：不越视口下缘 12px；顶带冲突时保底边（页脚/牌堆均有浮层保护） */
      if (y0 + colH > h - 12) y0 = Math.max(0, h - 12 - colH);
      for (var j = 0; j < k; j++) ys[cols[side][j]] = y0 + j * step;
    });

    var pts = [];
    for (var i2 = 0; i2 < n; i2++) {
      pts.push({
        x: i2 % 2 ? xr : xl,
        y: ys[i2],
        rot: Math.round(Math.sin(i2 * 1.9 + 1) * 90) / 10,   /* ±9° 交错倾斜 */
        side: i2 % 2 ? "r" : "l"
      });
    }
    return pts;
  }

  /* ---------- 底部横链布局（窄屏回退） ---------- */
  function chainPoints(n) {
    var w = window.innerWidth, h = window.innerHeight;
    var hintEl = doc.querySelector(".entry-hint");
    var footEl = doc.querySelector(".entry-foot");
    var bandTop = null, bandBottom = null;
    if (hintEl && footEl) {
      bandTop = hintEl.getBoundingClientRect().bottom;
      bandBottom = footEl.getBoundingClientRect().top;
    }
    var bandH = (bandTop != null && bandBottom != null) ? bandBottom - bandTop : null;

    var baseW = w <= 720 ? 80 : 92;
    var baseH = w <= 720 ? 104 : 116;
    /* 空隙带装不下全尺寸卡时按高度比例缩小（保底 70px 高，内容仍可读） */
    var hh = baseH;
    if (bandH != null) hh = Math.max(70, Math.min(baseH, bandH - 12));
    curW = Math.round(baseW * (hh / baseH));
    curH = Math.round(hh);
    ZW = w <= 720 ? Math.min(200, w - 32) : 210;
    ZH = 224;
    applySizeVars();

    /* 垂直：优先在「提示文字底 ↔ 页脚顶」空隙带内居中——
       带高足够则完全不压文字；带矮时链体对称外溢（提示与页脚都有
       z-index 浮层，文字仍可见可点）；带几乎不存在才贴底兜底 */
    var y;
    if (bandH != null && bandH >= 28) {
      y = bandTop + (bandH - curH) / 2;
    } else {
      y = h - 24 - curH;
    }

    /* 水平：居中成链；屏宽不足时加大重叠压缩链长（每张最少露出 8px） */
    var gap = curW - 12;                         /* 相邻重叠 12px（比旧版 26 更松） */
    var maxW = w - 52;
    if (curW + (n - 1) * gap > maxW) {
      gap = Math.max(8, (maxW - curW) / Math.max(n - 1, 1));
    }
    var x0 = (w - (curW + (n - 1) * gap)) / 2;

    var pts = [];
    for (var i = 0; i < n; i++) {
      pts.push({
        x: x0 + i * gap,
        y: y,
        rot: Math.round(Math.sin(i * 1.9 + 1) * 80) / 10,   /* ±8° 交错倾斜 */
        side: "m"
      });
    }
    return pts;
  }

  function layoutPoints(n) {
    twoCol = window.innerWidth >= SIDE_MIN_VW;
    return twoCol ? sidePoints(n) : chainPoints(n);
  }

  function makeCard(data, idx) {
    var a = doc.createElement("a");
    a.className = "friend-card";
    a.href = data.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.dataset.face = idx % 2 ? "mixt" : "uu";          /* 交替双面主题色 */
    a.innerHTML =
      '<span class="fc-avatar" aria-hidden="true">' + esc(data.name.slice(0, 1)) +
        (data.avatar ? '<img class="fc-avatar-img" src="' + esc(data.avatar) + '" alt="" onerror="this.remove()">' : "") +
      "</span>" +
      '<b class="fc-name">' + esc(data.name) + "</b>" +
      '<span class="fc-detail">' +
        '<span class="fc-host">' + esc(host(data.url)) + "</span>" +
        '<span class="fc-desc">' + esc(data.desc) + "</span>" +
        '<span class="fc-go">访问 <i aria-hidden="true">→</i></span>' +
      "</span>";
    /* 悬停放大 + 展开详情（用 JS 事件，便于无头自测与键盘触发） */
    a.addEventListener("mouseenter", function () { zoom(a, true); });
    a.addEventListener("mouseleave", function () { zoom(a, false); });
    a.addEventListener("focus", function () { zoom(a, true); });
    a.addEventListener("blur", function () { zoom(a, false); });
    return a;
  }

  function zoom(card, on) {
    place(card, on);
    card.classList.toggle("is-zoomed", on);
    if (on) {
      [].forEach.call(doc.querySelectorAll(".friend-card.is-zoomed"), function (c) {
        if (c !== card) { c.classList.remove("is-zoomed"); place(c, false); }
      });
    }
  }

  /* 牌堆当前位置（卡片出发 / 收回的原点） */
  function deckPoint() {
    return { x: window.innerWidth - 18 - 92, y: 70 };
  }

  /* 放置：静止 = 平移 + 交错倾斜；
     zoom = 转正展开——横链中心对齐；竖列左列向右展开、右列向左展开；
     垂直按视口 clamp：顶到边时向下长高、底到边时向上长高 */
  function place(card, zoomed) {
    var x = +card.dataset.x, y = +card.dataset.y, rot = +card.dataset.rot || 0;
    if (zoomed) {
      var dx;
      if (!twoCol) dx = Math.round((curW - ZW) / 2);
      else dx = card.dataset.side === "r" ? curW - ZW : 0;
      var dy = curH - ZH;
      dy = Math.max(8 - y, Math.min(dy, window.innerHeight - ZH - 8 - y));
      card.style.transform = "translate(" + Math.round(x + dx) + "px," + Math.round(y + dy) + "px) rotate(0deg)";
    } else {
      card.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px) rotate(" + rot + "deg)";
    }
  }

  /* 发牌：从牌堆原点飞到目标位（错峰入场） */
  function layout(animate) {
    var pts = layoutPoints(dealt.length);
    var d0 = deckPoint();
    dealt.forEach(function (item, i) {
      var p = pts[i];
      item.el.dataset.x = Math.round(p.x);
      item.el.dataset.y = Math.round(p.y);
      item.el.dataset.rot = p.rot;
      item.el.dataset.side = p.side || "m";
      item.el.style.zIndex = String(10 + i);       /* 后发压先发，像依次立起的牌 */
      if (animate && !reduced) {
        item.el.style.transitionDelay = (i % CAP_PER_BATCH) * 45 + "ms";
        item.el.style.transform = "translate(" + d0.x + "px," + d0.y + "px) scale(0.5)";
        item.el.style.opacity = "0";
        void item.el.offsetWidth;                      /* 强制回流，保证过渡生效 */
      }
      place(item.el, false);
      item.el.style.opacity = "1";
      if (animate && !reduced) {
        setTimeout(function () { item.el.style.transitionDelay = "0ms"; }, 900);
      }
    });
  }

  /* 发牌 / 换牌：场上始终 ≤ CAP_PER_BATCH 张——
     剩余不足以再铺一批时，先收回最早的等量卡片（飞回牌堆移除），
     再发出新卡替换空位，避免所有卡堆在一起越排越挤 */
  function deal() {
    var remain = FRIENDS.length - nextIdx;
    if (remain <= 0) { close(); return; }          /* 全部轮过一遍 → 收起 */
    var batch = Math.min(CAP_PER_BATCH, remain);
    var retire = Math.max(0, dealt.length + batch - CAP_PER_BATCH);
    var d0 = deckPoint();
    for (var r = 0; r < retire; r++) {
      var old = dealt.shift();
      old.el.style.zIndex = "5";                   /* 退场时垫底，让新卡压过 */
      old.el.style.transform = "translate(" + d0.x + "px," + d0.y + "px) scale(0.5)";
      old.el.style.opacity = "0";
      var out = old.el;
      setTimeout(function () { if (out.parentNode) out.parentNode.removeChild(out); }, reduced ? 0 : 500);
    }
    for (var i = 0; i < batch; i++) {
      var el = makeCard(FRIENDS[nextIdx + i], dealt.length);
      /* 初始位置：牌堆处（fixed 元素 left/top 归零，位置全由 transform 表达） */
      el.style.left = "0";
      el.style.top = "0";
      el.style.transform = "translate(" + d0.x + "px," + d0.y + "px) scale(0.5)";
      el.style.opacity = "0";
      doc.documentElement.appendChild(el);
      dealt.push({ data: FRIENDS[nextIdx + i], el: el });
    }
    nextIdx += batch;
    open = true;
    doc.body.classList.add("friends-open");
    layout(true);
    updateBadge();
  }

  function close() {
    var d0 = deckPoint();
    dealt.forEach(function (item, i) {
      item.el.style.transform = "translate(" + d0.x + "px," + d0.y + "px) scale(0.5)";
      item.el.style.opacity = "0";
      var el = item.el;
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, reduced ? 0 : 500);
    });
    dealt = [];
    nextIdx = 0;
    open = false;
    doc.body.classList.remove("friends-open");
    updateBadge();
  }

  function updateBadge() {
    var remain = FRIENDS.length - nextIdx;
    if (dealt.length === 0) {
      badge.textContent = "友链 " + FRIENDS.length;
      deck.classList.remove("is-open", "has-more");
    } else if (remain > 0) {
      badge.textContent = "还有 " + remain + " 张";
      deck.classList.add("is-open", "has-more");
    } else {
      badge.textContent = "收起";
      deck.classList.add("is-open");
      deck.classList.remove("has-more");
    }
  }

  deck.addEventListener("click", function () {
    var remain = FRIENDS.length - dealt.length;
    if (!open || remain > 0) deal();
    else close();
  });

  /* Esc 收回（捕获阶段，避免同时触发入口页翻牌的 Esc 回 S0） */
  doc.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !dealt.length) return;
    e.stopImmediatePropagation();
    close();
  }, true);

  /* 窗口尺寸变化：重新排布已发出的卡片（横竖布局自动切换） */
  var rt = null;
  window.addEventListener("resize", function () {
    if (!dealt.length) return;
    clearTimeout(rt);
    rt = setTimeout(function () { layout(false); }, 150);
  });
})();
