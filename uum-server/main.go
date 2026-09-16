/*
==========================================================================

	UU&Mixt · uum-server —— 统一小服务（PRD 6.1 修订后的唯一常驻组件）
	职责一：写作台写入 API（docs/09 T5-1 · 决策 7.19）
	  · POST   /api/verify  登录验证（token → {login, face}，替代 GitHub /user）
	  · GET    /api/list    列目录（与 gh.js listDir 语义一致）
	  · GET    /api/read    读文件（{content, sha}；404 = 不存在）
	  · POST   /api/write   写文件（JSON 文本 / multipart 图片）
	  · DELETE /api/file    删文件（sha 乐观锁）
	  · face 由 token 推导，接口不接受 face 参数——越面写入做不到
	  · 服务端只存 token 的 SHA-256 哈希；吊销 = 配置里删一条记录
	  · 每次写入/删除即 git commit（作者与时间天然入审计）并推送到服务器主库
	职责二：写作台 AI 摘要助手（决策 7.20 正式版接线，见 assist.go）
	  · POST /api/assist  {title, body} → {description, tags}（服务端持 Key 转发上游）
	职责三：标签池（决策 7.23 全站共享，见 tagpool.go）
	  · GET  /api/tags           汇总（文章标签计数 + 池）
	  · POST /api/tags/add|rename|remove  池维护；rename/remove 级联全站文章，单次提交
	职责四：桌宠 LLM 转发（决策 7.18，同进程，见 petchat.go）
	形态：Go 标准库零依赖单二进制；内存 < 50MB；只监听 127.0.0.1（公网仅 Nginx 反代）；
	配置 /etc/uum/config.json（token hash 表、仓库路径、上游 LLM 三元组）。
	本地自测：-mock 开关切内存存储（不碰 git），curl 跑通全部接口（见 README.md）。
	==========================================================================
*/
package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

/* ---------- 配置 ---------- */

type Author struct {
	Hash  string `json:"hash"`  // sha256(token) 的 hex——服务端永不存明文
	Label string `json:"label"` // 展示名（登录后显示，如 UU / Mixt）
	Face  string `json:"face"`  // uu | mixt
}

type GitConfig struct {
	AuthorName  string `json:"authorName"`
	AuthorEmail string `json:"authorEmail"`
}

type Config struct {
	Listen         string       `json:"listen"`
	RepoPath       string       `json:"repoPath"` // git 工作副本（主库为 /srv/uum/repo.git bare）
	Mock           bool         `json:"mock"`     // true = 内存存储自测，不碰 git
	Tokens         []Author     `json:"tokens"`
	PerTokenPerMin int          `json:"perTokenPerMin"` // 每 token 写操作/登录尝试限频
	MaxTextKB      int          `json:"maxTextKB"`      // Markdown/JSON 单文件上限
	MaxImageMB     int          `json:"maxImageMB"`     // 图片上限
	Git            GitConfig    `json:"git"`
	Pet            PetConfig    `json:"pet"`
	Assist         AssistConfig `json:"assist"`     // 写作台 AI 摘要助手（决策 7.20）
	RebuildScript  string       `json:"rebuildScript"` // 手动触发的服务器端构建脚本（决策 7.24）
}

func loadConfig(p string) (*Config, error) {
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	cfg := &Config{
		Listen:         "127.0.0.1:8787",
		PerTokenPerMin: 30,
		MaxTextKB:      200,
		MaxImageMB:     2,
		Git:            GitConfig{AuthorName: "UU&Mixt 写作台", AuthorEmail: "desk@uuandmixt.com"},
		Pet: PetConfig{
			BaseURL:     "https://api.deepseek.com",
			Model:       "deepseek-chat",
			APIKeyEnv:   "UUM_LLM_KEY",
			TimeoutSec:  30,
			MaxTokens:   300,
			Temperature: 0.8,
			PerIPPerMin: 10,
			DailyQuota:  500,
			CacheTTLMin: 60,
		},
		Assist: AssistConfig{
			BaseURL:        "https://api.deepseek.com",
			Model:          "deepseek-chat",
			APIKeyEnv:      "UUM_LLM_KEY",
			TimeoutSec:     60,
			MaxTokens:      500,
			Temperature:    0.4,
			PerTokenPerMin: 6, // 比写接口更严（决策 7.23 正式版接线）
			MaxBodyRunes:   6000,
		},
		// 决策 7.24：rebuildScript 缺省值——mock 冒烟不执行真脚本，缺了它
		// 只有真实模式首build才暴露（exec.Command("") 必败），2026-09-15 验收补
		RebuildScript: "/srv/uum/bin/uum-rebuild.sh",
	}
	if err := json.Unmarshal(raw, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

/* ---------- 通用限流（分钟滑窗；写作台按 token，桌宠按 IP） ---------- */

type rateLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func (l *rateLimiter) allow(key string, perMin int) bool {
	if perMin <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.hits == nil {
		l.hits = make(map[string][]time.Time)
	}
	now := time.Now()
	recent := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	if len(recent) >= perMin {
		l.hits[key] = recent
		return false
	}
	l.hits[key] = append(recent, now)
	return true
}

/* ---------- 服务 ---------- */

type server struct {
	cfg   *Config
	store Store
	lim   *rateLimiter // 写作台：verify 按 IP、写/删按 token
	start time.Time

	petLim    *rateLimiter  // 桌宠：按 IP
	petQuota  *quotaCounter // 桌宠：全局日配额
	petCache  *answerCache  // 桌宠：同题缓存
	petClient *http.Client  // 桌宠：上游 HTTP（显式直连，不吃环境代理）

	assistClient *http.Client // 写作台 AI 摘要：上游 HTTP（同 petClient 纪律，超时更长）

	rb rebuildState // 手动触发的服务器端构建状态（决策 7.24，见 rebuild.go）
}

/* 鉴权：Authorization: Bearer <token> → sha256 → 查表（恒定时间比较） */
func (s *server) author(r *http.Request) (*Author, bool) {
	h := r.Header.Get("Authorization")
	tok := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	if tok == "" {
		return nil, false
	}
	sum := sha256.Sum256([]byte(tok))
	k := hex.EncodeToString(sum[:])
	for i := range s.cfg.Tokens {
		if subtle.ConstantTimeCompare([]byte(k), []byte(s.cfg.Tokens[i].Hash)) == 1 {
			return &s.cfg.Tokens[i], true
		}
	}
	return nil, false
}

func unauthorized(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, map[string]string{
		"error": "凭据无效（401）：token 缺失、不正确或已被吊销，请重新登录写作台。",
	})
}

func tooFrequent(w http.ResponseWriter) {
	writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "操作过于频繁（429）：请稍后再试。"})
}

/* 统一错误映射：明确中文 + HTTP 状态码，绝不静默（PRD 6.1） */
func (s *server) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errBadPath), errors.Is(err, errForbidden),
		errors.Is(err, errNotFound), errors.Is(err, errConflict), errors.Is(err, errTooLarge):
		writeJSON(w, statusCodeOf(err), map[string]string{"error": err.Error()})
	default:
		log.Printf("[server] 500: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "服务器内部错误（500）：" + err.Error(),
		})
	}
}

func statusCodeOf(err error) int {
	switch {
	case errors.Is(err, errBadPath):
		return http.StatusBadRequest
	case errors.Is(err, errForbidden):
		return http.StatusForbidden
	case errors.Is(err, errNotFound):
		return http.StatusNotFound
	case errors.Is(err, errConflict):
		return http.StatusConflict
	case errors.Is(err, errTooLarge):
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusInternalServerError
}

/* ---------- POST /api/verify：登录验证（服务器端，替代 GET api.github.com/user） ---------- */

func (s *server) handleVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !s.lim.allow("verify:"+ip, s.cfg.PerTokenPerMin) {
		tooFrequent(w)
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<10))
	if err != nil || json.Unmarshal(raw, &body) != nil || strings.TrimSpace(body.Token) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请提交 token。"})
		return
	}
	sum := sha256.Sum256([]byte(body.Token))
	k := hex.EncodeToString(sum[:])
	for _, a := range s.cfg.Tokens {
		if subtle.ConstantTimeCompare([]byte(k), []byte(a.Hash)) == 1 {
			log.Printf("[verify] face=%s ip=%s", a.Face, ip)
			writeJSON(w, http.StatusOK, map[string]string{"login": a.Label, "face": a.Face})
			return
		}
	}
	log.Printf("[verify] 401 ip=%s", ip)
	writeJSON(w, http.StatusUnauthorized, map[string]string{
		"error": "凭据无效（401）：token 不正确或已被吊销，请找 master 核对。",
	})
}

/* ---------- GET /api/list：列目录 ---------- */

func (s *server) handleList(w http.ResponseWriter, r *http.Request) {
	a, ok := s.author(r)
	if !ok {
		unauthorized(w)
		return
	}
	rel, err := validateDir(a.Face, r.URL.Query().Get("path"))
	if err != nil {
		s.fail(w, err)
		return
	}
	files, err := s.store.List(a.Face, rel)
	if err != nil {
		s.fail(w, err)
		return
	}
	if files == nil {
		files = []FileInfo{}
	}
	writeJSON(w, http.StatusOK, files)
}

/* ---------- GET /api/read：读文件 ---------- */

func (s *server) handleRead(w http.ResponseWriter, r *http.Request) {
	a, ok := s.author(r)
	if !ok {
		unauthorized(w)
		return
	}
	rel, err := validateFile(a.Face, r.URL.Query().Get("path"))
	if err != nil {
		s.fail(w, err)
		return
	}
	data, err := s.store.Read(a.Face, rel)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": string(data), "sha": gitBlobHash(data)})
}

/* ---------- POST /api/write：写文件（JSON 文本 / multipart 图片） ---------- */

func (s *server) handleWrite(w http.ResponseWriter, r *http.Request) {
	a, ok := s.author(r)
	if !ok {
		unauthorized(w)
		return
	}
	if !s.lim.allow("write:"+a.Hash, s.cfg.PerTokenPerMin) {
		tooFrequent(w)
		return
	}
	ct := r.Header.Get("Content-Type")
	switch {
	case strings.HasPrefix(ct, "application/json"):
		s.writeText(w, r, a)
	case strings.HasPrefix(ct, "multipart/form-data"):
		s.writeImage(w, r, a)
	default:
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{
			"error": "不支持的请求类型：文本用 application/json，图片用 multipart/form-data。",
		})
	}
}

type writeReq struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Message string `json:"message"`
	SHA     string `json:"sha"`
}

func (s *server) writeText(w http.ResponseWriter, r *http.Request, a *Author) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, int64(s.cfg.MaxTextKB)<<10+16<<10))
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
			"error": fmt.Sprintf("正文超过大小限制（413）：≤ %dKB。", s.cfg.MaxTextKB),
		})
		return
	}
	var req writeReq
	if json.Unmarshal(raw, &req) != nil || req.Path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求体需要 path 与 content。"})
		return
	}
	rel, err := validateFile(a.Face, req.Path)
	if err != nil {
		s.fail(w, err)
		return
	}
	data := []byte(req.Content)
	if len(data) > s.cfg.MaxTextKB<<10 {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
			"error": fmt.Sprintf("正文超过大小限制（413）：≤ %dKB。", s.cfg.MaxTextKB),
		})
		return
	}
	sha, commit, warning, err := s.store.Write(a.Face, rel, data, req.Message, req.SHA, false)
	if err != nil {
		s.fail(w, err)
		return
	}
	log.Printf("[write] face=%s path=%s %d bytes commit=%s", a.Face, rel, len(data), commit)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sha": sha, "commit": commit, "warning": warning})
}

var imageExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".webp": true, ".svg": true, ".avif": true, ".ico": true,
}

func (s *server) writeImage(w http.ResponseWriter, r *http.Request, a *Author) {
	r.Body = http.MaxBytesReader(w, r.Body, int64(s.cfg.MaxImageMB)<<20+64<<10)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
			"error": fmt.Sprintf("图片超过大小限制（413）：≤ %dMB。", s.cfg.MaxImageMB),
		})
		return
	}
	rel, err := validateFile(a.Face, r.FormValue("path"))
	if err != nil {
		s.fail(w, err)
		return
	}
	if ext := strings.ToLower(path.Ext(rel)); !imageExts[ext] {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "只支持图片文件（png/jpg/jpeg/gif/webp/svg/avif/ico）。",
		})
		return
	}
	f, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少文件字段 file。"})
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		s.fail(w, err)
		return
	}
	// sha 可选：留空 = 允许覆盖同名图片（媒体面板不跟踪图片 sha）；给了则做乐观锁
	sha, commit, warning, err := s.store.Write(a.Face, rel, data, r.FormValue("message"), r.FormValue("sha"), true)
	if err != nil {
		s.fail(w, err)
		return
	}
	log.Printf("[image] face=%s path=%s %d bytes commit=%s", a.Face, rel, len(data), commit)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sha": sha, "commit": commit, "warning": warning})
}

/* ---------- DELETE /api/file：删文件 ---------- */

func (s *server) handleDelete(w http.ResponseWriter, r *http.Request) {
	a, ok := s.author(r)
	if !ok {
		unauthorized(w)
		return
	}
	if !s.lim.allow("write:"+a.Hash, s.cfg.PerTokenPerMin) {
		tooFrequent(w)
		return
	}
	q := r.URL.Query()
	rel, err := validateFile(a.Face, q.Get("path"))
	if err != nil {
		s.fail(w, err)
		return
	}
	commit, warning, err := s.store.Delete(a.Face, rel, q.Get("message"), q.Get("sha"))
	if err != nil {
		s.fail(w, err)
		return
	}
	log.Printf("[delete] face=%s path=%s commit=%s", a.Face, rel, commit)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "commit": commit, "warning": warning})
}

/* ---------- GET /healthz ---------- */

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"service":  "uum-server",
		"mock":     s.cfg.Mock,
		"petModel": s.cfg.Pet.Model,
		"uptime":   time.Since(s.start).Round(time.Second).String(),
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

/* ---------- 入口 ---------- */

func main() {
	cfgPath := flag.String("config", "config.json", "配置文件路径")
	mock := flag.Bool("mock", false, "强制内存存储（本地自测，不碰 git）")
	hash := flag.String("hash", "", "打印 token 的 SHA-256 后退出（master 生成配置用）")
	flag.Parse()

	if *hash != "" {
		sum := sha256.Sum256([]byte(*hash))
		fmt.Println(hex.EncodeToString(sum[:]))
		return
	}

	cfg, err := loadConfig(*cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if *mock {
		cfg.Mock = true
	}
	if len(cfg.Tokens) == 0 {
		log.Fatal("tokens 为空：至少需要一位作者的 token hash（用 -hash 生成）")
	}

	var store Store
	if cfg.Mock {
		store = NewMockStore()
		log.Println("uum-server: MOCK 内存存储（自测模式，不碰 git）")
	} else {
		if cfg.RepoPath == "" {
			log.Fatal("repoPath 未配置：请指向服务器 git 工作副本（如 /srv/uum/work）")
		}
		store, err = NewGitStore(cfg.RepoPath, cfg.Git.AuthorName, cfg.Git.AuthorEmail)
		if err != nil {
			log.Fatalf("git store: %v", err)
		}
	}

	// 决策 7.26：启动时把存量文章标签一次性回填进池（幂等；无 delta 不产生提交）。
	// 兜住「池上线前已存在的文章」——之后每次保存文章都会即时入池。
	if n, err := store.BackfillTags(); err != nil {
		log.Printf("[tags] 存量回填失败（服务继续，可重启重试）：%v", err)
	} else if n > 0 {
		log.Printf("[tags] 存量回填：%d 个标签入池", n)
	}

	s := &server{
		cfg:      cfg,
		store:    store,
		lim:      &rateLimiter{},
		start:    time.Now(),
		petLim:   &rateLimiter{},
		petQuota: &quotaCounter{day: time.Now().Format("2006-01-02")},
		petCache: &answerCache{m: make(map[string]petCacheEntry)},
		/* 显式直连：转发服务不受部署机环境代理影响 */
		petClient: &http.Client{
			Timeout:   time.Duration(cfg.Pet.TimeoutSec) * time.Second,
			Transport: &http.Transport{Proxy: nil},
		},
		assistClient: &http.Client{
			Timeout:   time.Duration(cfg.Assist.TimeoutSec) * time.Second,
			Transport: &http.Transport{Proxy: nil},
		},
	}
	s.rb.init()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/verify", s.handleVerify)
	mux.HandleFunc("/api/list", s.handleList)
	mux.HandleFunc("/api/read", s.handleRead)
	mux.HandleFunc("/api/write", s.handleWrite)
	mux.HandleFunc("/api/file", s.handleDelete)
	mux.HandleFunc("/api/assist", s.handleAssist)
	mux.HandleFunc("/api/tags", s.handleTags)
	mux.HandleFunc("/api/tags/add", s.handleTagsAdd)
	mux.HandleFunc("/api/tags/rename", s.handleTagsRename)
	mux.HandleFunc("/api/tags/remove", s.handleTagsRemove)
	mux.HandleFunc("/api/categories/remove", s.handleCategoryRemove)
	mux.HandleFunc("/api/rebuild", s.handleRebuild)
	mux.HandleFunc("/api/pet/chat", s.handlePetChat)
	mux.HandleFunc("/api/chat", s.handlePetChat) // 兼容别名：pet.js 切到 /api/pet/chat 后移除
	mux.HandleFunc("/healthz", s.handleHealth)

	log.Printf("uum-server: listen=%s mock=%v tokens=%d petModel=%s repo=%s",
		cfg.Listen, cfg.Mock, len(cfg.Tokens), cfg.Pet.Model, cfg.RepoPath)
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
