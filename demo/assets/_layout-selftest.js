/* 友链布局算法自验：复制 friends.js 的 sidePoints/chainPoints 数学，多视口断言 */
"use strict";
var curW = 92, curH = 116;
var SIDE_MIN_VW = 1024;
var fails = [];

function sidePoints(n, w, h) {
  curW = 92; curH = 116;
  var xl = 24, xr = w - 24 - curW - 10;
  var bands = { l: { top: 96, bottom: h - 24 }, r: { top: 190, bottom: h - 24 } };
  var cols = { l: [], r: [] };
  for (var i = 0; i < n; i++) cols[i % 2 ? "r" : "l"].push(i);
  var ys = {};
  ["l", "r"].forEach(function (side) {
    var k = cols[side].length;
    if (!k) return;
    var band = bands[side];
    var usable = band.bottom - band.top;
    var stepMin = Math.round(curH * 0.5);
    var step = curH + 8;
    if (k > 1) step = Math.min(step, (usable - curH) / (k - 1));
    step = Math.max(stepMin, Math.floor(step));
    var colH = (k - 1) * step + curH;
    var y0 = band.top + Math.max(0, Math.round((usable - colH) / 2));
    if (y0 + colH > h - 12) y0 = Math.max(0, h - 12 - colH);
    for (var j = 0; j < k; j++) ys[cols[side][j]] = y0 + j * step;
  });
  var pts = [];
  for (var i2 = 0; i2 < n; i2++) {
    pts.push({ x: i2 % 2 ? xr : xl, y: ys[i2], rot: Math.round(Math.sin(i2 * 1.9 + 1) * 90) / 10, side: i2 % 2 ? "r" : "l" });
  }
  return pts;
}

function chainPoints(n, w, h, band) {
  var bandTop = band ? band.top : null, bandBottom = band ? band.bottom : null;
  var bandH = (bandTop != null && bandBottom != null) ? bandBottom - bandTop : null;
  var baseW = w <= 720 ? 80 : 92, baseH = w <= 720 ? 104 : 116;
  var hh = baseH;
  if (bandH != null) hh = Math.max(70, Math.min(baseH, bandH - 12));
  curW = Math.round(baseW * (hh / baseH));
  curH = Math.round(hh);
  var y = bandH != null && bandH >= 28 ? bandTop + (bandH - curH) / 2 : h - 24 - curH;
  var gap = curW - 12;
  var maxW = w - 52;
  if (curW + (n - 1) * gap > maxW) gap = Math.max(8, (maxW - curW) / Math.max(n - 1, 1));
  var x0 = (w - (curW + (n - 1) * gap)) / 2;
  var pts = [];
  for (var i = 0; i < n; i++) pts.push({ x: x0 + i * gap, y: y, rot: Math.round(Math.sin(i * 1.9 + 1) * 80) / 10 });
  return pts;
}

/* ---- 断言辅助 ---- */
function assert(name, cond, detail) {
  if (!cond) fails.push(name + " :: " + detail);
}

/* 1) 两侧竖列 · 宽屏矩阵（16 张全发 + 10 张首批） */
[[1920, 1080], [1600, 900], [1366, 768], [1280, 800], [1024, 768]].forEach(function (vp) {
  [16, 10].forEach(function (n) {
    var w = vp[0], h = vp[1];
    var pts = sidePoints(n, w, h);
    pts.forEach(function (p, i) {
      var rotRad = Math.abs(p.rot) * Math.PI / 180;
      var swell = Math.round(curW * Math.sin(rotRad) / 2 + 2);   /* 倾斜外扩近似 */
      assert("side x-left", p.x - swell >= 8, w + "x" + h + " #" + i + " x=" + p.x + " rot=" + p.rot);
      assert("side x-right", p.x + curW + swell <= w - 8, w + "x" + h + " #" + i + " right=" + (p.x + curW + swell));
      assert("side y-top", p.y >= 90, w + "x" + h + " #" + i + " y=" + p.y);
      assert("side y-bottom", p.y + curH <= h - 20, w + "x" + h + " #" + i + " bottom=" + (p.y + curH) + " h=" + h);
      assert("side has-y", typeof p.y === "number" && isFinite(p.y), w + "x" + h + " #" + i);
    });
  });
});

/* 2) 竖列不压右上牌堆（仅 ≥700 高的常规桌面视口；更矮时接受兜底让位） */
[[1920, 1080], [1366, 768], [1024, 768], [1280, 800]].forEach(function (vp) {
  var pts = sidePoints(16, vp[0], vp[1]);
  pts.forEach(function (p, i) {
    if (p.side === "r") assert("side deck-clear", p.y >= 186, vp.join("x") + " right#" + i + " y=" + p.y);
  });
});

/* 2b) 极矮桌面窗（<700 高）：底边不越视口即可（顶部让位属于可接受妥协） */
[1024, 620].forEach(function (w) {
  var pts = sidePoints(16, w, 620);
  pts.forEach(function (p, i) {
    assert("side short y", p.y + curH <= 610, w + "x620 #" + i + " bottom=" + (p.y + curH));
  });
});

/* 3) 横链回退（<1024px）：带内居中 / 贴底都不越视口 */
var band = { top: 640, bottom: 745 };   /* 1080p 典型空隙带示例（900 视口） */
[[900, 700, null], [768, 900, { top: 560, bottom: 700 }], [390, 844, { top: 420, bottom: 560 }], [390, 844, null]].forEach(function (vp) {
  var pts = chainPoints(16, vp[0], vp[1], vp[2]);
  pts.forEach(function (p, i) {
    var rotRad = Math.abs(p.rot) * Math.PI / 180;
    var swell = Math.round(curW * Math.sin(rotRad) / 2 + 2);
    assert("chain x", p.x - swell >= -4 && p.x + curW + swell <= vp[0] + 4, vp[0] + "x" + vp[1] + " #" + i + " x=" + p.x);
    assert("chain y", p.y >= 0 && p.y + curH <= vp[1], vp[0] + "x" + vp[1] + " #" + i + " y=" + p.y + " ch=" + curH);
  });
});

/* 4) step 下限保护：极矮竖列不无限压缩 */
var pts = sidePoints(16, 1024, 500);
var right = pts.filter(function (p) { return p.side === "r"; });
var minGap = Infinity;
for (var i = 1; i < right.length; i++) minGap = Math.min(minGap, right[i].y - right[i - 1].y);
assert("side step-floor", minGap >= Math.round(116 * 0.5) - 1, "minGap=" + minGap);

/* 汇总 */
if (fails.length) {
  console.log("FAIL " + fails.length + " 项：");
  fails.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
} else {
  console.log("全部断言通过：宽屏竖列 5 档视口 x2 批次、右列避牌堆、横链 4 档视口、step 下限");
}
