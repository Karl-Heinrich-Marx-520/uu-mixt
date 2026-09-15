#!/usr/bin/env node
/**
 * 分类改名 / 删除时的「同步文章分类字段」工具（[内容管线]）
 * 语义与 Demo 写作台的 updateCategory 一致：改分类名 → 该分类下文章的 category 同步更新。
 *
 * 用法：
 *   node scripts/rename-category.mjs <face> <oldName> <newName>      # 改名（同步文章）
 *   node scripts/rename-category.mjs <face> <oldName> --to-draft     # 清空分类并把文章转草稿（删除分类时用）
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [face, oldName, newName] = process.argv.slice(2);

if (!face || !oldName || !newName || !['uu', 'mixt'].includes(face)) {
  console.error(
    '用法：node scripts/rename-category.mjs <uu|mixt> <旧分类名> <新分类名|--to-draft>'
  );
  process.exit(1);
}

/* ① 分类配置 */
const cfgPath = join(root, 'src', 'config', `categories-${face}.json`);
const cats = JSON.parse(readFileSync(cfgPath, 'utf8'));
const hit = cats.find((c) => c.name === oldName);
if (!hit) {
  console.error(`分类「${oldName}」不在 ${face} 面配置中，已登记：${cats.map((c) => c.name).join(' / ') || '（空）'}`);
  process.exit(1);
}

if (newName === '--to-draft') {
  cats.splice(cats.indexOf(hit), 1);
} else {
  hit.name = newName;
}
writeFileSync(cfgPath, JSON.stringify(cats, null, 2) + '\n', 'utf8');
console.log(`[配置] ${face} 面分类「${oldName}」→ ${newName === '--to-draft' ? '（已删除）' : `「${newName}」`}`);

/* ② 该分类下文章的 frontmatter 同步 */
const dir = join(root, 'src', 'content', face);
let changed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  const path = join(dir, file);
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(/^category:\s*(.+)$/m);
  if (!m || m[1].trim() !== oldName) continue;
  let next = newName === '--to-draft'
    ? raw.replace(/^category:.*$/m, 'category: ""').replace(/^draft:\s*false$/m, 'draft: true')
    : raw.replace(/^category:.*$/m, `category: ${newName}`);
  writeFileSync(path, next, 'utf8');
  changed++;
  console.log(`[文章] ${face}/${file} · category → ${newName === '--to-draft' ? '"" + draft: true' : newName}`);
}
console.log(`完成：配置 1 处 + 文章 ${changed} 篇`);
