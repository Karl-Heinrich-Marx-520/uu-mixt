/* ==========================================================================
   UU&Mixt 前端 Demo · 交互脚本（零依赖，单文件）
   覆盖：明暗模式 · 翻面控件（按钮/Alt方向键/触屏滑动） · 入口页四状态动画
        · TOC 滚动追踪 · 复制链接/代码 · 归档筛选 · 回到顶部 · toast
   ========================================================================== */
(function () {
  "use strict";

  var doc = document;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 明暗模式 ---------- */
  var pageDefault = doc.documentElement.dataset.defaultMode || "dark";
  var savedMode = pageDefault;
  try { savedMode = localStorage.getItem("uum-demo-mode") || pageDefault; } catch (e) {}
  doc.documentElement.dataset.mode = savedMode;

  function toggleMode() {
    var next = doc.documentElement.dataset.mode === "dark" ? "light" : "dark";
    doc.documentElement.dataset.mode = next;
    try { localStorage.setItem("uum-demo-mode", next); } catch (e) {}
  }

  /* ---------- toast ---------- */
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = doc.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  /* 暴露给工作台（admin.html）等页面的内联脚本使用 */
  window.uumToast = toast;

  /* ---------- 剪贴板（file:// 下降级 execCommand） ---------- */
  function copyText(text, okMsg) {
    function fallback() {
      var ta = doc.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      doc.body.appendChild(ta);
      ta.select();
      try { doc.execCommand("copy"); toast(okMsg); }
      catch (e) { toast("复制失败，请手动复制地址栏链接"); }
      doc.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () { toast(okMsg); },
        fallback
      );
    } else { fallback(); }
  }

  /* ---------- 翻面控件（面页面） ---------- */
  var flipTo = doc.body.dataset.flipTo;
  var leaving = false;

  /* 卡牌高光：斜向光带扫过（out = 扫到中央，in = 从中央扫出），跨页衔接 */
  function playGloss(phase) {
    if (reducedMotion) return;
    var g = doc.createElement("div");
    g.className = "gloss";
    doc.body.appendChild(g);
    try {
      var frames = phase === "out"
        ? [{ transform: "translateX(-118%)", opacity: 0 },
           { opacity: 0.95, offset: 0.45 },
           { transform: "translateX(0%)", opacity: 0.95 }]
        : [{ transform: "translateX(0%)", opacity: 0.95 },
           { opacity: 0.9, offset: 0.4 },
           { transform: "translateX(118%)", opacity: 0 }];
      var a = g.animate(frames, {
        duration: phase === "out" ? 700 : 760,
        easing: "cubic-bezier(.45,.05,.35,1)",
        fill: "forwards"
      });
      a.finished.then(function () { g.remove(); }).catch(function () { g.remove(); });
    } catch (e) { g.remove(); }
  }

  /* 翻入：从另一面跳转来时播放卡牌入场 + 高光后半程 */
  if (doc.documentElement.classList.contains("flip-in-pending")) {
    doc.documentElement.classList.remove("flip-in-pending");
    try { sessionStorage.removeItem("uum-flip-in"); } catch (e) {}
    doc.body.classList.add("flip-in");
    playGloss("in");
    doc.body.addEventListener("animationend", function onFlipIn(e) {
      if (e.animationName === "card-flip-in") {
        doc.body.classList.remove("flip-in");
        doc.body.removeEventListener("animationend", onFlipIn);
      }
    });
  }

  /* 粒子调色板（与两面主题色同源） */
  var PALETTES = {
    uu: ["#ef9f27", "#f6c468", "#ffe1a8", "#ffffff", "#c96f08"],
    mixt: ["#378add", "#6fb7ff", "#b3d5f8", "#ffffff", "#1b62b5"]
  };

  function spawnParticles(x, y, palette, count, power) {
    if (reducedMotion || !palette) return;
    power = power || 1;
    for (var i = 0; i < count; i++) {
      var p = doc.createElement("span");
      p.className = "particle";
      var size = 4 + Math.random() * 6;
      var circle = Math.random() < 0.55;
      p.style.width = size + "px";
      p.style.height = circle ? size + "px" : (size * 0.45) + "px";
      if (circle) p.style.borderRadius = "50%";
      p.style.background = palette[i % palette.length];
      p.style.left = x + "px";
      p.style.top = y + "px";
      var angle = Math.random() * Math.PI * 2;
      var dist = (70 + Math.random() * 170) * power;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist - 50;
      var rot = Math.random() * 660 - 330;
      var dur = 620 + Math.random() * 480;
      try {
        var a = p.animate(
          [
            { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
            { transform: "translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg) scale(.3)", opacity: 0 }
          ],
          { duration: dur, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }
        );
        a.finished.then(function () { this.remove(); }.bind(p)).catch(function () { p.remove(); });
      } catch (e) { p.remove(); return; }
      doc.body.appendChild(p);
    }
  }

  function spawnShockwave(x, y, color, delay, scaleMax) {
    if (reducedMotion) return;
    var r = doc.createElement("span");
    r.className = "shockwave";
    r.style.left = x + "px";
    r.style.top = y + "px";
    r.style.borderColor = color || "#fff";
    doc.body.appendChild(r);
    try {
      var a = r.animate(
        [
          { transform: "translate(-50%,-50%) scale(.15)", opacity: 0.95 },
          { transform: "translate(-50%,-50%) scale(" + (scaleMax || 3.4) + ")", opacity: 0 }
        ],
        { duration: 620, delay: delay || 0, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }
      );
      a.finished.then(function () { r.remove(); }).catch(function () { r.remove(); });
    } catch (e) { r.remove(); }
  }

  /* 持续喷泉：翻转期间从卡片中心不断喷出粒子，营造"引擎点火"感 */
  function spawnFountain(x, y, palette, duration) {
    if (reducedMotion || !palette) return;
    var stopAt = Date.now() + duration;
    (function tick() {
      spawnParticles(x + (Math.random() * 60 - 30), y + (Math.random() * 30 - 15),
        palette, 5, 0.85);
      if (Date.now() < stopAt) setTimeout(tick, 80);
    })();
  }

  /* 全屏闪光：入场瞬间亮一记主题色（仅 700ms，随即消散） */
  function spawnFlash(color) {
    if (reducedMotion) return;
    var f = doc.createElement("div");
    f.className = "flash";
    f.style.background =
      "radial-gradient(circle at 50% 44%, " + color + " 0%, transparent 62%)";
    doc.body.appendChild(f);
    try {
      var a = f.animate(
        [{ opacity: 0 }, { opacity: 0.16, offset: 0.25 }, { opacity: 0 }],
        { duration: 700, easing: "ease-out", fill: "forwards" }
      );
      a.finished.then(function () { f.remove(); }).catch(function () { f.remove(); });
    } catch (e) { f.remove(); }
  }

  function doFlip() {
    if (!flipTo || leaving) return;
    leaving = true;
    if (reducedMotion) { location.href = flipTo; return; }
    /* 卡牌式翻转：缓慢高光扫到中央 → 整页卡牌翻出 90° →
       跳转后另一面从 90° 翻入，背景与内容在 90° 瞬间同时切换 */
    try { sessionStorage.setItem("uum-flip-in", "1"); } catch (e) {}
    playGloss("out");
    doc.body.classList.add("flip-out");
    setTimeout(function () { location.href = flipTo; }, 700);
  }

  /* 键盘 Alt + ←/→（PRD 4.2） */
  doc.addEventListener("keydown", function (e) {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      doFlip();
    }
  });

  /* 触屏横向滑动：位移 > 60px 且速度 > 0.3px/ms，方向角 > 30°（PRD 4.2） */
  if (flipTo && "ontouchstart" in window) {
    var ts = null;
    doc.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1) {
        ts = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
      }
    }, { passive: true });
    doc.addEventListener("touchend", function (e) {
      if (!ts) return;
      var dx = e.changedTouches[0].clientX - ts.x;
      var dy = e.changedTouches[0].clientY - ts.y;
      var dt = Date.now() - ts.t;
      var dist = Math.sqrt(dx * dx + dy * dy);
      ts = null;
      if (dist < 60 || dt === 0) return;
      var speed = dist / dt;
      var angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
      if (speed > 0.3 && angle < 60) doFlip();
    }, { passive: true });
  }

  /* ---------- 事件委托 ---------- */
  doc.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.dataset.action;
    if (action === "toggle-mode") { toggleMode(); return; }
    if (action === "flip") { doFlip(); return; }
    if (action === "copy-link") {
      copyText(location.href, "链接已复制：分享后直达当前页面（不播放动画）");
      return;
    }
    if (action === "copy-code") {
      var pre = el.closest(".code-block").querySelector("pre");
      copyText(pre.innerText, "代码已复制");
      return;
    }
    if (action === "copy-mail") {
      var mail = el.dataset.mail || "";
      copyText(mail, el.dataset.okmsg || ("已复制：" + mail));
      return;
    }
    if (action === "todo") {
      e.preventDefault();
      toast(el.dataset.msg || "该功能在后续里程碑实现，本 Demo 未包含");
      return;
    }
    if (action === "back-top") {
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
      return;
    }
  });

  /* ---------- 回到顶部 ---------- */
  var backTop = doc.querySelector(".back-top");
  if (backTop) {
    window.addEventListener("scroll", function () {
      backTop.classList.toggle("show", window.scrollY > 500);
    }, { passive: true });
  }

  /* ---------- TOC：点击即时高亮 + 滚动位置追踪 ---------- */
  var tocLinks = [].slice.call(doc.querySelectorAll(".toc a"));
  if (tocLinks.length) {
    var tocHeads = tocLinks
      .map(function (a) { return doc.getElementById(a.getAttribute("href").slice(1)); })
      .filter(Boolean);

    function setActive(id) {
      tocLinks.forEach(function (a) {
        a.classList.toggle("active", a.getAttribute("href") === "#" + id);
      });
    }

    /* 点击目录：立即高亮所点击项（平滑滚动期间逐步移交给追踪逻辑） */
    tocLinks.forEach(function (a) {
      a.addEventListener("click", function () {
        setActive(a.getAttribute("href").slice(1));
      });
    });

    /* 滚动追踪：取判读线（视口顶部下方 25%）上方最近的标题 */
    var tocTicking = false;
    function tocTrack() {
      tocTicking = false;
      var line = window.scrollY + window.innerHeight * 0.25;
      var current = tocHeads.length ? tocHeads[0] : null;
      for (var i = 0; i < tocHeads.length; i++) {
        var top = tocHeads[i].getBoundingClientRect().top + window.scrollY;
        if (top <= line) current = tocHeads[i];
      }
      if (current) setActive(current.id);
    }
    window.addEventListener("scroll", function () {
      if (!tocTicking) {
        tocTicking = true;
        requestAnimationFrame(tocTrack);
      }
    }, { passive: true });
    tocTrack();
  }

  /* ---------- 文章页：正文方框 + 拖边界调宽（双击恢复默认） ---------- */
  var articlePage = doc.querySelector(".article-page .page");
  var frame = articlePage && articlePage.querySelector(".article-layout > article");
  if (articlePage && frame) {
    try {
      var savedW = parseInt(localStorage.getItem("uum-demo-article-w"), 10);
      if (savedW >= 680) articlePage.style.setProperty("--article-w", savedW + "px");
    } catch (e) {}

    var clampW = function (w) {
      var maxW = Math.min(1400, window.innerWidth - 64);
      return Math.max(680, Math.min(w, maxW));
    };

    ["left", "right"].forEach(function (side) {
      var edge = doc.createElement("div");
      edge.className = "frame-edge frame-edge--" + side;
      edge.setAttribute("role", "separator");
      edge.setAttribute("aria-label", "拖动调整阅读宽度");
      edge.title = "拖动调整阅读宽度 · 双击恢复默认";
      frame.appendChild(edge);

      var startX = 0, startW = 0, dragging = false;
      edge.addEventListener("pointerdown", function (e) {
        dragging = true;
        startX = e.clientX;
        startW = articlePage.getBoundingClientRect().width;
        edge.classList.add("is-dragging");
        doc.body.classList.add("is-resizing");
        try { edge.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      edge.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        /* 容器居中：边界每移动 1px，宽度改变 2px */
        var delta = (e.clientX - startX) * 2 * (side === "right" ? 1 : -1);
        var w = clampW(Math.round(startW + delta));
        articlePage.style.setProperty("--article-w", w + "px");
        try { localStorage.setItem("uum-demo-article-w", String(w)); } catch (err) {}
      });
      var stop = function () {
        if (!dragging) return;
        dragging = false;
        edge.classList.remove("is-dragging");
        doc.body.classList.remove("is-resizing");
      };
      edge.addEventListener("pointerup", stop);
      edge.addEventListener("pointercancel", stop);
      edge.addEventListener("dblclick", function () {
        articlePage.style.removeProperty("--article-w");
        try { localStorage.removeItem("uum-demo-article-w"); } catch (err) {}
        toast("已恢复默认阅读宽度");
      });
    });
  }

  /* ---------- 首页：文章栏方框 + 拖边界调宽（交互与文章页一致，双击恢复默认） ---------- */
  var homePage = doc.querySelector(".home-page");
  var homeMain = homePage && homePage.querySelector(".home-main");
  var homeFrame = homeMain && homeMain.querySelector(".home-frame");
  if (homePage && homeFrame) {
    try {
      var savedHomeW = parseInt(localStorage.getItem("uum-demo-home-w"), 10);
      if (savedHomeW >= 680) homeFrame.style.setProperty("--home-w", savedHomeW + "px");
    } catch (e) {}

    var clampHome = function (w) {
      /* 上限 = 主栏实际宽度（窄屏单栏后自动变全宽） */
      return Math.max(680, Math.min(w, homeMain.getBoundingClientRect().width));
    };

    ["left", "right"].forEach(function (side) {
      var edge = doc.createElement("div");
      edge.className = "frame-edge frame-edge--" + side;
      edge.setAttribute("role", "separator");
      edge.setAttribute("aria-label", "拖动调整文章栏宽度");
      edge.title = "拖动调整文章栏宽度 · 双击恢复默认";
      homeFrame.appendChild(edge);

      var startX = 0, startW = 0, dragging = false;
      edge.addEventListener("pointerdown", function (e) {
        dragging = true;
        startX = e.clientX;
        startW = homeFrame.getBoundingClientRect().width;
        edge.classList.add("is-dragging");
        doc.body.classList.add("is-resizing");
        try { edge.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      edge.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        /* 方框在主栏内居中：边界每移动 1px，宽度改变 2px */
        var delta = (e.clientX - startX) * 2 * (side === "right" ? 1 : -1);
        var w = clampHome(Math.round(startW + delta));
        homeFrame.style.setProperty("--home-w", w + "px");
        try { localStorage.setItem("uum-demo-home-w", String(w)); } catch (err) {}
      });
      var stop = function () {
        if (!dragging) return;
        dragging = false;
        edge.classList.remove("is-dragging");
        doc.body.classList.remove("is-resizing");
      };
      edge.addEventListener("pointerup", stop);
      edge.addEventListener("pointercancel", stop);
      edge.addEventListener("dblclick", function () {
        homeFrame.style.removeProperty("--home-w");
        try { localStorage.removeItem("uum-demo-home-w"); } catch (err) {}
        toast("已恢复默认文章栏宽度");
      });
    });
  }

  /* ---------- 内容层渲染（写作台提交 → 站点立即可见） ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var store = window.UUMStore;

  /* 面首页统计：文章数随内容层实时更新 */
  [].slice.call(doc.querySelectorAll("[data-stat-posts]")).forEach(function (el) {
    if (store) el.textContent = store.published(el.dataset.statPosts).length;
  });

  /* 作者简介：写作台「设置」改完 → 面页侧栏 / 作者页立即同步。
     HTML 里的静态文本是 no-JS 兜底；store 有值时以内容层为准。 */
  if (store && (doc.body.dataset.face === "uu" || doc.body.dataset.face === "mixt")) {
    [].slice.call(doc.querySelectorAll("[data-bio]")).forEach(function (el) {
      var bio = store.authorBio(doc.body.dataset.face);
      if (bio) el.textContent = bio;
    });
  }

  /* 个人标签：作者页方向行（「C++ 后端 · 网络编程」），写作台「设置」维护 */
  if (store && (doc.body.dataset.face === "uu" || doc.body.dataset.face === "mixt")) {
    [].slice.call(doc.querySelectorAll("[data-author-dir]")).forEach(function (el) {
      var tags = store.authorTags(doc.body.dataset.face);
      if (tags.length) el.textContent = tags.join(" · ");
    });
  }

  /* 在做什么：作者页条目（小标题 + 一句描述），写作台「设置」维护。
     store 有条目时整组覆盖渲染；列表为空保留 HTML 静态内容作 no-JS 兜底。 */
  if (store && (doc.body.dataset.face === "uu" || doc.body.dataset.face === "mixt")) {
    [].slice.call(doc.querySelectorAll("[data-doing]")).forEach(function (el) {
      var doing = store.authorDoing(doc.body.dataset.face);
      if (!doing.length) return;
      el.innerHTML = doing.map(function (x) {
        var t = doc.createElement("b"); t.textContent = x.t;
        var s = doc.createElement("span"); s.textContent = x.d;
        var w = doc.createElement("div"); w.className = "author-fact";
        w.appendChild(t); w.appendChild(s);
        return w.outerHTML;
      }).join("");
    });
  }

  /* 技术栈：作者页 chips，写作台「设置」维护；为空保留静态兜底 */
  if (store && (doc.body.dataset.face === "uu" || doc.body.dataset.face === "mixt")) {
    [].slice.call(doc.querySelectorAll("[data-stack]")).forEach(function (el) {
      var stack = store.authorStack(doc.body.dataset.face);
      if (!stack.length) return;
      el.innerHTML = stack.map(function (t) {
        var c = doc.createElement("span"); c.className = "chip"; c.textContent = t;
        return c.outerHTML;
      }).join("");
    });
  }

  /* ---------- 首页侧栏：统计 + 网站信息（内容层实时更新） ---------- */
  function countTags(posts) {
    var tags = {};
    posts.forEach(function (p) { (p.tags || []).forEach(function (t) { tags[t] = 1; }); });
    return Object.keys(tags).length;
  }
  function wordsToNum(w) {
    var m = /([\d.]+)\s*(k)?/i.exec(String(w || ""));
    return m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : 0;
  }
  function fmtWords(total) {
    return total >= 1000 ? (total / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(total);
  }
  function daysSince(dateStr) {
    return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
  }
  function humanUptime(days) {
    if (days >= 365) return Math.floor(days / 365) + " 年 " + (days % 365) + " 天";
    if (days >= 30) return Math.floor(days / 30) + " 个月 " + (days % 30) + " 天";
    return days + " 天";
  }
  function humanAgo(days) {
    if (days <= 0) return "今天";
    if (days < 30) return days + " 天前";
    if (days < 365) return Math.floor(days / 30) + " 个月前";
    return Math.floor(days / 365) + " 年前";
  }
  /* 侧栏统计：文章（复用 data-stat-posts）/ 分类 / 标签，均由内容层实时计算 */
  [].slice.call(doc.querySelectorAll("[data-side-stats]")).forEach(function (el) {
    if (!store) return;
    var posts = store.published(el.dataset.sideStats);
    var set = function (sel, v) { var n = el.querySelector(sel); if (n) n.textContent = v; };
    set("[data-stat-cats]", store.categories(el.dataset.sideStats).length);
    set("[data-stat-tags]", countTags(posts));
  });
  /* 网站信息：建站日写死（SITE_START），其余由内容层实时计算 */
  var SITE_START = "2026-09-12";
  [].slice.call(doc.querySelectorAll("[data-site-info]")).forEach(function (el) {
    if (!store) return;
    var posts = store.published(el.dataset.siteInfo);
    var set = function (sel, v) { var n = el.querySelector(sel); if (n) n.textContent = v; };
    var latest = posts.reduce(function (a, p) { return (p.date || "") > a ? p.date : a; }, "");
    set("[data-si-posts]", posts.length + " 篇");
    set("[data-si-uptime]", humanUptime(Math.max(1, daysSince(SITE_START))));
    set("[data-si-words]", fmtWords(posts.reduce(function (a, p) { return a + wordsToNum(p.words); }, 0)));
    set("[data-si-updated]", latest ? humanAgo(daysSince(latest)) : "—");
  });


  /* 面首页 / 归档：文章卡片列表 */
  [].slice.call(doc.querySelectorAll("[data-post-list]")).forEach(function (host) {
    if (!store) return; /* 无内容层时保留静态 HTML（无 JS / 打开单个文件也正常） */
    var face = host.dataset.postList;
    var posts = store.published(face);
    if (!posts.length) {
      host.innerHTML = '<div class="empty-state"><h2>这一面还没有文章</h2><p>在写作台发布第一篇即可在首页看到。</p></div>';
      return;
    }
    host.innerHTML = posts.map(function (p) {
      var fresh = p.createdAt && (Date.now() - p.createdAt) < 172800000;
      var href = p.detail || "#";
      var linkAttrs = p.detail ? "" : ' data-action="todo" data-msg="Demo：详情页在正式实现里由构建期生成"';
      var tags = (p.tags || []).slice(0, 3).map(function (t) {
        return '<span class="chip">' + esc(t) + "</span>";
      }).join("");
      var meta = [];
      if (p.featured) {
        meta.push('<span class="pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 6 3 4H7l3-4-1-6zM12 14v7"/></svg>置顶</span>');
      }
      if (fresh) meta.push('<span class="pin pin--new">新发布</span>');
      meta.push('<time datetime="' + esc(p.date) + '">' + esc(p.date) + "</time>");
      meta.push("<span>" + esc(p.words || "—") + " 字 · 约 " + esc(p.minutes || 5) + " 分钟</span>");
      return '<a class="post-card" href="' + esc(href) + '"' + linkAttrs + ">" +
        '<div class="post-meta">' + meta.join("") + "</div>" +
        "<h2>" + esc(p.title) + "</h2>" +
        '<div class="chip-row">' +
          (p.category ? '<span class="chip chip--cat">' + esc(p.category) + "</span>" : "") + tags +
        "</div>" +
        '<p class="post-excerpt">' + esc(p.desc) + "</p>" +
        '<span class="read-more">阅读全文 <span class="arr">→</span></span>' +
        "</a>";
    }).join("");
  });

  /* 归档：按年份分组（时间维度视图：统计行 + 年份锚点跳转条；「按分类找」完全交给分类页） */
  [].slice.call(doc.querySelectorAll("[data-archive]")).forEach(function (host) {
    if (!store) return;
    var face = host.dataset.archive;
    var posts = store.published(face);
    var byYear = {};
    posts.forEach(function (p) { (byYear[(p.date || "").slice(0, 4)] = byYear[(p.date || "").slice(0, 4)] || []).push(p); });
    var years = Object.keys(byYear).sort().reverse();

    /* 统计行：共 N 篇 · 2026 年 X 篇 · 2025 年 Y 篇 */
    var counter = doc.querySelector("[data-archive-counter]");
    if (counter && posts.length) {
      counter.textContent = "共 " + posts.length + " 篇 · " + years.map(function (y) {
        return y + " 年 " + byYear[y].length + " 篇";
      }).join(" · ");
    }

    if (!years.length) {
      host.innerHTML = '<div class="empty-state"><h2>还没有可归档的文章</h2></div>';
      return;
    }

    /* 年份锚点跳转条 */
    var nav = doc.querySelector("[data-archive-nav]");
    if (nav) {
      nav.innerHTML = years.map(function (y) {
        return '<a href="#year-' + esc(y) + '">' + esc(y) + "<small>" + byYear[y].length + " 篇</small></a>";
      }).join("");
    }

    host.innerHTML = years.map(function (y) {
      var rows = byYear[y].map(function (p) {
        var attrs = p.detail ? "" : ' data-action="todo" data-msg="Demo：详情页在正式实现里由构建期生成"';
        return '<li class="archive-row">' +
          '<time datetime="' + esc(p.date) + '">' + esc((p.date || "").slice(5)) + "</time>" +
          '<a href="' + esc(p.detail || "#") + '"' + attrs + ">" + esc(p.title) + "</a>" +
          (p.category ? '<span class="chip chip--cat">' + esc(p.category) + "</span>" : "") +
          "</li>";
      }).join("");
      return '<h2 class="archive-year" id="year-' + esc(y) + '">' + esc(y) + " <small>" + byYear[y].length + " 篇</small></h2>" +
        '<ul class="archive-list">' + rows + "</ul>";
    }).join("");
  });

  /* 分类页：分类卡片 + 各分类文章列表 */
  var catGrid = doc.querySelector("[data-cat-grid]");
  if (catGrid && store) {
    var cface = catGrid.dataset.catGrid;
    var cats = store.categories(cface);
    var emptyHost = doc.querySelector("[data-cat-empty]");
    var listHost = doc.querySelector("[data-cat-lists]");
    var total = store.published(cface).length;
    var counter = doc.querySelector("[data-cat-counter]");
    if (counter) counter.textContent = cats.length + " 个分类 · 共 " + total + " 篇";

    if (!cats.length) {
      catGrid.innerHTML = "";
      if (listHost) listHost.innerHTML = "";
      if (emptyHost) emptyHost.hidden = false;
    } else {
      if (emptyHost) emptyHost.hidden = true;
      catGrid.innerHTML = cats.map(function (c) {
        var posts = store.published(cface).filter(function (p) { return p.category === c.name; });
        var latest = posts[0];
        return '<a class="cat-card" href="#cat-' + esc(c.slug) + '">' +
          '<span class="cat-name">' + esc(c.name) + "</span>" +
          '<span class="cat-count">' + posts.length + " 篇</span>" +
          '<p class="cat-desc">' + esc(c.desc || "") + "</p>" +
          (latest ? '<span class="cat-latest">最近：' + esc(latest.title) + " · " + esc(latest.date) + "</span>" : "") +
          "</a>";
      }).join("");
      if (listHost) {
        listHost.innerHTML = cats.map(function (c) {
          var posts = store.published(cface).filter(function (p) { return p.category === c.name; });
          return '<h2 class="archive-year" id="cat-' + esc(c.slug) + '">' + esc(c.name) +
            " <small>" + posts.length + " 篇</small></h2>" +
            '<ul class="archive-list">' + posts.map(function (p) {
              var href = p.detail || ("post.html?face=" + cface + "&slug=" + encodeURIComponent(p.slug));
              return '<li class="archive-row"><time datetime="' + esc(p.date) + '">' + esc((p.date || "").slice(5)) + "</time>" +
                '<a href="' + esc(href) + '">' + esc(p.title) + "</a></li>";
            }).join("") + "</ul>";
        }).join("");
      }
    }
  }

  /* 作者页：这一面的分类索引（chips） */
  [].slice.call(doc.querySelectorAll("[data-author-cats]")).forEach(function (host) {
    if (!store) return;
    var face = host.dataset.authorCats;
    var cats = store.categories(face);
    var page = face === "uu" ? "uu-category.html" : "mixt-category.html";
    if (!cats.length) {
      host.innerHTML = '<span style="font-size:.86rem;color:var(--text-2)">这一面的分类当前为空（按 PRD 3.5 由本人经写作台添加）。</span>';
      return;
    }
    host.innerHTML = cats.map(function (c) {
      return '<a href="' + page + '#cat-' + esc(c.slug) + '">' + esc(c.name) +
        "（" + store.categoryCount(face, c.name) + " 篇）</a>";
    }).join("");
  });

  /* ---------- 入口页：四状态翻牌（PRD 4.3 的 Demo 实现） ---------- */
  var stage = doc.querySelector(".stage");
  if (stage) {
    var cards = [].slice.call(stage.querySelectorAll(".entry-card"));
    var hint = doc.querySelector(".entry-hint");
    var state = 0; /* 0 并列 · 1 收拢 · 2/3 翻转入场 */

    /* 上次访问标记 */
    try {
      var last = localStorage.getItem("uum-demo-last-face");
      if (last) {
        var badgeHost = stage.querySelector(".entry-card--" + last + " .name");
        if (badgeHost) {
          var b = doc.createElement("span");
          b.className = "visited-badge";
          b.textContent = "上次访问";
          badgeHost.appendChild(b);
        }
      }
    } catch (e) {}

    function enter(target) {
      try { localStorage.setItem("uum-demo-last-face", target); } catch (e) {}
      var card = stage.querySelector(".entry-card.is-selected");
      var rect = card.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var pal = PALETTES[target] || PALETTES.uu;
      var accent = target === "mixt" ? "#378add" : "#ef9f27";
      /* S2：翻转起手 —— 喷泉持续喷发 + 首发大爆发 + 双重冲击波 */
      stage.classList.add("s2");
      state = 2;
      spawnFountain(cx, cy, pal, reducedMotion ? 0 : 860);
      spawnParticles(cx, cy, pal, 40, 1.5);
      spawnShockwave(cx, cy, accent, 0, 4.2);
      spawnShockwave(cx, cy, accent, 180, 2.6);
      setTimeout(function () {
        /* S3：放大入场 —— 双连爆（错开 140ms）+ 全屏闪光 */
        stage.classList.add("s3");
        state = 3;
        spawnParticles(cx, cy, pal, 50, 1.8);
        setTimeout(function () {
          spawnParticles(cx, cy, pal, 40, 1.3);
        }, 140);
        spawnShockwave(cx, cy, "#ffffff", 0, 4.6);
        spawnFlash(accent);
        setTimeout(function () { location.href = target + ".html"; }, reducedMotion ? 0 : 490);
      }, reducedMotion ? 0 : 860);
    }

    stage.addEventListener("click", function (e) {
      var card = e.target.closest(".entry-card");
      if (state === 0) {
        if (!card) return;
        e.preventDefault();
        cards.forEach(function (c) { c.classList.toggle("is-selected", c === card); });
        stage.classList.add("s1");
        state = 1;
        if (hint) hint.textContent = "再点一次确认进入 · 按 Esc 返回";
      } else if (state === 1) {
        e.preventDefault();
        if (card) {
          enter(card.dataset.face);
        } else {
          /* 点击空白：回到 S0（360ms 反向） */
          stage.classList.remove("s1");
          cards.forEach(function (c) { c.classList.remove("is-selected"); });
          state = 0;
          if (hint) hint.textContent = "选择一张卡片，进入该作者的一面";
        }
      }
    });

    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state === 1) {
        stage.classList.remove("s1");
        cards.forEach(function (c) { c.classList.remove("is-selected"); });
        state = 0;
        if (hint) hint.textContent = "选择一张卡片，进入该作者的一面";
      }
    });
  }
})();
