// ==========================================================================
// rehype 插件：给 Markdown 里的表格套一层滚动容器（2026-10-06）
// 为什么需要：窄屏上宽表格会把整页撑出横向滚动条，常见做法是「table{display:block}」，
// 但那会**抹掉表格的语义**（AT 不再把它当 table 读，列对齐也丢）。
// 正确做法是把滚动条放在外层容器上，table 本身保持 display:table。
// 与 rehype-lazy-img 同款：零依赖、递归遍历 hast、失败即原样返回。
// ==========================================================================

export default function rehypeWrapTable() {
  function walk(node) {
    if (!node.children) return node;
    node.children = node.children.map((child) => {
      if (child.type === "element" && child.tagName === "table") {
        return {
          type: "element",
          tagName: "div",
          properties: {
            className: ["table-wrap"],
            tabindex: "0",
            role: "region",
            ariaLabel: "表格（窄屏可横向滚动）",
          },
          children: [child],
        };
      }
      return walk(child);
    });
    return node;
  }

  return (tree) => walk(tree);
}
