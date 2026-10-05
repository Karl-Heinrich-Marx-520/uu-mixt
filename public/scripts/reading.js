/* ==========================================================================
   UU&Mixt · reading.js（文章页阅读辅助，2026-10-06）
   职责：① 阅读进度条 ② 正文图片点击放大（lightbox）③ 标题锚点链接
   约束：
   · 零依赖、原生 ES5 语法，接管失败也不影响阅读（全部包 try / 判空）
   · 浮动层（进度条、lightbox）挂 documentElement 而不是 body —— AGENTS 踩坑 16：
     body 上的 transform/filter 会让它成为 fixed 的包含块，浮动组件会被钉到页底
   · 滚动监听走 requestAnimationFrame 节流 + passive
   ========================================================================== */

(function () {
  "use strict";
  var doc = document;
  var root = doc.documentElement;

  function toast(msg) {
    if (window.uumToast) window.uumToast(msg);
  }

  /* ---------- 1. 阅读进度条（按正文区域，而不是整页含页脚） ---------- */
  (function () {
    var art = doc.querySelector(".prose");
    if (!art) return;
    var wrap = doc.createElement("div");
    wrap.className = "read-progress";
    wrap.setAttribute("aria-hidden", "true");
    var bar = doc.createElement("i");
    wrap.appendChild(bar);
    root.appendChild(wrap);

    var ticking = false;
    function update() {
      ticking = false;
      var rect = art.getBoundingClientRect();
      var start = window.pageYOffset + rect.top;
      var total = art.offsetHeight;
      if (total <= 0) { bar.style.width = "0%"; return; }
      var passed = window.pageYOffset + window.innerHeight - start;
      var pct = (passed / total) * 100;
      bar.style.width = Math.max(0, Math.min(100, pct)).toFixed(2) + "%";
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
  })();

  /* ---------- 2. 正文图片点击放大（支持左右切换 / Esc 关闭） ---------- */
  (function () {
    var imgs = [].slice.call(doc.querySelectorAll(".prose img"));
    if (!imgs.length) return;

    var box = doc.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "图片预览");
    box.hidden = true;

    var figure = doc.createElement("img");
    var tip = doc.createElement("p");
    tip.className = "lb-tip";
    box.appendChild(figure);
    box.appendChild(tip);
    root.appendChild(box);

    var idx = 0;
    function show(i) {
      idx = (i + imgs.length) % imgs.length;
      var el = imgs[idx];
      figure.src = el.currentSrc || el.src;
      figure.alt = el.alt || "";
      box.hidden = false;
      root.classList.add("lb-open");
      tip.textContent = (idx + 1) + " / " + imgs.length + "　← → 切换 · Esc 关闭";
    }
    function hide() {
      box.hidden = true;
      root.classList.remove("lb-open");
    }
    box.addEventListener("click", hide);
    figure.addEventListener("click", function (e) { e.stopPropagation(); });
    doc.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "Escape") hide();
      else if (e.key === "ArrowRight") show(idx + 1);
      else if (e.key === "ArrowLeft") show(idx - 1);
    });

    imgs.forEach(function (el, i) {
      el.classList.add("zoomable");
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", "放大查看：" + (el.alt || "正文配图"));
      el.addEventListener("click", function () { show(i); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(i); }
      });
    });
  })();

  /* ---------- 3. 标题锚点：hover 出现 #，点击复制该节链接 ---------- */
  (function () {
    var heads = [].slice.call(doc.querySelectorAll(".prose h2[id], .prose h3[id]"));
    if (!heads.length) return;
    heads.forEach(function (h) {
      var a = doc.createElement("a");
      a.className = "anchor";
      a.href = "#" + h.id;
      a.textContent = "#";
      a.title = "复制本节链接";
      a.setAttribute("aria-label", "复制本节链接");
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey) return;      /* 保留新标签页打开 */
        e.preventDefault();
        var url = location.origin + location.pathname + "#" + h.id;
        try {
          history.replaceState(null, "", "#" + h.id);
        } catch (err) {}
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(
            function () { toast("本节链接已复制"); },
            function () { toast("复制失败，地址栏已是本节链接"); }
          );
        } else {
          toast("地址栏已定位到本节");
        }
      });
      h.appendChild(a);
    });
  })();
})();
