# -*- coding: utf-8 -*-
"""入口页四状态探针：S0 → S1 → S2/S3，检查粒子/冲击波/闪光与最终跳转"""
import io

src = io.open('dist/index.html', encoding='utf-8').read()

probe = """
  <script>
    window.addEventListener("load", function () {
      try {
        var log = [];
        var stage = document.querySelector(".stage");
        var card = document.querySelector(".entry-card--uu");
        log.push("S0:" + (stage.className || "-"));

        card.click();                       /* S0 → S1 */
        log.push("S1:" + stage.className + "|selected=" + card.classList.contains("is-selected") +
                 "|hint=" + document.querySelector(".entry-hint").textContent.slice(0, 6));

        card.click();                       /* S1 → S2（粒子/喷泉/冲击波同步产生） */
        log.push("S2:" + stage.className +
                 "|particles=" + document.querySelectorAll(".particle").length +
                 "|shockwave=" + document.querySelectorAll(".shockwave").length);

        setTimeout(function () {
          log.push("S3:" + stage.className + "|flash=" + document.querySelectorAll(".flash").length);
          document.title = "ENTRY " + log.join(" || ") + " | lastFace=" + localStorage.getItem("uum-last-face");
        }, 900);
      } catch (e) {
        document.title = "ERR " + e.message;
      }
    });
  </script>
"""

io.open('dist/_probe-entry.html', 'w', encoding='utf-8', newline='\n').write(
    src.replace('</body>', probe + '</body>')
)
print('入口页探针已生成')
