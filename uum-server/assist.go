/*
==========================================================================

	UU&Mixt · uum-server 写作台 AI 摘要助手（决策 7.20/7.23 正式版接线）
	· POST /api/assist —— body {title, body}，返回 {description, tags}
	与桌宠转发同一套纪律：
	  · 服务端持上游 Key（UUM_LLM_KEY），Key 绝不进前端（PRD 铁律 5）
	  · face 由 token 推导；按 token 限频（默认 6 次/分钟，比写接口更严）
	  · 显式直连不吃环境代理；上游失败返回 502 + 中文指引（手动填写兜底）
	  · mock 模式（-mock）不碰上游，按 demo 同款规则本地生成，供 curl 冒烟
	输出只认 JSON 对象（模型偶尔包 markdown 代码栅栏也能剥出）；description/tags
	在服务端兜底清洗（截长、去空、去重、上限 5 个），前端不做信任假设。
	==========================================================================
*/
package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
)

/* ---------- 配置 ---------- */

type AssistConfig struct {
	BaseURL        string  `json:"baseUrl"`
	Model          string  `json:"model"`
	APIKeyEnv      string  `json:"apiKeyEnv"`
	TimeoutSec     int     `json:"timeoutSec"`
	MaxTokens      int     `json:"maxTokens"`
	Temperature    float64 `json:"temperature"`
	PerTokenPerMin int     `json:"perTokenPerMin"`
	MaxBodyRunes   int     `json:"maxBodyRunes"` // 送入上游的正文上限（防灌水与浪费）
	SystemHint     string  `json:"systemHint"`
}

const defaultAssistSystem = `你是 UU&Mixt 双面技术博客写作台的摘要助手。根据文章标题与正文（Markdown）生成两个字段：
1. description：一句话摘要，60 到 120 个字符，概括正文的核心内容或结论；不用「本文」「这篇文章」开头，不夸饰。
2. tags：最多 5 个标签，从正文的技术内容提炼；英文技术词用小写连字符形式（如 boost-beast、graceful-shutdown），中文技术概念可用中文（如 拥塞控制、堆利用）；不要照抄标题里超过两个词。
只输出一个 JSON 对象，格式：{"description":"...","tags":["..."]}，不要输出 JSON 以外的任何文字。`

/* ---------- 请求/响应 ---------- */

type assistRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type assistOut struct {
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
}

/* ---------- 处理器 ---------- */

func (s *server) handleAssist(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	a, ok := s.author(r)
	if !ok {
		unauthorized(w)
		return
	}
	if !s.lim.allow("assist:"+a.Hash, s.assistPerMin()) {
		tooFrequent(w)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求体读取失败。"})
		return
	}
	var req assistRequest
	if json.Unmarshal(raw, &req) != nil || strings.TrimSpace(req.Title) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "需要 title（正文可为空）。"})
		return
	}
	title := strings.TrimSpace(req.Title)
	body := req.Body
	if max := s.cfg.Assist.MaxBodyRunes; max > 0 {
		if runes := []rune(body); len(runes) > max {
			body = string(runes[:max])
		}
	}

	/* mock 自测：不碰上游，按 demo 同款规则本地生成 */
	if s.cfg.Mock {
		desc, tags := mockAssist(title, body)
		log.Printf("[assist-mock] face=%s title=%q -> %d chars, %d tags", a.Face, title, len([]rune(desc)), len(tags))
		writeJSON(w, http.StatusOK, map[string]any{"description": desc, "tags": tags, "via": "mock"})
		return
	}

	system := s.cfg.Assist.SystemHint
	if system == "" {
		system = defaultAssistSystem
	}
	msgs := []petMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: "标题：" + title + "\n\n正文：\n" + body},
	}
	reply, err := llmUpstream(s.assistClient, s.cfg.Assist.BaseURL, s.cfg.Assist.Model,
		s.cfg.Assist.APIKeyEnv, msgs, s.cfg.Assist.MaxTokens, s.cfg.Assist.Temperature)
	if err != nil {
		log.Printf("[assist-upstream] face=%s err=%v", a.Face, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "AI 生成失败（上游暂时不可用）：稍后再试，或手动填写摘要与标签。",
		})
		return
	}
	desc, tags, err := parseAssistJSON(reply)
	if err != nil {
		log.Printf("[assist-parse] face=%s err=%v reply=%.200s", a.Face, err, reply)
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "AI 返回格式异常：稍后再试，或手动填写摘要与标签。",
		})
		return
	}
	log.Printf("[assist] face=%s title=%q -> %d chars, %d tags", a.Face, title, len([]rune(desc)), len(tags))
	writeJSON(w, http.StatusOK, map[string]any{"description": desc, "tags": tags, "via": "AI", "model": s.cfg.Assist.Model})
}

func (s *server) assistPerMin() int {
	if s.cfg.Assist.PerTokenPerMin > 0 {
		return s.cfg.Assist.PerTokenPerMin
	}
	return 6
}

/* ---------- 上游回复解析：剥代码栅栏/杂语，只取第一个 JSON 对象，并兜底清洗 ---------- */

func parseAssistJSON(reply string) (string, []string, error) {
	start := strings.Index(reply, "{")
	end := strings.LastIndex(reply, "}")
	if start < 0 || end <= start {
		return "", nil, errors.New("reply has no json object")
	}
	var out assistOut
	if err := json.Unmarshal([]byte(reply[start:end+1]), &out); err != nil {
		return "", nil, err
	}
	desc := strings.TrimSpace(out.Description)
	if desc == "" {
		return "", nil, errors.New("empty description")
	}
	if runes := []rune(desc); len(runes) > 200 {
		desc = string(runes[:200])
	}
	tags := []string{}
	seen := map[string]bool{}
	for _, t := range out.Tags {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if runes := []rune(t); len(runes) > 24 {
			t = string(runes[:24])
		}
		if seen[t] {
			continue
		}
		seen[t] = true
		tags = append(tags, t)
		if len(tags) >= 5 {
			break
		}
	}
	return desc, tags, nil
}

/* ---------- mock 生成（demo genDesc/genTags 的 Go 移植，仅自测用） ---------- */

func mockAssist(title, body string) (string, []string) {
	desc := ""
	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if t == "" {
			continue
		}
		if strings.HasPrefix(t, "#") || strings.HasPrefix(t, ">") || strings.HasPrefix(t, "-") ||
			strings.HasPrefix(t, "*") || strings.HasPrefix(t, "![") || strings.HasPrefix(t, "|") ||
			strings.HasPrefix(t, "```") || strings.HasPrefix(t, "---") || strings.HasPrefix(t, "tags:") {
			continue
		}
		t = strings.Trim(t, "*` ")
		if t == "" {
			continue
		}
		desc = t
		break
	}
	if desc == "" {
		desc = "关于「" + title + "」的内容摘要（mock 自测生成）。"
	}
	if runes := []rune(desc); len(runes) > 72 {
		desc = string(runes[:72]) + "……"
	}

	dict := []struct{ kw, tag string }{
		{"c++", "cpp"}, {"asio", "asio"}, {"beast", "beast"}, {"epoll", "epoll"},
		{"tcp", "tcp"}, {"http", "http"}, {"协程", "协程"}, {"coroutine", "coroutine"},
		{"muduo", "muduo"}, {"qt", "qt"}, {"ns-3", "ns-3"}, {"hpcc", "hpcc"},
		{"拥塞", "拥塞控制"}, {"pwn", "pwn"}, {"glibc", "glibc"}, {"堆", "堆利用"},
		{"ctf", "ctf"}, {"docker", "docker"}, {"内核", "内核"}, {"mercury", "mercury"},
	}
	low := strings.ToLower(body + " " + title)
	tags := []string{}
	for _, d := range dict {
		if strings.Contains(low, d.kw) {
			tags = append(tags, d.tag)
			if len(tags) >= 5 {
				break
			}
		}
	}
	if len(tags) == 0 {
		tags = []string{"笔记"}
	}
	return desc, tags
}
