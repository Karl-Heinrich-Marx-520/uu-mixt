/**
 * cursors.js —— 站点光标图集清单
 * 每点击一次，光标切换到清单中的下一张（vine.js 消费）。
 * 加新图：48px 图放进 public/（建议命名 cursor-<名>.png，绝对路径引用），
 * 在下面数组追加一行 {src, x, y}（x/y = 热点，点击点在图上的落点，一般取脸部中心）。
 */
window.UUM_CURSORS = [
  { src: "/cursor-orange.png", x: 24, y: 24 },
];
