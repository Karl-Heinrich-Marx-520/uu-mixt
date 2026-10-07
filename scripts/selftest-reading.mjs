// ==========================================================================
// selftest-reading.mjs —— 阅读三件套的回归自测（2026-10-07）
//
// 为什么需要：reading.js 管着阅读进度条、图片点击放大、标题锚点三件事，都是"只搬家
//   不改语义"时最容易悄悄坏掉的交互（例如浮动层挂错父节点会被 body 的 transform 劫持，
//   见 AGENTS 踩坑 16）。本机没有可用浏览器时，这里用最小 DOM 桩把它们真跑一遍。
// 用法：node scripts/selftest-reading.mjs
// ==========================================================================
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag,
    children,
    attrs,
    dataset: attrs.dataset || {},
    style: { setProperty(k, v) { node.style[k] = v; } },
    classList: new Set((attrs.class || '').split(' ').filter(Boolean)),
    listeners: {},
    _html: '',
  };
  children.forEach((c) => { c.parentNode = node; });
  node.id = attrs.id || '';
  if (attrs.src) node.src = attrs.src;
  node.classList.toggle = function (c, on) {
    const want = on === undefined ? !node.classList.has(c) : on;
    if (want) node.classList.add(c); else node.classList.delete(c);
    return want;
  };
  node.setAttribute = (k, v) => { node.attrs[k] = String(v); };
  node.getAttribute = (k) => (k in node.attrs ? node.attrs[k] : null);
  node.appendChild = (c) => { children.push(c); c.parentNode = node; return c; };
  node.addEventListener = (t, h) => { (node.listeners[t] ||= []).push(h); };
  node.closest = () => null;
  Object.defineProperty(node, 'className', {
    get: () => [...node.classList].join(' '),
    set: (v) => { node.classList.clear(); String(v).split(' ').filter(Boolean).forEach((c) => node.classList.add(c)); },
  });
  Object.defineProperty(node, 'innerHTML', { get: () => node._html, set: (v) => { node._html = v; } });
  Object.defineProperty(node, 'textContent', { get: () => node._text || '', set: (v) => { node._text = v; } });
  return node;
}

/* 构造：正文里有 2 张图、2 个带 id 的 h2 */
const img1 = el('img', { src: '/images/a.png', alt: 'a' });
const img2 = el('img', { src: '/images/b.png', alt: 'b' });
const h2a = el('h2', { id: 'alpha' });
const h2b = el('h2', { id: 'beta' });
const prose = el('div', { class: 'prose' }, [img1, img2, h2a, h2b]);
prose.offsetHeight = 4000;
/* 模拟滚动：真实浏览器里滚动后 rect.top 会变成负值，桩不模拟这点的话
   进度条算出来恒为同一个值（第一版就在这里误报过一次） */
prose.getBoundingClientRect = () => ({ top: -win.pageYOffset, height: prose.offsetHeight });

const rootChildren = [];
const documentElement = {
  dataset: {},
  classList: new Set(),
  appendChild: (c) => { rootChildren.push(c); return c; },
};
/* 注意：别覆盖 classList.add（Set 自带），写成调用自己会无限递归。
   DOM 的 classList.remove 对应 Set 的 delete，这里补上别名。 */
documentElement.classList.remove = (c) => documentElement.classList.delete(c);
documentElement.classList.toggle = (c, on) => (on ? documentElement.classList.add(c) : documentElement.classList.delete(c));

const bySelector = {
  '.prose': prose,
  '.prose img': [img1, img2],
  '.prose h2[id], .prose h3[id]': [h2a, h2b],
  '.lightbox': () => rootChildren.find((c) => c.classList.has('lightbox')),
};
const doc = {
  documentElement,
  body: el('body'),
  querySelector: (s) => (s === '.prose' ? prose : null),
  querySelectorAll: (s) => bySelector[s] || [],
  createElement: (t) => el(t),
  addEventListener: (t, h) => { (doc._l ||= {}), (doc._l[t] ||= []).push(h); },
};

const win = {
  pageYOffset: 0,
  scrollY: 0,
  innerHeight: 800,
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame: (fn) => { fn(); return 1; },
  addEventListener: (t, h) => { (win._l ||= {}), (win._l[t] ||= []).push(h); },
  uumToast: () => {},
};

const sandbox = {
  document: doc,
  window: win,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  console,
  setTimeout,
  location: { origin: 'https://uuandmixt.com', pathname: '/x/' },
  history: { replaceState() {} },
  requestAnimationFrame: win.requestAnimationFrame,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync('public/scripts/reading.js', 'utf8'), sandbox, { filename: 'reading.js' });

console.log('阅读三件套回归自测：');

/* 1. 进度条：挂在 documentElement 上（踩坑 16），且随滚动推进 */
const barWrap = rootChildren.find((c) => c.classList && c.classList.has('read-progress'));
check('进度条已创建', !!barWrap);
check('进度条挂在 documentElement（不是 body）', !!barWrap && barWrap.parentNode === undefined);
const bar = barWrap && barWrap.children[0];
win.pageYOffset = 0;
win.scrollY = 0;
(win._l.scroll || []).forEach((h) => h());
const w0 = bar ? bar.style.width : '';
win.pageYOffset = 3000;
win.scrollY = 3000;
(win._l.scroll || []).forEach((h) => h());
const w1 = bar ? bar.style.width : '';
check('滚动后进度条宽度增加', parseFloat(w1) > parseFloat(w0 || '0'), `${w0} -> ${w1}`);

/* 2. 图片放大：点第一张 → 打开；→ 切第二张；Esc 关闭 */
const lightbox = rootChildren.find((c) => c.classList.has('lightbox'));
check('lightbox 已创建且默认隐藏', !!lightbox && lightbox.hidden === true);
(img1.listeners.click || []).forEach((h) => h());
check('点图片后打开', lightbox.hidden === false);
const lbImg = lightbox.children[0];
check('打开的是被点的那张', lbImg.src === '/images/a.png', lbImg.src);
(doc._l.keydown || []).forEach((h) => h({ key: 'ArrowRight' }));
check('→ 切到第二张', lbImg.src === '/images/b.png', lbImg.src);
(doc._l.keydown || []).forEach((h) => h({ key: 'Escape' }));
check('Esc 关闭', lightbox.hidden === true);
check('关闭时移除 html.lb-open', !documentElement.classList.has('lb-open'));

/* 3. 标题锚点：每个带 id 的标题后面补一个 # 链接 */
check('标题注入了锚点链接', h2a.children.length === 1 && h2a.children[0].className === 'anchor');
check('第二个标题同样注入', h2b.children.length === 1);

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
