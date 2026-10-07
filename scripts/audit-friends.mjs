// ==========================================================================
// audit-friends.mjs —— 友链健康检查（只读，不改数据）
//
// 为什么需要：友链是入口页卡组的数据源（PRD E8），对方站点挂了/换域名/证书过期，
//   本站不会有任何报错，只会一直把读者送去一个打不开的地址。
//   2026-10-08 首次检查：4 条里 1 条连不上（wkiwiblog.cn）。
// 处置原则：**只报告，不改数据**——删不删、换不换是 UU 的决定（也可能是对方临时故障）。
//
// 用法：npm run audit:friends
// ==========================================================================
import { readFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync('src/data/friends.json', 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.friends || []);

async function probe(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'UU&Mixt-friend-check/1.0' },
    });
    return { ok: res.ok, code: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, code: 'ERR', ms: Date.now() - t0, err: e.name === 'TimeoutError' ? '超时' : e.message };
  }
}

console.log(`[audit-friends] 共 ${list.length} 条友链`);
const bad = [];
for (const f of list) {
  const url = f.url || '';
  const r = await probe(url);
  const flag = r.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${flag} ${String(r.code).padEnd(4)} ${String(r.ms).padStart(5)}ms  ${f.name || '(无名)'}  ${url}${r.err ? '  ← ' + r.err : ''}`);
  if (!r.ok) bad.push(f);
}
if (bad.length) {
  console.log(`[audit-friends] 不可达 ${bad.length} 条：${bad.map((f) => f.name).join('、')}`);
  console.log('[audit-friends] 脚本不代为修改——可能是对方临时故障，确认后再决定去留。');
} else {
  console.log('[audit-friends] 全部可达。');
}
process.exit(0);
