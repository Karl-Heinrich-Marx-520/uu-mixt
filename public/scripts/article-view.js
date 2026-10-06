/* ==========================================================================
   UU&Mixt · article-view.js（文章页视图：目录跟随高亮 + 正文方框拖宽）
   从原 article.js 拆出：这两个都是"阅读视图"层面的事，与分享/代码块无关。
   ========================================================================== */

(function () {
  "use strict";
  var doc = document;

  /* ---------- 目录：点击即时高亮 + 滚动位置追踪 ---------- */
  var tocLinks = [].slice.call(doc.querySelectorAll(".toc a"));
  if (tocLinks.length) {
    var tocHeads = tocLinks
      .map(function (a) { return doc.getElementById((a.getAttribute("href") || "").slice(1)); })
      .filter(Boolean);

    function setActive(id) {
      tocLinks.forEach(function (a) {
        a.classList.toggle("active", a.getAttribute("href") === "#" + id);
      });
    }

    tocLinks.forEach(function (a) {
      a.addEventListener("click", function () {
        setActive(a.getAttribute("href").slice(1));
      });
    });

    /* 标题距文档顶部的距离缓存起来：此前每帧对每个标题 getBoundingClientRect()，
       69 条目录就是每帧 69 次强制读布局。判定语义完全不变（仍是"越过 25% 线"），
       只是把布局读取从"每帧"降到"布局真的变化时"。 */
    var tops = [];
    function measure() {
      tops = tocHeads.map(function (h) { return h.getBoundingClientRect().top + window.scrollY; });
    }
    var tocTicking = false;
    function tocTrack() {
      tocTicking = false;
      var line = window.scrollY + window.innerHeight * 0.25;
      var current = tocHeads.length ? 0 : -1;
      for (var i = 0; i < tops.length; i++) {
        if (tops[i] <= line) current = i;
      }
      if (current >= 0) setActive(tocHeads[current].id);
    }
    window.addEventListener("scroll", function () {
      if (!tocTicking) {
        tocTicking = true;
        requestAnimationFrame(tocTrack);
      }
    }, { passive: true });
    /* 布局变化的三个时机都要重算：视口变化、图片/字体加载完（懒加载图片撑开正文）、
       代码块折叠展开——否则缓存会带着旧位置算错当前节。 */
    window.addEventListener("resize", function () { measure(); tocTrack(); }, { passive: true });
    window.addEventListener("load", function () { measure(); tocTrack(); });
    doc.addEventListener("click", function (e) {
      if (e.target.closest('[data-action="fold-code"]')) {
        setTimeout(function () { measure(); tocTrack(); }, 0);
      }
    });
    measure();
    tocTrack();
  }

  /* ---------- 正文方框：拖边界调宽（双击恢复默认） ---------- */
  var articlePage = doc.querySelector(".article-page .page");
  var frame = articlePage && articlePage.querySelector(".article-layout > article");
  if (articlePage && frame) {
    try {
      var savedW = parseInt(localStorage.getItem("uum-article-w"), 10);
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
        var delta = (e.clientX - startX) * 2 * (side === "right" ? 1 : -1);
        var w = clampW(Math.round(startW + delta));
        articlePage.style.setProperty("--article-w", w + "px");
        try { localStorage.setItem("uum-article-w", String(w)); } catch (err) {}
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
        try { localStorage.removeItem("uum-article-w"); } catch (err) {}
        if (window.uumToast) window.uumToast("已恢复默认阅读宽度");
      });
    });
  }
})();
