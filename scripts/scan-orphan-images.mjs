// ==========================================================================
// scan-orphan-images.mjs —— 孤儿图片体检（只报告，绝不删除）
//
// 为什么需要：写作台删文章、换图之后，`public/images/` 里的旧图会一直留着，
// 既占仓库也占产物（每次构建照样复制、照样压缩）。2026-10-07 首次扫描就发现
// 6 张未引用的图，约 890KB。
// 为什么不做成"自动删除"：图片可能被作者留作备用、或被脚本/草稿引用，误删不可逆。
// 这里只把清单打出来，删不删由人决定（符合"失败/浪费要可见，但破坏性操作交给人"）。
//
// 用法：node scripts/scan-orphan-images.mjs
// ==========================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const IMG_DIR = 'public/images';
const EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);
/* 引用来源：astro 模板 / md 正文 / 前端脚本（桌宠立绘就是 public/scripts/pet.js 引的，
   只扫 src 会把它误报成孤儿图） */
const SOURCE_DIRS = ['src', 'public/scripts', 'demo'];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/* 所有源码文本合成一个大串再找，比逐文件 grep 快得多（本项目源码量很小） */
/* 注意：别写成 flatMap(walk) —— flatMap 会把数组索引当第二个参数传进去 */
const sourceText = SOURCE_DIRS.flatMap((dir) => walk(dir))
  .filter((f) => /\.(astro|md|ts|js|json|css)$/.test(f))
  .map((f) => {
    try { return readFileSync(f, 'utf8'); } catch { return ''; }
  })
  .join('\n');

const images = walk(IMG_DIR).filter((f) => EXTS.has(extname(f).toLowerCase()));
const orphans = [];
let total = 0;
let orphanBytes = 0;

for (const f of images) {
  const url = '/' + f.replace(/^public[\\/]/, '').replace(/\\/g, '/');
  total += statSync(f).size;
  /* 用转义后的文件名比对：正文里写的是 URL 编码形式（如空格变 %20） */
  const candidates = [url, url.replace(/ /g, '%20'), encodeURI(url)];
  if (!candidates.some((u) => sourceText.includes(u))) {
    const size = statSync(f).size;
    orphanBytes += size;
    orphans.push({ url, size });
  }
}

const kb = (n) => (n / 1024).toFixed(0) + 'KB';
console.log(`[orphan-images] 图片 ${images.length} 张，共 ${kb(total)}`);
if (!orphans.length) {
  console.log('[orphan-images] 没有发现未被引用的图片。');
} else {
  console.log(`[orphan-images] 未被引用的图片 ${orphans.length} 张，共 ${kb(orphanBytes)}：`);
  orphans.sort((a, b) => b.size - a.size).forEach((o) => console.log(`  ${kb(o.size).padStart(7)}  ${o.url}`));
  console.log('[orphan-images] 确认无用后可手工删除（脚本不代劳：删除不可逆，且图可能被留作备用）。');
}
process.exit(0);
