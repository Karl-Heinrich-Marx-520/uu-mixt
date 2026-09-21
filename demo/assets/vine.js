/**
 * vine.js —— 点击藤蔓生长环绕效果（demo 验收版）
 *
 * 点击页面任意处：从点击点长出 3 条螺旋卷须（描边生长动画），
 * 沿途冒出叶片，卷须末端结一颗金色小星（呼应小怪物头上的星星），
 * 约 0.9 秒整体淡出。全部自包含：动态创建 SVG + Web Animations，无 CSS 依赖。
 * prefers-reduced-motion 时整体禁用。
 *
 * 引入：<script src="assets/vine.js"></script>（body 内任意位置，demo.js 之前）
 */
(function () {
  "use strict";
  var doc = document;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var NS = "http://www.w3.org/2000/svg";
  var GREEN = "#4e9a3c", GREEN_LITE = "#7cc35a", GOLD = "#e8b93c", GOLD_DEEP = "#d9a327";
  var SIZE = 260, R = SIZE / 2;

  function el(name, attrs) {
    var n = doc.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* 螺旋卷须路径：从中心向外绕 1.6~2 圈，带轻微波动（藤蔓的不规则感） */
  function tendrilPath(phase) {
    var dir = (phase | 0) % 2 ? 1 : -1;
    var turns = 1.55 + (phase % 3) * 0.12, steps = 28, pts = [];
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      var ang = phase + dir * t * turns * 2 * Math.PI;
      var rad = 3 + t * (R - 14) + Math.sin(t * 10 + phase * 2.3) * 3.2;
      pts.push([R + Math.cos(ang) * rad, R + Math.sin(ang) * rad * 0.94]);
    }
    return "M" + pts.map(function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L ");
  }

  /* 叶片形状：以 (0,0) 为叶柄基点的小叶子 */
  function leafPath() {
    return "M0 0 C 7 -6, 15 -5, 17 1 C 13 6, 5 6, 0 0 Z";
  }

  /* 金色四角星（呼应小怪物头顶的星星） */
  function starPath(r) {
    var p = "", i;
    for (i = 0; i < 8; i++) {
      var ang = (Math.PI / 4) * i - Math.PI / 2;
      var rad = i % 2 === 0 ? r : r * 0.42;
      p += (i === 0 ? "M" : "L") + (Math.cos(ang) * rad).toFixed(1) + " " + (Math.sin(ang) * rad).toFixed(1) + " ";
    }
    return p + "Z";
  }

  doc.addEventListener("click", function (e) {
    var svg = el("svg", {
      viewBox: "0 0 " + SIZE + " " + SIZE,
      width: SIZE, height: SIZE,
      "aria-hidden": "true"
    });
    svg.style.cssText = "position:fixed;left:" + (e.clientX - R) + "px;top:" + (e.clientY - R) +
      "px;width:" + SIZE + "px;height:" + SIZE + "px;pointer-events:none;z-index:2147483000;overflow:visible";
    if (!doc.body) return;
    doc.body.appendChild(svg);

    var dying = false;
    var die = function () {
      if (dying) return;
      dying = true;
      var fade = svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" });
      fade.onfinish = function () { if (svg.parentNode) svg.parentNode.removeChild(svg); };
    };

    /* 3 条卷须，相位差 120° */
    for (var i = 0; i < 3; i++) {
      var phase = (i * 2 * Math.PI) / 3 + 0.5;
      var path = el("path", {
        d: tendrilPath(phase),
        fill: "none",
        stroke: i === 1 ? GREEN_LITE : GREEN,
        "stroke-width": 2.6,
        "stroke-linecap": "round"
      });
      svg.appendChild(path);
      var len = path.getTotalLength();
      path.style.strokeDasharray = len + " " + len;
      path.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: 480, delay: i * 60, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" }
      );

      /* 沿途两片叶子：外层 g 用 attribute transform 定位（CSS 不认无单位 translate），
         内层 path 只做 CSS scale 动画 —— 定位与动画分层，两层语法各自合法 */
      [0.5, 0.78].forEach(function (t, k) {
        var steps = 28;
        var ang = phase + ((phase | 0) % 2 ? 1 : -1) * t * (1.55 + (phase % 3) * 0.12) * 2 * Math.PI;
        var rad = 3 + t * (R - 14);
        var x = R + Math.cos(ang) * rad, y = R + Math.sin(ang) * rad * 0.94;
        var deg = ((ang * 180) / Math.PI + (k ? 40 : -70)).toFixed(0);
        var g = el("g", { transform: "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ") rotate(" + deg + ")" });
        var leaf = el("path", { d: leafPath(), fill: k ? GREEN_LITE : GREEN, transform: "scale(0)" });
        g.appendChild(leaf);
        svg.appendChild(g);
        leaf.animate(
          [{ transform: "scale(0)" }, { transform: "scale(1)" }],
          { duration: 240, delay: 260 + i * 60 + k * 110, easing: "cubic-bezier(.3,1.4,.5,1)", fill: "both" }
        );
      });

      /* 末端小星：卷须长到头时 pop 出来（同样 g 定位 + 内层 CSS 动画） */
      var endAng = phase + ((phase | 0) % 2 ? 1 : -1) * (1.55 + (phase % 3) * 0.12) * 2 * Math.PI;
      var endRad = 3 + (R - 14);
      var sx = R + Math.cos(endAng) * endRad, sy = R + Math.sin(endAng) * endRad * 0.94;
      var gs = el("g", { transform: "translate(" + sx.toFixed(1) + " " + sy.toFixed(1) + ")" });
      var star = el("path", { d: starPath(i === 1 ? 9 : 7), fill: i === 1 ? GOLD : GOLD_DEEP, transform: "scale(0)" });
      gs.appendChild(star);
      svg.appendChild(gs);
      star.animate(
        [{ transform: "scale(0) rotate(0deg)" },
         { transform: "scale(1.25) rotate(90deg)" },
         { transform: "scale(1) rotate(72deg)" }],
        { duration: 320, delay: 500 + i * 60, easing: "ease-out", fill: "both" }
      );
    }

    setTimeout(die, 880);
  });
})();
