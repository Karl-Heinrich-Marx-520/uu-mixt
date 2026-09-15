/** Mixt 单面 feed（PRD 5.4）：/mixt/rss.xml（只含 Mixt 面的文章） */
import type { APIRoute } from 'astro';
import { buildFeed } from '../../lib/feed';

export const GET: APIRoute = () =>
  buildFeed({
    scope: 'mixt',
    title: 'UU&Mixt · Mixt 的一面',
    description: 'Mixt 的一面：PWN、二进制安全、漏洞分析与 CTF writeup。',
  });
