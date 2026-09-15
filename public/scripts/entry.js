/* ==========================================================================
   UU&Mixt · entry.js（入口页：四状态翻牌 + 粒子特效）
   —— 自 demo/assets/demo.js 原样迁移（样式与动效参数逐值一致），仅两处适配：
        · 卡片 URL 由 xx.html 改为 /xx/
        · 上次访问标记的存储键统一为 uum-last-face（与 flip.js 的反播判定共用）
   规格：PRD 4.3 S0 并列 → S1 收拢 → S2 翻转 → S3 放大入场；
         Esc 回 S0；二次访问跳过；prefers-reduced-motion 直接跳转。
   ========================================================================== */

(function () {
  "use strict";

  var doc = document;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 粒子调色板（与两面主题色同源） */
  var PALETTES = {
    uu: ["#ef9f27", "#f6c468", "#ffe1a8", "#ffffff", "#c96f08"],
    mixt: ["#378add", "#6fb7ff", "#b3d5f8", "#ffffff", "#1b62b5"]
  };

  function spawnParticles(x, y, palette, count, power) {
    if (reducedMotion || !palette) return;
    power = power || 1;
    for (var i = 0; i < count; i++) {
      var p = doc.createElement("span");
      p.className = "particle";
      var size = 4 + Math.random() * 6;
      var circle = Math.random() < 0.55;
      p.style.width = size + "px";
      p.style.height = circle ? size + "px" : (size * 0.45) + "px";
      if (circle) p.style.borderRadius = "50%";
      p.style.background = palette[i % palette.length];
      p.style.left = x + "px";
      p.style.top = y + "px";
      var angle = Math.random() * Math.PI * 2;
      var dist = (70 + Math.random() * 170) * power;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist - 50;
      var rot = Math.random() * 660 - 330;
      var dur = 620 + Math.random() * 480;
      try {
        var a = p.animate(
          [
            { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
            { transform: "translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg) scale(.3)", opacity: 0 }
          ],
          { duration: dur, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }
        );
        a.finished.then(function () { this.remove(); }.bind(p)).catch(function () { p.remove(); });
      } catch (e) { p.remove(); return; }
      doc.body.appendChild(p);
    }
  }

  function spawnShockwave(x, y, color, delay, scaleMax) {
    if (reducedMotion) return;
    var r = doc.createElement("span");
    r.className = "shockwave";
    r.style.left = x + "px";
    r.style.top = y + "px";
    r.style.borderColor = color || "#fff";
    doc.body.appendChild(r);
    try {
      var a = r.animate(
        [
          { transform: "translate(-50%,-50%) scale(.15)", opacity: 0.95 },
          { transform: "translate(-50%,-50%) scale(" + (scaleMax || 3.4) + ")", opacity: 0 }
        ],
        { duration: 620, delay: delay || 0, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }
      );
      a.finished.then(function () { r.remove(); }).catch(function () { r.remove(); });
    } catch (e) { r.remove(); }
  }

  /* 持续喷泉：翻转期间从卡片中心不断喷出粒子，营造"引擎点火"感 */
  function spawnFountain(x, y, palette, duration) {
    if (reducedMotion || !palette) return;
    var stopAt = Date.now() + duration;
    (function tick() {
      spawnParticles(x + (Math.random() * 60 - 30), y + (Math.random() * 30 - 15),
        palette, 5, 0.85);
      if (Date.now() < stopAt) setTimeout(tick, 80);
    })();
  }

  /* 全屏闪光：入场瞬间亮一记主题色（仅 700ms，随即消散） */
  function spawnFlash(color) {
    if (reducedMotion) return;
    var f = doc.createElement("div");
    f.className = "flash";
    f.style.background =
      "radial-gradient(circle at 50% 44%, " + color + " 0%, transparent 62%)";
    doc.body.appendChild(f);
    try {
      var a = f.animate(
        [{ opacity: 0 }, { opacity: 0.16, offset: 0.25 }, { opacity: 0 }],
        { duration: 700, easing: "ease-out", fill: "forwards" }
      );
      a.finished.then(function () { f.remove(); }).catch(function () { f.remove(); });
    } catch (e) { f.remove(); }
  }

  /* ---------- 入口页：四状态翻牌（PRD 4.3 的 Demo 实现） ---------- */
  var stage = doc.querySelector(".stage");
  if (stage) {
    var cards = [].slice.call(stage.querySelectorAll(".entry-card"));
    var hint = doc.querySelector(".entry-hint");
    var state = 0; /* 0 并列 · 1 收拢 · 2/3 翻转入场 */

    /* 上次访问标记 */
    try {
      var last = localStorage.getItem("uum-last-face");
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
      try { localStorage.setItem("uum-last-face", target); } catch (e) {}
      var card = stage.querySelector(".entry-card.is-selected");
      var rect = card.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var pal = PALETTES[target] || PALETTES.uu;
      var accent = target === "mixt" ? "#378add" : "#ef9f27";
      /* S2：翻转起手 —— 喷泉持续喷发 + 首发大爆发 + 双重冲击波 */
      stage.classList.add("s2");
      state = 2;
      spawnFountain(cx, cy, pal, reducedMotion ? 0 : 860);
      spawnParticles(cx, cy, pal, 40, 1.5);
      spawnShockwave(cx, cy, accent, 0, 4.2);
      spawnShockwave(cx, cy, accent, 180, 2.6);
      setTimeout(function () {
        /* S3：放大入场 —— 双连爆（错开 140ms）+ 全屏闪光 */
        stage.classList.add("s3");
        state = 3;
        spawnParticles(cx, cy, pal, 50, 1.8);
        setTimeout(function () {
          spawnParticles(cx, cy, pal, 40, 1.3);
        }, 140);
        spawnShockwave(cx, cy, "#ffffff", 0, 4.6);
        spawnFlash(accent);
        setTimeout(function () { location.href = "/" + target + "/"; }, reducedMotion ? 0 : 490);
      }, reducedMotion ? 0 : 860);
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
