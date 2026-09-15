#!/usr/bin/env node
/**
 * 交付自检：逐路由核对「面身份」与关键要素（[内容管线] / 自测脚本）
 *
 * 为什么需要：镜像页面时最容易漏改 face / flipTo 这类身份字段，
 * 一旦漏改，某一面会静默使用另一面的背景与主题色（肉眼容易被"看起来像"骗过）。
 * 本脚本对构建产物逐页断言 data-face 与关键结构，失败即非零退出。
 *
 * 用法：node scripts/check-pages.mjs   （需先执行构建）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
if (!existsSync(DIST)) {
  console.error('未找到 dist/ —— 请先执行构建');
  process.exit(1);
}

/** 收集所有 index.html */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'index.html') out.push(p);
  }
  return out;
}

const pages = walk(DIST).sort();
let fail = 0;
const rows = [];
const broken = new Map();   /* 目标 → 引用它的页面 */

/** 站内链接是否存在（页面 / 资源） */
function targetExists(href) {
  /* 浏览器会把 URL 编码解码后再找文件，这里对齐同一语义（中文标签目录） */
  let clean = href.split('#')[0].split('?')[0];
  try { clean = decodeURIComponent(clean); } catch (e) {}
  if (!clean || clean === '/' ) return existsSync(join(DIST, 'index.html'));
  const p = join(DIST, clean.replace(/^\//, ''));
  return existsSync(p) || existsSync(join(p, 'index.html')) || existsSync(p + '.html');
}

for (const file of pages) {
  const route = ('/' + relative(DIST, file).replace(/index\.html$/, '')).replace(/\\/g, '/');
  const html = readFileSync(file, 'utf8');
  const bodyFace = (html.match(/<body[^>]*data-face="([^"]+)"/) || [])[1] || '(缺失)';

  /* 期望的面：由路由前缀推导 */
  let expect = 'shared';
  if (/^\/uu\//.test(route)) expect = 'uu';
  else if (/^\/mixt\//.test(route)) expect = 'mixt';

  const issues = [];
  if (bodyFace !== expect) issues.push(`data-face=${bodyFace}（期望 ${expect}）`);

  /* 空白页断言：产物必须真的渲染出内容。
     为什么需要：search.astro 曾把头部的 frontmatter 定界符写成「<!---」（多一个 !），
     Astro 于是把它当作普通文本，整份源码被浏览器当成未闭合注释吞掉 ——
     页面构建"成功"、路由也存在，但打开是空白。这类失败不会被任何结构断言发现。 */
  /* 用「可见文本量」而不是字节数判断：写作台登录页本身就只有 3.7KB，
     但它有实打实的文字；真正空白的页面可见文本接近 0。 */
  const bodyInner = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1];
  const visibleText = bodyInner.replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  /* 阈值取 80：标签详情页（约 215 字符）与搜索页（结果由 JS 注入）本身就短，
     真正的空白页可见文本接近 0，两者量级差一个数量级，不会误伤。 */
  if (visibleText.length < 80) issues.push(`可见文本仅 ${visibleText.length} 字符（疑似空白页）`);
  if (!/<body[^>]*>/.test(html) || !/<main[\s>]/.test(html)) issues.push('缺少 main 主体（疑似空白页）');
  if (/<!---/.test(html)) issues.push('产物里残留「<!---」（frontmatter 定界符写错）');

  /* 关键结构断言 */
  const need = {
    '首页/归档/分类/标签/作者/文章': /^\/(uu|mixt)\//,
  };
  if (need['首页/归档/分类/标签/作者/文章'].test(route) && !/page-card/.test(html)) {
    issues.push('缺 .page-card（翻面动画容器）');
  }
  /* 面页必须有 background 变量引用（面视觉） */
  if (expect !== 'shared' && /^\/(uu|mixt)\/$/.test(route)) {
    if (!/hero-bg/.test(html)) issues.push('面首页缺 .hero-bg');
    if (!/class="page-bg"/.test(html)) issues.push('面首页缺 .page-bg（常驻虚化）');
  }
  /* 入口页必须有翻牌舞台与卡片 */
  if (route === '/') {
    if (!/class="stage"/.test(html)) issues.push('入口页缺 .stage');
    const cards = (html.match(/class="entry-card entry-card--/g) || []).length;
    if (cards !== 2) issues.push(`入口页卡片数=${cards}（期望 2）`);
  }
  /* 两面隔离：面内页面不得出现另一面的文章链接。
     豁免：标签页（PRD 3.6 标签池全站共享 + 4.4「该标签下列出跨两面的文章、每条标识作者」）
     与文章页的跨面引用（PRD 4.4 允许显式标注的跨面引用）。 */
  const isTagPage = /^\/(uu|mixt)\/tags\//.test(route);
  if (!isTagPage) {
    if (expect === 'uu' && /href="\/mixt\/posts\//.test(html)) issues.push('UU 页面出现指向 Mixt 文章的链接（两面隔离）');
    if (expect === 'mixt' && /href="\/uu\/posts\//.test(html)) issues.push('Mixt 页面出现指向 UU 文章的链接（两面隔离）');
  } else if (!/class="result-author" data-face=/.test(html)) {
    issues.push('标签页缺少作者标识（PRD 4.4 要求每条结果标识作者）');
  }

  /* 站内死链：正文/导航/页脚里的所有 /xxx 链接都必须能在构建产物中找到 */
  const hrefs = [...html.matchAll(/href="(\/[^"#][^"]*)"/g)].map((m) => m[1]);
  for (const h of [...new Set(hrefs)]) {
    if (!targetExists(h)) {
      issues.push(`死链 ${h}`);
      if (!broken.has(h)) broken.set(h, route);
    }
  }

  if (issues.length) fail++;
  rows.push([route, bodyFace, issues.length ? issues.join(' · ') : 'ok']);
}

const w = Math.max(...rows.map((r) => r[0].length), 6);
console.log(`${'路由'.padEnd(w)}  ${'data-face'.padEnd(8)}  状态`);
console.log('-'.repeat(w + 20));
for (const [route, face, st] of rows) {
  console.log(`${route.padEnd(w)}  ${face.padEnd(8)}  ${st}`);
}
/* ---------- 交付件断言（PRD 5.1 / 5.4 / 部署收录） ---------- */
const artifacts = [
  ['dist/rss.xml', 'RSS 全站合流'],
  ['dist/uu/rss.xml', 'RSS UU 面'],
  ['dist/mixt/rss.xml', 'RSS Mixt 面'],
  ['dist/sitemap-index.xml', 'sitemap'],
  ['dist/robots.txt', 'robots.txt'],
  ['dist/search-index.json', '搜索索引'],
];
const artifactIssues = [];
for (const [f, label] of artifacts) {
  if (!existsSync(f)) artifactIssues.push(`缺 ${f}（${label}）`);
}
if (existsSync('dist/sitemap-0.xml')) {
  const sm = readFileSync('dist/sitemap-0.xml', 'utf8');
  if (/\/admin\//.test(sm)) artifactIssues.push('sitemap 含 /admin/（写作台不应被收录）');
}
if (existsSync('dist/search-index.json')) {
  const idx = readFileSync('dist/search-index.json', 'utf8');
  for (const slug of ['test-bad', 'test-dup']) {
    if (idx.includes(slug)) artifactIssues.push(`搜索索引含测试/草稿内容（${slug}）`);
  }
}

console.log(`\n共 ${rows.length} 页，问题页 ${fail} 个`);
console.log(artifactIssues.length ? `交付件问题：\n  - ${artifactIssues.join('\n  - ')}` : '交付件（RSS / sitemap / robots / 搜索索引）：齐全');
if (artifactIssues.length) fail++;
if (broken.size) {
  console.log('\n死链汇总（目标 ← 首次出现的页面）：');
  for (const [t, from] of broken) console.log(`  ${t}  ← ${from}`);
}
process.exit(fail ? 1 : 0);
