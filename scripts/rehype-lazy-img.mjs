/**
 * rehype-lazy-img —— 给 Markdown 正文图片补 loading/decoding
 *
 * 作用：Markdown 里的 ![](...) 渲染成 <img> 时默认不带任何加载策略，
 *       文章一打开就把全文图片一次性拉完（Mixt 的 PWN 文章一篇十几张截图）。
 *       这里统一补上 loading="lazy" + decoding="async"，让视口外的图按需加载。
 *
 * 为什么自己写而不用 unist-util-visit：保持依赖克制（本站前端依赖仅 astro + rss + sitemap），
 *       hast 树的递归遍历不到 20 行，没必要为一个遍历引入包。
 *
 * 注意：Astro 的用户 rehype 插件运行在 Shiki 之前（见 astro.config.mjs 注释），
 *      但这对 <img> 无影响——图片节点由 remark 的 mdast→hast 转换产出，早于 Shiki。
 */
export default function rehypeLazyImg() {
  return function transformer(tree) {
    walk(tree);
  };
}

function walk(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node.children)) node.children.forEach(walk);
  if (node.type !== "element" || node.tagName !== "img") return;

  node.properties = node.properties || {};
  /* 已有的显式声明优先（作者想要 eager 时不覆盖） */
  if (!("loading" in node.properties)) node.properties.loading = "lazy";
  if (!("decoding" in node.properties)) node.properties.decoding = "async";
}
