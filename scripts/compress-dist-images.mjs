// ==========================================================================
// 构建后图片压缩（PRD 开放项 E6：产物体积超标时启用）
// 触发条件：dist 图片总体积 / 单图体积超 PRD「单图 ≤ 400KB」红线
// 语义：
//   · 只压缩 dist（产物），源图 public/ 保持原样——原图仍在 git 里，随时可重出
//   · 只在新体积更小且满足红线时才写回，绝不"越压越大"
//   · sharp 缺失（如干净环境未安装）时静默跳过并退出 0：压缩是优化不是门禁，
//     不能因为一个可选优化把整个构建判失败、进而保留旧站点（uum-rebuild 语义）
// 手动：node scripts/compress-dist-images.mjs [distDir]
// ==========================================================================
import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = process.argv[2] || 'dist';
/* 压缩结果缓存：每次构建把 40+ 张图全部重新解码/重编码，实测 5.2s 且随图片数线性
   增长（Mixt 每发一篇带截图的文章就更慢一点）。源图内容没变时直接复用上次结果。
   缓存在 node_modules/.cache 下（不在 dist 里，构建清 dist 不影响；也不在
   .astro 里，清 content 缓存不影响）。改压缩参数时把 CACHE_VERSION 加一即可全部失效。 */
const CACHE_VERSION = 'v1';
const CACHE_DIR = join('node_modules', '.cache', 'uum-img');
const MAX_WIDTH = 1600; // 超过则等比缩到该宽（PWN 截图多为 1920 宽终端图）
const TARGET = 400 * 1024; // PRD 单图红线
const EXTS = new Set(['.png', '.jpg', '.jpeg']);

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.warn('[compress-images] 未安装 sharp，跳过图片压缩（构建照常通过）');
  process.exit(0);
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // dist 里没有该目录（例如还没生成 images/）
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (EXTS.has(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

async function shrink(buf, ext) {
  // 逐档降质量/降宽度，第一档满足红线即返回；全档失败返回最小的一档
  const isPng = ext === '.png';
  let best = null;
  /* metadata 只解码一次：此前写在档位循环里，每张图最多重复解码 9 次 */
  const meta = await sharp(buf).metadata();
  for (const width of [MAX_WIDTH, 1280, 1000]) {
    for (const q of isPng ? [85, 70, 55] : [82, 72, 62]) {
      let pipe = sharp(buf, { animated: false }).rotate(); // rotate() 吃 EXIF 方向
      if (meta.width && meta.width > width) pipe = pipe.resize({ width, withoutEnlargement: true });
      const out = await (isPng
        ? pipe.png({ quality: q, compressionLevel: 9, palette: true })
        : pipe.jpeg({ quality: q, mozjpeg: true, progressive: true })
      ).toBuffer({ resolveWithObject: false });
      if (!best || out.length < best.length) best = out;
      if (out.length <= TARGET) return out;
    }
  }
  return best;
}

const files = await walk(DIST);
let before = 0;
let after = 0;
const rows = [];

const t0 = Date.now();
let cached = 0;

for (const f of files) {
  const src = await readFile(f);
  const ext = extname(f).toLowerCase();
  before += src.length;

  /* 缓存键 = 压缩参数版本 + 源图内容哈希：内容不变就直接复用上次的产物 */
  const cacheFile = join(
    CACHE_DIR,
    createHash('sha1').update(CACHE_VERSION).update(src).digest('hex') + ext
  );
  try {
    const hit = await readFile(cacheFile);
    if (hit.length) {
      await writeFile(f, hit);
      after += hit.length;
      cached++;
      rows.push({ f, a: src.length, b: hit.length });
      continue;
    }
  } catch (e) {}   /* 没有缓存或读不到，按未命中处理 */

  try {
    const out = await shrink(src, ext);
    if (out && out.length < src.length) {
      await writeFile(f, out);
      try {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cacheFile, out);
      } catch (e) {}   /* 缓存写失败不影响产物 */
      after += out.length;
      rows.push({ f, a: src.length, b: out.length });
      continue;
    }
  } catch (e) {
    console.warn('[compress-images] 跳过（处理失败）', f, e.message);
  }
  after += src.length;
}

const st = await stat(DIST).catch(() => null);
if (!st) {
  console.warn(`[compress-images] ${DIST} 不存在，跳过`);
  process.exit(0);
}

rows.sort((x, y) => y.a - y.a);
for (const r of rows.slice(0, 15)) {
  console.log(`  ${kb(r.a).padStart(7)} -> ${kb(r.b).padStart(7)}  ${r.f.replace(/\\/g, '/')}`);
}
const over = rows.filter((r) => r.b > TARGET);
console.log(
  `[compress-images] ${files.length} 张图：${kb(before)} -> ${kb(after)}` +
    `（省 ${(((before - after) / before) * 100).toFixed(0)}%）` +
    ` · 缓存命中 ${cached}/${files.length} · 耗时 ${Date.now() - t0}ms` +
    (over.length ? `；仍超 400KB 红线 ${over.length} 张：${over.map((r) => r.f).join(', ')}` : '；全部满足 ≤400KB')
);
process.exit(0);
