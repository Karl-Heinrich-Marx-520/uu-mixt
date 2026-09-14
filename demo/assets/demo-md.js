/* ==========================================================================
   UU&Mixt Demo · 极简 Markdown 渲染（文章详情页与写作台预览共用）
   支持：h2/h3（自动生成 id 供目录用）、段落、有序/无序列表、引用、围栏代码块、
        行内 code / 粗体 / 斜体 / 链接、分割线
   说明：Demo 用的最小实现；正式实现由 Astro 的 Markdown 管线负责。
   对外暴露：window.UUMMD.render(markdownText)
   ========================================================================== */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function slugId(text) {
    var s = String(text).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "");
    return s || "sec";
  }

      /* 极简 Markdown → HTML（Demo 用：标题/段落/列表/引用/代码块/行内样式/分割线） */
  function md(src) {
    var lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
    var out = [], i = 0, usedIds = {};
    function inline(t) {
      return esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    }
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var lang = line.replace(/^```/, "").trim();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push('<div class="code-block"><div class="code-head"><span>' + esc(lang || "code") +
          '</span></div><pre><code>' + esc(buf.join("\n")) + "</code></pre></div>");
        continue;
      }
      var h = /^(#{2,3})\s+(.*)$/.exec(line);
      if (h) {
        var lvl = h[1].length;
        var id = slugId(h[2]), base = id, k = 2;
        while (usedIds[id]) { id = base + "-" + k++; }
        usedIds[id] = 1;
        out.push("<h" + lvl + ' id="' + id + '">' + inline(h[2]) + "</h" + lvl + ">");
        i++;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push("<li>" + inline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ul>" + items.join("") + "</ul>");
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        var oitems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          oitems.push("<li>" + inline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ol>" + oitems.join("") + "</ol>");
        continue;
      }
      if (/^>\s?/.test(line)) {
        var qbuf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          qbuf.push(inline(lines[i].replace(/^>\s?/, "")));
          i++;
        }
        out.push("<blockquote><p>" + qbuf.join("<br>") + "</p></blockquote>");
        continue;
      }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
      if (!line.trim()) { i++; continue; }
      var pbuf = [inline(line)];
      i++;
      while (i < lines.length && lines[i].trim() &&
             !/^(#{2,3}\s|```|>|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) {
        pbuf.push(inline(lines[i]));
        i++;
      }
      out.push("<p>" + pbuf.join(" ") + "</p>");
    }
    return out.join("\n");
  }

  window.UUMMD = { render: md, esc: esc, slugId: slugId };
})();
