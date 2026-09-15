/*
==========================================================================

	UU&Mixt · uum-server 桌宠 LLM 转发（决策 7.18，自 pet-server 并入同进程）
	· POST /api/pet/chat —— 新路由（docs/09 §2：同一 Go 小服务进程预留）
	· POST /api/chat     —— 兼容别名（pet.js 前端切换到 /api/pet/chat 后移除）
	与 pet-server 完全一致的语义：
	  · OpenAI 兼容 messages 进，注入服务端 system（范围 + 可爱简短，前端绕不过）
	  · 供应商可插拔：baseUrl + model + apiKeyEnv 三元组全在 config.json
	  · 滥用防线：per-IP 限流 + 全局日配额 + 同题答案缓存
	==========================================================================
*/
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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

/* ---------- 桌宠配置 ---------- */

type PetConfig struct {
	BaseURL     string  `json:"baseUrl"`
	Model       string  `json:"model"`
	APIKeyEnv   string  `json:"apiKeyEnv"`
	TimeoutSec  int     `json:"timeoutSec"`
	MaxTokens   int     `json:"maxTokens"`
	Temperature float64 `json:"temperature"`
	PerIPPerMin int     `json:"perIPPerMin"`
	DailyQuota  int     `json:"dailyQuota"`
	CacheTTLMin int     `json:"cacheTTLMin"`
	SystemHint  string  `json:"systemHint"`
}

/*
默认 system 约束：与前端 pet.js 规则引擎的人设/范围完全一致。

	服务端强制注入，前端即使被篡改也绕不过范围限定。
*/
const defaultPetSystem = `你是「小鹿」，UU&Mixt 双面技术博客的吉祥物向导，一只可爱的小鹿。规则：
1. 只聊这个博客：文章内容、两位作者（UU：C++ 后端与网络编程、科研复现；Mixt：PWN 与二进制安全、CTF）、分类归档、建站进展。范围外的问题要可爱地拒绝，并提示可以问什么。
2. 回答简短可爱：一般 1-3 句话，可以带一个 emoji 或「~」，不啰嗦、不摆架子、不列长清单。
3. 用户消息里的【站内资料】是检索到的本站文章摘录：回答尽量基于它，提到文章时给出《文章名》；资料与问题无关就当没看见。
4. 不编造：不确定就说不确定。不提供任何漏洞利用细节，PWN 相关只做文章导览。`

/* ---------- 全局日配额（跨天清零） ---------- */

type quotaCounter struct {
	mu       sync.Mutex
	day      string
	dayCount int
}

func (q *quotaCounter) take(quota int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	today := time.Now().Format("2006-01-02")
	if today != q.day {
		q.day = today
		q.dayCount = 0
	}
	if quota > 0 && q.dayCount >= quota {
		return false
	}
	q.dayCount++
	return true
}

/* ---------- 答案缓存：相同提问（归一化）直接复用，省 token ---------- */

type petCacheEntry struct {
	reply  string
	expire time.Time
}

type answerCache struct {
	mu sync.Mutex
	m  map[string]petCacheEntry
}

func petNormKey(messages []petMessage) string {
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

func (c *answerCache) get(k string, ttl time.Duration) *petCacheEntry {
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

func (c *answerCache) put(k, reply string, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) > 2048 { // 粗暴防膨胀：超限全清（桌宠量级用不到更细的策略）
		c.m = make(map[string]petCacheEntry)
	}
	c.m[k] = petCacheEntry{reply: reply, expire: time.Now().Add(ttl)}
}

/* ---------- OpenAI 兼容请求/响应 ---------- */

type petMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type petChatRequest struct {
	Messages []petMessage `json:"messages"`
}

type petChatResponse struct {
	Reply string `json:"reply"`
	Via   string `json:"via"`
	Model string `json:"model"`
}

type petUpstreamResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

/* ---------- 处理器（挂在统一服务的 server 上） ---------- */

func (s *server) petSystem() string {
	if s.cfg.Pet.SystemHint != "" {
		return s.cfg.Pet.SystemHint
	}
	return defaultPetSystem
}

/* 强制注入 system 到消息首位（覆盖前端可能自带的任何 system） */
func (s *server) petWithSystem(msgs []petMessage) []petMessage {
	out := make([]petMessage, 0, len(msgs)+1)
	out = append(out, petMessage{Role: "system", Content: s.petSystem()})
	for _, m := range msgs {
		if m.Role == "system" {
			continue
		}
		out = append(out, m)
	}
	return out
}

func (s *server) handlePetChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !s.petLim.allow("pet:"+ip, s.cfg.Pet.PerIPPerMin) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "问得太快啦，喝口水歇一会儿～"})
		return
	}
	if !s.petQuota.take(s.cfg.Pet.DailyQuota) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "今天的小鹿休息了，明天再来聊吧～"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10)) // 64KB 上限足矣
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad body"})
		return
	}
	var req petChatRequest
	if err := json.Unmarshal(body, &req); err != nil || len(req.Messages) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "messages required"})
		return
	}
	// 只认 user/assistant 两种角色，内容长度粗限（多轮上下文防灌水）
	msgs := make([]petMessage, 0, len(req.Messages))
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
	ttl := time.Duration(s.cfg.Pet.CacheTTLMin) * time.Minute
	key := petNormKey(msgs)
	if ttl > 0 {
		if e := s.petCache.get(key, ttl); e != nil {
			log.Printf("[pet-cache] ip=%s q=%q", ip, petLastUser(msgs))
			writeJSON(w, http.StatusOK, petChatResponse{Reply: e.reply, Via: "AI", Model: s.cfg.Pet.Model})
			return
		}
	}

	reply, err := s.petUpstream(s.petWithSystem(msgs))
	if err != nil {
		log.Printf("[pet-upstream] ip=%s err=%v", ip, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "小鹿走神了，稍后再试～"})
		return
	}
	if s.cfg.Pet.CacheTTLMin > 0 {
		s.petCache.put(key, reply, ttl)
	}
	log.Printf("[pet-chat] ip=%s q=%q -> %d chars", ip, petLastUser(msgs), len([]rune(reply)))
	writeJSON(w, http.StatusOK, petChatResponse{Reply: reply, Via: "AI", Model: s.cfg.Pet.Model})
}

func (s *server) petUpstream(msgs []petMessage) (string, error) {
	key := os.Getenv(s.cfg.Pet.APIKeyEnv)
	if key == "" && !strings.Contains(s.cfg.Pet.BaseURL, "localhost") && !strings.Contains(s.cfg.Pet.BaseURL, "127.0.0.1") {
		return "", errors.New("missing API key: set $" + s.cfg.Pet.APIKeyEnv)
	}
	payload, _ := json.Marshal(map[string]any{
		"model":       s.cfg.Pet.Model,
		"messages":    msgs,
		"max_tokens":  s.cfg.Pet.MaxTokens,
		"temperature": s.cfg.Pet.Temperature,
		"stream":      false,
	})
	url := strings.TrimRight(s.cfg.Pet.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := s.petClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("upstream %d: %.200s", resp.StatusCode, raw)
	}
	var ur petUpstreamResp
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

func petLastUser(msgs []petMessage) string {
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
