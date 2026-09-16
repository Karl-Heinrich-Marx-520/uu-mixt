/*
==========================================================================

	UU&Mixt · uum-server 分类级联（决策 7.26：删除分类 → 文章转入「未分类」）
	· POST /api/categories/remove  body {"name": "..."}（face 由 token 推导）
	语义（与 demo/assets/demo-store.js removeCategory 同步演进）：
	  · 删除 categories-<face>.json 中的条目；
	  · 该分类下文章的 frontmatter category 行级联改为「未分类」（单行标量格式）；
	  · 「未分类」是常驻兜底分类：缺失时自动种子（slug: uncategorized），且本身不可删；
	  · 全部改动（配置 + N 篇文章）一次 git add + 单次提交，审计尾注记发起者。
	category 行只认单行标量格式（category: 名称）——与写作台 buildFrontmatter
	产出的格式一致；YAML 块状列表不解析、不改写（当前仓库不存在该形态）。
	==========================================================================
*/
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	FallbackCategory     = "未分类"
	FallbackCategorySlug = "uncategorized"
	fallbackCategoryDesc = "未归入其他分类的文章。"
	CategoriesFileFmt    = "src/config/categories-%s.json"
)

/* ---------- category 行解析/改写（单行标量格式） ---------- */

var categoryLineRe = regexp.MustCompile(`(?m)^category:[ \t]*(\S[^\r\n]*)$`)

// parseFrontmatterCategory 返回 category 行的值（去引号、去空白）。无该行时 ok=false。
func parseFrontmatterCategory(text string) (string, bool) {
	m := categoryLineRe.FindStringSubmatch(text)
	if m == nil {
		return "", false
	}
	return strings.Trim(strings.TrimSpace(m[1]), `"'`), true
}

// replaceFrontmatterCategory 把值为 from 的 category 行改写为 to；无该行或值不同则原样返回。
func replaceFrontmatterCategory(text, from, to string) string {
	return categoryLineRe.ReplaceAllStringFunc(text, func(line string) string {
		v, _ := parseFrontmatterCategory(line)
		if v != from {
			return line
		}
		return "category: " + to
	})
}

/* ---------- 分类配置编解码 ---------- */

type categoryEntry struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	Desc string `json:"desc"`
}

func marshalCategories(cats []categoryEntry) []byte {
	if cats == nil {
		cats = []categoryEntry{}
	}
	b, _ := json.MarshalIndent(cats, "", "  ")
	return append(b, '\n')
}

// seedFallback 若 cats 中没有「未分类」则追加种子，返回（可能新的列表, 是否追加）。
func seedFallback(cats []categoryEntry) ([]categoryEntry, bool) {
	for _, c := range cats {
		if c.Name == FallbackCategory {
			return cats, false
		}
	}
	return append(cats, categoryEntry{Slug: FallbackCategorySlug, Name: FallbackCategory, Desc: fallbackCategoryDesc}), true
}

/* ---------- GitStore：级联删除（配置 + 文章，单次提交） ---------- */

func (g *GitStore) RemoveCategory(face, name, msg string) (int, string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.alignMain(); err != nil {
		return 0, "", err
	}
	cfgRel := fmt.Sprintf(CategoriesFileFmt, face)
	cfgPath := filepath.Join(g.repoPath, filepath.FromSlash(cfgRel))
	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, "", errNotFound
		}
		return 0, "", err
	}
	var cats []categoryEntry
	if err := json.Unmarshal(raw, &cats); err != nil {
		return 0, "", fmt.Errorf("分类配置解析失败：%w", err)
	}
	idx := -1
	for i, c := range cats {
		if c.Name == name {
			idx = i
			break
		}
	}
	if idx == -1 {
		return 0, "", errNotFound
	}
	newCats := append(cats[:idx:idx], cats[idx+1:]...)
	newCats, _ = seedFallback(newCats)

	// 级联：本人面文章里 category == name 的行改为「未分类」
	touched := []string{cfgRel}
	changed := 0
	files, err := g.collectMarkdown()
	if err != nil {
		return 0, "", err
	}
	prefix := "src/content/" + face + "/"
	for rel, body := range files {
		if !strings.HasPrefix(rel, prefix) {
			continue
		}
		if v, ok := parseFrontmatterCategory(string(body)); !ok || v != name {
			continue
		}
		full, err := g.abs(rel)
		if err != nil {
			return 0, "", err
		}
		if err := os.WriteFile(full, []byte(replaceFrontmatterCategory(string(body), name, FallbackCategory)), 0o644); err != nil {
			return 0, "", err
		}
		touched = append(touched, rel)
		changed++
	}
	commit, _, err := g.commit(msg, face, touched...)
	if err != nil {
		return changed, "", err
	}
	return changed, commit, nil
}

/* ---------- MockStore：内存同语义 ---------- */

func (m *MockStore) RemoveCategory(face, name, msg string) (int, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cfgRel := fmt.Sprintf(CategoriesFileFmt, face)
	raw, ok := m.data[cfgRel]
	if !ok {
		return 0, "", errNotFound
	}
	var cats []categoryEntry
	if err := json.Unmarshal(raw, &cats); err != nil {
		return 0, "", fmt.Errorf("分类配置解析失败：%w", err)
	}
	idx := -1
	for i, c := range cats {
		if c.Name == name {
			idx = i
			break
		}
	}
	if idx == -1 {
		return 0, "", errNotFound
	}
	newCats := append(cats[:idx:idx], cats[idx+1:]...)
	newCats, _ = seedFallback(newCats)
	m.data[cfgRel] = marshalCategories(newCats)

	changed := 0
	for rel, body := range m.data {
		if !strings.HasPrefix(rel, "src/content/"+face+"/") || !strings.HasSuffix(rel, ".md") {
			continue
		}
		if v, ok := parseFrontmatterCategory(string(body)); !ok || v != name {
			continue
		}
		m.data[rel] = []byte(replaceFrontmatterCategory(string(body), name, FallbackCategory))
		changed++
	}
	return changed, "mock", nil
}

/* ---------- POST /api/categories/remove ---------- */

func (s *server) handleCategoryRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	a, ok := s.author(r)
	if !ok {
		unauthorized(w)
		return
	}
	if !s.lim.allow("write:"+a.Hash, s.cfg.PerTokenPerMin) {
		tooFrequent(w)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<10))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求读取失败。"})
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(raw, &body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求体应为 JSON 对象。"})
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少分类名。"})
		return
	}
	if name == FallbackCategory {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "「未分类」是兜底分类，不能删除。"})
		return
	}
	changed, commit, err := s.store.RemoveCategory(a.Face, name,
		"config(categories): 删除分类「"+name+"」")
	if err != nil {
		s.fail(w, err)
		return
	}
	log.Printf("[categories] face=%s remove=%q cascaded=%d commit=%s", a.Face, name, changed, commit)
	writeJSON(w, http.StatusOK, map[string]any{
		"cascaded": changed,
		"fallback": FallbackCategory,
		"commit":   commit,
	})
}
