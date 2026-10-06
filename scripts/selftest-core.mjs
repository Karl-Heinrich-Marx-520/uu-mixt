// ==========================================================================
// selftest-core.mjs —— core.js 的回归自测（2026-10-07）
// 为什么需要：2026-10-06 发现「回到顶部」按钮从建成起就没露过面——
//   shell.css 里 .back-top 默认 opacity:0 + visibility:hidden，而全仓没有任何
//   代码添加过 .show 类。这类"写了但从未生效"的功能，构建和页面自检都抓不到。
//   这里用最小 DOM 桩把 core.js 跑起来，断言按钮的显隐与点击行为。
// 用法：node scripts/selftest-core.mjs   （不需要浏览器、不需要联网）
// ==========================================================================
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 最小 DOM 桩：只实现 core.js 真正用到的那几个 API */
function makeEnv() {
  const listeners = { doc: {}, win: {} };
  const cls = new Set();
  const btn = {
    dataset: { action: 'back-top' },
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)),
    },
    setAttribute() {},
    getAttribute() { return null; },
  };
  const el = () => ({ dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, style: {}, setAttribute() {}, appendChild() {}, remove() {} });

  const doc = {
    documentElement: { dataset: { mode: 'dark', defaultMode: 'dark', modeLock: '' }, classList: { add() {}, remove() {}, toggle() {} } },
    body: { dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, removeChild() {} },
    querySelector: (sel) => (sel.includes('back-top') ? btn : null),
    querySelectorAll: () => [],
    createElement: el,
    addEventListener: (t, h) => { (listeners.doc[t] ||= []).push(h); },
  };

  const win = {
    pageYOffset: 0,
    innerHeight: 800,
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (fn) => { fn(); return 1; },
    addEventListener: (t, h) => { (listeners.win[t] ||= []).push(h); },
    scrollTo: (opts) => { win.lastScrollTo = opts; },
    location: { origin: 'https://uuandmixt.com', pathname: '/x/' },
  };
  return { doc, win, btn, cls, listeners };
}

const env = makeEnv();
const sandbox = {
  document: env.doc,
  window: env.win,
  localStorage: env.win.localStorage,
  navigator: { clipboard: null },
  console,
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync('public/scripts/core.js', 'utf8'), sandbox, { filename: 'core.js' });

console.log('core.js 回归自测：');

/* 1. 默认态必须是不显示（踩坑 17：只验"打开态"会漏掉默认态的错误） */
check('初始未滚动时不显示', !env.btn.classList.contains('show'));

/* 2. 滚动超过约一屏后出现 */
env.win.pageYOffset = 1000;
(env.listeners.win.scroll || []).forEach((h) => h());
check('滚过一屏后显示', env.btn.classList.contains('show'));

/* 3. 回到顶部后再次隐藏 */
env.win.pageYOffset = 10;
(env.listeners.win.scroll || []).forEach((h) => h());
check('回到顶部后重新隐藏', !env.btn.classList.contains('show'));

/* 4. 点击按钮确实触发滚动到顶部 */
env.win.lastScrollTo = null;
const clickHandlers = env.listeners.doc.click || [];
/* 事件对象要给全：core.js 里还有别的 click 委托（copy-mail 等），
   它们的 closest 命中不到就自行 return，但 preventDefault 必须存在 */
clickHandlers.forEach((h) =>
  h({
    target: { closest: (sel) => (sel.includes('back-top') ? env.btn : null) },
    preventDefault() {},
    metaKey: false,
    ctrlKey: false,
  })
);
check('点击触发 scrollTo(0)', env.win.lastScrollTo && env.win.lastScrollTo.top === 0,
  JSON.stringify(env.win.lastScrollTo));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
