/* ==========================================================================
   UU&Mixt · article.js（文章页交互：目录高亮跟随 / 正文方框拖边界 / 代码块复制）
   自 demo/assets/demo.js 的对应逻辑原样迁移；原生 JS，无依赖。
   ========================================================================== */

(function () {
  "use strict";
  var doc = document;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 分享（PRD 5.3） ----------
     优先 navigator.share（移动端系统分享面板）；不支持或用户取消时降级为复制链接。
     链接是该面的正式路由 → 接收方直达正确的一面且不播翻转动画（PRD 4.2 / G2）。 */
  [].slice.call(doc.querySelectorAll('[data-action="share"]')).forEach(function (btn) {
    btn.addEventListener("click", function () {
      var url = btn.dataset.url || location.href;
      var title = btn.dataset.title || doc.title;
      var fallback = function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            window.uumToast && window.uumToast("链接已复制，可以直接分享给朋友");
          }, function () {
            /* 剪贴板被拒（如无权限环境）：说明原因并给手动复制出路（与 copy-mail 降级一致） */
            window.uumToast && window.uumToast("复制失败，请手动复制：" + url);
          });
        } else {
          window.uumToast && window.uumToast("当前浏览器不支持自动复制，链接：" + url);
        }
      };
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function (err) {
          /* 用户主动取消不算失败，不再打扰 */
          if (err && err.name === "AbortError") return;
          fallback();
        });
      } else {
        fallback();
      }
    });
  });

  /* ---------- 代码块：组装 demo 同款结构（头部 + 语言标签 + 复制按钮） ----------
     为什么在运行时做：Astro 的用户 rehype 插件在 Shiki 之前执行（拿不到行 span 与
     语言信息），在插件里包装会被后续 Shiki 改写，故改到这里组装。
     无 JS 时代码本身仍是完整可读的 <pre>。 */
  [].slice.call(doc.querySelectorAll(".prose pre")).forEach(function (pre) {
    if (pre.closest(".code-block")) return;
    var lang = pre.getAttribute("data-language") || "code";
    var wrapper = doc.createElement("div");
    wrapper.className = "code-block";
    pre.parentNode.insertBefore(wrapper, pre);
    var head = doc.createElement("div");
    head.className = "code-head";
    var label = doc.createElement("span");
    label.textContent = lang;
    head.appendChild(label);
    wrapper.appendChild(head);
    wrapper.appendChild(pre);
    pre.removeAttribute("style");   /* 交给 .code-block 的 CSS 变量接管配色 */
  });

  /* 补一键复制按钮（与 demo 的 copy-code 一致） */
  [].slice.call(doc.querySelectorAll(".code-block")).forEach(function (block) {
    var head = block.querySelector(".code-head");
    if (!head || head.querySelector(".copy-btn")) return;
    var btn = doc.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.setAttribute("data-action", "copy-code");
    btn.setAttribute("aria-label", "复制代码");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"><rect x="9" y="9" width="12" height="12" rx="2"/>' +
      '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg> 复制';
    head.appendChild(btn);
  });

  doc.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-action="copy-code"]');
    if (!btn) return;
    var block = btn.closest(".code-block");
    var code = block ? block.querySelector("code") : null;
    if (!code) return;
    var text = code.textContent;
    var done = function (ok) {
      var old = btn.innerHTML;
      btn.innerHTML = ok ? "已复制" : "复制失败";
      setTimeout(function () { btn.innerHTML = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { done(fallback()); }
      );
    } else {
      done(fallback());
    }
    function fallback() {
      var ta = doc.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
      doc.body.removeChild(ta);
      return ok;
    }
  });

  /* ---------- 目录：点击即时高亮 + 滚动位置追踪（与 demo 一致） ---------- */
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

  /* ---------- 正文方框：拖边界调宽（双击恢复默认；与 demo 一致） ---------- */
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
