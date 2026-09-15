# -*- coding: utf-8 -*-
"""写作台端到端自测（mock 后端）：发文 → slug 去重 → 分类改名同步 → 导出生成的 Markdown"""
import io, os, re, subprocess

CHROME = r'C:/Program Files/Google/Chrome/Application/chrome.exe'
BASE = 'http://127.0.0.1:4321'

src = io.open('dist/admin/desk/index.html', encoding='utf-8').read()

# ① 会话预置（必须在 gh.js / desk.js 之前执行）
pre = """  <script>
    try {
      localStorage.removeItem("uum-desk-mock-store");
      localStorage.setItem("uum-desk-session", JSON.stringify({ face: "mixt", login: "Mixt170", token: "mock" }));
    } catch (e) {}
  </script>
"""

# ② 驱动脚本
drive = """
  <script>
    (function () {
      var log = [];
      function set(sel, v) {
        var el = document.querySelector(sel);
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      function waitFor(fn, ms) {
        ms = ms || 4000;
        return new Promise(function (res) {
          var t0 = Date.now();
          (function tick() {
            var ok = false;
            try { ok = fn(); } catch (e) { ok = false; }
            if (ok || Date.now() - t0 > ms) return res(ok);
            setTimeout(tick, 60);
          })();
        });
      }
      var store = function () {
        return JSON.parse(localStorage.getItem("uum-desk-mock-store") || "{}");
      };

      window.addEventListener("load", async function () {
        try {
          /* 等文章列表载入 */
          await waitFor(function () {
            return document.querySelectorAll("[data-post-rows] tr").length >= 1 &&
                   document.querySelector("[data-post-total]").textContent !== "0";
          });
          log.push("初始文章数=" + document.querySelector("[data-post-total]").textContent);

          /* A. 新建文章：标题故意与种子文章的 slug 冲突（tcache-layout） */
          document.querySelector('[data-action="new-post"]').click();
          set("#f-title", "tcache layout");
          set("#f-desc", "这是一篇用于自测的说明文字，长度必须落在六十到一百二十个字符之间，用来验证写作台的校验与提交链路是否按预期工作并生成合规的 frontmatter。");
          set("#f-tags", "pwn, glibc");
          document.querySelector("#f-cat").value = "堆利用";
          document.querySelector("#f-draft").checked = false;
          var slug = document.querySelector("#f-slug").value;
          log.push("slug去重=" + slug);
          document.querySelector('[data-action="save-post"]').click();
          await waitFor(function () {
            return /已提交到仓库/.test(document.querySelector("[data-post-msg]").textContent || "");
          });
          log.push("保存提示=" + (document.querySelector("[data-post-msg]").textContent || "").slice(0, 10));

          /* B. 分类改名 → 同步该分类下文章 */
          document.querySelector('[data-panel="categories"]').click();
          document.querySelector('[data-edit-cat="heap"]').click();
          set("#c-name", "堆利用与分配器");
          document.querySelector('[data-action="save-cat"]').click();
          await waitFor(function () {
            return /分类已改名/.test(document.querySelector("[data-cat-msg]").textContent || "");
          });
          log.push("改名提示=" + (document.querySelector("[data-cat-msg]").textContent || "").slice(0, 16));

          var s = store();
          var keys = Object.keys(s);
          log.push("仓库文件=[" + keys.join(" | ") + "]");
          log.push("越权检查(uu路径)=" + (keys.some(function (k) { return k.indexOf("uu") !== -1; }) ? "发现UU路径✗" : "无UU路径✓"));

          var newFile = s["src/content/mixt/tcache-layout-2.md"] ||
                        s["src/content/mixt/" + slug + ".md"] || "(未找到新文件)";
          log.push("改名后新文章分类=" + ((/^category: (.+)$/m.exec(newFile) || [])[1] || "?"));
          log.push("改名后种子文章分类=" + ((/^category: (.+)$/m.exec(s["src/content/mixt/tcache-layout.md"] || "") || [])[1] || "?"));

          var out = document.createElement("pre");
          out.id = "dump";
          out.textContent = "RESULT " + log.join(" || ") + "\\n---MARKDOWN---\\n" + newFile +
            "\\n---CATEGORIES---\\n" + s["src/config/categories-mixt.json"];
          document.body.appendChild(out);
          document.title = "DESK-OK " + log.join(" || ");
        } catch (e) {
          document.title = "DESK-ERR " + e.message;
        }
      });
    })();
  </script>
"""

probe = src.replace('<script src="/scripts/admin/gh.js"></script>',
                    pre + '  <script src="/scripts/admin/gh.js"></script>')
probe = probe.replace('</body>', drive + '</body>')
io.open('dist/admin/desk/_probe.html', 'w', encoding='utf-8', newline='\n').write(probe)

out = subprocess.run(
    [CHROME, '--headless=new', '--disable-gpu', '--virtual-time-budget=9000',
     '--dump-dom', BASE + '/admin/desk/_probe.html?mock=1'],
    capture_output=True, text=True, encoding='utf-8', errors='replace'
).stdout

m = re.search(r'<pre id="dump">([\s\S]*?)</pre>', out)
title = re.search(r'<title>([^<]*)</title>', out)
print('探针结果:', (title.group(1) if title else '(无 title)')[:400])
if m:
    io.open('docs/p4-self-test/desk-generated.md', 'w', encoding='utf-8', newline='\n').write(
        m.group(1).replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    )
    print('\n已导出生成的 Markdown → docs/p4-self-test/desk-generated.md')
else:
    print('\n未取到 dump（探针可能失败）')
os.remove('dist/admin/desk/_probe.html')
