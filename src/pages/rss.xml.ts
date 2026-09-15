/** 全站合流 feed（PRD 5.4）：/rss.xml */
import type { APIRoute } from 'astro';
import { buildFeed } from '../lib/feed';

export const GET: APIRoute = () =>
  buildFeed({
    scope: 'all',
    title: 'UU&Mixt · 全部文章（两面合流）',
    description: '双作者双面技术博客：UU 的 C++ 后端与网络编程，Mixt 的 PWN 与二进制安全。',
  });
