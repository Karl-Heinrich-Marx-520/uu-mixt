/*
==========================================================================

	UU&Mixt · uum-server 标签池（决策 7.23：全站共享，两位作者均可维护）
	· GET  /api/tags         汇总：全站文章标签计数 + 池（池内 count=0 待用）
	· POST /api/tags/add     池新增（重复幂等返回 exists=true）
	· POST /api/tags/rename  改名级联全站文章 frontmatter（单次提交，审计尾注记发起者）
	· POST /api/tags/remove  删除级联全站文章 + 池（单次提交）
	语义与 demo/assets/demo-store.js 的 tagPool/addPoolTag/renameTag/removeTag 一致：
	  · rename：新名已存在（池或任意文章）→ merged=true，文章里旧名并入新名
	    （同篇双标签只移除旧名）；纯池改名（新名无处存在且无文章改写）→ 新名补入池
	  · remove：从池与所有文章移除；标签不存在时幂等成功（posts=0，不产生空提交）
	文章 frontmatter 只认单行方括号格式（tags: [a, b]）——与写作台 buildFrontmatter
	产出的格式一致；YAML 块状列表不解析、不改写（当前仓库不存在该形态）。
	tag-pool.json 不在 /api/write 白名单内：只能经本组端点服务端读改写，避免乐观锁竞态。
	==========================================================================
*/
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

const TagPoolFile = "src/config/tag-pool.json"

/* ---------- 变更请求/结果 ---------- */

type TagOp struct {
	Add        string // 池新增标签名（可空）
	RenameFrom string // 改名：旧名（可空）
	RenameTo   string
	Remove     string // 删除：标签名（可空）
}

type TagResult struct {
	Posts  int      `json:"posts"`          // rename/remove 级联影响的文章数
	Merged bool     `json:"merged"`         // rename：新名已存在（文章或池），旧名文章并入新名
	Exists bool     `json:"exists"`         // add：标签已在池中（幂等）
	Pool   []string `json:"pool"`           // 变更后的池
	Commit string   `json:"commit"`         // 短 commit 号（无变更时为空）
}

/* ---------- frontmatter tags 行解析/改写（单行方括号格式） ---------- */

var tagLineRe = regexp.MustCompile(`(?m)^tags:[ \t]*\[([^\]]*)\][ \t]*$`)

func parseFrontmatterTags(text string) ([]string, bool) {
	m := tagLineRe.FindStringSubmatch(text)
	if m == nil {
		return nil, false
	}
	inner := strings.TrimSpace(m[1])
	if inner == "" {
		return []string{}, true
	}
	tags := []string{}
	for _, p := range strings.Split(inner, ",") {
		t := strings.Trim(strings.TrimSpace(p), `"'`)
		if t != "" {
			tags = append(tags, t)
		}
	}
	return tags, true
}

func replaceFrontmatterTags(text string, tags []string) string {
	return tagLineRe.ReplaceAllString(text, "tags: ["+strings.Join(tags, ", ")+"]")
}

/* ---------- 池文件编解码 ---------- */

func unmarshalTagPool(b []byte) ([]string, error) {
	var pool []string
	if err := json.Unmarshal(b, &pool); err != nil {
		return nil, fmt.Errorf("tag-pool.json 解析失败：%w", err)
	}
	if pool == nil {
		pool = []string{}
	}
	return pool, nil
}

func marshalTagPool(pool []string) []byte {
	b, _ := json.MarshalIndent(pool, "", "  ")
	return append(b, '\n')
}

/* ---------- 小工具 ---------- */

func containsString(list []string, s string) bool {
	for _, t := range list {
		if t == s {
			return true
		}
	}
	return false
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

/*
computeTagChange 纯函数：对 (池, 文章标签) 应用一次变更。

	postTags：map[路径]→tags（只含解析出 tags 行的文章，其余文章不参与也不改写）。
	返回：新池、需要改写的文章（路径→新 tags，只含有变化者）、统计结果。
*/
func computeTagChange(pool []string, postTags map[string][]string, op TagOp) ([]string, map[string][]string, TagResult) {
	changed := map[string][]string{}
	res := TagResult{}
	newPool := append([]string{}, pool...)

	switch {
	case op.Add != "":
		if containsString(pool, op.Add) {
			res.Exists = true
		} else {
			newPool = append(newPool, op.Add)
		}

	case op.RenameFrom != "":
		to := op.RenameTo
		// 先于任何改写判断：新名是否已存在于池或任意文章（demo renameTag 语义）
		toExists := containsString(pool, to)
		if !toExists {
			for _, tags := range postTags {
				if containsString(tags, to) {
					toExists = true
					break
				}
			}
		}
		for rel, tags := range postTags {
			if !containsString(tags, op.RenameFrom) {
				continue
			}
			next := make([]string, 0, len(tags))
			for _, t := range tags {
				if t == op.RenameFrom {
					if containsString(tags, to) {
						continue // 同篇双标签：旧名并入新名，只移除旧名
					}
					next = append(next, to)
					continue
				}
				next = append(next, t)
			}
			changed[rel] = next
		}
		res.Posts = len(changed)
		res.Merged = toExists
		newPool = []string{}
		for _, t := range pool {
			if t != op.RenameFrom {
				newPool = append(newPool, t)
			}
		}
		// 纯池改名：新名无处存在且没有文章被改写 → 新名补入池
		if !toExists && res.Posts == 0 && !containsString(newPool, to) {
			newPool = append(newPool, to)
		}

	case op.Remove != "":
		newPool = []string{}
		for _, t := range pool {
			if t != op.Remove {
				newPool = append(newPool, t)
			}
		}
		for rel, tags := range postTags {
			if !containsString(tags, op.Remove) {
				continue
			}
			next := []string{}
			for _, t := range tags {
				if t != op.Remove {
					next = append(next, t)
				}
			}
			changed[rel] = next
		}
		res.Posts = len(changed)
	}

	if newPool == nil {
		newPool = []string{}
	}
	res.Pool = newPool
	return newPool, changed, res
}

/* ---------- 标签名合法性：非空、≤24 字、不含分隔/括号字符 ---------- */

func validTagName(s string) bool {
	if s == "" {
		return false
	}
	if runes := []rune(s); len(runes) > 24 {
		return false
	}
	return !strings.ContainsAny(s, ",[]\"'\\")
}

/* ---------- GET /api/tags：汇总（文章标签计数 + 池） ---------- */

func (s *server) handleTags(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := s.author(r); !ok { // 站点级数据：读汇总不区分面，仅要求有效登录
		unauthorized(w)
		return
	}
	postTags, err := s.store.ScanTags()
	if err != nil {
		s.fail(w, err)
		return
	}
	pool, err := s.store.ReadTagPool()
	if err != nil {
		s.fail(w, err)
		return
	}
	counts := map[string]int{}
	for _, tags := range postTags {
		for _, t := range tags {
			counts[t]++
		}
	}
	names := []string{}
	for t := range counts {
		names = append(names, t)
	}
	for _, t := range pool { // 池内待用标签（count=0）也展示
		if _, ok := counts[t]; !ok {
			names = append(names, t)
		}
	}
	type tagStat struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}
	out := make([]tagStat, 0, len(names))
	for _, n := range names {
		out = append(out, tagStat{Name: n, Count: counts[n]})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]any{"tags": out, "pool": pool})
}

/* ---------- POST /api/tags/add|rename|remove ---------- */

func (s *server) tagChange(w http.ResponseWriter, r *http.Request, op TagOp, commitMsg string) {
	a, ok := s.author(r)
	if !ok {
		unauthorized(w)
		return
	}
	if !s.lim.allow("write:"+a.Hash, s.cfg.PerTokenPerMin) {
		tooFrequent(w)
		return
	}
	res, commit, err := s.store.ApplyTagChange(op, commitMsg, a.Face)
	if err != nil {
		s.fail(w, err)
		return
	}
	res.Commit = commit
	log.Printf("[tags] face=%s op=add:%q rename:%q->%q remove:%q posts=%d merged=%v commit=%s",
		a.Face, op.Add, op.RenameFrom, op.RenameTo, op.Remove, res.Posts, res.Merged, commit)
	writeJSON(w, http.StatusOK, res)
}

func readTagBody(w http.ResponseWriter, r *http.Request) (map[string]string, bool) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求体过大。"})
		return nil, false
	}
	var body map[string]string
	if json.Unmarshal(raw, &body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求体应为 JSON 对象。"})
		return nil, false
	}
	return body, true
}

func (s *server) handleTagsAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, ok := readTagBody(w, r)
	if !ok {
		return
	}
	tag := strings.TrimSpace(body["tag"])
	if !validTagName(tag) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "标签名不合法：非空、不超过 24 字、不含逗号或方括号。"})
		return
	}
	s.tagChange(w, r, TagOp{Add: tag}, "config(tags): 标签池新增「"+tag+"」")
}

func (s *server) handleTagsRename(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, ok := readTagBody(w, r)
	if !ok {
		return
	}
	from := strings.TrimSpace(body["from"])
	to := strings.TrimSpace(body["to"])
	if !validTagName(from) || !validTagName(to) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "标签名不合法：非空、不超过 24 字、不含逗号或方括号。"})
		return
	}
	if from == to {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "新旧标签名相同。"})
		return
	}
	s.tagChange(w, r, TagOp{RenameFrom: from, RenameTo: to},
		"config(tags): 标签改名「"+from+"」→「"+to+"」")
}

func (s *server) handleTagsRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, ok := readTagBody(w, r)
	if !ok {
		return
	}
	tag := strings.TrimSpace(body["tag"])
	if !validTagName(tag) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "标签名不合法。"})
		return
	}
	s.tagChange(w, r, TagOp{Remove: tag}, "config(tags): 移除标签「"+tag+"」")
}
