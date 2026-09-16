/*
==========================================================================

	UU&Mixt · uum-server 存储层（docs/09 T5-1）
	两种实现，同一接口：
	  · MockStore   —— 内存存储，-mock 自测用（不碰 git，curl 跑通全部接口）
	  · GitStore    —— 服务器 git 工作副本：写/删即 git commit（审计）+ push 主库
	共同约束：
	  · 路径白名单（face 由 token 推导，接口不接受 face 参数）：
	      src/content/<face>/**          本人面文章
	      src/config/categories-<face>.json  本人分类配置
	      src/data/friends.json          站点级友链（决策 7.16，两位作者都可维护）
	      public/images/<face>/**        本人面图片
	  · 拒绝 ..、绝对路径、反斜杠、符号链接（含父目录链上的符号链接逃逸）
	  · sha 乐观锁：git blob SHA-1，409 = 内容已被另一端修改
	==========================================================================
*/
package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

/* ---------- 错误哨兵：handler 统一映射为中文 + HTTP 状态码 ---------- */

var (
	errBadPath   = errors.New("路径不合法（400）：请使用相对路径，不含 .. 与反斜杠")
	errForbidden = errors.New("路径越权（403）：只能操作本人面的文章、分类与图片，以及站点级友链")
	errNotFound  = errors.New("文件不存在（404）")
	errConflict  = errors.New("内容已被另一端修改（409）：请刷新页面后重试")
	errTooLarge  = errors.New("文件超过大小限制（413）")
)

/* ---------- 路径校验（两种存储共用，保证 mock 与真实行为一致） ---------- */

func validateDir(face, raw string) (string, error)  { return validatePath(face, raw, true) }
func validateFile(face, raw string) (string, error) { return validatePath(face, raw, false) }

func validatePath(face, raw string, isDir bool) (string, error) {
	if raw == "" {
		return "", errBadPath
	}
	if strings.Contains(raw, "\\") || strings.HasPrefix(raw, "/") {
		return "", errBadPath
	}
	clean := path.Clean(raw)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", errBadPath
	}
	if !allowedPath(face, clean, isDir) {
		return "", errForbidden
	}
	return clean, nil
}

func allowedPath(face, clean string, isDir bool) bool {
	contentDir := "src/content/" + face
	imagesDir := "public/images/" + face
	if isDir { // 列目录允许目录本身（desk.js 调 listDir("src/content/<face>") 不带尾斜杠）
		return clean == contentDir || strings.HasPrefix(clean, contentDir+"/") ||
			clean == imagesDir || strings.HasPrefix(clean, imagesDir+"/")
	}
	switch {
	case strings.HasPrefix(clean, contentDir+"/"):
		return true
	case clean == "src/config/categories-"+face+".json":
		return true
	case clean == "src/config/author-"+face+".json": // 作者简介与个人标签（决策 7.21，只能改自己那面）
		return true
	case clean == "src/data/friends.json": // 站点级共享数据（决策 7.16）
		return true
	case strings.HasPrefix(clean, imagesDir+"/"):
		return true
	}
	return false
}

/* gitBlobHash：与 git blob 一致的 SHA-1（"blob <len>\\0" + 内容），路径无关 */
func gitBlobHash(b []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d", len(b))
	h.Write([]byte{0})
	h.Write(b)
	return hex.EncodeToString(h.Sum(nil))
}

/* ---------- Store 接口 ---------- */

type FileInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
	SHA  string `json:"sha"`
	Type string `json:"type"` // 恒为 "file"（写作台只消费文件）
}

type Store interface {
	List(face, rel string) ([]FileInfo, error)
	Read(face, rel string) ([]byte, error)
	// Write 返回 (新 blob sha, 短 commit 号, 告警, 错误)；overwrite=true 且 sha 为空时允许覆盖已存在文件（媒体面板不跟踪图片 sha）
	Write(face, rel string, data []byte, msg, sha string, overwrite bool) (string, string, string, error)
	Delete(face, rel string, msg, sha string) (string, string, error)

	// ---------- 标签池（站点级共享，决策 7.23；只经 /api/tags/* 端点触达，不走 /api/write） ----------
	// ScanTags 全站文章标签：map[仓库相对路径]tags（两面都扫；只认单行 tags: [a, b] 格式）
	ScanTags() (map[string][]string, error)
	// ReadTagPool 标签池（src/config/tag-pool.json）；文件不存在视为空池
	ReadTagPool() ([]string, error)
	// ApplyTagChange 原子应用一次标签变更（池 + 全站文章级联，单次提交；face 仅入审计尾注）
	ApplyTagChange(op TagOp, msg, face string) (TagResult, string, error)
	// BackfillTags 存量回填：把全站文章标签 upsert 进池（决策 7.26，幂等；无 delta 不产生提交）。
	// 返回实际新入池的标签数。
	BackfillTags() (int, error)
	// RemoveCategory 删除本人面分类（决策 7.26）：配置条目移除；该分类文章 category 级联改
	// 「未分类」；兜底分类缺失时自动种子且本身不可删；单次提交。返回级联文章数与短 commit 号。
	RemoveCategory(face, name, msg string) (int, string, error)
}

/* ---------- MockStore：内存实现（-mock 自测） ---------- */

type MockStore struct {
	mu   sync.Mutex
	data map[string][]byte
}

func NewMockStore() *MockStore {
	seed := "---\ntitle: \"tcache 结构体布局\"\nslug: tcache-layout\ndate: 2026-08-20\nauthor: mixt\ncategory: 堆利用\ntags: [pwn, glibc]\n---\n\n正文……\n"
	return &MockStore{data: map[string][]byte{
		"src/content/mixt/tcache-layout.md": []byte(seed),
	}}
}

func (m *MockStore) List(face, rel string) ([]FileInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	prefix := rel
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	var out []FileInfo
	for k, v := range m.data {
		rest := strings.TrimPrefix(k, prefix)
		if strings.HasPrefix(k, prefix) && !strings.Contains(rest, "/") {
			out = append(out, FileInfo{Name: rest, Path: k, SHA: gitBlobHash(v), Type: "file"})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (m *MockStore) Read(face, rel string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, err := validateFile(face, rel); err != nil {
		return nil, err
	}
	b, ok := m.data[rel]
	if !ok {
		return nil, errNotFound
	}
	return b, nil
}

func (m *MockStore) Write(face, rel string, data []byte, msg, sha string, overwrite bool) (string, string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, err := validateFile(face, rel); err != nil {
		return "", "", "", err
	}
	cur, ok := m.data[rel]
	if ok {
		curSha := gitBlobHash(cur)
		if sha == "" && !overwrite || sha != "" && sha != curSha {
			return "", "", "", errConflict
		}
		if bytes.Equal(cur, data) {
			return curSha, "mock", "", nil // 内容未变：幂等成功
		}
	}
	m.data[rel] = data
	// 决策 7.26：保存文章时标签自动入池（mock 与 GitStore 同语义，不产生提交）
	if strings.HasPrefix(rel, "src/content/") && strings.HasSuffix(rel, ".md") {
		if tags, ok := parseFrontmatterTags(string(data)); ok {
			if pool, perr := mockReadTagPool(m.data); perr == nil {
				if newPool, added := mergeTagsIntoPool(pool, tags); len(added) > 0 {
					m.data[TagPoolFile] = marshalTagPool(newPool)
				}
			}
		}
	}
	return gitBlobHash(data), "mock", "", nil
}

func (m *MockStore) Delete(face, rel string, msg, sha string) (string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, err := validateFile(face, rel); err != nil {
		return "", "", err
	}
	cur, ok := m.data[rel]
	if !ok {
		return "", "", errNotFound
	}
	if sha == "" || sha != gitBlobHash(cur) {
		return "", "", errConflict
	}
	delete(m.data, rel)
	return "mock", "", nil
}

/* ---------- MockStore：标签池（与 GitStore 同语义，不碰 git） ---------- */

func mockScanTags(data map[string][]byte) map[string][]string {
	out := map[string][]string{}
	for k, v := range data {
		if strings.HasPrefix(k, "src/content/") && strings.HasSuffix(k, ".md") {
			if tags, ok := parseFrontmatterTags(string(v)); ok {
				out[k] = tags
			}
		}
	}
	return out
}

func (m *MockStore) ScanTags() (map[string][]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return mockScanTags(m.data), nil
}

func (m *MockStore) ReadTagPool() ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return mockReadTagPool(m.data)
}

func mockReadTagPool(data map[string][]byte) ([]string, error) {
	raw, ok := data[TagPoolFile]
	if !ok {
		return []string{}, nil
	}
	return unmarshalTagPool(raw)
}

func (m *MockStore) ApplyTagChange(op TagOp, msg, face string) (TagResult, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pool, err := mockReadTagPool(m.data)
	if err != nil {
		return TagResult{}, "", err
	}
	newPool, changed, res := computeTagChange(pool, mockScanTags(m.data), op)
	for rel, tags := range changed {
		m.data[rel] = []byte(replaceFrontmatterTags(string(m.data[rel]), tags))
	}
	if !equalStrings(pool, newPool) {
		m.data[TagPoolFile] = marshalTagPool(newPool)
	}
	return res, "mock", nil
}

/* ---------- GitStore：服务器 git 工作副本 ---------- */

type GitStore struct {
	mu          sync.Mutex
	repoPath    string
	authorName  string
	authorEmail string
}

func NewGitStore(repoPath, authorName, authorEmail string) (*GitStore, error) {
	abs, err := filepath.Abs(repoPath)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(filepath.Join(abs, ".git")); err != nil {
		return nil, fmt.Errorf("repoPath 不是 git 工作副本（缺 .git）：%s", abs)
	}
	return &GitStore{repoPath: abs, authorName: authorName, authorEmail: authorEmail}, nil
}

/* abs 把仓库内相对路径转绝对路径，并做符号链接逃逸检查（白名单之外的二道防线） */
func (g *GitStore) abs(rel string) (string, error) {
	full := filepath.Join(g.repoPath, filepath.FromSlash(rel))
	if !strings.HasPrefix(full, g.repoPath+string(os.PathSeparator)) {
		return "", errBadPath
	}
	// 从目标向上找第一个存在的祖先，解析符号链接后必须仍在仓库根内
	existing := full
	for {
		if _, err := os.Lstat(existing); os.IsNotExist(err) {
			parent := filepath.Dir(existing)
			if parent == existing {
				break
			}
			existing = parent
			continue
		}
		break
	}
	resolvedRepo, err := filepath.EvalSymlinks(g.repoPath)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", err
	}
	if resolved != resolvedRepo && !strings.HasPrefix(resolved, resolvedRepo+string(os.PathSeparator)) {
		return "", errForbidden
	}
	if fi, err := os.Lstat(full); err == nil && fi.Mode()&os.ModeSymlink != 0 {
		return "", errForbidden // 目标本身是符号链接：拒绝
	}
	return full, nil
}

/*
alignMain 在每次写/删前把工作副本对齐主库 origin/main。

	背景（2026-09-16 事故）：master 从本地直推主库后，work 落后于 origin/main，
	此时写作台提交的 push 会因非快进被拒（仅 warning），而下一次构建的
	reset --hard origin/main 会把未推送的作者内容整链销毁。
	工作副本在两次操作之间总是干净的（每次写/删即提交，mu 串行），这里
	先对齐再落盘即可保证本提交必然可快进推送。
*/
func (g *GitStore) alignMain() error {
	if _, err := g.git("fetch", "origin"); err != nil {
		return nil // 主库不可达：沿用当前副本（push 失败仍有 warning 兜底）
	}
	// 有未推送的本地提交时绝不能 reset——那会销毁作者内容；
	// 此时跳过对齐，交给本次提交后 push 失败路径的 rebase 自愈。
	if out, _ := g.git("rev-list", "--count", "origin/main..HEAD"); strings.TrimSpace(out) != "0" {
		log.Printf("[store] alignMain: 检测到未推送本地提交，跳过 reset（保留待自愈）")
		return nil
	}
	if _, err := g.git("reset", "--hard", "origin/main"); err != nil {
		return fmt.Errorf("工作副本对齐主库失败：%w", err)
	}
	return nil
}

func (g *GitStore) List(face, rel string) ([]FileInfo, error) {
	full, err := g.abs(rel)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(full)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errNotFound
		}
		return nil, err
	}
	var out []FileInfo
	for _, e := range entries {
		if e.IsDir() || e.Type()&os.ModeSymlink != 0 {
			continue
		}
		b, err := os.ReadFile(filepath.Join(full, e.Name()))
		if err != nil {
			continue
		}
		out = append(out, FileInfo{Name: e.Name(), Path: rel + "/" + e.Name(), SHA: gitBlobHash(b), Type: "file"})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (g *GitStore) Read(face, rel string) ([]byte, error) {
	full, err := g.abs(rel)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errNotFound
		}
		return nil, err
	}
	return b, nil
}

func (g *GitStore) Write(face, rel string, data []byte, msg, sha string, overwrite bool) (string, string, string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.alignMain(); err != nil {
		return "", "", "", err
	}
	full, err := g.abs(rel)
	if err != nil {
		return "", "", "", err
	}
	cur, curErr := os.ReadFile(full)
	if curErr == nil {
		curSha := gitBlobHash(cur)
		if (sha == "" && !overwrite) || (sha != "" && sha != curSha) {
			return "", "", "", errConflict
		}
		if bytes.Equal(cur, data) {
			return curSha, "", "", nil // 内容未变：幂等成功，不产生空提交
		}
	} else if !os.IsNotExist(curErr) {
		return "", "", "", curErr
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return "", "", "", err
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return "", "", "", err
	}
	// 决策 7.26：保存文章时 frontmatter 标签自动 upsert 入池，与文章同一次提交。
	// 池写失败不阻塞保存——池是衍生数据，启动回填/下次保存会补。
	rels := []string{rel}
	if strings.HasPrefix(rel, "src/content/") && strings.HasSuffix(rel, ".md") {
		if tags, ok := parseFrontmatterTags(string(data)); ok {
			pool, perr := g.ReadTagPool()
			if perr != nil {
				log.Printf("[tags] 池读取失败（不阻塞保存）：%v", perr)
			} else if newPool, added := mergeTagsIntoPool(pool, tags); len(added) > 0 {
				if werr := g.writePoolFile(newPool); werr == nil {
					rels = append(rels, TagPoolFile)
					log.Printf("[tags] 自动入池 %v（face=%s）", added, face)
				} else {
					log.Printf("[tags] 池写入失败（不阻塞保存）：%v", werr)
				}
			}
		}
	}
	commit, warning, err := g.commit(msg, face, rels...)
	return gitBlobHash(data), commit, warning, err
}

func (g *GitStore) Delete(face, rel string, msg, sha string) (string, string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.alignMain(); err != nil {
		return "", "", err
	}
	full, err := g.abs(rel)
	if err != nil {
		return "", "", err
	}
	cur, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", errNotFound
		}
		return "", "", err
	}
	if sha == "" || sha != gitBlobHash(cur) {
		return "", "", errConflict
	}
	if err := os.Remove(full); err != nil {
		return "", "", err
	}
	return g.commit(msg, face, rel)
}

/* ---------- GitStore：标签池（站点级共享，决策 7.23） ----------
   ScanTags 只扫两面文章目录（与 Astro glob '*.md' 同口径：非递归）；
   ApplyTagChange 在同一把锁下读-改-写全部受影响文件，一次 git add + 单次提交。 */

func (g *GitStore) collectMarkdown() (map[string][]byte, error) {
	out := map[string][]byte{}
	for _, face := range []string{"uu", "mixt"} {
		dir := filepath.Join(g.repoPath, "src", "content", face)
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, e := range entries {
			if e.IsDir() || e.Type()&os.ModeSymlink != 0 || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			b, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				continue
			}
			out["src/content/"+face+"/"+e.Name()] = b
		}
	}
	return out, nil
}

func (g *GitStore) ScanTags() (map[string][]string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	files, err := g.collectMarkdown()
	if err != nil {
		return nil, err
	}
	out := map[string][]string{}
	for rel, b := range files {
		if tags, ok := parseFrontmatterTags(string(b)); ok {
			out[rel] = tags
		}
	}
	return out, nil
}

func (g *GitStore) ReadTagPool() ([]string, error) {
	b, err := os.ReadFile(filepath.Join(g.repoPath, filepath.FromSlash(TagPoolFile)))
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	return unmarshalTagPool(b)
}

func (g *GitStore) ApplyTagChange(op TagOp, msg, face string) (TagResult, string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	pool, err := g.ReadTagPool() // 不加锁的内部读，安全（本方法已持锁）
	if err != nil {
		return TagResult{}, "", err
	}
	files, err := g.collectMarkdown()
	if err != nil {
		return TagResult{}, "", err
	}
	postTags := map[string][]string{}
	for rel, b := range files {
		if tags, ok := parseFrontmatterTags(string(b)); ok {
			postTags[rel] = tags
		}
	}
	newPool, changed, res := computeTagChange(pool, postTags, op)

	var touched []string
	if !equalStrings(pool, newPool) {
		poolPath := filepath.Join(g.repoPath, filepath.FromSlash(TagPoolFile))
		if err := os.MkdirAll(filepath.Dir(poolPath), 0o755); err != nil {
			return TagResult{}, "", err
		}
		if err := os.WriteFile(poolPath, marshalTagPool(newPool), 0o644); err != nil {
			return TagResult{}, "", err
		}
		touched = append(touched, TagPoolFile)
	}
	for rel, tags := range changed {
		full, err := g.abs(rel)
		if err != nil {
			return TagResult{}, "", err
		}
		if err := os.WriteFile(full, []byte(replaceFrontmatterTags(string(files[rel]), tags)), 0o644); err != nil {
			return TagResult{}, "", err
		}
		touched = append(touched, rel)
	}
	if len(touched) == 0 { // 幂等：标签不存在/无变化 → 不产生空提交
		return res, "", nil
	}
	commit, warning, err := g.commit(msg, face, touched...)
	if warning != "" {
		log.Printf("[tags] push warning: %s", warning)
	}
	return res, commit, err
}

/*
commit 提交一批路径变更并推送到主库（origin = /srv/uum/repo.git）。

	推送失败不阻塞作者（内容已落工作副本），以 warning 字段返回，日志可见。
	多路径（标签池级联改名）共用一次提交，保证原子性。
*/
func (g *GitStore) commit(msg, face string, rels ...string) (string, string, error) {
	msg = strings.TrimSpace(strings.ReplaceAll(msg, "\r", ""))
	if msg == "" {
		msg = "content: 写作台更新"
	}
	if runes := []rune(msg); len(runes) > 300 {
		msg = string(runes[:300])
	}
	full := msg + "\n\nVia: 写作台\nAuthor-Face: " + face

	args := append([]string{"add", "--"}, rels...)
	if _, err := g.git(args...); err != nil {
		return "", "", fmt.Errorf("git add 失败：%w", err)
	}
	out, err := g.git("commit", "-m", full)
	if err != nil {
		if strings.Contains(out, "nothing to commit") {
			return "", "", nil // 竞态下内容与 HEAD 一致：视为成功
		}
		return "", "", fmt.Errorf("git commit 失败：%s", strings.TrimSpace(out))
	}
	rev, err := g.git("rev-parse", "--short", "HEAD")
	if err != nil {
		return "", "", nil
	}
	commit := strings.TrimSpace(rev)
	if _, err := g.git("push", "origin", "HEAD:main"); err != nil {
		// 自愈重试：主库可能被 master 本地直推领先（非快进）——rebase 本提交后再推一次
		if _, ferr := g.git("fetch", "origin"); ferr == nil {
			if _, rerr := g.git("rebase", "origin/main"); rerr == nil {
				if _, perr := g.git("push", "origin", "HEAD:main"); perr == nil {
					return commit, "", nil // 重试成功
				}
			}
		}
		warn := "已提交到工作副本，但推送主库失败（自动重试后仍未成功）：" + strings.TrimSpace(err.Error())
		log.Printf("[store] push warning: %s", warn)
		return commit, warn, nil
	}
	return commit, "", nil
}

func (g *GitStore) git(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = g.repoPath
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME="+g.authorName, "GIT_AUTHOR_EMAIL="+g.authorEmail,
		"GIT_COMMITTER_NAME="+g.authorName, "GIT_COMMITTER_EMAIL="+g.authorEmail,
	)
	out, err := cmd.CombinedOutput()
	return string(out), err
}
