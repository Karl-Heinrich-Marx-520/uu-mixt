/* ==========================================================================
   UU&Mixt · core.js（共享外壳脚本）
   职责：明暗模式（含页级默认主题）/ toast / 回到顶部 / 翻面按钮之外的通用交互
   说明：原生 JS 模块，无框架运行时；与 demo/assets/demo.js 的同名逻辑等价。
   ========================================================================== */

(function () {
  "use strict";
  var doc = document;

  /* ---------- 明暗模式（localStorage 持久化；支持页级默认主题） ---------- */
  var pageDefault = doc.documentElement.dataset.defaultMode || "light";
  var savedMode = pageDefault;
  try { savedMode = localStorage.getItem("uum-mode") || pageDefault; } catch (e) {}
  doc.documentElement.dataset.mode = savedMode;

  doc.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-action="toggle-mode"]');
    if (!btn) return;
    var next = doc.documentElement.dataset.mode === "dark" ? "light" : "dark";
    doc.documentElement.dataset.mode = next;
    try { localStorage.setItem("uum-mode", next); } catch (e) {}
    toast(next === "dark" ? "已切换到暗色模式" : "已切换到浅色模式");
  });

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
  window.uumToast = toast;

  /* ---------- 回到顶部 ---------- */
  doc.addEventListener("click", function (e) {
    if (e.target.closest('[data-action="back-top"]')) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  /* ---------- 待实现占位（todo 提示） ---------- */
  doc.addEventListener("click", function (e) {
    var el = e.target.closest('[data-action="todo"]');
    if (!el) return;
    e.preventDefault();
    toast(el.dataset.msg || "该功能将在后续里程碑实现");
  });
})();
