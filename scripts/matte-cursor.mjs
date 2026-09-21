/**
 * matte-cursor.mjs —— 小怪物抠透明底（泛洪填充版）
 *
 * 为什么不用"白色全局替换"：眼白/高光也是浅色，全局替换会毁图。
 * 改用四角泛洪（flood fill）：只把与背景色【连通】的近白区域转透明，
 * 眼白被眼眶包围不与外部连通，天然安全；再对边缘做软 alpha 去白边。
 *
 * 输入：用户提供的原图（720px，浅灰白底）
 * 输出：demo/assets/cursor.png（48px 光标）+ demo/assets/mascot.png（720px 透明原图）
 * 用法：node scripts/matte-cursor.mjs "<原图路径>"
 */
import sharp from "sharp";
import fs from "fs";

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) {
  console.error("用法：node scripts/matte-cursor.mjs <原图路径>");
  process.exit(1);
}

const { data, info } = await sharp(SRC)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;

/* 背景色 = 四角 8x8 区域均值 */
function avgRect(x0, y0) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + 8; y++)
    for (let x = x0; x < x0 + 8; x++) {
      const i = (y * W + x) * C;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  return [r / n, g / n, b / n];
}
const corners = [avgRect(0, 0), avgRect(W - 8, 0), avgRect(0, H - 8), avgRect(W - 8, H - 8)];
const bg = [0, 1, 2].map(k => corners.reduce((s, c) => s + c[k], 0) / 4);
const dist2bg = i => {
  const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

/* ① 泛洪：从四角出发，连通的近背景区 → alpha 0 */
const T0 = 30; // 硬抠阈值
const visited = new Uint8Array(W * H);
const stack = new Int32Array(W * H);
let sp = 0;
const push = (x, y) => {
  const p = y * W + x;
  if (!visited[p] && dist2bg(p * C) < T0) { visited[p] = 1; stack[sp++] = p; }
};
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
while (sp > 0) {
  const p = stack[--sp];
  data[p * C + 3] = 0;
  const x = p % W, y = (p / W) | 0;
  if (x > 0) push(x - 1, y);
  if (x < W - 1) push(x + 1, y);
  if (y > 0) push(x, y - 1);
  if (y < H - 1) push(x, y + 1);
}

/* ② 边缘软化：与透明区相邻的不透明像素，按与背景距离给渐变 alpha（去白边） */
const T1 = T0, T2 = 70;
const alphaCopy = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) alphaCopy[p] = data[p * C + 3];
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (alphaCopy[p] === 0) continue;
    const nb = [];
    if (x > 0) nb.push(p - 1);
    if (x < W - 1) nb.push(p + 1);
    if (y > 0) nb.push(p - W);
    if (y < H - 1) nb.push(p + W);
    if (nb.some(q => alphaCopy[q] === 0)) {
      const d = dist2bg(p * C);
      if (d < T2) data[p * C + 3] = Math.max(0, Math.min(255, ((d - T1) / (T2 - T1)) * 255));
    }
  }

const cleaned = sharp(data, { raw: { width: W, height: H, channels: C } });

/* 手动算 alpha 包围盒（sharp trim 对残留边缘像素不稳，自己算完全可控） */
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (data[(y * W + x) * C + 3] > 8) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
const bw = maxX - minX + 1, bh = maxY - minY + 1;
const boxed = sharp(data, {
  raw: { width: W, height: H, channels: C },
}).extract({ left: minX, top: minY, width: bw, height: bh });

await cleaned.clone().png().toFile("demo/assets/mascot.png");
/* 光标图：bbox 裁掉透明留白让主体撑满画幅（48px 时怪物只占一半会糊成"黑眼圈"），
   64px 是现代桌面浏览器光标的稳妥上限，细节保留度好 */
await boxed.clone()
  .resize(48, 48, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile("demo/assets/cursor.png");
/* 光标图集第 2 张（水平翻转演示轮换机制；用户后续传图按清单追加） */
await boxed.clone()
  .flop()
  .resize(48, 48, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile("demo/assets/cursor-b.png");

/* 抠图质量统计 */
let transparent = 0;
for (let p = 0; p < W * H; p++) if (data[p * C + 3] === 0) transparent++;
console.log(`matte-cursor: ${W}x${H} → mascot.png(原尺寸) + cursor.png/cursor-b.png(48px, bbox ${bw}x${bh} @${minX},${minY})，透明占比 ${(transparent / (W * H) * 100).toFixed(1)}%`);
