// ==========================================================================
// selftest-flip.mjs —— 翻面交互的回归自测（2026-10-08）
//
// 为什么需要：翻面是 PRD 4.2 的核心交互（站内切换播动画、直接访问不播、后退反播），
//   但它和"只搬家不改语义"的改动挨得很近（flip.js 现在只在有 flipTo 的页面加载，
//   snap/13 才改的），没有任何自测兜底。这里用最小 DOM 桩把关键分支跑一遍。
// 注意：桩里用假定时器驱动 setTimeout（翻出动画后 700ms 才跳转）。
// 用法：node scripts/selftest-flip.mjs
// ==========================================================================
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

/** 建一套环境：flipTo 可指定，sessionStorage 可预置，定时器手动推进 */
function makeEnv({ flipTo = '', face = 'uu', session = {}, reduced = false, navType = 'navigate' } = {}) {
  const store = { ...session };
  const timers = [];
  const body = {
    dataset: { flipTo, face },
    classList: new Set(),
    listeners: {},
    appendChild() {},
    addEventListener(t, h) { (body.listeners[t] ||= []).push(h); },
    removeEventListener(t, h) {
      body.listeners[t] = (body.listeners[t] || []).filter((x) => x !== h);
    },
  };
  const doc = {
    documentElement: { classList: new Set() },
    body,
    addEventListener(t, h) { (doc._l ||= {}), (doc._l[t] ||= []).push(h); },
    createElement: () => ({ classList: new Set(), remove() {}, animate: () => ({ finished: Promise.resolve() }) }),
  };
  /* classList 用 Set 实现时：add/has/delete 自带，但要补 DOM 的 remove 与 toggle 别名 */
  doc.documentElement.classList.remove = (c) => doc.documentElement.classList.delete(c);
  doc.documentElement.classList.toggle = (c, on) => (on ? doc.documentElement.classList.add(c) : doc.documentElement.classList.delete(c));

  const win = {
    matchMedia: () => ({ matches: reduced }),
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    location: { href: 'https://uuandmixt.com/uu/' },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    requestAnimationFrame: (fn) => { fn(); return 1; },
    performance: { getEntriesByType: () => [{ type: navType }] },
    addEventListener() {},
  };
  return { doc, win, body, store, timers, run: (file) => {
    /* flip.js 用的是裸全局 sessionStorage（不是 window.sessionStorage），桩必须给全局，
       否则它会静默落进 try/catch——第一版就是这么误报了 5 项失败 */
    const sandbox = { document: doc, window: win, console, setTimeout: win.setTimeout,
      requestAnimationFrame: win.requestAnimationFrame, performance: win.performance, location: win.location,
      sessionStorage: win.sessionStorage };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(file, 'utf8'), sandbox, { filename: file });
  } };
}

const FILE = 'public/scripts/flip.js';
console.log('翻面交互回归自测：');

/* 1. 有 flipTo：点翻面按钮 → 播翻出动画并（700ms 后）跳转 */
{
  const env = makeEnv({ flipTo: '/mixt/' });
  env.run(FILE);
  const btn = { closest: (s) => (s === '[data-action="flip"]' ? {} : null) };
  (env.doc._l.click || []).forEach((h) => h({ target: btn, preventDefault() {} }));
  check('触发翻出：body 加 flip-out', env.body.classList.has('flip-out'));
  check('翻出时写入 sessionStorage 标记', env.store['uum-flip-in'] === '1');
  check('安排了 700ms 后的跳转', env.timers.some((t) => t.ms === 700));
  env.timers.filter((t) => t.ms === 700).forEach((t) => t.fn());
  check('动画结束后跳到目标面', env.win.location.href === '/mixt/', env.win.location.href);
}

/* 2. 共享页（无 flipTo）：不该有翻出行为 */
{
  const env = makeEnv({ flipTo: '' });
  env.run(FILE);
  (env.doc._l.click || []).forEach((h) => h({ target: { closest: () => ({}) }, preventDefault() {} }));
  check('无 flipTo 时不翻也不跳', !env.body.classList.has('flip-out') && env.timers.length === 0);
}

/* 3. reduced-motion：直接跳转，不播动画 */
{
  const env = makeEnv({ flipTo: '/mixt/', reduced: true });
  env.run(FILE);
  (env.doc._l.click || []).forEach((h) => h({ target: { closest: () => ({}) }, preventDefault() {} }));
  check('reduced-motion 下立即跳转', env.win.location.href === '/mixt/' && !env.body.classList.has('flip-out'));
}

/* 4. 到达页：sessionStorage 有标记 → 播翻入并清掉标记（只播一次） */
{
  const env = makeEnv({ flipTo: '/mixt/', session: { 'uum-flip-in': '1' } });
  env.run(FILE);
  check('有标记时播翻入', env.body.classList.has('flip-in'));
  check('翻入后清掉标记（不会重复播）', env.store['uum-flip-in'] === undefined);
}

/* 5. 后退/前进反播：navType=back_forward 且上一面不同 */
{
  const env = makeEnv({ face: 'mixt', session: { 'uum-last-face': 'uu' }, navType: 'back_forward' });
  env.run(FILE);
  check('后退反播 flip-in-reverse', env.body.classList.has('flip-in-reverse'));
}

/* 6. 每次都记录当前面，供下次反播判定 */
{
  const env = makeEnv({ face: 'uu' });
  env.run(FILE);
  check('记录当前面', env.store['uum-last-face'] === 'uu');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
