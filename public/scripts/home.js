/*!
 * home.js —— 面首页专用交互（自 demo.js 迁移）
 * 职责：
 *   1. 文章栏方框拖宽（与文章页正文方框同款交互：拖左右边调宽 / 双击恢复默认）
 *   2. 侧栏「网站信息」的运行时间与最后更新时间按天刷新
 *      （文章数目 / 总字数为构建期静态数据，无需 JS）
 * 挂载：仅面首页（uu/index.astro、mixt/index.astro），defer 加载。
 */
(function () {
  "use strict";
  var doc = document;

  /* ---------- 文章栏方框：拖边界调宽（双击恢复默认；与 demo 交互一致） ---------- */
  var homePage = doc.querySelector(".home-page");
  var homeMain = homePage && homePage.querySelector(".home-main");
  var homeFrame = homeMain && homeMain.querySelector(".home-frame");
  if (homePage && homeFrame) {
    try {
      var savedHomeW = parseInt(localStorage.getItem("uum-home-w"), 10);
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
        try { localStorage.setItem("uum-home-w", String(w)); } catch (err) {}
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
        try { localStorage.removeItem("uum-home-w"); } catch (err) {}
        if (window.uumToast) window.uumToast("已恢复默认文章栏宽度");
      });
    });
  }

  /* ---------- 网站信息：运行时间 / 最后更新时间（构建期给默认值，有 JS 则按访问日刷新） ---------- */
  var daysSince = function (dateStr) {
    return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
  };
  var humanUptime = function (days) {
    if (days >= 365) return Math.floor(days / 365) + " 年 " + (days % 365) + " 天";
    if (days >= 30) return Math.floor(days / 30) + " 个月 " + (days % 30) + " 天";
    return days + " 天";
  };
  var humanAgo = function (days) {
    if (days <= 0) return "今天";
    if (days < 30) return days + " 天前";
    if (days < 365) return Math.floor(days / 30) + " 个月前";
    return Math.floor(days / 365) + " 年前";
  };
  var uptimeEl = doc.querySelector("[data-si-uptime]");
  if (uptimeEl && uptimeEl.dataset.siteStart) {
    uptimeEl.textContent = humanUptime(Math.max(1, daysSince(uptimeEl.dataset.siteStart)));
  }
  var updatedEl = doc.querySelector("[data-si-updated]");
  if (updatedEl && updatedEl.dataset.latest) {
    updatedEl.textContent = humanAgo(daysSince(updatedEl.dataset.latest));
  }
})();
