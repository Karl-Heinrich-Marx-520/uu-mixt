package main

/* 决策 7.24（2026-09-15）：写作台手动触发服务器端重新构建
 *
 * 背景：前台内容页是 Astro 构建期静态产物（/srv/uum/dist），写作台写入只落
 * 仓库（/srv/uum/work → push 主库），dist 不会自己变化。本文件提供：
 *
 *   POST /api/rebuild —— 异步启动 uum-rebuild.sh（flock 单实例 + pending 合并），
 *                        立即返回；脚本自身负责 npm build → check-pages → rsync 替换 dist，
 *                        失败保留旧站点。
 *   GET  /api/rebuild —— 查询状态：running / exitCode / elapsed / 日志尾部。
 *
 * 设计约束：
 *   · 构建是长任务（1-3 分钟），绝不在 HTTP 请求内同步等待；
 *   · 防并发：running 标志（服务内）+ 脚本内 flock（跨进程）双保险；
 *   · mock 模式不执行脚本，返回假状态（2 秒转 done），供冒烟自测；
 *   · 失败可见：退出码与日志尾部返回给前端展示，不做静默失败。
 */

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"
)

type rebuildState struct {
	mu       sync.Mutex
	running  bool
	started  time.Time
	finished time.Time
	exitCode int    // 0 成功；非 0 失败；-1 尚未运行过
	tail     string // 构建日志尾部（uum-rebuild.log）
}

const (
	rebuildLogPath = "/srv/uum/rebuild.log" // uum-rebuild.sh 的 LOG 默认值，保持一致
	rebuildTailMax = 2400                   // 返回给前端的日志尾部上限（字节）
)

func (rb *rebuildState) init() {
	rb.exitCode = -1
}

/* handleRebuild 是 /api/rebuild 的总入口，按 method 分发。 */
func (s *server) handleRebuild(w http.ResponseWriter, r *http.Request) {
	a, ok := s.author(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "凭据无效或已过期：请重新登录写作台。"})
		return
	}
	switch r.Method {
	case http.MethodPost:
		// 重操作限频：每 face 每分钟 2 次（防手抖连点；构建本身有 running+锁双保险）
		if !s.lim.allow("rebuild:"+a.Face, 2) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "触发太频繁（429）：构建正在进行或刚结束，请稍候。"})
			return
		}
		s.rebuildStart(w, r, a.Face)
	case http.MethodGet:
		s.rebuildStatus(w)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "仅支持 GET / POST。"})
	}
}

/* rebuildStart：置 running 标志并派发后台 goroutine，立即应答。 */
func (s *server) rebuildStart(w http.ResponseWriter, _ *http.Request, face string) {
	s.rb.mu.Lock()
	if s.rb.running {
		s.rb.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "status": "running",
			"message": "构建已在进行中，请勿重复触发；状态区会自动刷新。",
		})
		return
	}
	s.rb.running = true
	s.rb.started = time.Now()
	s.rb.mu.Unlock()

	if s.cfg.Mock {
		go func() { // 冒烟自测：2 秒后转成功
			time.Sleep(2 * time.Second)
			s.rb.mu.Lock()
			s.rb.running, s.rb.exitCode, s.rb.finished = false, 0, time.Now()
			s.rb.tail = "[mock] rebuild OK（内存假状态，未执行脚本）"
			s.rb.mu.Unlock()
		}()
	} else {
		go func() {
			code := 0
			cmd := exec.Command(s.cfg.RebuildScript)
			if err := cmd.Run(); err != nil {
				code = 1
				if ee, ok := err.(*exec.ExitError); ok {
					code = ee.ExitCode()
				}
			}
			tail := readTail(rebuildLogPath, rebuildTailMax)
			s.rb.mu.Lock()
			s.rb.running, s.rb.exitCode, s.rb.finished, s.rb.tail = false, code, time.Now(), tail
			s.rb.mu.Unlock()
			if code == 0 {
				log.Printf("[rebuild] face=%s exit=0 构建并发布完成", face)
			} else {
				log.Printf("[rebuild] face=%s exit=%d 构建失败（旧 dist 未受影响）", face, code)
			}
		}()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "status": "started",
		"message": "构建已启动：重新生成全站页面约需 1-2 分钟，完成后状态区会显示结果。",
	})
}

/* rebuildStatus：返回当前状态快照（无锁写方，读方持锁）。 */
func (s *server) rebuildStatus(w http.ResponseWriter) {
	s.rb.mu.Lock()
	defer s.rb.mu.Unlock()
	resp := map[string]any{
		"running":  s.rb.running,
		"exitCode": s.rb.exitCode,
	}
	if !s.rb.started.IsZero() {
		resp["startedAt"] = s.rb.started.Format(time.RFC3339)
	}
	if !s.rb.finished.IsZero() {
		resp["finishedAt"] = s.rb.finished.Format(time.RFC3339)
		resp["elapsedSec"] = int(s.rb.finished.Sub(s.rb.started).Seconds())
	}
	if s.rb.tail != "" {
		resp["tail"] = s.rb.tail
	}
	writeJSON(w, http.StatusOK, resp)
}

/* readTail 读取文件末尾至多 max 字节（日志预览用；文件不存在返回空串）。 */
func readTail(path string, max int) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return ""
	}
	n := st.Size()
	if n > int64(max) {
		n = int64(max)
	}
	buf := make([]byte, n)
	if _, err := f.ReadAt(buf, st.Size()-n); err != nil {
		return ""
	}
	return string(buf)
}
