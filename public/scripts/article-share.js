/* ==========================================================================
   UU&Mixt · article-share.js（文章页分享按钮）
   从原 article.js 拆出：原先一个 245 行的 IIFE 里混着分享 / 代码块 / 目录 / 拖宽
   四个职责，改任一处都要通读全文、回滚也是整块回滚。
   复制降级统一走 core.js 暴露的 window.uumCopyText（Clipboard API → execCommand），
   不再每个脚本各写一份 legacyCopy。
   ========================================================================== */

(function () {
  "use strict";
  var doc = document;

  /* PRD 5.3：优先 navigator.share（移动端系统分享面板），不支持则复制链接。
     链接是该面的正式路由 → 接收方直达正确的一面且不播翻转动画（PRD 4.2 / G2）。 */
  [].slice.call(doc.querySelectorAll('[data-action="share"]')).forEach(function (btn) {
    btn.addEventListener("click", function () {
      var url = btn.dataset.url || location.href;
      var title = btn.dataset.title || doc.title;
      var ok = function () { window.uumToast && window.uumToast("链接已复制，可以直接分享给朋友"); };
      var manual = function () { window.uumToast && window.uumToast("复制失败，请手动复制：" + url); };
      var fallback = function () {
        if (window.uumCopyText) {
          window.uumCopyText(url).then(function (done) { done ? ok() : manual(); });
        } else {
          manual();
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
})();
