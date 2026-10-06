/* ==========================================================================
   UU&Mixt · article-code.js（代码块：头部组装 + 复制 + 折叠）
   从原 article.js 拆出。复制降级统一走 core.js 的 window.uumCopyText。
   ========================================================================== */

(function () {
  "use strict";
  var doc = document;

  /* ---------- 组装 demo 同款结构（头部 + 语言标签） ----------
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

  /* 补折叠按钮 + 一键复制按钮（与 demo 一致） */
  [].slice.call(doc.querySelectorAll(".code-block")).forEach(function (block) {
    var head = block.querySelector(".code-head");
    if (!head) return;
    if (!head.querySelector(".fold-btn")) {
      var fold = doc.createElement("button");
      fold.className = "copy-btn fold-btn";
      fold.type = "button";
      fold.setAttribute("data-action", "fold-code");
      fold.setAttribute("aria-expanded", "true");
      fold.setAttribute("aria-label", "收起代码");
      fold.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
      head.insertBefore(fold, head.firstChild);
    }
    if (head.querySelector('[data-action="copy-code"]')) return;
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

  /* ---------- 复制代码 ---------- */
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
    if (window.uumCopyText) {
      window.uumCopyText(text).then(function (ok) { done(!!ok); });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  });

  /* ---------- 折叠/展开：切 is-collapsed 类，CSS 藏 pre、箭头旋转 ---------- */
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-action="fold-code"]');
    if (!btn) return;
    var block = btn.closest(".code-block");
    if (!block) return;
    var collapsed = block.classList.toggle("is-collapsed");
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", collapsed ? "展开代码" : "收起代码");
  });
})();
