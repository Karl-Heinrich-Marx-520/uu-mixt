/**
 * feed.ts —— RSS 生成（PRD 5.4：全站合流 + 两面各自，共三份）
 * 只收录已发布文章（草稿绝不进 feed，与构建产物同一套过滤）。
 */
import rss from '@astrojs/rss';
import { published, type Face } from './content-layer';

export type FeedScope = Face | 'all';

export async function buildFeed(opts: {
  scope: FeedScope;
  title: string;
  description: string;
}) {
  const faces: Face[] = opts.scope === 'all' ? ['uu', 'mixt'] : [opts.scope];
  const items: {
    title: string;
    description: string;
    pubDate: Date;
    link: string;
    categories: string[];
    author: string;
  }[] = [];

  for (const face of faces) {
    for (const p of await published(face)) {
      items.push({
        title: p.data.title,
        description: p.data.description,
        pubDate: p.data.date,
        link: `/${face}/posts/${p.data.slug}/`,
        /* 分类与标签同名时会重复输出 <category>（线上实测：CVE、linux kernel pwn
           都各出现了两次）。RSS 阅读器里看着像脏数据，这里去重并保持顺序。 */
        categories: [...new Set([p.data.category ?? '', ...(p.data.tags ?? [])].filter(Boolean))],
        author: face === 'uu' ? 'UU' : 'Mixt',
      });
    }
  }

  items.sort((a, b) => +b.pubDate - +a.pubDate);

  return rss({
    title: opts.title,
    description: opts.description,
    site: import.meta.env.SITE,
    items,
    customData: '<language>zh-CN</language>',
  });
}
