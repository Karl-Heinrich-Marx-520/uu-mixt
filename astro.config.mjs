import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// UU&Mixt · Astro 配置
// 说明：纯静态输出；无框架集成、无 SSR。
// markdown：Shiki 用 css-variables 主题 → 代码块配色由 article.css 的 CSS 变量接管
//           （与 demo 的双面主题色代码高亮一致）。
//           代码块的「头部 + 复制按钮」由 /scripts/article.js 运行时组装——
//           原因：Astro 的用户 rehype 插件在 Shiki 之前运行（拿不到行 span 与语言信息），
//           在插件里包装会被后续 Shiki 改写，故改到运行时做。
export default defineConfig({
  site: 'https://uuandmixt.com',
  trailingSlash: 'always',
  /* sitemap：只收录公开内容页。写作台（/admin/*）是管理入口，不进 sitemap 也不该被收录 */
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin/') && !page.endsWith('/404/'),
    }),
  ],
  build: {
    format: 'directory',
  },
  markdown: {
    shikiConfig: {
      theme: 'css-variables',
      // 保留 Shiki 的逐行 span（.line → 由 rehype 插件改名为 .cl，供行号 CSS 使用）
      wrap: true,
    },
  },
});
