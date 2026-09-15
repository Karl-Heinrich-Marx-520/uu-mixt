/**
 * search-index.json.ts —— 构建期生成的全站搜索索引（PRD 5.1）
 *
 * 为什么不用 Pagefind：本站在两个作者、十几篇文章的量级，自建索引可以
 *   ① 精确控制中文切词（前端按字符 bigram 匹配，不依赖空格分词）；
 *   ② 结果渲染完全复用 Demo 已验收的视觉（搜索框 / 结果条 / 作者标识）；
 *   ③ 不引入额外的构建后处理步骤与运行时包。
 * 索引只在进入 /search/ 时按需拉取（PRD 5.1「索引不在首屏加载」）。
 *
 * 安全边界：**只用 published()**，草稿绝不进索引（PRD 6.3 草稿泄露风险）。
 */
import type { APIRoute } from 'astro';
import { published, tags as allTags, type Face } from '../lib/content-layer';

const FACES: Face[] = ['uu', 'mixt'];

/** 正文 → 纯文本（搜索用）。去掉围栏代码块：代码里的符号噪音大、体积收益低。 */
function toPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 单篇正文收录上限：足够覆盖主题词，避免索引整体臃肿 */
const BODY_LIMIT = 4000;

export const GET: APIRoute = async () => {
  const posts: unknown[] = [];

  for (const face of FACES) {
    const list = await published(face);
    for (const p of list) {
      const d = p.data;
      posts.push({
        face,
        author: face === 'uu' ? 'UU' : 'Mixt',
        title: d.title,
        slug: d.slug,
        url: `/${face}/posts/${d.slug}/`,
        description: d.description,
        category: d.category ?? '',
        tags: d.tags ?? [],
        date: d.date.toISOString().slice(0, 10),
        featured: !!d.featured,
        text: toPlain(p.body ?? '').slice(0, BODY_LIMIT),
      });
    }
  }

  /* 相关性排序的兜底：日期倒序由前端做，这里只保证数据完整 */
  const tagList = await allTags();

  return new Response(
    JSON.stringify({
      generated: new Date().toISOString().slice(0, 10),
      count: posts.length,
      tags: tagList,
      posts,
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
};
