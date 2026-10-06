// ==========================================================================
// selftest-article.mjs —— 文章页脚本的回归自测（2026-10-07）
//
// 为什么需要：article.js 原先是 245 行一个 IIFE，混着分享 / 代码块 / 目录 / 拖宽
//   四个职责。2026-10-07 把它拆成 article-share / article-code / article-view 三个
//   脚本，并把重复的 execCommand 降级收归 core.js 的 window.uumCopyText。
//   "只是搬家"最容易在搬家时丢东西，所以这里用最小 DOM 桩把代码块与目录两段逻辑
//   真跑一遍：包装结构、按钮注入、折叠、目录高亮。
// 用法：node scripts/selftest-article.mjs
// ==========================================================================
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 极简元素：够 article-*.js 用的那几个 DOM API */
function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag,
    children,
    attrs,
    dataset: attrs.dataset || {},
    style: { setProperty() {}, removeProperty() {} },
    classList: new Set((attrs.class || '').split(' ').filter(Boolean)),
    listeners: {},
    _html: attrs.innerHTML || '',
  };
  children.forEach((c) => { c.parentNode = node; });
  node.id = attrs.id || '';   /* article-view.js 会读 heading.id 反查目录项 */
  /* Set 自带 add/has/delete，这里只补 DOM 的 toggle 语义 */
  node.classList.toggle = function (c, on) {
    const want = on === undefined ? !node.classList.has(c) : on;
    if (want) node.classList.add(c); else node.classList.delete(c);
    return want;
  };
  node.setAttribute = (k, v) => { node.attrs[k] = String(v); };
  node.getAttribute = (k) => (k in node.attrs ? node.attrs[k] : null);
  node.removeAttribute = (k) => { delete node.attrs[k]; };
  node.appendChild = (c) => { children.push(c); c.parentNode = node; return c; };
  node.insertBefore = (c, ref) => { children.splice(Math.max(0, children.indexOf(ref)), 0, c); c.parentNode = node; return c; };
  node.addEventListener = (t, h) => { (node.listeners[t] ||= []).push(h); };
  node.closest = function (sel) {
    const key = sel.replace(/^[.#\[]/, '').replace(/\].*$/, '');
    let n = node;
    while (n) {
      if (sel.startsWith('[') ? n.attrs[key.replace('data-', '').replace(/"/g, '')] === sel.split('="')[1]?.replace('"]', '') : (n._class || '').split(' ').includes(key)) return n;
      n = n.parentNode;
    }
    return null;
  };
  Object.defineProperty(node, 'className', {
    get: () => [...node.classList].join(' '),
    set: (v) => {
      node.classList.clear();
      String(v).split(' ').filter(Boolean).forEach((c) => node.classList.add(c));
      node._class = String(v);
    },
  });
  Object.defineProperty(node, 'firstChild', { get: () => children[0] || null });
  Object.defineProperty(node, 'innerHTML', { get: () => node._html, set: (v) => { node._html = v; } });
  /* 一律用 classList 判定：className 赋值也要能查到 */
  const match = (c, s) => (s.startsWith('.') ? c.classList.has(s.slice(1)) : c.tagName === s);
  node.querySelector = (s) => children.find((c) => match(c, s)) || null;
  node.querySelectorAll = (s) => children.filter((c) => match(c, s));
  node._class = attrs.class || '';
  return node;
}

function makeDoc() {
  const code = el('code');
  code.textContent = 'int main(){}';
  const pre = el('pre', { 'data-language': 'c' }, [code]);
  const prose = el('div', { class: 'prose' }, [pre]);

  const h2 = el('h2', { id: 'sec-a' });
  const h2b = el('h2', { id: 'sec-b' });
  const tocA = el('a', { href: '#sec-a' });
  const tocB = el('a', { href: '#sec-b' });
  const tocNav = el('nav', {}, [tocA, tocB]);
  const toc = el('aside', { class: 'toc' }, [tocNav]);

  const byId = { 'sec-a': h2, 'sec-b': h2b };
  const doc = {
    documentElement: { dataset: {} },
    body: el('body'),
    _byId: byId,
    getElementById: (id) => byId[id] || null,
    querySelector: (s) => {
      if (s === '.prose pre') return pre;
      if (s === '.article-page .page') return null;
      return null;
    },
    querySelectorAll: (s) => {
      if (s === '.prose pre') return [pre];
      if (s === '.code-block') return prose.children.filter((c) => (c._class || '').includes('code-block'));
      if (s === '.toc a') return [tocA, tocB];
      return [];
    },
    createElement: (t) => el(t),
    addEventListener: (t, h) => { (doc._l ||= {}), (doc._l[t] ||= []).push(h); },
  };
  return { doc, pre, prose, toc, tocA, tocB, byId };
}

function run(file, env, extra = {}) {
  const win = {
    scrollY: 0,
    innerHeight: 800,
    pageYOffset: 0,
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (fn) => { fn(); return 1; },
    addEventListener: (t, h) => { (win._l ||= {}), (win._l[t] ||= []).push(h); },
    uumCopyText: () => Promise.resolve(true),
    uumToast: () => {},
    ...extra,
  };
  const sandbox = {
    document: env.doc,
    window: win,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    localStorage: win.localStorage,
    console,
    setTimeout,
    Promise,
    /* 浏览器里 requestAnimationFrame / matchMedia / location 是全局的，桩也要给 */
    requestAnimationFrame: win.requestAnimationFrame,
    matchMedia: win.matchMedia,
    location: { href: 'https://uuandmixt.com/x/', origin: 'https://uuandmixt.com', pathname: '/x/' },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(file, 'utf8'), sandbox, { filename: file });
  return { win, sandbox };
}

console.log('文章页脚本回归自测：');

/* ---------- article-code.js ---------- */
{
  const env = makeDoc();
  const { win } = run('public/scripts/article-code.js', env);

  const blocks = env.doc.querySelectorAll('.code-block');
  check('pre 被包成 .code-block', blocks.length === 1);
  const head = blocks[0] && blocks[0].querySelector('.code-head');
  check('注入了 .code-head', !!head);
  check('head 带复制按钮', !!head && head.innerHTML.includes('data-action="copy-code"') === false
    ? [...head.children].some((c) => c.attrs['data-action'] === 'copy-code')
    : true);
  check('head 带折叠按钮', [...(head ? head.children : [])].some((c) => c.attrs['data-action'] === 'fold-code'));

  /* 折叠：点 fold-code 后加 is-collapsed，aria-expanded 翻转 */
  const fold = head.children.find((c) => c.attrs['data-action'] === 'fold-code');
  const clickHandlers = env.doc._l.click || [];
  clickHandlers.forEach((h) => h({ target: { closest: (s) => (s.includes('fold-code') ? fold : null) }, preventDefault() {} }));
  check('折叠后加 is-collapsed', blocks[0].classList.has('is-collapsed'));
  check('折叠后 aria-expanded=false', fold.attrs['aria-expanded'] === 'false');
}

/* ---------- article-view.js（目录高亮） ---------- */
{
  const env = makeDoc();
  /* 两个标题分别位于文档 100 与 1200 处 */
  env.byId['sec-a'].getBoundingClientRect = () => ({ top: 100 });
  env.byId['sec-b'].getBoundingClientRect = () => ({ top: 1200 });
  const { win } = run('public/scripts/article-view.js', env);

  check('初始高亮第一节', env.tocA.classList.has('active'));

  /* 滚到第二节之后（判定线 = scrollY + 25% 视口高） */
  win.scrollY = 1200;
  win.pageYOffset = 1200;
  (win._l.scroll || []).forEach((h) => h());
  check('滚动后高亮切到第二节', env.tocB.classList.has('active') && !env.tocA.classList.has('active'));

  /* 回到顶部应回到第一节 */
  win.scrollY = 0;
  win.pageYOffset = 0;
  (win._l.scroll || []).forEach((h) => h());
  check('回到顶部再高亮第一节', env.tocA.classList.has('active'));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
