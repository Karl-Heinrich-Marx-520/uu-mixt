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
  var savedMode = "light";
  try { savedMode = localStorage.getItem("uum-demo-mode") || "light"; } catch (e) {}
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

  /* ---------- 文章页：内容栏拖拽调宽（双击恢复默认） ---------- */
  var articlePage = doc.querySelector(".article-page .page");
  if (articlePage) {
    var handle = doc.createElement("div");
    handle.className = "width-handle";
    handle.title = "拖动调整阅读宽度 · 双击恢复默认";
    articlePage.appendChild(handle);
    try {
      var savedW = parseInt(localStorage.getItem("uum-demo-article-w"), 10);
      if (savedW >= 680) articlePage.style.setProperty("--article-w", savedW + "px");
    } catch (e) {}
    var draggingW = false;
    handle.addEventListener("pointerdown", function (e) {
      draggingW = true;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    handle.addEventListener("pointermove", function (e) {
      if (!draggingW) return;
      var rect = articlePage.getBoundingClientRect();
      var w = Math.round(e.clientX - rect.left);
      var maxW = Math.min(1400, window.innerWidth - 64);
      w = Math.max(680, Math.min(w, maxW));
      articlePage.style.setProperty("--article-w", w + "px");
      try { localStorage.setItem("uum-demo-article-w", String(w)); } catch (err) {}
    });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      handle.addEventListener(ev, function () { draggingW = false; });
    });
    handle.addEventListener("dblclick", function () {
      articlePage.style.removeProperty("--article-w");
      try { localStorage.removeItem("uum-demo-article-w"); } catch (err) {}
      toast("已恢复默认阅读宽度");
    });
  }

  /* ---------- 归档分类筛选 ---------- */
  var filterBar = doc.querySelector(".filter-bar");
  if (filterBar) {
    var rows = [].slice.call(doc.querySelectorAll(".archive-row"));
    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter-chip");
      if (!btn) return;
      filterBar.querySelectorAll(".filter-chip").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      var f = btn.dataset.filter;
      rows.forEach(function (r) {
        r.classList.toggle("is-hidden", f !== "all" && r.dataset.cat !== f);
      });
      doc.querySelectorAll(".archive-year").forEach(function (y) {
        var group = y.nextElementSibling;
        var any = group && [].some.call(group.children, function (c) {
          return !c.classList.contains("is-hidden");
        });
        y.style.display = any ? "" : "none";
      });
    });
  }

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
