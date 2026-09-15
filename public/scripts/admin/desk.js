/* ==========================================================================
   UU&Mixt · 写作台工作台逻辑（/admin/desk/）
   交互与 demo/admin-desk.html 一致（AGENTS「正式开发 = 按 Demo 接线」）：
     · 文章：列表（状态与操作合并列）/ 新建 / 编辑 / 删除 / 发布↔转草稿
     · 分类：自维护（增改删 + 添加入口 + 表单收起）+ 点击展开时间线 + 改名同步文章字段
     · 友链：站点级共享数据（src/data/friends.json，两位作者都可维护，决策 7.16）
     · 媒体：真实上传图片到 public/images/<face>/，生成正文引用代码
   面（face）只来自会话，接口不接受 face 参数 —— 技术强制"只管自己那一面"
   （友链除外：站点级数据，同标签池先例）。
   ========================================================================== */

(function () {
  "use strict";

  var GH = window.UUMGH;
  var doc = document;
  var $ = function (s) { return doc.querySelector(s); };
  var session = GH.getSession();
  if (!session || !session.face) {
    location.replace("/admin/");
    return;
  }
  var FACE = session.face;                       /* uu | mixt */
  var AUTHOR = FACE === "uu" ? "UU" : "Mixt";
  var CONTENT_DIR = "src/content/" + FACE;
  var CATEGORY_FILE = "src/config/categories-" + FACE + ".json";
  var FRIENDS_FILE = "src/data/friends.json";   /* 友链：站点级共享数据，两位作者都可维护（决策 7.16） */
  var IMAGE_DIR = "public/images/" + FACE;
  var META = {
    uu: { name: "UU", avatar: "/assets/avatars/uu.jpg", role: "管理 UU 面的文章与分类" },
    mixt: { name: "Mixt", avatar: "/assets/avatars/mixt.jpg", role: "管理 Mixt 面的文章与分类" },
  }[FACE];

  var msg = function (el, t) { if (el) el.textContent = t || ""; };
  var toast = window.uumToast || function () {};
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- frontmatter 读写（字段与 PRD 3.2 一一对应） ---------- */
  function buildFrontmatter(f) {
    var lines = ["---", 'title: ' + JSON.stringify(f.title), "slug: " + f.slug,
      'description: ' + JSON.stringify(f.description), "date: " + f.date];
    if (f.updated) lines.push("updated: " + f.updated);
    lines.push("author: " + FACE, "category: " + f.category);
    lines.push("tags: [" + (f.tags || []).join(", ") + "]");
    lines.push("featured: " + (!!f.featured), "draft: " + (!!f.draft), "---", "");
    return lines.join("\n");
  }

  function parseFrontmatter(text) {
    var m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    var head = m ? m[1] : "";
    var body = m ? text.slice(m[0].length) : text;
    var get = function (k) {
      var r = new RegExp("^" + k + ":\\s*(.*)$", "m").exec(head);
      if (!r) return "";
      return r[1].trim().replace(/^["']|["']$/g, "");
    };
    var tagsRaw = get("tags").replace(/^\[|\]$/g, "");
    return {
      title: get("title"), slug: get("slug"), description: get("description"),
      date: get("date"), author: get("author"), category: get("category"),
      tags: tagsRaw ? tagsRaw.split(",").map(function (t) { return t.trim(); }).filter(Boolean) : [],
      featured: get("featured") === "true", draft: get("draft") === "true",
      body: body, sha: null, path: null,
    };
  }

  /* ---------- slug 自动生成（与 scripts 端一致：英文 kebab / 中文日期兜底 / 同面去重） ---------- */
  function slugifyTitle(title) {
    var base = String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (base) return base;
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return "post-" + d.getFullYear() + mm + dd + "-" + Math.random().toString(36).slice(2, 6);
  }
  /* 分类的 URL 短名：同样不提供填写项。英文名 → kebab；
     纯中文名没有可用 ASCII → 用 cat-日期-随机 兜底（正式实现可换中文转拼音）。 */
  function autoCategorySlug(name, taken, keep) {
    var base = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!base) {
      var d = new Date();
      var mm = String(d.getMonth() + 1).padStart(2, "0");
      var dd = String(d.getDate()).padStart(2, "0");
      base = "cat-" + d.getFullYear() + mm + dd + "-" + Math.random().toString(36).slice(2, 6);
    }
    return dedupeSlug(base, taken || [], keep || null);
  }

  function dedupeSlug(base, taken, keep) {
    var list = taken.filter(function (s) { return s !== keep; });
    if (list.indexOf(base) === -1) return base;
    var n = 2;
    while (list.indexOf(base + "-" + n) !== -1) n++;
    return base + "-" + n;
  }

  /* ---------- 状态 ---------- */
  var state = { posts: [], categories: [], friends: [], editing: null, slugDraft: "" };
  /* slugDraft：文章的 URL 短名（PRD 4.1）。界面上不提供填写项 → 用内部状态承载，
     由标题自动生成（英文 kebab / 中文日期兜底 / 同面去重）。 */

  /* ---------- 身份 ---------- */
  function renderIdentity() {
    $("[data-user-name]").textContent = META.name;
    $("[data-user-role]").textContent = META.role + (GH.isMock() ? "（自测 mock 模式）" : "· 已连接 GitHub");
    $("[data-user-avatar]").src = META.avatar;
    doc.body.dataset.face = FACE;                 /* 主题色跟随作者 */
    var homeLink = doc.querySelector("[data-face-home]");
    if (homeLink) homeLink.href = "/" + FACE + "/";
  }

  /* ---------- 文章列表 ---------- */
  async function loadPosts() {
    var files = (await GH.listDir(CONTENT_DIR)).filter(function (f) { return /\.md$/.test(f.name); });
    var posts = [];
    for (var i = 0; i < files.length; i++) {
      var r = await GH.readFile(files[i].path);
      if (!r) continue;
      var p = parseFrontmatter(r.content);
      p.sha = r.sha;
      p.path = files[i].path;
      posts.push(p);
    }
    posts.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    state.posts = posts;
    renderPosts();
  }

  function statusPill(p) {
    if (p.draft) return '<span class="admin-pill admin-pill--draft">草稿</span>';
    if (p.featured) return '<span class="admin-pill admin-pill--pin">已发布 · 置顶</span>';
    return '<span class="admin-pill">已发布</span>';
  }

  function renderPosts() {
    $("[data-post-total]").textContent = state.posts.length;
    var host = $("[data-post-rows]");
    if (!state.posts.length) {
      host.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-3)">还没有文章，点右上角「新建文章」开始。</td></tr>';
      return;
    }
    host.innerHTML = state.posts.map(function (p) {
      return "<tr>" +
        "<td>" + esc(p.title) + "</td>" +
        "<td>" + esc(p.category || "—") + "</td>" +
        "<td>" + esc(p.date) + "</td>" +
        '<td class="admin-status-actions">' + statusPill(p) +
          '<span class="admin-row-actions">' +
            '<button class="admin-mini" data-edit="' + esc(p.slug) + '">编辑</button>' +
            '<button class="admin-mini" data-toggle="' + esc(p.slug) + '">' + (p.draft ? "发布" : "转草稿") + "</button>" +
            '<button class="admin-mini admin-mini--danger" data-del="' + esc(p.slug) + '">删除</button>' +
          "</span></td></tr>";
    }).join("");
  }

  /* ---------- 文章表单 ---------- */
  function fillCategoryOptions(selected) {
    var sel = $("#f-cat");
    sel.innerHTML = "";
    if (!state.categories.length) {
      var o = doc.createElement("option");
      o.value = "";
      o.textContent = "（本面还没有分类，请先到「分类」添加）";
      sel.appendChild(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    state.categories.forEach(function (c) {
      var opt = doc.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      if (c.name === selected) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function autoSlugNow() {
    var title = $("#f-title").value.trim();
    var taken = state.posts.map(function (p) { return p.slug; });
    var keep = state.editing ? state.editing.slug : null;
    state.slugDraft = title ? dedupeSlug(slugifyTitle(title), taken, keep) : "";
    return state.slugDraft;
  }

  function resetEditor() {
    state.editing = null;
    $("[data-editor-title]").textContent = "新建文章";
    $("#f-title").value = "";
    state.slugDraft = "";
    $("#f-date").value = new Date().toISOString().slice(0, 10);
    $("#f-tags").value = "";
    $("#f-desc").value = "";
    $("#f-body").value = "";
    $("#f-featured").checked = false;
    $("#f-draft").checked = true;
    fillCategoryOptions("");
    $("[data-editor]").hidden = true;
    /* 注意：不清空 [data-post-msg]——否则刚提交成功的提示会被立刻抹掉（自测发现的 bug） */
  }

  function openEditor(slug) {
    var p = state.posts.filter(function (x) { return x.slug === slug; })[0];
    state.editing = p || null;
    $("[data-editor-title]").textContent = p ? "编辑文章" : "新建文章";
    $("#f-title").value = p ? p.title : "";
    state.slugDraft = p ? p.slug : "";              /* 编辑旧文章：沿用原 slug（发布后冻结） */
    $("#f-date").value = p ? p.date : new Date().toISOString().slice(0, 10);
    $("#f-tags").value = p ? p.tags.join(", ") : "";
    $("#f-desc").value = p ? p.description : "";
    $("#f-body").value = p ? p.body : "";
    $("#f-featured").checked = p ? p.featured : false;
    $("#f-draft").checked = p ? p.draft : true;
    fillCategoryOptions(p ? p.category : "");
    $("[data-editor]").hidden = false;
    $("#f-title").focus();
  }

  function validatePost(data) {
    if (!data.title) return "标题为必填字段。";
    if (data.title.length > 60) return "标题不能超过 60 字符（当前 " + data.title.length + "）。";
    if (data.description.length < 60) return "description 至少 60 字符（当前 " + data.description.length + "）。";
    if (data.description.length > 120) return "description 不能超过 120 字符（当前 " + data.description.length + "）。";
    if (data.tags.length > 5) return "标签最多 5 个（当前 " + data.tags.length + "）。";
    if (!data.category) return "分类必填：本面还没有分类时，请先到「分类」添加。";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return "日期格式应为 YYYY-MM-DD。";
    if (new Date(data.date) > new Date()) return "日期不能晚于今天。";
    return null;
  }

  async function savePost() {
    var out = $("[data-post-msg]");
    var data = {
      title: $("#f-title").value.trim(),
      slug: state.slugDraft || autoSlugNow(),
      description: $("#f-desc").value.trim(),
      date: $("#f-date").value,
      category: $("#f-cat").value || "",
      tags: $("#f-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
      featured: $("#f-featured").checked,
      draft: $("#f-draft").checked,
      body: $("#f-body").value,
    };
    if (!data.slug) data.slug = autoSlugNow();
    var bad = validatePost(data);
    if (bad) { msg(out, bad); return; }

    try {
      var text = buildFrontmatter(data) + data.body + "\n";
      var path = CONTENT_DIR + "/" + data.slug + ".md";
      var sha = state.editing ? state.editing.sha : null;
      msg(out, "正在提交到仓库…");
      await GH.writeFile(path, text, (sha ? "content(" + FACE + "): 更新 " : "content(" + FACE + "): 新增 ") + data.title, sha);
      msg(out, data.draft
        ? "已保存为草稿（不进构建产物）：" + path
        : "已提交到仓库：" + path + "　→ 由部署方构建后线上可见（提交即发布，无审核环节）");
      resetEditor();
      await loadPosts();
      await renderCategories();
    } catch (e) {
      msg(out, "提交失败：" + e.message);
    }
  }

  /* ---------- 分类 ---------- */
  async function loadCategories() {
    var r = await GH.readFile(CATEGORY_FILE);
    state.categories = r ? JSON.parse(r.content) : [];
    state.categorySha = r ? r.sha : null;
    renderCategories();
  }

  async function renderCategories() {
    var totalEl = $("[data-cat-total]");
    if (totalEl) totalEl.textContent = state.categories.length;
    var host = $("[data-cat-list]");
    if (!state.categories.length) {
      host.innerHTML = '<div class="admin-cat-empty">' +
        (FACE === "mixt" ? "Mixt 面的分类当前为空 —— 添加第一个分类后，站点会自动出现分类导航与分类页。" : "还没有分类。") +
        "</div>";
      return;
    }
    host.innerHTML = state.categories.map(function (c) {
      var posts = state.posts.filter(function (p) { return p.category === c.name; });
      var rows = posts.map(function (p) {
        return '<li class="archive-row"><time datetime="' + esc(p.date) + '">' + esc((p.date || "").slice(5)) + "</time>" +
          '<a href="/' + FACE + '/posts/' + esc(p.slug) + '/">' + esc(p.title) + "</a>" +
          (p.draft ? ' <span class="admin-saved-badge">草稿</span>' : "") + "</li>";
      }).join("");
      return '<div class="admin-cat-row" data-cat-slug="' + esc(c.slug) + '">' +
        '<div class="admin-cat-head"><b>' + esc(c.name) + '</b>' +
        '<span class="admin-cat-arrow" aria-hidden="true">▸</span>' +
        "<p>" + esc(c.desc || "") + "</p></div>" +
        '<div class="admin-row-actions"><span class="admin-saved-badge">' + posts.length + " 篇</span>" +
        '<button class="admin-mini" data-edit-cat="' + esc(c.slug) + '">编辑</button>' +
        '<button class="admin-mini admin-mini--danger" data-del-cat="' + esc(c.slug) + '">删除</button></div>' +
        '<div class="admin-cat-timeline" hidden>' +
        (posts.length ? '<ul class="archive-list">' + rows + "</ul>" : '<p class="admin-cat-none">该分类下还没有文章。</p>') +
        "</div></div>";
    }).join("");
  }

  async function writeCategories() {
    var text = JSON.stringify(state.categories, null, 2) + "\n";
    var r = await GH.writeFile(CATEGORY_FILE, text, "config(" + FACE + "): 更新分类配置", state.categorySha);
    state.categorySha = (r && r.content && r.content.sha) || state.categorySha;
  }

  async function saveCategory() {
    var out = $("[data-cat-msg]");
    var name = $("#c-name").value.trim();
    var desc = $("#c-desc").value.trim();
    if (!name) { msg(out, "分类名必填。"); return; }
    if (name.length > 20) { msg(out, "分类名不超过 20 字符（当前 " + name.length + "）。"); return; }
    if (state.categories.some(function (c) { return c.name === name && c !== state.editingCat; })) {
      msg(out, "同名分类已存在。"); return;
    }

    var editing = state.editingCat;
    var oldName = editing && editing.name;
    /* 短名不提供填写项：新建时按分类名自动生成；编辑时沿用原值（发布后冻结） */
    var slug = editing
      ? editing.slug
      : autoCategorySlug(name, state.categories.map(function (c) { return c.slug; }));
    if (editing) {
      editing.name = name; editing.desc = desc;      /* slug 冻结：改名不改短名 */
    } else {
      state.categories.push({ slug: slug, name: name, desc: desc });
    }
    try {
      msg(out, "正在提交分类配置…");
      await writeCategories();
      /* 改名同步：该分类下所有文章的 category 字段（与 demo 语义一致） */
      if (oldName && oldName !== name) {
        var affected = state.posts.filter(function (p) { return p.category === oldName; });
        for (var i = 0; i < affected.length; i++) {
          var p = affected[i];
          p.category = name;
          await GH.writeFile(p.path, buildFrontmatter(p) + p.body + "\n",
            "content(" + FACE + "): 分类改名同步（" + oldName + " → " + name + "）", p.sha);
        }
        msg(out, "分类已改名，并同步更新 " + affected.length + " 篇文章；构建后生效。");
      } else {
        msg(out, editing ? "分类已更新。" : "已添加「" + name + "」（短名 /" + slug + "，自动生成）——构建后分类页与导航自动出现。");
      }
      resetCategoryForm();
      await loadCategories();
      await loadPosts();
    } catch (e) {
      msg(out, "提交失败：" + e.message);
    }
  }

  function resetCategoryForm() {
    state.editingCat = null;
    $("[data-cat-form-title]").textContent = "新增分类";
    $("#c-name").value = "";
    $("#c-desc").value = "";
    $("[data-cat-form]").hidden = true;   /* 取消/保存后表单收起，回到列表视图（与 demo 一致） */
  }

  /* ---------- 友链（站点级共享数据；入口页卡组数据源，PRD E8 · 决策 7.16） ----------
     写路径与文章同通道（GitHub Contents API）：读改写整个 friends.json、带 sha 乐观锁；
     重名校验在前端（正式 JSON 无 id，name 即唯一键）；保存即提交，部署后入口页可见。 */
  async function loadFriends() {
    var r = await GH.readFile(FRIENDS_FILE);
    state.friends = r ? JSON.parse(r.content) : [];
    state.friendsSha = r ? r.sha : null;
    renderFriends();
  }

  function renderFriends() {
    var list = state.friends;
    $("[data-friend-total]").textContent = list.length;
    var host = $("[data-friend-rows]");
    if (!list.length) {
      host.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-3)">还没有友链，点右上角「添加友链」开始。</td></tr>';
      return;
    }
    host.innerHTML = list.map(function (f) {
      var hostName = String(f.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
      return "<tr>" +
        '<td><span class="admin-friend-dot" aria-hidden="true">' + esc((f.name || "?").slice(0, 1)) + "</span>" + esc(f.name) + "</td>" +
        '<td><code class="admin-friend-host">' + esc(hostName) + "</code></td>" +
        "<td>" + esc(f.desc || "—") + "</td>" +
        '<td class="admin-status-actions"><span class="admin-row-actions">' +
          '<button class="admin-mini" data-edit-friend="' + esc(f.name) + '">编辑</button>' +
          '<button class="admin-mini admin-mini--danger" data-del-friend="' + esc(f.name) + '">删除</button>' +
        "</span></td></tr>";
    }).join("");
  }

  function resetFriendForm() {
    state.editingFriend = null;
    $("[data-friend-form-title]").textContent = "添加友链";
    $("#fl-name").value = "";
    $("#fl-url").value = "";
    $("#fl-avatar").value = "";
    $("#fl-desc").value = "";
    $("[data-friend-editor]").hidden = true;
  }

  async function writeFriends(message) {
    var text = JSON.stringify(state.friends, null, 2) + "\n";
    var r = await GH.writeFile(FRIENDS_FILE, text, message, state.friendsSha);
    state.friendsSha = (r && r.content && r.content.sha) || state.friendsSha;
  }

  async function saveFriend() {
    var out = $("[data-friend-msg]");
    var name = $("#fl-name").value.trim();
    var url = $("#fl-url").value.trim();
    var avatar = $("#fl-avatar").value.trim();
    var desc = $("#fl-desc").value.trim();
    if (!name) { msg(out, "站点名必填。"); $("#fl-name").focus(); return; }
    if (!url) { msg(out, "站点地址必填。"); $("#fl-url").focus(); return; }
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;   /* 手滑没写协议时自动补 https */
    if (!desc) { msg(out, "简介必填——悬停卡片时会展示它。"); $("#fl-desc").focus(); return; }
    if (state.friends.some(function (f) { return f.name === name && f !== state.editingFriend; })) {
      msg(out, "同名友链已存在——换一个名字，或编辑已有条目。");
      return;
    }
    try {
      msg(out, "正在提交到仓库…");
      if (state.editingFriend) {
        state.editingFriend.name = name;
        state.editingFriend.url = url;
        state.editingFriend.avatar = avatar;
        state.editingFriend.desc = desc;
        await writeFriends("content(friends): 更新友链「" + name + "」");
        msg(out, "友链已更新并提交进仓库 → 由部署方构建后线上可见。");
      } else {
        state.friends.push({ name: name, url: url, avatar: avatar, desc: desc });
        await writeFriends("content(friends): 添加友链「" + name + "」");
        msg(out, "已添加「" + name + "」并提交进仓库 → 由部署方构建后入口页卡组可见。");
      }
      resetFriendForm();
      renderFriends();
    } catch (e) {
      msg(out, "提交失败：" + e.message);
      try { await loadFriends(); } catch (e2) {}   /* 写失败以仓库为准回滚本地态，避免 sha 漂移 */
    }
  }

  /* ---------- 媒体（真实上传 + 引用生成） ---------- */
  function insertMediaRow(name, dataUrl, reference) {
    var list = $("[data-media-list]");
    var row = doc.createElement("div");
    row.className = "admin-media-row";
    row.innerHTML = '<img src="' + dataUrl + '" alt="">' +
      '<div class="admin-media-info"><b>' + esc(name) + "</b>" +
      '<code class="admin-media-ref">' + esc(reference) + "</code></div>" +
      '<button class="admin-mini" data-media-copy="' + esc(reference) + '">复制引用</button>';
    list.insertBefore(row, list.firstChild);
  }

  async function handleMediaFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!/^image\//.test(file.type)) { toast("只支持图片文件：" + file.name); continue; }
      var base64 = await new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result).split(",")[1]); };
        fr.readAsDataURL(file);
      });
      var safeName = file.name.replace(/[^\w.-]/g, "-");
      var path = IMAGE_DIR + "/" + safeName;
      try {
        await GH.uploadBinary(path, base64, "media(" + FACE + "): 上传 " + safeName);
        var reference = "![" + safeName.replace(/\.[^.]+$/, "") + "](/images/" + FACE + "/" + safeName + ")";
        insertMediaRow(safeName, "data:" + file.type + ";base64," + base64, reference);
        toast("已上传到 " + path);
      } catch (e) {
        toast("上传失败：" + e.message);
      }
    }
  }

  /* ---------- 事件 ---------- */
  doc.addEventListener("click", function (e) {
    var el = e.target.closest(
      "[data-action],[data-edit],[data-toggle],[data-del],[data-edit-cat],[data-del-cat],[data-edit-friend],[data-del-friend],[data-media-copy]"
    );
    if (!el) return;

    if (el.dataset.action === "logout") {
      GH.clearSession();
      location.href = "/admin/";
      return;
    }
    if (el.dataset.action === "new-post") { resetEditor(); $("[data-editor]").hidden = false; fillCategoryOptions(""); $("#f-title").focus(); return; }
    if (el.dataset.action === "cancel-edit") { resetEditor(); return; }
    if (el.dataset.action === "save-post") { savePost(); return; }
    if (el.dataset.action === "save-cat") { saveCategory(); return; }
    if (el.dataset.action === "cancel-cat") { resetCategoryForm(); msg($("[data-cat-msg]"), ""); return; }
    if (el.dataset.action === "new-cat") { resetCategoryForm(); msg($("[data-cat-msg]"), ""); $("[data-cat-form]").hidden = false; $("#c-name").focus(); return; }
    if (el.dataset.action === "new-friend") { resetFriendForm(); msg($("[data-friend-msg]"), ""); $("[data-friend-editor]").hidden = false; $("#fl-name").focus(); return; }
    if (el.dataset.action === "cancel-friend") { resetFriendForm(); msg($("[data-friend-msg]"), ""); return; }
    if (el.dataset.action === "save-friend") { saveFriend(); return; }
    if (el.dataset.action === "reset-media-input") { $("#media-input").click(); return; }
    if (el.dataset.mediaCopy) {
      var text = el.dataset.mediaCopy;
      var ok = false;
      try { ok = doc.execCommand("copy", false, text); } catch (err) { ok = false; }
      toast(ok ? "引用已复制，粘贴到正文即可" : "复制失败，请手动选中复制");
      return;
    }
    if (el.dataset.edit) { openEditor(el.dataset.edit); return; }
    if (el.dataset.toggle) {
      var p = state.posts.filter(function (x) { return x.slug === el.dataset.toggle; })[0];
      if (!p) return;
      p.draft = !p.draft;
      GH.writeFile(p.path, buildFrontmatter(p) + p.body + "\n",
        "content(" + FACE + "): " + (p.draft ? "转为草稿 " : "发布 ") + p.title, p.sha)
        .then(function () {
          msg($("[data-post-msg]"), p.draft ? "已转为草稿（构建产物中移除）。" : "已发布（构建后线上可见）。");
          return loadPosts();
        })
        .catch(function (err) { msg($("[data-post-msg]"), "提交失败：" + err.message); });
      return;
    }
    if (el.dataset.del) {
      var t = state.posts.filter(function (x) { return x.slug === el.dataset.del; })[0];
      if (!t) return;
      if (!window.confirm("删除《" + t.title + "》？仓库中的文件会被删除，此操作不可撤销。")) return;
      GH.removeFile(t.path, "content(" + FACE + "): 删除 " + t.title, t.sha)
        .then(function () { msg($("[data-post-msg]"), "已删除：" + t.path); return loadPosts(); })
        .catch(function (err) { msg($("[data-post-msg]"), "删除失败：" + err.message); });
      return;
    }
    if (el.dataset.editCat) {
      var c = state.categories.filter(function (x) { return x.slug === el.dataset.editCat; })[0];
      if (!c) return;
      state.editingCat = c;
      $("[data-cat-form-title]").textContent = "编辑分类：" + c.name;
      $("#c-name").value = c.name;
      $("#c-desc").value = c.desc || "";
      $("[data-cat-form]").hidden = false;
      $("#c-name").focus();
      return;
    }
    if (el.dataset.delCat) {
      var c2 = state.categories.filter(function (x) { return x.slug === el.dataset.delCat; })[0];
      if (!c2) return;
      var used = state.posts.filter(function (p) { return p.category === c2.name; }).length;
      if (!window.confirm("删除分类「" + c2.name + "」？" + (used ? "该分类下还有 " + used + " 篇文章，它们会变成未登记分类（构建将失败），建议先改文章分类。" : ""))) return;
      state.categories = state.categories.filter(function (x) { return x.slug !== c2.slug; });
      writeCategories()
        .then(function () { msg($("[data-cat-msg]"), "已删除分类。"); return loadCategories(); })
        .catch(function (err) { msg($("[data-cat-msg]"), "提交失败：" + err.message); });
      return;
    }
    if (el.dataset.editFriend) {
      var fd = state.friends.filter(function (x) { return x.name === el.dataset.editFriend; })[0];
      if (!fd) return;
      state.editingFriend = fd;
      $("[data-friend-form-title]").textContent = "编辑友链：" + fd.name;
      $("#fl-name").value = fd.name;
      $("#fl-url").value = fd.url;
      $("#fl-avatar").value = fd.avatar || "";
      $("#fl-desc").value = fd.desc || "";
      $("[data-friend-editor]").hidden = false;
      $("#fl-name").focus();
      return;
    }
    if (el.dataset.delFriend) {
      var fd2 = state.friends.filter(function (x) { return x.name === el.dataset.delFriend; })[0];
      if (!fd2) return;
      if (!window.confirm("删除友链「" + fd2.name + "」？入口页卡组在部署更新后同步移除。")) return;
      state.friends = state.friends.filter(function (x) { return x !== fd2; });
      writeFriends("content(friends): 移除友链「" + fd2.name + "」")
        .then(function () {
          msg($("[data-friend-msg]"), "已删除并提交进仓库。");
          renderFriends();
        })
        .catch(function (err) {
          msg($("[data-friend-msg]"), "提交失败：" + err.message);
          loadFriends().catch(function () {});   /* 以仓库为准回滚本地态 */
        });
      return;
    }
  });

  doc.addEventListener("click", function (e) {
    if (e.target.closest(".admin-mini")) return;
    var row = e.target.closest(".admin-cat-row");
    if (!row || !row.dataset.catSlug) return;
    var tl = row.querySelector(".admin-cat-timeline");
    if (!tl) return;
    var open = row.classList.toggle("is-open");
    tl.hidden = !open;
  });

  /* 面板切换 */
  [].slice.call(doc.querySelectorAll(".admin-side-item")).forEach(function (btn) {
    btn.addEventListener("click", function () {
      [].slice.call(doc.querySelectorAll(".admin-side-item")).forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      [].slice.call(doc.querySelectorAll("[data-panel-body]")).forEach(function (p) {
        p.classList.toggle("is-active", p.dataset.panelBody === btn.dataset.panel);
      });
    });
  });

  /* 表单联动 */
  $("#f-title").addEventListener("input", function () {
    if (state.editing) return;                 /* 编辑时 slug 冻结（PRD 4.1） */
    autoSlugNow();
  });
  $("#media-input").addEventListener("change", function () {
    var files = [].slice.call(this.files || []);
    this.value = "";
    if (files.length) handleMediaFiles(files);
  });

  /* ---------- 启动 ---------- */
  renderIdentity();
  (async function init() {
    try {
      /* 顺序敏感：文章先于分类——分类面板的时间线与「N 篇」徽章要按 state.posts 统计 */
      await loadPosts();
      await loadCategories();
      resetEditor();
      resetCategoryForm();                           /* 分类表单初始收起（与 demo 一致） */
      resetFriendForm();
    } catch (e) {
      msg($("[data-post-msg]"), "加载失败：" + e.message);
    }
    try {
      await loadFriends();                           /* 友链失败不阻断文章/分类 */
    } catch (e) {
      msg($("[data-friend-msg]"), "友链加载失败：" + e.message);
    }
  })();
})();
