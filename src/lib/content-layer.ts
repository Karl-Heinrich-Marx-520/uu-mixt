/**
 * 内容层（[内容管线]）—— demo-store.js 的正式替代
 * 接口语义与 Demo 一一对应（docs/04-技术方案.md §2.2 映射表）：
 *   published(face) / allPosts(face) / getPost(face, slug)
 *   categories(face) / categoryCount(face, name) / tags()
 * 差异：数据源从 localStorage 换成 Astro Content Collections（构建期读取），
 *       公开页面全部 SSR——浏览器不再需要下载内容层脚本。
 *
 * 交叉级校验（PRD 3.3，schema 级之外的）在 validateContent() 中执行，
 * 于模块加载时运行：任一页面导入本模块即触发，构建失败即拦截。
 * 规则（已与 Demo 语义对齐）：
 *   - 非草稿文章的 category 必须在本面分类配置中登记（草稿仅警告：
 *     Demo 的 Mixt 示例文章正是「文章带示例分类 + 本面分类为空」的形态）
 *   - slug 同面去重（草稿同样检查——slug 冲突无论状态都应尽早暴露）
 *   - author 必须与所在目录（面）一致
 *   - 站内死链：正文中的 /uu/… 与 /mixt/… 链接必须指向存在的路由（草稿跳过）
 *   - 相似标签警告（不阻断，PRD 3.6）
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import categoriesUU from '../config/categories-uu.json';
import categoriesMixt from '../config/categories-mixt.json';

export type Face = 'uu' | 'mixt';
export type Category = { slug: string; name: string; desc: string };
export type Post = CollectionEntry<'uu' | 'mixt'>;

const CATEGORY_CONFIG: Record<Face, Category[]> = {
  uu: categoriesUU as Category[],
  mixt: categoriesMixt as Category[],
};

/* ---------- 基础接口（语义 = demo-store.js） ---------- */

/** 已发布文章：草稿除外；置顶在前，其余按日期倒序（= demo 的 sortPosts） */
export async function published(face: Face): Promise<Post[]> {
  const all = await getCollection(face);
  return all
    .filter(({ data }) => !data.draft)
    .sort((a, b) => {
      if (!!b.data.featured !== !!a.data.featured) return b.data.featured ? 1 : -1;
      return +b.data.date - +a.data.date;
    });
}

/** 全部文章（含草稿；写作台用） */
export async function allPosts(face: Face): Promise<Post[]> {
  const all = await getCollection(face);
  return all.sort((a, b) => +b.data.date - +a.data.date);
}

/** 按 slug 取文章 */
export async function getPost(face: Face, slug: string): Promise<Post | undefined> {
  const all = await getCollection(face);
  return all.find(({ data }) => data.slug === slug);
}

/** 本面分类（配置文件驱动；空配置 = 空数组） */
export function categories(face: Face): Category[] {
  return CATEGORY_CONFIG[face];
}

/** 分类下已发布文章数 */
export async function categoryCount(face: Face, name: string): Promise<number> {
  const posts = await published(face);
  return posts.filter(({ data }) => data.category === name).length;
}

/** 共享标签池（PRD 3.6：全站共享） */
export async function tags(): Promise<{ name: string; count: number }[]> {
  const [uuPosts, mixtPosts] = await Promise.all([getCollection('uu'), getCollection('mixt')]);
  const pool = new Map<string, number>();
  for (const { data } of [...uuPosts, ...mixtPosts]) {
    if (data.draft) continue;
    for (const t of data.tags ?? []) pool.set(t, (pool.get(t) ?? 0) + 1);
  }
  return [...pool.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 本面标签（面首页统计用） */
export async function faceTags(face: Face): Promise<string[]> {
  const posts = await published(face);
  return [...new Set(posts.flatMap(({ data }) => data.tags ?? []))];
}

/* ---------- 交叉级校验（构建期，PRD 3.3） ---------- */

function fail(file: string, field: string, expected: string): never {
  throw new Error(
    `[内容校验失败] ${file} · 字段「${field}」不合法 · 期望：${expected}`
  );
}

function warn(msg: string): void {
  console.warn(`[内容校验警告] ${msg}`);
}

/** 正文中站内链接的目标 slug 集合（用于死链检测） */
function internalLinks(body: string): string[] {
  const out: string[] = [];
  const re = /\((\/(?:uu|mixt)\/posts\/([a-z0-9-]+)\/?)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

/**
 * 文件系统层扫描 slug 冲突（必须先于集合读取）
 * 为什么要这一步：Astro 的 glob loader 会把 frontmatter 的 slug 当作 entry id，
 * 两个文件同 slug 时**只发 WARN 并让后者覆盖前者**——集合里看不到冲突。
 * 因此重复 slug 必须在文件层拦截（验收项 3）。
 */
function scanSlugConflicts(face: Face, errors: string[]): Map<string, string> {
  const dir = join(process.cwd(), 'src', 'content', face);
  const slugToFile = new Map<string, string>();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return slugToFile;
  }
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    const m = raw.match(new RegExp("^slug:\\s*(.+)$", "m"));
    const slug = (m ? m[1].trim().replace(/^["']|["']$/g, "") : f.replace(/\.md$/, ''));
    const file = `src/content/${face}/${f}`;
    if (slugToFile.has(slug)) {
      errors.push(
        `[内容校验失败] ${file} · 字段「slug」冲突 · 「${slug}」已被 ${slugToFile.get(slug)} 使用 · 期望：同面内唯一（slug 一经发布即冻结，请为新文章换标题或手动改短名）`
      );
    } else {
      slugToFile.set(slug, file);
    }
    if (m && f.replace(/\.md$/, '') !== slug) {
      warn(`${file} · 文件名与 slug 不一致（文件名 ${f.replace(/\.md$/, '')} / slug ${slug}）—— 建议保持一致，便于定位文件`);
    }
  }
  return slugToFile;
}

export async function validateContent(): Promise<void> {
  const faces: Face[] = ['uu', 'mixt'];
  const errors: string[] = [];
  const allTags: string[] = [];

  /* 先做文件层 slug 冲突扫描（集合读取会静默覆盖，晚做就抓不到了） */
  for (const face of faces) scanSlugConflicts(face, errors);

  for (const face of faces) {
    const entries = await getCollection(face);
    const registered = CATEGORY_CONFIG[face].map((c) => c.name);
    const slugSeen = new Map<string, string>();

    if (entries.length === 0 && face === 'uu') {
      errors.push(`[内容校验失败] src/content/uu/ · 集合为空 · 期望：至少 1 篇文章（UU 面不应为空）`);
    }

    for (const entry of entries) {
      const file = `src/content/${face}/${entry.id}${entry.id.endsWith(".md") ? "" : ".md"}`;
      const d = entry.data;

      /* author 与目录一致 */
      if (d.author !== face) {
        errors.push(
          `[内容校验失败] ${file} · 字段「author」不合法 · 期望：${face}（与所在目录一致），实际：${d.author}`
        );
      }

      /* slug 同面去重（集合内；文件层冲突已在 scanSlugConflicts 中拦截） */
      if (slugSeen.has(d.slug)) {
        errors.push(
          `[内容校验失败] ${file} · 字段「slug」冲突 · 「${d.slug}」已被 ${slugSeen.get(d.slug)} 使用 · 期望：同面内唯一`
        );
      } else {
        slugSeen.set(d.slug, file);
      }

      /* 分类已登记：非草稿强制，草稿警告（Demo 的 Mixt 示例即此形态） */
      if (!registered.includes(d.category)) {
        const msg = `${file} · 字段「category」· 「${d.category}」未在本面分类配置中登记（已登记：${
          registered.join(' / ') || '（空）'
        }）`;
        if (d.draft) warn(`${msg} —— 草稿，放行`);
        else errors.push(`[内容校验失败] ${msg}`);
      }

      /* 站内死链（草稿跳过） */
      if (!d.draft) {
        for (const link of internalLinks(entry.body ?? '')) {
          const targetFace = link.startsWith('/uu/') ? 'uu' : 'mixt';
          const targetSlug = link.split('/posts/')[1]?.replace(/\/$/, '');
          const target = (await getCollection(targetFace as Face)).find(
            ({ data }) => data.slug === targetSlug && !data.draft
          );
          if (!target) {
            errors.push(
              `[内容校验失败] ${file} · 正文站内链接死链 · 「${link}」 · 期望：指向一篇已发布文章（目标不存在或为草稿）`
            );
          }
        }
      }

      if (!d.draft) allTags.push(...(d.tags ?? []));
    }
  }

  /* 相似标签警告（不阻断，PRD 3.6） */
  const uniq = [...new Set(allTags)];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i].toLowerCase();
      const b = uniq[j].toLowerCase();
      if (a !== b && (a.includes(b) || b.includes(a))) {
        warn(`标签「${uniq[i]}」与「${uniq[j]}」高度相似，建议合并（不阻断构建）`);
      }
    }
  }

  if (errors.length) {
    throw new Error(`\n${errors.join('\n')}\n`);
  }
}

/* 模块加载即校验：任何页面构建时导入本模块都会先跑校验，失败即构建失败 */
await validateContent();
