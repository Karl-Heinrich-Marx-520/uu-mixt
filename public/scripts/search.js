/* ==========================================================================
   UU&Mixt · search.js —— 全站搜索（PRD 5.1）
   · 索引在进入本页时才拉取（构建期生成的 /search-index.json，只含已发布文章）
   · 中文按「整词 + 字符 bigram」切分 → 不需要空格分词也能命中子串
   · 权重：标题 > 摘要 > 标签 > 分类 > 正文；同分按日期倒序
   · 标签精确过滤：?tag=xxx 深链，或点标签云（等价于 #标签 语法）
   · 空输入 → 最近更新；无结果 → 建议标签
   ========================================================================== */
(function () {
  "use strict";

  var doc = document;
  var $ = function (s) { return doc.querySelector(s); };
  var input = $("#q");
  var metaEl = $("[data-search-meta]");
  var listEl = $("[data-search-results]");
  var tagCloud = $("[data-search-tags]");
  if (!input || !listEl) return;

  var state = { index: null, posts: [], q: "", tag: "", loading: false };
  var WEIGHT = { title: 10, description: 6, tag: 5, category: 4, text: 1 };
  var MAX_HITS_PER_TOKEN = 5;   /* 单个词在同一字段内最多计 5 次，防止长文霸榜 */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 切词 ---------- */
  function tokenize(q) {
    var out = [];
    String(q || "").toLowerCase().split(/[^0-9a-z\u4e00-\u9fa5]+/).forEach(function (part) {
      if (!part) return;
      if (!/[\u4e00-\u9fa5]/.test(part)) { out.push(part); return; }
      out.push(part);                                       /* 整词（连续中文） */
      for (var i = 0; i < part.length - 1; i++) out.push(part.slice(i, i + 2));  /* bigram */
    });
    var seen = {};
    return out.filter(function (t) { return seen[t] ? false : (seen[t] = 1); });
  }

  function countHits(hay, token) {
    if (!hay) return 0;
    var lower = hay.toLowerCase(), idx = 0, n = 0;
    while (n < MAX_HITS_PER_TOKEN && (idx = lower.indexOf(token, idx)) !== -1) { n++; idx += token.length; }
    return n;
  }

  /* ---------- 打分 ---------- */
  function score(post, tokens) {
    if (!tokens.length) return { matched: 0, score: 0 };
    var matched = 0, total = 0;
    tokens.forEach(function (t) {
      var s = WEIGHT.title * countHits(post.title, t) +
        WEIGHT.description * countHits(post.description, t) +
        WEIGHT.tag * countHits((post.tags || []).join(" "), t) +
        WEIGHT.category * countHits(post.category, t) +
        WEIGHT.text * countHits(post.text, t);
      if (s > 0) matched++;
      total += s;
    });
    /* 整串短语出现的额外加权（标题里出现最优） */
    var phrase = tokens.length ? tokens[0] : "";
    return { matched: matched, score: total, phrase: phrase };
  }

  function search(q, tag) {
    var tokens = tokenize(q);
    var pool = state.posts.filter(function (p) {
      if (!tag) return true;
      return (p.tags || []).some(function (t) { return String(t).toLowerCase() === tag.toLowerCase(); });
    });
    if (!tokens.length) {
      return pool.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    }
    var need = Math.max(1, Math.ceil(tokens.length * 0.5));
    return pool.map(function (p) {
      var r = score(p, tokens);
      return { p: p, matched: r.matched, score: r.score };
    }).filter(function (r) { return r.matched >= need; })
      .sort(function (a, b) {
        if (b.matched !== a.matched) return b.matched - a.matched;
        if (b.score !== a.score) return b.score - a.score;
        return b.p.date.localeCompare(a.p.date);
      })
      .map(function (r) { return r.p; });
  }

  /* ---------- 高亮（合并重叠区间，避免嵌套 mark） ---------- */
  function highlight(text, tokens) {
    if (!tokens.length) return esc(text);
    var lower = String(text).toLowerCase(), ranges = [];
    tokens.forEach(function (t) {
      var idx = 0;
      while ((idx = lower.indexOf(t, idx)) !== -1) {
        ranges.push([idx, idx + t.length]);
        idx += t.length;
      }
    });
    if (!ranges.length) return esc(text);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    var out = "", pos = 0;
    merged.forEach(function (r) {
      out += esc(text.slice(pos, r[0])) + "<mark>" + esc(text.slice(r[0], r[1])) + "</mark>";
      pos = r[1];
    });
    return out + esc(text.slice(pos));
  }

  /** 正文摘要片段（标题与摘要都没命中时用），围绕首个命中词取上下文 */
  function snippet(post, tokens) {
    var text = post.text || "";
    if (!text) return "";
    var tokens2 = tokens.filter(function (t) { return t.length > 1; });
    var pick = tokens2.length ? tokens2 : tokens;
    var at = -1;
    for (var i = 0; i < pick.length && at === -1; i++) at = text.toLowerCase().indexOf(pick[i]);
    if (at === -1) return text.slice(0, 110) + (text.length > 110 ? "…" : "");
    var start = Math.max(0, at - 40), end = Math.min(text.length, at + 90);
    return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  }

  /* ---------- 渲染 ---------- */
  function itemHTML(p, tokens, opts) {
    var tags = (p.tags || []).slice(0, 3).map(function (t) {
      return '<span class="chip chip--link" data-tag="' + esc(String(t).toLowerCase()) + '">' + esc(t) + "</span>";
    }).join("");
    var body = "";
    if (tokens && tokens.length) {
      var t = highlight(p.title, tokens), d = highlight(p.description, tokens);
      var dm = /<mark>/.test(d);
      body = '<h3>' + t + "</h3><p>" + (dm ? d : esc(p.description)) + "</p>";
      if (!/<mark>/.test(t) && !dm) {
        var sn = snippet(p, tokens);
        if (sn) body += '<p class="result-snippet">' + highlight(sn, tokens) + "</p>";
      }
    } else {
      body = "<h3>" + esc(p.title) + "</h3><p>" + esc(p.description) + "</p>";
    }
    var pin = p.featured ? '<span class="result-pin">置顶</span>' : "";
    var cat = p.category ? '<span class="chip chip--cat">' + esc(p.category) + "</span>" : "";
    return '<a class="result-item" data-face="' + p.face + '" href="' + esc(p.url) + '">' +
      '<span class="result-top">' +
        '<span class="result-author" data-face="' + p.face + '">' + esc(p.author) + "</span>" +
        "<time datetime=\"" + esc(p.date) + '">' + esc(p.date) + "</time>" +
        (p.category ? "<span>" + cat + "</span>" : "") +
        pin +
      "</span>" +
      body +
      (tags ? '<span class="chip-row">' + tags + "</span>" : "") +
      "</a>";
  }

  function renderTagCloud() {
    if (!tagCloud || !state.index) return;
    var list = state.index.tags.slice(0, 16);
    tagCloud.innerHTML = list.map(function (t) {
      var active = state.tag && state.tag === t.name.toLowerCase();
      return '<a href="#" data-tag="' + esc(t.name.toLowerCase()) + '"' +
        (active ? ' class="is-active"' : "") + ">" + esc(t.name) + " <b>" + t.count + "</b></a>";
    }).join("");
  }

  function render() {
    if (!state.index) return;
    var tokens = tokenize(state.q);
    var found = search(state.q, state.tag);
    var total = state.index.count;
    var bits = ["索引覆盖 " + total + " 篇已发布文章（两面）"];
    if (state.tag) bits.push("标签筛选：" + state.tag + "（结果 " + found.length + " 篇）");
    else if (state.q) bits.push("命中 " + found.length + " 篇");
    else bits.push("下面是最近更新的 " + Math.min(6, found.length) + " 篇");
    metaEl.textContent = bits.join(" · ");

    if (!found.length) {
      var sugg = state.index.tags.slice(0, 8).map(function (t) {
        return '<a href="#" data-tag="' + esc(t.name.toLowerCase()) + '">' + esc(t.name) + "</a>";
      }).join("");
      listEl.innerHTML = '<div class="empty-state search-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
        "<h2>没有匹配的文章</h2>" +
        "<p>换个关键词试试；也可以直接按标签浏览（标签全站共享，两面的文章都会列出并标出作者）：</p>" +
        '<div class="tag-cloud">' + sugg + "</div>" +
        "</div>";
      renderTagCloud();
      return;
    }

    var show = state.q || state.tag ? found : found.slice(0, 6);
    listEl.innerHTML = show.map(function (p) { return itemHTML(p, tokens, {}); }).join("");
    renderTagCloud();
  }

  /* ---------- URL 同步（便于分享搜索结果） ---------- */
  function syncURL() {
    var parts = [];
    if (state.q) parts.push("q=" + encodeURIComponent(state.q));
    if (state.tag) parts.push("tag=" + encodeURIComponent(state.tag));
    var url = "/search/" + (parts.length ? "?" + parts.join("&") : "");
    try { history.replaceState(null, "", url); } catch (e) {}
  }

  function apply(q, tag, sync) {
    state.q = q;
    if (typeof tag === "string") state.tag = tag;
    if (sync) syncURL();
    render();
  }

  /* ---------- 事件 ---------- */
  var timer = null;
  input.addEventListener("input", function () {
    var v = this.value.trim();
    clearTimeout(timer);
    timer = setTimeout(function () { apply(v, "", true); }, 110);   /* 防抖，保证输入响应 */
  });

  doc.addEventListener("click", function (e) {
    var el = e.target.closest("[data-tag]");
    if (!el) return;
    e.preventDefault();
    var tag = el.dataset.tag;
    var same = state.tag === tag;
    input.value = "";
    apply("", same ? "" : tag, true);
    if (!same) window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ---------- 启动：按需拉索引 ---------- */
  (async function init() {
    var params = new URLSearchParams(location.search);
    state.q = params.get("q") || "";
    state.tag = params.get("tag") || "";
    input.value = state.q;
    /* 桌面端进来就聚焦（搜索页只有一件事可做）；触屏不聚焦——软键盘会先弹出来
       盖住结果区，反而是干扰。*/
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (!coarse && !state.q) {
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    }
    try {
      var res = await fetch("/search-index.json");
      state.index = await res.json();
      state.posts = state.index.posts || [];
    } catch (err) {
      metaEl.textContent = "索引载入失败，请刷新重试。";
      return;
    }
    render();
  })();
})();
