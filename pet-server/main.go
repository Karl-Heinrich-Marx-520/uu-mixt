/* ==========================================================================
   UU&Mixt · pet-server —— 桌宠小鹿的 LLM 转发小服务（决策 7.17 / 7.18）
   职责（单一，刻意保持简单）：
     · POST /api/chat：接收前端桌宠的 OpenAI 兼容 messages，注入服务端
       system 约束（范围限定 + 可爱简短，前端绕不过去），转发给上游 LLM；
     · 供应商可插拔（7.18 核心诉求）：上游 = baseUrl + model + apiKeyEnv
       三元组，全部在 config.json 里改——DeepSeek / OpenAI / Kimi / GLM /
       Qwen（OpenAI 兼容模式）/ 本地 Ollama 通吃，换 API 不改一行代码；
     · 滥用防线：per-IP 每分钟限流 + 全局日配额 + 答案缓存（同题不重复计费）；
     · Key 永远只活在服务端环境变量（PRD 6.6），前端只见自家端点。
   设计边界：
     · 只监听 127.0.0.1，公网入口由 Nginx 反代 /api/（见 README 部署节）；
     · 标准库零依赖；不做多租户、不做流式（简短回答场景无需 SSE）；
     · 计数与缓存存内存，重启清零——桌宠场景可接受，换来零状态运维。
   编译：cd pet-server && go build -o uum-pet .
   运行：UUM_LLM_KEY=sk-xxx ./uum-pet -config config.json
   ========================================================================== */
package main

import (
	"bytes"
	"crypto/sha256"
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
	"strings"
	"sync"
	"time"
)

/* ---------- 配置 ---------- */

type Config struct {
	Listen      string  `json:"listen"`      // 只服务本机 Nginx 反代，勿暴露公网
	BaseURL     string  `json:"baseUrl"`     // 供应商 OpenAI 兼容根地址（不带 /chat/completions）
	Model       string  `json:"model"`       // 模型名，如 deepseek-chat
	APIKeyEnv   string  `json:"apiKeyEnv"`   // 存 Key 的环境变量名（Key 不落盘）
	TimeoutSec  int     `json:"timeoutSec"`  // 上游请求超时
	MaxTokens   int     `json:"maxTokens"`   // 限制回答长度（可爱简短的硬约束）
	Temperature float64 `json:"temperature"` // 生成温度
	PerIPPerMin int     `json:"perIPPerMin"` // 单 IP 每分钟请求数
	DailyQuota  int     `json:"dailyQuota"`  // 全局每日请求配额
	CacheTTLMin int     `json:"cacheTTLMin"` // 相同提问答案缓存时长
	SystemHint  string  `json:"systemHint"`  // 可选：覆盖默认 system 约束
}

func loadConfig(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg := &Config{
		Listen:      "127.0.0.1:8787",
		BaseURL:     "https://api.deepseek.com",
		Model:       "deepseek-chat",
		APIKeyEnv:   "UUM_LLM_KEY",
		TimeoutSec:  30,
		MaxTokens:   300,
		Temperature: 0.8,
		PerIPPerMin: 10,
		DailyQuota:  500,
		CacheTTLMin: 60,
	}
	if err := json.Unmarshal(raw, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

/* 默认 system 约束：与前端 pet.js 规则引擎的人设/范围完全一致。
   服务端强制注入，前端即使被篡改也绕不过范围限定（PRD 3.7 精神的延伸）。 */
const defaultSystem = `你是「小鹿」，UU&Mixt 双面技术博客的吉祥物向导，一只可爱的小鹿。规则：
1. 只聊这个博客：文章内容、两位作者（UU：C++ 后端与网络编程、科研复现；Mixt：PWN 与二进制安全、CTF）、分类归档、建站进展。范围外的问题要可爱地拒绝，并提示可以问什么。
2. 回答简短可爱：一般 1-3 句话，可以带一个 emoji 或「~」，不啰嗦、不摆架子、不列长清单。
3. 用户消息里的【站内资料】是检索到的本站文章摘录：回答尽量基于它，提到文章时给出《文章名》；资料与问题无关就当没看见。
4. 不编造：不确定就说不确定。不提供任何漏洞利用细节，PWN 相关只做文章导览。`

/* ---------- 限流与配额（内存态，重启清零） ---------- */

type limiter struct {
	mu      sync.Mutex
	hits    map[string][]time.Time // ip -> 本分钟请求时刻
	day     string                 // "2026-09-15"
	dayCount int
}

func newLimiter() *limiter {
	return &limiter{hits: make(map[string][]time.Time), day: time.Now().Format("2006-01-02")}
}

/* 返回 ""=放行，否则拒绝原因 */
func (l *limiter) allow(ip string, perMin, quota int) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	today := time.Now().Format("2006-01-02")
	if today != l.day { // 跨天：配额清零
		l.day = today
		l.dayCount = 0
	}
	if quota > 0 && l.dayCount >= quota {
		return "今天的小鹿休息了，明天再来聊吧～"
	}
	now := time.Now()
	// 清理窗口外记录并计数
	recent := l.hits[ip][:0]
	for _, t := range l.hits[ip] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	if perMin > 0 && len(recent) >= perMin {
		l.hits[ip] = recent
		return "问得太快啦，喝口水歇一会儿～"
	}
	l.hits[ip] = append(recent, now)
	l.dayCount++
	return ""
}

/* ---------- 答案缓存：相同提问（归一化）直接复用，省 token ---------- */

type cacheEntry struct {
	reply  string
	via    string
	expire time.Time
}

type answerCache struct {
	mu sync.Mutex
	m  map[string]cacheEntry
}

func newCache() *answerCache { return &answerCache{m: make(map[string]cacheEntry)} }

func normKey(messages []Message) string {
	var last string
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			last = messages[i].Content
			break
		}
	}
	last = strings.ToLower(strings.Join(strings.Fields(last), " "))
	sum := sha256.Sum256([]byte(last))
	return hex.EncodeToString(sum[:16])
}

func (c *answerCache) get(k string, ttl time.Duration) *cacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[k]
	if !ok || time.Now().After(e.expire) {
		if ok {
			delete(c.m, k)
		}
		return nil
	}
	return &e
}

func (c *answerCache) put(k, reply, via string, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) > 2048 { // 粗暴防膨胀：超限全清（桌宠量级用不到更细的策略）
		c.m = make(map[string]cacheEntry)
	}
	c.m[k] = cacheEntry{reply: reply, via: via, expire: time.Now().Add(ttl)}
}

/* ---------- OpenAI 兼容请求 ---------- */

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Messages []Message `json:"messages"`
}

type chatResponse struct {
	Reply string `json:"reply"`
	Via   string `json:"via"`
	Model string `json:"model"`
}

type upstreamResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

/* ---------- 服务 ---------- */

type server struct {
	cfg    *Config
	client *http.Client
	lim    *limiter
	cache  *answerCache
	start  time.Time
}

func (s *server) systemPrompt() string {
	if s.cfg.SystemHint != "" {
		return s.cfg.SystemHint
	}
	return defaultSystem
}

/* 强制注入 system 到消息首位（覆盖前端可能自带的任何 system） */
func (s *server) withSystem(msgs []Message) []Message {
	out := make([]Message, 0, len(msgs)+1)
	out = append(out, Message{Role: "system", Content: s.systemPrompt()})
	for _, m := range msgs {
		if m.Role == "system" {
			continue
		}
		out = append(out, m)
	}
	return out
}

func (s *server) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if reason := s.lim.allow(ip, s.cfg.PerIPPerMin, s.cfg.DailyQuota); reason != "" {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": reason})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10)) // 64KB 上限足矣
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad body"})
		return
	}
	var req chatRequest
	if err := json.Unmarshal(body, &req); err != nil || len(req.Messages) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "messages required"})
		return
	}
	// 只认 user/assistant 两种角色，内容长度粗限（多轮上下文防灌水）
	msgs := make([]Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		if (m.Role != "user" && m.Role != "assistant") || m.Content == "" {
			continue
		}
		if len([]rune(m.Content)) > 2000 {
			m.Content = string([]rune(m.Content)[:2000])
		}
		msgs = append(msgs, m)
	}
	if len(msgs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no valid messages"})
		return
	}

	// 缓存命中：直接回
	ttl := time.Duration(s.cfg.CacheTTLMin) * time.Minute
	key := normKey(msgs)
	if ttl > 0 {
		if e := s.cache.get(key, ttl); e != nil {
			log.Printf("[cache] ip=%s q=%q", ip, lastUser(msgs))
			writeJSON(w, http.StatusOK, chatResponse{Reply: e.reply, Via: e.via, Model: s.cfg.Model})
			return
		}
	}

	reply, err := s.upstream(s.withSystem(msgs))
	if err != nil {
		log.Printf("[upstream] ip=%s err=%v", ip, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "小鹿走神了，稍后再试～"})
		return
	}
	if s.cfg.CacheTTLMin > 0 {
		s.cache.put(key, reply, "AI", ttl)
	}
	log.Printf("[chat] ip=%s q=%q -> %d chars", ip, lastUser(msgs), len([]rune(reply)))
	writeJSON(w, http.StatusOK, chatResponse{Reply: reply, Via: "AI", Model: s.cfg.Model})
}

func (s *server) upstream(msgs []Message) (string, error) {
	key := os.Getenv(s.cfg.APIKeyEnv)
	if key == "" && !strings.Contains(s.cfg.BaseURL, "localhost") && !strings.Contains(s.cfg.BaseURL, "127.0.0.1") {
		return "", errors.New("missing API key: set $" + s.cfg.APIKeyEnv)
	}
	payload, _ := json.Marshal(map[string]any{
		"model":       s.cfg.Model,
		"messages":    msgs,
		"max_tokens":  s.cfg.MaxTokens,
		"temperature": s.cfg.Temperature,
		"stream":      false,
	})
	url := strings.TrimRight(s.cfg.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("upstream %d: %.200s", resp.StatusCode, raw)
	}
	var ur upstreamResp
	if err := json.Unmarshal(raw, &ur); err != nil {
		return "", err
	}
	if ur.Error != nil && ur.Error.Message != "" {
		return "", fmt.Errorf("upstream error: %s", ur.Error.Message)
	}
	if len(ur.Choices) == 0 {
		return "", errors.New("upstream returned no choices")
	}
	return strings.TrimSpace(ur.Choices[0].Message.Content), nil
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	keySet := os.Getenv(s.cfg.APIKeyEnv) != ""
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"model":   s.cfg.Model,
		"baseUrl": s.cfg.BaseURL,
		"keySet":  keySet,
		"uptime":  time.Since(s.start).Round(time.Second).String(),
	})
}

func lastUser(msgs []Message) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			r := []rune(msgs[i].Content)
			if len(r) > 24 {
				r = r[:24]
			}
			return string(r)
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	cfgPath := flag.String("config", "config.json", "配置文件路径")
	flag.Parse()
	cfg, err := loadConfig(*cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	s := &server{
		cfg: cfg,
		/* 显式直连：转发服务不受部署机环境代理影响（本地调试时沙箱代理会拦上游） */
		client: &http.Client{
			Timeout:   time.Duration(cfg.TimeoutSec) * time.Second,
			Transport: &http.Transport{Proxy: nil},
		},
		lim:   newLimiter(),
		cache: newCache(),
		start: time.Now(),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/chat", s.handleChat)
	mux.HandleFunc("/healthz", s.handleHealth)

	log.Printf("uum-pet: model=%s baseUrl=%s listen=%s perIPPerMin=%d dailyQuota=%d",
		cfg.Model, cfg.BaseURL, cfg.Listen, cfg.PerIPPerMin, cfg.DailyQuota)
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
