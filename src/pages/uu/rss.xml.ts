/** UU 单面 feed（PRD 5.4）：/uu/rss.xml（只含 UU 面的文章） */
import type { APIRoute } from 'astro';
import { buildFeed } from '../../lib/feed';

export const GET: APIRoute = () =>
  buildFeed({
    scope: 'uu',
    title: 'UU&Mixt · UU 的一面',
    description: 'UU 的一面：C++ 后端、网络编程、源码阅读、科研复现与工程实践。',
  });
