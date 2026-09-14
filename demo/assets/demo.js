/* ==========================================================================
   UU&Mixt 前端 Demo · 交互脚本（零依赖，单文件）
   覆盖：明暗模式 · 翻面控件（按钮/Alt方向键/触屏滑动） · 入口页四状态动画
        · TOC 滚动追踪 · 复制链接/代码 · 归档筛选 · 回到顶部 · toast
   ========================================================================== */
(function () {
  "use strict";

  var doc = document;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 明暗模式 ---------- */
  var pageDefault = doc.documentElement.dataset.defaultMode || "light";
  var savedMode = pageDefault;
  try { savedMode = localStorage.getItem("uum-demo-mode") || pageDefault; } catch (e) {}
  doc.documentElement.dataset.mode = savedMode;

  function toggleMode() {
    var next = doc.documentElement.dataset.mode === "dark" ? "light" : "dark";
    doc.documentElement.dataset.mode = next;
    try { localStorage.setItem("uum-demo-mode", next); } catch (e) {}
  }

  /* ---------- toast ---------- */
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = doc.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  /* 暴露给工作台（admin.html）等页面的内联脚本使用 */
  window.uumToast = toast;

  /* ---------- 剪贴板（file:// 下降级 execCommand） ---------- */
  function copyText(text, okMsg) {
    function fallback() {
      var ta = doc.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      doc.body.appendChild(ta);
      ta.select();
      try { doc.execCommand("copy"); toast(okMsg); }
      catch (e) { toast("复制失败，请手动复制地址栏链接"); }
      doc.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () { toast(okMsg); },
        fallback
      );
    } else { fallback(); }
  }

  /* ---------- 翻面控件（面页面） ---------- */
  var flipTo = doc.body.dataset.flipTo;
  var leaving = false;

  /* FX（粒子/冲击波/高光）只在入口页加载，面页调用时做存在性保护 */
  function callFX(phase) {
    if (window.UUMFX && window.UUMFX.gloss) window.UUMFX.gloss(phase);
  }

  /* 翻入：从另一面跳转来时播放卡牌入场 + 高光后半程 */
  if (doc.documentElement.classList.contains("flip-in-pending")) {
    doc.documentElement.classList.remove("flip-in-pending");
    try { sessionStorage.removeItem("uum-flip-in"); } catch (e) {}
    doc.body.classList.add("flip-in");
    callFX("in");
    doc.body.addEventListener("animationend", function onFlipIn(e) {
      if (e.animationName === "card-flip-in") {
        doc.body.classList.remove("flip-in");
        doc.body.removeEventListener("animationend", onFlipIn);
      }
    });
  }

  function doFlip() {
    if (!flipTo || leaving) return;
    leaving = true;
    if (reducedMotion) { location.href = flipTo; return; }
    /* 卡牌式翻转：缓慢高光扫到中央 → 整页卡牌翻出 90° →
       跳转后另一面从 90° 翻入，背景与内容在 90° 瞬间同时切换 */
    try { sessionStorage.setItem("uum-flip-in", "1"); } catch (e) {}
    callFX("out");
    doc.body.classList.add("flip-out");
    setTimeout(function () { location.href = flipTo; }, 700);
  }

  /* 键盘 Alt + ←/→（PRD 4.2） */
  doc.addEventListener("keydown", function (e) {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      doFlip();
    }
  });

  /* 触屏横向滑动：位移 > 60px 且速度 > 0.3px/ms，方向角 > 30°（PRD 4.2） */
  if (flipTo && "ontouchstart" in window) {
    var ts = null;
    doc.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1) {
        ts = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
      }
    }, { passive: true });
    doc.addEventListener("touchend", function (e) {
      if (!ts) return;
      var dx = e.changedTouches[0].clientX - ts.x;
      var dy = e.changedTouches[0].clientY - ts.y;
      var dt = Date.now() - ts.t;
      var dist = Math.sqrt(dx * dx + dy * dy);
      ts = null;
      if (dist < 60 || dt === 0) return;
      var speed = dist / dt;
      var angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
      if (speed > 0.3 && angle < 60) doFlip();
    }, { passive: true });
  }

  /* ---------- 事件委托 ---------- */
  doc.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.dataset.action;
    if (action === "toggle-mode") { toggleMode(); return; }
    if (action === "flip") { doFlip(); return; }
    if (action === "copy-link") {
      copyText(location.href, "链接已复制：分享后直达当前页面（不播放动画）");
      return;
    }
    if (action === "copy-code") {
      var pre = el.closest(".code-block").querySelector("pre");
      copyText(pre.innerText, "代码已复制");
      return;
    }
    if (action === "todo") {
      e.preventDefault();
      toast(el.dataset.msg || "该功能在后续里程碑实现，本 Demo 未包含");
      return;
    }
    if (action === "back-top") {
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
      return;
    }
  });

  /* ---------- 回到顶部 ---------- */
  var backTop = doc.querySelector(".back-top");
  if (backTop) {
    window.addEventListener("scroll", function () {
      backTop.classList.toggle("show", window.scrollY > 500);
    }, { passive: true });
  }

  /* ---------- TOC：点击即时高亮 + 滚动位置追踪 ---------- */
  var tocLinks = [].slice.call(doc.querySelectorAll(".toc a"));
  if (tocLinks.length) {
    var tocHeads = tocLinks
      .map(function (a) { return doc.getElementById(a.getAttribute("href").slice(1)); })
      .filter(Boolean);

    function setActive(id) {
      tocLinks.forEach(function (a) {
        a.classList.toggle("active", a.getAttribute("href") === "#" + id);
      });
    }

    /* 点击目录：立即高亮所点击项（平滑滚动期间逐步移交给追踪逻辑） */
    tocLinks.forEach(function (a) {
      a.addEventListener("click", function () {
        setActive(a.getAttribute("href").slice(1));
      });
    });

    /* 滚动追踪：取判读线（视口顶部下方 25%）上方最近的标题 */
    var tocTicking = false;
    function tocTrack() {
      tocTicking = false;
      var line = window.scrollY + window.innerHeight * 0.25;
      var current = tocHeads.length ? tocHeads[0] : null;
      for (var i = 0; i < tocHeads.length; i++) {
        var top = tocHeads[i].getBoundingClientRect().top + window.scrollY;
        if (top <= line) current = tocHeads[i];
      }
      if (current) setActive(current.id);
    }
    window.addEventListener("scroll", function () {
      if (!tocTicking) {
        tocTicking = true;
        requestAnimationFrame(tocTrack);
      }
    }, { passive: true });
    tocTrack();
  }

  /* ---------- 文章页：正文方框 + 拖边界调宽（双击恢复默认） ---------- */
  var articlePage = doc.querySelector(".article-page .page");
  var frame = articlePage && articlePage.querySelector(".article-layout > article");
  if (articlePage && frame) {
    try {
      var savedW = parseInt(localStorage.getItem("uum-demo-article-w"), 10);
      if (savedW >= 680) articlePage.style.setProperty("--article-w", savedW + "px");
    } catch (e) {}

    var clampW = function (w) {
      var maxW = Math.min(1400, window.innerWidth - 64);
      return Math.max(680, Math.min(w, maxW));
    };

    ["left", "right"].forEach(function (side) {
      var edge = doc.createElement("div");
      edge.className = "frame-edge frame-edge--" + side;
      edge.setAttribute("role", "separator");
      edge.setAttribute("aria-label", "拖动调整阅读宽度");
      edge.title = "拖动调整阅读宽度 · 双击恢复默认";
      frame.appendChild(edge);

      var startX = 0, startW = 0, dragging = false;
      edge.addEventListener("pointerdown", function (e) {
        dragging = true;
        startX = e.clientX;
        startW = articlePage.getBoundingClientRect().width;
        edge.classList.add("is-dragging");
        doc.body.classList.add("is-resizing");
        try { edge.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      edge.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        /* 容器居中：边界每移动 1px，宽度改变 2px */
        var delta = (e.clientX - startX) * 2 * (side === "right" ? 1 : -1);
        var w = clampW(Math.round(startW + delta));
        articlePage.style.setProperty("--article-w", w + "px");
        try { localStorage.setItem("uum-demo-article-w", String(w)); } catch (err) {}
      });
      var stop = function () {
        if (!dragging) return;
        dragging = false;
        edge.classList.remove("is-dragging");
        doc.body.classList.remove("is-resizing");
      };
      edge.addEventListener("pointerup", stop);
      edge.addEventListener("pointercancel", stop);
      edge.addEventListener("dblclick", function () {
        articlePage.style.removeProperty("--article-w");
        try { localStorage.removeItem("uum-demo-article-w"); } catch (err) {}
        toast("已恢复默认阅读宽度");
      });
    });
  }

  /* ---------- 归档分类筛选 ---------- */
  var filterBar = doc.querySelector(".filter-bar");
  if (filterBar) {
    var rows = [].slice.call(doc.querySelectorAll(".archive-row"));
    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter-chip");
      if (!btn) return;
      filterBar.querySelectorAll(".filter-chip").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      var f = btn.dataset.filter;
      rows.forEach(function (r) {
        r.classList.toggle("is-hidden", f !== "all" && r.dataset.cat !== f);
      });
      doc.querySelectorAll(".archive-year").forEach(function (y) {
        var group = y.nextElementSibling;
        var any = group && [].some.call(group.children, function (c) {
          return !c.classList.contains("is-hidden");
        });
        y.style.display = any ? "" : "none";
      });
    });
  }

  /* ---------- 内容层渲染（写作台提交 → 站点立即可见） ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var store = window.UUMStore;

  /* 面首页统计：文章数随内容层实时更新 */
  [].slice.call(doc.querySelectorAll("[data-stat-posts]")).forEach(function (el) {
    if (store) el.textContent = store.published(el.dataset.statPosts).length;
  });

  /* 归档筛选条：由内容层渲染 → 写作台新增分类后自动出现 */
  [].slice.call(doc.querySelectorAll("[data-filter-bar]")).forEach(function (bar) {
    if (!store) return;
    var face = bar.dataset.filterBar;
    var cats = store.categories(face);
    bar.innerHTML = '<button class="filter-chip is-active" data-filter="all">全部</button>' +
      cats.map(function (c) {
        return '<button class="filter-chip" data-filter="' + esc(c.name) + '">' + esc(c.name) + "</button>";
      }).join("");
  });

  /* 面首页 / 归档：文章卡片列表 */
  [].slice.call(doc.querySelectorAll("[data-post-list]")).forEach(function (host) {
    if (!store) return; /* 无内容层时保留静态 HTML（无 JS / 打开单个文件也正常） */
    var face = host.dataset.postList;
    var posts = store.published(face);
    if (!posts.length) {
      host.innerHTML = '<div class="empty-state"><h2>这一面还没有文章</h2><p>在写作台发布第一篇即可在首页看到。</p></div>';
      return;
    }
    host.innerHTML = posts.map(function (p) {
      var fresh = p.createdAt && (Date.now() - p.createdAt) < 172800000;
      var href = p.detail || ("post.html?face=" + face + "&slug=" + encodeURIComponent(p.slug));
      var linkAttrs = "";
      var tags = (p.tags || []).slice(0, 3).map(function (t) {
        return '<a class="chip chip--link" href="tags.html#tag-' +
          encodeURIComponent(String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-")) + '">' + esc(t) + "</a>";
      }).join("");
      var meta = [];
      if (p.featured) {
        meta.push('<span class="pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 6 3 4H7l3-4-1-6zM12 14v7"/></svg>置顶</span>');
      }
      if (fresh) meta.push('<span class="pin pin--new">新发布</span>');
      meta.push('<time datetime="' + esc(p.date) + '">' + esc(p.date) + "</time>");
      meta.push("<span>" + esc(p.words || "—") + " 字 · 约 " + esc(p.minutes || 5) + " 分钟</span>");
      return '<a class="post-card" href="' + esc(href) + '"' + linkAttrs + ">" +
        '<div class="post-meta">' + meta.join("") + "</div>" +
        "<h2>" + esc(p.title) + "</h2>" +
        '<div class="chip-row">' +
          (p.category ? '<span class="chip chip--cat">' + esc(p.category) + "</span>" : "") + tags +
        "</div>" +
        '<p class="post-excerpt">' + esc(p.desc) + "</p>" +
        '<span class="read-more">阅读全文 <span class="arr">→</span></span>' +
        "</a>";
    }).join("");
  });

  /* 归档：按年份分组 */
  [].slice.call(doc.querySelectorAll("[data-archive]")).forEach(function (host) {
    if (!store) return;
    var face = host.dataset.archive;
    var posts = store.published(face);
    var byYear = {};
    posts.forEach(function (p) { (byYear[(p.date || "").slice(0, 4)] = byYear[(p.date || "").slice(0, 4)] || []).push(p); });
    var years = Object.keys(byYear).sort().reverse();
    if (!years.length) {
      host.innerHTML = '<div class="empty-state"><h2>还没有可归档的文章</h2></div>';
      return;
    }
    host.innerHTML = years.map(function (y) {
      var rows = byYear[y].map(function (p) {
        var href = p.detail || ("post.html?face=" + face + "&slug=" + encodeURIComponent(p.slug));
        return '<li class="archive-row" data-cat="' + esc(p.category) + '">' +
          '<time datetime="' + esc(p.date) + '">' + esc((p.date || "").slice(5)) + "</time>" +
          '<a href="' + esc(href) + '">' + esc(p.title) + "</a>" +
          (p.category ? '<span class="chip chip--cat">' + esc(p.category) + "</span>" : "") +
          "</li>";
      }).join("");
      return '<h2 class="archive-year">' + esc(y) + " <small>" + byYear[y].length + " 篇</small></h2>" +
        '<ul class="archive-list">' + rows + "</ul>";
    }).join("");
  });

  /* 分类页：分类卡片 + 各分类文章列表 */
  var catGrid = doc.querySelector("[data-cat-grid]");
  if (catGrid && store) {
    var cface = catGrid.dataset.catGrid;
    var cats = store.categories(cface);
    var emptyHost = doc.querySelector("[data-cat-empty]");
    var listHost = doc.querySelector("[data-cat-lists]");
    var total = store.published(cface).length;
    var counter = doc.querySelector("[data-cat-counter]");
    if (counter) counter.textContent = cats.length + " 个分类 · 共 " + total + " 篇";

    if (!cats.length) {
      catGrid.innerHTML = "";
      if (listHost) listHost.innerHTML = "";
      if (emptyHost) emptyHost.hidden = false;
    } else {
      if (emptyHost) emptyHost.hidden = true;
      catGrid.innerHTML = cats.map(function (c) {
        var posts = store.published(cface).filter(function (p) { return p.category === c.name; });
        var latest = posts[0];
        return '<a class="cat-card" href="#cat-' + esc(c.slug) + '">' +
          '<span class="cat-name">' + esc(c.name) + "</span>" +
          '<span class="cat-count">' + posts.length + " 篇</span>" +
          '<p class="cat-desc">' + esc(c.desc || "") + "</p>" +
          (latest ? '<span class="cat-latest">最近：' + esc(latest.title) + " · " + esc(latest.date) + "</span>" : "") +
          "</a>";
      }).join("");
      if (listHost) {
        listHost.innerHTML = cats.map(function (c) {
          var posts = store.published(cface).filter(function (p) { return p.category === c.name; });
          return '<h2 class="archive-year" id="cat-' + esc(c.slug) + '">' + esc(c.name) +
            " <small>" + posts.length + " 篇</small></h2>" +
            '<ul class="archive-list">' + posts.map(function (p) {
              var phref = p.detail || ("post.html?face=" + cface + "&slug=" + encodeURIComponent(p.slug));
              return '<li class="archive-row"><time datetime="' + esc(p.date) + '">' + esc((p.date || "").slice(5)) + "</time>" +
                '<a href="' + esc(phref) + '">' + esc(p.title) + "</a></li>";
            }).join("") + "</ul>";
        }).join("");
      }
    }
  }

  /* 作者页：这一面的分类索引（chips） */
  [].slice.call(doc.querySelectorAll("[data-author-cats]")).forEach(function (host) {
    if (!store) return;
    var face = host.dataset.authorCats;
    var cats = store.categories(face);
    var page = face === "uu" ? "uu-category.html" : "mixt-category.html";
    if (!cats.length) {
      host.innerHTML = '<span style="font-size:.86rem;color:var(--text-2)">这一面的分类当前为空（按 PRD 3.5 由本人经写作台添加）。</span>';
      return;
    }
    host.innerHTML = cats.map(function (c) {
      return '<a href="' + page + '#cat-' + esc(c.slug) + '">' + esc(c.name) +
        "（" + store.categoryCount(face, c.name) + " 篇）</a>";
    }).join("");
  });

})();
