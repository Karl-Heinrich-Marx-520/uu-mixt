/*
==========================================================================

	UU&Mixt · uum-server —— 写作台首屏数据包（决策 7.41 · 2026-10-14）

	背景（nginx 日志实测）：写作台进入首屏要 1 次 list + N 次 read + 分类 +
	简介 + 友链 + 标签池，**共 18 次串行往返**（前台是 for + await 逐个读）。
	作者侧每次往返约 0.5s（12:27:40 → 12:27:49），首屏要等 9-10 秒——
	站点静态资源没问题，慢的是这串串行请求。

	本端点把首屏所需内容压成一次响应：

	  GET /api/desk → {
	    posts:      [{path, sha, content}]  本人面全部 .md（每篇只读一次）
	    categories: {path, sha, content} | null
	    author:     {path, sha, content} | null
	    friends:    {path, sha, content} | null   站点级（两位作者都可维护）
	    tags:       {tags: [{name, count}], pool: [...]}  站点级汇总
	  }

	面（face）仍由 token 推导，接口不接受 face 参数（与其余端点同纪律）。
	只读端点，不触碰乐观锁：content 与 sha 的口径与 /api/read 完全一致，
	保存/删除后前台仍走 /api/write、/api/file + 各自的单文件读，语义不变。

	失败降级：前台拿不到本端点（旧二进制 / 网络抖动）时自动回落到逐文件接口，
	所以部署顺序「先二进制作后前台」不会出现空面板。

==========================================================================
*/
package main

import (
	"errors"
	"log"
	"net/http"
	"strings"
)

// bundleFile 与 /api/read 的响应形状保持一致（content + sha），前台解析逻辑可直接复用
type bundleFile struct {
	Path    string `json:"path"`
	SHA     string `json:"sha"`
	Content string `json:"content"`
}

type deskBundle struct {
	Posts      []bundleFile `json:"posts"`
	Categories *bundleFile  `json:"categories"`
	Author     *bundleFile  `json:"author"`
	Friends    *bundleFile  `json:"friends"`
	Tags       tagsPayload  `json:"tags"`
}

// readOptional 读一个可选文件：不存在视为「本面还没建」（nil, nil），其余错误照常上抛
func readOptional(st Store, face, rel string) (*bundleFile, error) {
	data, err := st.Read(face, rel)
	if err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &bundleFile{Path: rel, SHA: gitBlobHash(data), Content: string(data)}, nil
}

/* ---------- GET /api/desk：一次取齐首屏六个面板 ---------- */

func (s *server) handleDesk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	a, ok := s.author(r)
	if !ok {
		unauthorized(w)
		return
	}

	files, err := s.store.List(a.Face, "src/content/"+a.Face)
	if err != nil {
		s.fail(w, err)
		return
	}
	out := deskBundle{Posts: make([]bundleFile, 0, len(files))}
	for _, f := range files {
		if !strings.HasSuffix(f.Name, ".md") {
			continue // 与 Astro glob '*.md' 同口径（写作台也只认 .md）
		}
		data, err := s.store.Read(a.Face, f.Path)
		if err != nil {
			// 单篇读失败不炸整个首屏：跳过并留日志（前台少一篇总比空面板好）
			log.Printf("[desk] 跳过读不到的文章 face=%s path=%s: %v", a.Face, f.Path, err)
			continue
		}
		out.Posts = append(out.Posts, bundleFile{Path: f.Path, SHA: gitBlobHash(data), Content: string(data)})
	}

	if out.Categories, err = readOptional(s.store, a.Face, "src/config/categories-"+a.Face+".json"); err != nil {
		s.fail(w, err)
		return
	}
	if out.Author, err = readOptional(s.store, a.Face, "src/config/author-"+a.Face+".json"); err != nil {
		s.fail(w, err)
		return
	}
	if out.Friends, err = readOptional(s.store, a.Face, "src/data/friends.json"); err != nil {
		s.fail(w, err)
		return
	}
	if out.Tags, err = tagSummary(s.store); err != nil {
		s.fail(w, err)
		return
	}

	log.Printf("[desk] face=%s posts=%d tags=%d pool=%d", a.Face, len(out.Posts), len(out.Tags.Tags), len(out.Tags.Pool))
	writeJSON(w, http.StatusOK, out)
}
