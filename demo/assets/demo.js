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
  function doFlip() {
    if (!flipTo || leaving) return;
    leaving = true;
    if (reducedMotion) { location.href = flipTo; return; }
    doc.body.classList.add("page-leaving");
    setTimeout(function () { location.href = flipTo; }, 390);
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

  /* ---------- TOC 滚动追踪 ---------- */
  var tocLinks = [].slice.call(doc.querySelectorAll(".toc a"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var heads = tocLinks.map(function (a) { return doc.getElementById(a.getAttribute("href").slice(1)); })
      .filter(Boolean);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (a) {
            a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id);
          });
        }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    heads.forEach(function (h) { io.observe(h); });
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
      stage.classList.add("s2");
      state = 2;
      setTimeout(function () {
        stage.classList.add("s3");
        state = 3;
        setTimeout(function () { location.href = target + ".html"; }, reducedMotion ? 0 : 330);
      }, reducedMotion ? 0 : 720);
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
