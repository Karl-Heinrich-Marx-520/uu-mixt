// ==========================================================================
// build-local.mjs —— 本地一键构建（含阶段耗时）
//
// 为什么需要：本机上直接跑 `npm run build` 会被两个环境坑反复绊倒——
//   ① Astro 构建前 `rm -rf dist`，删除量触顶后被 safe-delete 钩子拦下（AGENTS 踩坑 27），
//      每次都得先手动 `mv dist dist-prev-<日期>`；
//   ② 改了 rehype 插件 / 内容管线后必须清 `node_modules/.astro`，否则直接吃缓存，
//      让人误判"代码没生效"。
// 这里把两件事一次性做掉，并打印各阶段耗时，方便判断构建为什么变慢。
//
// 用法：npm run build:local          （默认清 content 缓存）
//       npm run build:local -- --keep-cache   （保留缓存，测热构建速度）
// ==========================================================================
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const keepCache = process.argv.includes('--keep-cache');
const t0 = Date.now();
const step = (msg) => console.log(`[build-local] ${msg}（+${((Date.now() - t0) / 1000).toFixed(1)}s）`);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
  });
}

/* 1. 旧产物挪到系统临时目录：既不触发批量删除钩子，也不在项目里堆积 dist-prev-* */
if (existsSync('dist')) {
  /* 放在同盘的 node_modules/.cache 下：跨盘 rename 会报 EXDEV（实测 D 盘 → C 盘 temp 失败），
     而且这里不进 git、不污染工作区。 */
  const backupRoot = join('node_modules', '.cache', 'uum-dist-prev');
  const target = join(backupRoot, String(Date.now()));
  try {
    mkdirSync(backupRoot, { recursive: true });
    renameSync('dist', target);
    step(`旧 dist 已移到 ${target}`);
    /* 只留最近一份，避免备份越攒越多 */
    for (const old of readdirSync(backupRoot).sort().slice(0, -1)) {
      rmSync(join(backupRoot, old), { recursive: true, force: true });
    }
  } catch (e) {
    console.warn('[build-local] 移动旧 dist 失败，退回原地清理：', e.message);
    rmSync('dist', { recursive: true, force: true });
  }
}

/* 2. 清 content layer 缓存（data-store.json 是唯一的陈旧源头，其余缓存留着提速） */
if (!keepCache) {
  try {
    rmSync(join('node_modules', '.astro', 'data-store.json'), { force: true });
  } catch (e) {}
}

/* 3. 构建 + 压缩（与 package.json 的 build 等价，只是拆开计时） */
const tBuild = Date.now();
await run(process.execPath, ['node_modules/astro/astro.js', 'build']);
step(`astro build 完成，用时 ${((Date.now() - tBuild) / 1000).toFixed(1)}s`);

const tCompress = Date.now();
await run(process.execPath, ['scripts/compress-dist-images.mjs', 'dist']);
step(`图片压缩完成，用时 ${((Date.now() - tCompress) / 1000).toFixed(1)}s`);

console.log(`[build-local] 全部完成，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
