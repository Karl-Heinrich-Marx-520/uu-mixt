/* ==========================================================================
   UU&Mixt · core.js（共享外壳脚本）
   职责：明暗模式（含页级默认主题）/ toast / 回到顶部 / 翻面按钮之外的通用交互
   说明：原生 JS 模块，无框架运行时；与 demo/assets/demo.js 的同名逻辑等价。
   ========================================================================== */

(function () {
  "use strict";
  var doc = document;

  /* ---------- 明暗模式（localStorage 持久化；首帧由 head 内联脚本定调） ----------
     取值优先级：用户显式选择 > 页面的 data-mode-lock（写作台写死自己的主题）
     > 系统偏好 prefers-color-scheme > 兜底 dark。
     此前兜底是 data-default-mode（全站硬编码 dark），结果两套色板里的浅色几乎
     没人能用；而且这里的赋值发生在 body 末尾，比首帧晚，会造成「深色闪一下再变
     浅色」——head 里的内联引导脚本已经提前定好，这里只负责同步与后续切换。 */
  var lock = doc.documentElement.dataset.modeLock || "";
  var savedMode = "";
  try { savedMode = localStorage.getItem("uum-mode") || ""; } catch (e) {}
  var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  doc.documentElement.dataset.mode = savedMode || lock || (prefersLight ? "light" : "dark");

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

  /* ---------- 点击复制（邮箱等，决策 7.22）：Clipboard API 优先，execCommand 降级 ---------- */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    var ok = false;
    try { ta.select(); ok = doc.execCommand("copy"); } catch (e) { ok = false; }
    doc.body.removeChild(ta);
    return ok;
  }
  doc.addEventListener("click", function (e) {
    var el = e.target.closest('[data-action="copy-mail"]');
    if (!el) return;
    e.preventDefault();
    var mail = el.dataset.mail || "";
    if (!mail) return;
    copyText(mail).then(function (ok) {
      toast(ok ? (el.dataset.okmsg || "已复制：" + mail) : "复制失败，请手动复制：" + mail);
    });
  });
})();
