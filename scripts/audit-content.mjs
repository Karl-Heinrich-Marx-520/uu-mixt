// ==========================================================================
// audit-content.mjs —— 内容体检（只读，输出报告，不改动任何文件）
//
// 为什么需要：分享卡片（OG）的 description、站内标签入口、分类徽章都依赖 frontmatter
// 字段齐全。少一个 description，分享出去的卡片就没有摘要；少 tags，文章页就没有
// 标签入口（2026-10-07 才补上的路标）。这些缺失构建期不会报错，只会静默难看。
//
// 用法：npm run audit:content
// ==========================================================================
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FACES = ['uu', 'mixt'];

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: text.slice(m[0].length) };
}

const rows = [];
for (const face of FACES) {
  const dir = join('src', 'content', face);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const words = (body.match(/[一-龥]/g) || []).length + (body.match(/[A-Za-z]+/g) || []).length;
    rows.push({
      face,
      file: `${face}/${f}`,
      title: data.title || '(无标题)',
      draft: data.draft === 'true',
      hasDesc: !!data.description,
      hasTags: !!(data.tags && data.tags.replace(/[[\]]/g, '').trim()),
      hasCat: !!data.category,
      updated: !!data.updated,
      words,
      date: data.date || '(无日期)',
    });
  }
}

const pub = rows.filter((r) => !r.draft);
const miss = (fn) => pub.filter(fn);

console.log(`[audit-content] 共 ${rows.length} 篇（草稿 ${rows.length - pub.length} 篇，已发布 ${pub.length} 篇）`);

const groups = [
  ['缺 description（分享卡片没摘要）', miss((r) => !r.hasDesc)],
  ['缺 tags（文章页没有标签入口）', miss((r) => !r.hasTags)],
  ['缺 category', miss((r) => !r.hasCat)],
];
for (const [label, list] of groups) {
  if (!list.length) { console.log(`  · ${label}：无`); continue; }
  console.log(`  · ${label}：${list.length} 篇`);
  list.forEach((r) => console.log(`      - ${r.file} · ${r.title}`));
}

const words = pub.map((r) => r.words);
const total = words.reduce((a, b) => a + b, 0);
console.log(
  `[audit-content] 已发布正文合计约 ${(total / 1000).toFixed(1)}k 字，` +
    `中位 ${words.sort((a, b) => a - b)[Math.floor(words.length / 2)] ?? 0} 字，` +
    `最长 ${Math.max(...words, 0)} 字`
);
console.log(`[audit-content] 带 updated 字段（会显示"最后更新于"）：${pub.filter((r) => r.updated).length} 篇`);
process.exit(0);
