/* ==========================================================================
   UU&Mixt · flip.js（卡牌式翻转 + URL 同步）
   规格：PRD 4.2 v2.0 —— .page-card 作为一张卡牌：
     · 翻出面绕 Y 轴 0 → ±89° 翻出（700ms）
     · 目标面从 ±89° 翻入归位（760ms）
     · 高光带跨页衔接：翻面扫到中央 → sessionStorage 传递标记 → 目标页扫出
     · 90° 瞬间背景与内容同时切换（真实导航完成）
   URL 同步（MPA 语义，等效 PRD 4.2 的 pushState 要求）：
     · 站内切换 = 真实导航（URL 随面变化）
     · 直接访问面页（navigate/reload）不播动画
     · 浏览器后退/前进（back_forward）= 反向翻入
   降级：prefers-reduced-motion 直接跳转；无 JS 时翻面按钮即普通链接。
   ========================================================================== */

(function () {
  "use strict";
  var doc = document;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 卡牌高光带（自 demo 原样迁移） ---------- */
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

  var flipTo = doc.body.dataset.flipTo;
  var leaving = false;
  var currentFace = doc.body.dataset.face;

  /* ---------- 翻入判定：正向（翻面控件）或反向（后退/前进） ---------- */
  function navigationType() {
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      return nav ? nav.type : "navigate";
    } catch (e) { return "navigate"; }
  }

  (function handleArrival() {
    if (reducedMotion) return;
    var flag = null;
    try { flag = sessionStorage.getItem("uum-flip-in"); } catch (e) {}
    if (flag) {
      /* 正向翻入：从 +89° 归位 + 高光后半程 */
      try { sessionStorage.removeItem("uum-flip-in"); } catch (e) {}
      doc.documentElement.classList.add("flip-in-pending");
      requestAnimationFrame(function () {
        doc.documentElement.classList.remove("flip-in-pending");
        doc.body.classList.add("flip-in");
        playGloss("in");
        afterAnim();
      });
      return;
    }
    /* 反向翻入（popstate 反播）：导航类型为 back_forward 且记录的上一个面不同 */
    var last = null;
    try { last = sessionStorage.getItem("uum-last-face"); } catch (e) {}
    if (navigationType() === "back_forward" && last && last !== currentFace) {
      doc.documentElement.classList.add("flip-in-pending");
      requestAnimationFrame(function () {
        doc.documentElement.classList.remove("flip-in-pending");
        doc.body.classList.add("flip-in-reverse");
        afterAnim();
      });
    }
  })();

  /* 记录当前面（供后退反播判定） */
  try { if (currentFace) sessionStorage.setItem("uum-last-face", currentFace); } catch (e) {}

  function afterAnim() {
    doc.body.addEventListener("animationend", function h(e) {
      if (e.animationName === "card-flip-in" || e.animationName === "card-flip-in-reverse") {
        doc.body.classList.remove("flip-in");
        doc.body.classList.remove("flip-in-reverse");
        doc.body.removeEventListener("animationend", h);
      }
    });
  }

  /* ---------- 翻出 ---------- */
  function doFlip() {
    if (!flipTo || leaving) return;
    leaving = true;
    if (reducedMotion) { location.href = flipTo; return; }
    try { sessionStorage.setItem("uum-flip-in", "1"); } catch (e) {}
    playGloss("out");
    doc.body.classList.add("flip-out");
    setTimeout(function () { location.href = flipTo; }, 700);
  }

  doc.addEventListener("click", function (e) {
    var el = e.target.closest('[data-action="flip"]');
    if (el) { e.preventDefault(); doFlip(); }
  });

  doc.addEventListener("keydown", function (e) {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      doFlip();
    }
  });

  /* 触屏横向滑动翻面（与 demo 一致：≥80px 且 |dy| ≤ 40px） */
  var touchX = 0, touchY = 0;
  doc.addEventListener("touchstart", function (e) {
    touchX = e.changedTouches[0].clientX;
    touchY = e.changedTouches[0].clientY;
  }, { passive: true });
  doc.addEventListener("touchend", function (e) {
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = Math.abs(e.changedTouches[0].clientY - touchY);
    if (Math.abs(dx) >= 80 && dy <= 40) doFlip();
  }, { passive: true });
})();
