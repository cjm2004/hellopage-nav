package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

var (
	addr    = flag.String("addr", ":9527", "listen address")
	dataDir = flag.String("data", "", "data directory")
)

const (
	sessionCookieName = "hellopage_session"
	pwIterations      = 120000
	pwKeyLen          = 32
	saltBytes         = 16
	maxFailures       = 5
	lockoutDuration   = 5 * time.Minute
)

type authRecord struct {
	Salt       string `json:"salt"`
	Hash       string `json:"hash"`
	Iterations int    `json:"iterations"`
}

type passwordRequest struct {
	Password string `json:"password"`
}

type passwordChangeRequest struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

// derivePassword 实现 PBKDF2-HMAC-SHA256，与原版完全一致。
func derivePassword(password, salt []byte, iterations int) []byte {
	hashLen := sha256.Size
	numBlocks := (pwKeyLen + hashLen - 1) / hashLen
	dk := make([]byte, 0, numBlocks*hashLen)
	var block [4]byte
	for i := 1; i <= numBlocks; i++ {
		block[0] = byte(i >> 24)
		block[1] = byte(i >> 16)
		block[2] = byte(i >> 8)
		block[3] = byte(i)
		mac := hmac.New(sha256.New, password)
		mac.Write(salt)
		mac.Write(block[:])
		u := mac.Sum(nil)
		t := make([]byte, hashLen)
		copy(t, u)
		for j := 1; j < iterations; j++ {
			mac2 := hmac.New(sha256.New, password)
			mac2.Write(u)
			u = mac2.Sum(nil)
			for k := range t {
				t[k] ^= u[k]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:pwKeyLen]
}

func randomBase64(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	}
	return base64.StdEncoding.EncodeToString(b)
}

func validPassword(pw string) bool {
	n := len(pw)
	return n >= 8 && n <= 128
}

type aiConfig struct {
	Endpoint string `json:"endpoint"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
	DescriptionMax int `json:"descriptionMax"`
}

type aiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type aiChatRequest struct {
	Model    string      `json:"model"`
	Messages []aiMessage `json:"messages"`
}

type aiChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type server struct {
	mu         sync.Mutex
	dataDir    string
	record     *authRecord
	sessions   map[string]bool
	failCount  map[string]int
	failLockAt map[string]time.Time
}

func newServer(dir string) *server {
	if dir == "" {
		dir = "."
	}
	s := &server{
		dataDir:    dir,
		sessions:   make(map[string]bool),
		failCount:  make(map[string]int),
		failLockAt: make(map[string]time.Time),
	}
	s.loadAuth()
	return s
}

func (s *server) authPath() string     { return filepath.Join(s.dataDir, "auth.json") }
func (s *server) aiPath() string       { return filepath.Join(s.dataDir, "ai.json") }
func (s *server) dataJSONPath() string { return filepath.Join(s.dataDir, "data.json") }

func (s *server) loadAuth() {
	b, err := os.ReadFile(s.authPath())
	if err != nil {
		return
	}
	var rec authRecord
	if json.Unmarshal(b, &rec) == nil && rec.Hash != "" {
		s.record = &rec
	}
}

func (s *server) saveAuth() error {
	b, err := json.Marshal(s.record)
	if err != nil {
		return err
	}
	return os.WriteFile(s.authPath(), b, 0600)
}

func (s *server) passwordMatches(pw string) bool {
	if s.record == nil {
		return false
	}
	salt, err1 := base64.StdEncoding.DecodeString(s.record.Salt)
	hash, err2 := base64.StdEncoding.DecodeString(s.record.Hash)
	if err1 != nil || err2 != nil {
		return false
	}
	got := derivePassword([]byte(pw), salt, s.record.Iterations)
	return subtle.ConstantTimeCompare(got, hash) == 1
}

func (s *server) issueSession() string {
	id := randomBase64(32)
	s.mu.Lock()
	s.sessions[id] = true
	s.mu.Unlock()
	return id
}

func (s *server) isAuthenticated(r *http.Request) bool {
	c, err := r.Cookie(sessionCookieName)
	if err != nil || c == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[c.Value]
}

func (s *server) setSessionCookie(w http.ResponseWriter, id string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   7 * 24 * 3600,
	})
}

func (s *server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func (s *server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *server) loginAllowed(ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failCount[ip] >= maxFailures {
		if t, ok := s.failLockAt[ip]; ok && time.Since(t) < lockoutDuration {
			return false
		}
		s.failCount[ip] = 0
	}
	return true
}

func (s *server) recordLoginFailure(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failCount[ip]++
	if s.failCount[ip] >= maxFailures {
		s.failLockAt[ip] = time.Now()
	}
}

func (s *server) clearLoginFailures(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failCount[ip] = 0
	delete(s.failLockAt, ip)
}

func (s *server) revokeSessionsExcept(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ns := make(map[string]bool)
	if id != "" {
		ns[id] = true
	}
	s.sessions = ns
}

func (s *server) releaseDefaults() {
	for _, name := range []string{"links.js", "engines.js"} {
		dst := filepath.Join(s.dataDir, name)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		src := filepath.Join("web", "assets", "js", name)
		if b, err := fs.ReadFile(webFS, src); err == nil {
			if err := os.WriteFile(dst, b, 0644); err == nil {
				log.Printf("[hellopage-nav] 已释放默认数据文件: %s", dst)
			}
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v interface{}) error {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(body, v)
}

func (s *server) healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(200)
	io.WriteString(w, "ok")
}

func (s *server) apiError(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "接口不存在"})
}

func (s *server) authStatusHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]interface{}{
		"authenticated": s.isAuthenticated(r),
		"configured":    s.record != nil,
	})
}

func (s *server) setupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	if s.record != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "已配置密码"})
		return
	}
	var req passwordRequest
	if readJSON(r, &req) != nil || !validPassword(req.Password) {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "密码需为 8-128 个字符"})
		return
	}
	rawSalt := make([]byte, saltBytes)
	rand.Read(rawSalt)
	hash := derivePassword([]byte(req.Password), rawSalt, pwIterations)
	s.record = &authRecord{Salt: base64.StdEncoding.EncodeToString(rawSalt), Hash: base64.StdEncoding.EncodeToString(hash), Iterations: pwIterations}
	if err := s.saveAuth(); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "保存失败"})
		return
	}
	id := s.issueSession()
	s.setSessionCookie(w, id)
	writeJSON(w, 200, map[string]interface{}{"ok": true})
}

func (s *server) loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	if s.record == nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "尚未配置密码"})
		return
	}
	ip := s.clientIP(r)
	if !s.loginAllowed(ip) {
		writeJSON(w, 429, map[string]interface{}{"ok": false, "error": "失败次数过多，请稍后再试"})
		return
	}
	var req passwordRequest
	if readJSON(r, &req) != nil || !s.passwordMatches(req.Password) {
		s.recordLoginFailure(ip)
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "密码错误"})
		return
	}
	s.clearLoginFailures(ip)
	id := s.issueSession()
	s.setSessionCookie(w, id)
	writeJSON(w, 200, map[string]interface{}{"ok": true})
}

func (s *server) logoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	if c, err := r.Cookie(sessionCookieName); err == nil && c != nil {
		s.mu.Lock()
		delete(s.sessions, c.Value)
		s.mu.Unlock()
	}
	s.clearSessionCookie(w)
	writeJSON(w, 200, map[string]interface{}{"ok": true})
}

func (s *server) passwordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	var req passwordChangeRequest
	if readJSON(r, &req) != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求无效"})
		return
	}
	if !s.passwordMatches(req.OldPassword) {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "当前密码错误"})
		return
	}
	if !validPassword(req.NewPassword) {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "新密码需为 8-128 个字符"})
		return
	}
	rawSalt := make([]byte, saltBytes)
	rand.Read(rawSalt)
	hash := derivePassword([]byte(req.NewPassword), rawSalt, pwIterations)
	s.record = &authRecord{Salt: base64.StdEncoding.EncodeToString(rawSalt), Hash: base64.StdEncoding.EncodeToString(hash), Iterations: pwIterations}
	if err := s.saveAuth(); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "保存失败"})
		return
	}
	var current string
	if c, err := r.Cookie(sessionCookieName); err == nil && c != nil {
		current = c.Value
	}
	s.revokeSessionsExcept(current)
	writeJSON(w, 200, map[string]interface{}{"ok": true})
}

func (s *server) dataHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		b, err := os.ReadFile(s.dataJSONPath())
		if err != nil {
			writeJSON(w, 404, map[string]interface{}{"ok": false, "error": "数据文件不存在"})
			return
		}
		var payload map[string]interface{}
		if json.Unmarshal(b, &payload) != nil {
			payload = map[string]interface{}{}
		}
		payload["wallpapers"] = s.wallpaperList()
		writeJSON(w, 200, payload)
	case http.MethodPost:
		if !s.isAuthenticated(r) {
			writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
			return
		}
		defer r.Body.Close()
		body, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
		if err != nil {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求体过大"})
			return
		}
		var m map[string]json.RawMessage
		if json.Unmarshal(body, &m) != nil {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "配置格式无效"})
			return
		}
		if raw, ok := m["navGroups"]; ok {
			var groups []json.RawMessage
			if json.Unmarshal(raw, &groups) != nil {
				writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "navGroups 必须是数组"})
				return
			}
		} else {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少 navGroups"})
			return
		}
		if raw, ok := m["siteConfig"]; ok {
			var cfg map[string]json.RawMessage
			if json.Unmarshal(raw, &cfg) != nil {
				writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "siteConfig 必须是对象"})
				return
			}
		} else {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少 siteConfig"})
			return
		}
		if err := os.WriteFile(s.dataJSONPath(), body, 0644); err != nil {
			writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "写入失败"})
			return
		}
		writeJSON(w, 200, map[string]interface{}{"ok": true})
	default:
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
	}
}

func (s *server) staticHandler(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path

	switch p {
	case "/":
		s.analyticsRecord("home")
		s.serveEmbedded(w, r, "web/index.html", "text/html; charset=utf-8")
		return
	case "/index.html":
		http.Redirect(w, r, "./", http.StatusMovedPermanently)
		return
	case "/admin.html":
		if !s.isAuthenticated(r) {
			http.Redirect(w, r, "/login.html?next=/admin.html", http.StatusFound)
			return
		}
		s.serveEmbedded(w, r, "web/admin.html", "text/html; charset=utf-8")
		return
	case "/login.html":
		s.serveEmbedded(w, r, "web/login.html", "text/html; charset=utf-8")
		return
	case "/about.html":
		s.serveEmbedded(w, r, "web/about.html", "text/html; charset=utf-8")
		return
	}

	if strings.HasPrefix(p, "/assets/") {
		if p == "/assets/js/links.js" || p == "/assets/js/engines.js" {
			name := filepath.Base(p)
			dst := filepath.Join(s.dataDir, name)
			if b, err := os.ReadFile(dst); err == nil {
				w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
				w.Write(b)
				return
			}
		}
		s.serveEmbedded(w, r, "web"+p, "")
		return
	}

	http.NotFound(w, r)
}

func (s *server) serveEmbedded(w http.ResponseWriter, r *http.Request, embedPath, contentType string) {
	b, err := fs.ReadFile(webFS, embedPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if contentType == "" {
		contentType = detectContentType(embedPath)
	}
	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, filepath.Base(embedPath), time.Time{}, bytes.NewReader(b))
}

func detectContentType(p string) string {
	switch {
	case strings.HasSuffix(p, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(p, ".js"):
		return "text/javascript; charset=utf-8"
	case strings.HasSuffix(p, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(p, ".png"):
		return "image/png"
	case strings.HasSuffix(p, ".jpg"), strings.HasSuffix(p, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(p, ".gif"):
		return "image/gif"
	case strings.HasSuffix(p, ".webp"):
		return "image/webp"
	case strings.HasSuffix(p, ".ttf"):
		return "font/ttf"
	case strings.HasSuffix(p, ".woff2"):
		return "font/woff2"
	default:
		return "application/octet-stream"
	}
}

var aiHTTPClient = &http.Client{Timeout: 20 * time.Second}

func (s *server) loadAIConfig() aiConfig {
	var cfg aiConfig
	if b, err := os.ReadFile(s.aiPath()); err == nil {
		json.Unmarshal(b, &cfg)
	}
	return cfg
}

func (s *server) aiConfigHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, 200, map[string]interface{}{"ok": true, "config": s.loadAIConfig()})
	case http.MethodPost:
		var cfg aiConfig
		if readJSON(r, &cfg) != nil {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求无效"})
			return
		}
		cfg.Endpoint = strings.TrimSpace(cfg.Endpoint)
		cfg.APIKey = strings.TrimSpace(cfg.APIKey)
		cfg.Model = strings.TrimSpace(cfg.Model)
		cfg.DescriptionMax = normalizeDescriptionLimit(cfg.DescriptionMax)
		b, _ := json.Marshal(cfg)
		if err := os.WriteFile(s.aiPath(), b, 0600); err != nil {
			writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "保存失败"})
			return
		}
		writeJSON(w, 200, map[string]interface{}{"ok": true})
	default:
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
	}
}

func (s *server) callAI(cfg aiConfig, messages []aiMessage) (string, error) {
	if cfg.Endpoint == "" || cfg.APIKey == "" || cfg.Model == "" {
		return "", fmt.Errorf("AI 未配置完整（endpoint / apiKey / model）")
	}
	body, _ := json.Marshal(aiChatRequest{Model: cfg.Model, Messages: messages})
	req, err := http.NewRequest(http.MethodPost, cfg.Endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	resp, err := aiHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("AI 接口返回 HTTP %d，请检查接口地址、API Key 和模型名称", resp.StatusCode)
	}
	bodyText := strings.TrimSpace(string(data))
	if bodyText == "" { return "", fmt.Errorf("AI 接口返回空内容") }
	if strings.HasPrefix(bodyText, "<") {
		return "", fmt.Errorf("AI 接口返回了网页 HTML，不是 OpenAI 兼容 JSON；请填写 chat/completions 完整接口地址")
	}
	var cr aiChatResponse
	if err := json.Unmarshal(data, &cr); err != nil {
		return "", fmt.Errorf("AI 接口返回格式不是有效 JSON，请检查接口地址是否填写正确")
	}
	if cr.Error != nil && cr.Error.Message != "" {
		return "", fmt.Errorf("AI 错误: %s", cr.Error.Message)
	}
	if len(cr.Choices) == 0 {
		return "", fmt.Errorf("AI 返回为空")
	}
	return strings.TrimSpace(cr.Choices[0].Message.Content), nil
}

func normalizeURL(raw string) (string, string, error) {
	u := strings.TrimSpace(raw)
	if u == "" {
		return "", "", fmt.Errorf("网址为空")
	}
	if !strings.Contains(u, "://") {
		u = "https://" + u
	}
	parsed, err := url.Parse(u)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", "", fmt.Errorf("网址无效")
	}
	return parsed.String(), parsed.Hostname(), nil
}

var (
	titleRe     = regexp.MustCompile("(?is)<title[^>]*>(.*?)</title>")
	metaDescRe  = regexp.MustCompile("(?is)<meta[^>]+(?:name|property)=[\x22']?(?:description|og:description)[\x22']?[^>]+content=[\x22']?([^\x22'>]+)")
	metaDescRe2 = regexp.MustCompile("(?is)<meta[^>]+content=[\x22']([^\x22'>]+)[\x22'][^>]+(?:name|property)=[\x22']?(?:description|og:description)[\x22']?")
	iconRe      = regexp.MustCompile("(?is)<link[^>]+rel=[\x22']?(?:shortcut[[:space:]]+)?icon[\x22']?[^>]+href=[\x22']([^\x22']+)[\x22']")
	iconRe2     = regexp.MustCompile("(?is)<link[^>]+href=[\x22']([^\x22']+)[\x22'][^>]+rel=[\x22']?(?:shortcut[[:space:]]+)?icon[\x22']?")
	tagRe       = regexp.MustCompile("(?is)<meta[^>]+name=[\x22']keywords[\x22'][^>]+content=[\x22']([^\x22']+)[\x22']")
)

func cleanText(s string) string {
	s = regexp.MustCompile("(?s)<[^>]+>").ReplaceAllString(s, "")
	s = regexp.MustCompile("[[:space:]]+").ReplaceAllString(strings.TrimSpace(s), " ")
	return strings.TrimSpace(s)
}

func fetchPage(rawURL string) (title, desc, iconHref, tags string) {
	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	html := string(body)

	if m := titleRe.FindStringSubmatch(html); len(m) > 1 {
		title = cleanText(m[1])
	}
	if m := metaDescRe.FindStringSubmatch(html); len(m) > 1 {
		desc = cleanText(m[1])
	} else if m := metaDescRe2.FindStringSubmatch(html); len(m) > 1 {
		desc = cleanText(m[1])
	}
	if m := tagRe.FindStringSubmatch(html); len(m) > 1 {
		tags = cleanText(m[1])
	}
	if m := iconRe.FindStringSubmatch(html); len(m) > 1 {
		iconHref = m[1]
	} else if m := iconRe2.FindStringSubmatch(html); len(m) > 1 {
		iconHref = m[1]
	}
	if len(title) > 256 {
		title = title[:256]
	}
	if len(desc) > 4096 {
		desc = desc[:4096]
	}
	if len(tags) > 512 {
		tags = tags[:512]
	}
	return
}

func resolveIcon(rawURL, iconHref, host string) string {
	if iconHref != "" {
		if u, err := url.Parse(iconHref); err == nil {
			if !u.IsAbs() {
				if base, err := url.Parse(rawURL); err == nil {
					u = base.ResolveReference(u)
				}
			}
			if u.Scheme == "http" || u.Scheme == "https" {
				return u.String()
			}
		}
	}
	return "https://favicon.cccyun.cc/" + host
}

func iconOK(iconURL string) bool {
	client := &http.Client{Timeout: 6 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, iconURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return false
	}
	ct := resp.Header.Get("Content-Type")
	return strings.HasPrefix(ct, "image/") || strings.Contains(ct, "icon")
}

func parseAIFill(content string) (name, desc, tags string) {
	content = strings.TrimSpace(content)
	if strings.HasPrefix(content, "{") {
		var m struct {
			Name        string   `json:"name"`
			Description string   `json:"description"`
			Tags        []string `json:"tags"`
		}
		if json.Unmarshal([]byte(content), &m) == nil {
			return m.Name, m.Description, strings.Join(m.Tags, "、")
		}
	}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "name:"), strings.HasPrefix(line, "名称:"):
			name = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
		case strings.HasPrefix(line, "description:"), strings.HasPrefix(line, "描述:"), strings.HasPrefix(line, "备注:"):
			desc = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
		case strings.HasPrefix(line, "tags:"), strings.HasPrefix(line, "标签:"):
			tags = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
		}
	}
	return
}

func normalizeDescriptionLimit(n int) int {
	if n < 20 { return 120 }
	if n > 4096 { return 4096 }
	return n
}

func trimRunes(text string, limit int) string {
	r := []rune(strings.TrimSpace(text))
	if len(r) > limit { r = r[:limit] }
	return string(r)
}

func (s *server) fillFor(rawURL string) (title, desc, tags, icon, iconSource string, err error) {
	_, host, err := normalizeURL(rawURL)
	if err != nil { return "", "", "", "", "", err }
	cfg := s.loadAIConfig()
	if cfg.Endpoint == "" || cfg.APIKey == "" || cfg.Model == "" {
		return "", "", "", "", "", fmt.Errorf("AI 未配置完整，请先在后台 AI 接入中填写接口地址、API Key 和模型")
	}
	limit := normalizeDescriptionLimit(cfg.DescriptionMax)
	fetchedTitle, fetchedDesc, iconHref, fetchedTags := fetchPage(rawURL)
	prompt := "你是网站信息整理助手。根据网址和网页抓取的原始信息，生成导航条目信息。只输出 JSON：{\"name\":\"站点名称\",\"description\":\"一句话备注\",\"tags\":[\"标签1\"]}。描述最多" + fmt.Sprint(limit) + "个字符，不能超出。网址：" + rawURL + "；抓取标题：" + fetchedTitle + "；抓取描述：" + fetchedDesc + "；抓取标签：" + fetchedTags
	content, err := s.callAI(cfg, []aiMessage{{Role: "user", Content: prompt}})
	if err != nil { return "", "", "", "", "", err }
	title, desc, tags = parseAIFill(content)
	if title == "" { return "", "", "", "", "", fmt.Errorf("AI 返回内容无效，请检查模型配置") }
	desc = trimRunes(desc, limit)
	icon = resolveIcon(rawURL, iconHref, host)
	iconSource = "favicon"
	if !iconOK(icon) {
		icon = ""
		prompt2 := "请为网站 " + host + " 提供一个可用的 logo 图标直链 URL（png/svg，尽量来自其官网或 favicon）。只输出 URL，不要多余文字。"
		if u2, cerr := s.callAI(cfg, []aiMessage{{Role: "user", Content: prompt2}}); cerr == nil {
			u2 = strings.TrimSpace(u2)
			if strings.HasPrefix(u2, "http") && iconOK(u2) { icon = u2; iconSource = "ai" }
		}
	}
	return trimRunes(title, 256), desc, tags, icon, iconSource, nil
}

// scrapeFor returns only data observed on the target page; it never calls an AI model.
func scrapeFor(rawURL string) (title, desc, tags, icon string, err error) {
	normalized, host, err := normalizeURL(rawURL)
	if err != nil { return "", "", "", "", err }
	title, desc, iconHref, tags := fetchPage(normalized)
	if title == "" { title = host }
	icon = resolveIcon(normalized, iconHref, host)
	if !iconOK(icon) { icon = "" }
	return trimRunes(title, 256), trimRunes(desc, 4096), trimRunes(tags, 512), icon, nil
}

func (s *server) scrapeHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) { writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"}); return }
	if r.Method != http.MethodPost { writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"}); return }
	var req struct { URL string `json:"url"` }
	if readJSON(r, &req) != nil { writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求无效"}); return }
	title, desc, tags, icon, err := scrapeFor(req.URL)
	if err != nil { writeJSON(w, 400, map[string]interface{}{"ok": false, "error": err.Error()}); return }
	writeJSON(w, 200, map[string]interface{}{"ok": true, "name": title, "description": desc, "tags": tags, "icon": icon, "source": "scrape"})
}

func (s *server) aiFillHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if readJSON(r, &req) != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求无效"})
		return
	}
	title, desc, tags, icon, iconSource, err := s.fillFor(req.URL)
	if err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"ok": true, "aiUsed": true, "name": title, "description": desc, "tags": tags,
		"icon": icon, "iconSource": iconSource,
	})
}

func (s *server) aiTestHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	readJSON(r, &req)
	if req.URL == "" {
		req.URL = "https://www.baidu.com"
	}
	title, desc, tags, icon, iconSource, err := s.fillFor(req.URL)
	if err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	cfg := s.loadAIConfig()
	configured := cfg.Endpoint != "" && cfg.APIKey != "" && cfg.Model != ""
	aiOK := configured && title != "" && err == nil
	writeJSON(w, 200, map[string]interface{}{
		"ok": true, "name": title, "description": desc, "tags": tags,
		"icon": icon, "iconSource": iconSource,
		"configured": configured, "aiOK": aiOK,
	})
}

func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

type updateSource struct {
	URL       string                 `json:"url"`
	Reachable bool                   `json:"reachable"`
	ElapsedMS int64                  `json:"elapsed_ms"`
	Error     string                 `json:"error"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

type githubInfo struct {
	URL        string `json:"url"`
	Version    string `json:"version"`
	Newer      bool   `json:"newer"`
	AssetURL   string `json:"asset_url"`
	ReleaseURL string `json:"release_url"`
	Error      string `json:"error"`
}

func currentAppVersion() string {
	if v := strings.TrimSpace(os.Getenv("TRIM_APPVER")); v != "" {
		return v
	}
	return "1.0.0"
}

func versionGreater(a, b string) bool {
	pa := strings.Split(strings.TrimPrefix(strings.TrimSpace(a), "v"), ".")
	pb := strings.Split(strings.TrimPrefix(strings.TrimSpace(b), "v"), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			fmt.Sscanf(pa[i], "%d", &x)
		}
		if i < len(pb) {
			fmt.Sscanf(pb[i], "%d", &y)
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func strVal(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func boolVal(m map[string]interface{}, key string) bool {
	if m == nil {
		return false
	}
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func fetchUpdateJSON(u string, timeout time.Duration) (map[string]interface{}, error) {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "hellopage-nav/"+currentAppVersion())
	resp, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func checkGitHub(api, ver string) githubInfo {
	gh := githubInfo{URL: "https://github.com/cjm2004/hellopage-nav/releases"}
	data, err := fetchUpdateJSON(api, 6*time.Second)
	if err != nil {
		gh.Error = err.Error()
		return gh
	}
	gh.Version = strVal(data, "tag_name")
	gh.ReleaseURL = strVal(data, "html_url")
	if assets, ok := data["assets"].([]interface{}); ok {
		for _, item := range assets {
			if a, ok := item.(map[string]interface{}); ok {
				if strings.HasSuffix(strings.ToLower(strVal(a, "name")), ".fpk") {
					gh.AssetURL = strVal(a, "browser_download_url")
					break
				}
			}
		}
	}
	gh.Newer = gh.Version != "" && versionGreater(gh.Version, ver)
	return gh
}

func (s *server) updateCheckHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	ver := currentAppVersion()
	appKey := "hellopage"
	channel := "stable"
	serverURLs := []string{
		"http://nas1.192321.xyz:18080",
		"http://nas.192321.xyz:18080",
		"http://nas.192322.xyz:18080",
	}
	githubAPI := "https://api.github.com/repos/cjm2004/hellopage-nav/releases/latest"

	q := url.Values{}
	q.Set("app_key", appKey)
	q.Set("current_version", ver)
	q.Set("channel", channel)

	var mu sync.Mutex
	var wg sync.WaitGroup
	results := make([]updateSource, 0, len(serverURLs))
	for _, base := range serverURLs {
		wg.Add(1)
		go func(base string) {
			defer wg.Done()
			start := time.Now()
			endpoint := strings.TrimRight(base, "/") + "/api/check-update?" + q.Encode()
			data, err := fetchUpdateJSON(endpoint, 6*time.Second)
			src := updateSource{URL: base, ElapsedMS: time.Since(start).Milliseconds(), Data: data}
			if err != nil {
				src.Error = err.Error()
			} else {
				src.Reachable = true
			}
			mu.Lock()
			results = append(results, src)
			mu.Unlock()
		}(base)
	}
	gh := githubInfo{URL: "https://github.com/cjm2004/hellopage-nav/releases"}
	wg.Add(1)
	go func() {
		defer wg.Done()
		gh = checkGitHub(githubAPI, ver)
	}()
	wg.Wait()

	// 有更新的服务器优先，同优先级里响应最快的胜出
	var best *updateSource
	for i := range results {
		if !results[i].Reachable || results[i].Data == nil {
			continue
		}
		if best == nil {
			best = &results[i]
			continue
		}
		bestAvail := boolVal(best.Data, "update_available")
		curAvail := boolVal(results[i].Data, "update_available")
		if curAvail && !bestAvail {
			best = &results[i]
		} else if curAvail == bestAvail && results[i].ElapsedMS < best.ElapsedMS {
			best = &results[i]
		}
	}

	buildGitHubOnly := func(errMsg string) map[string]interface{} {
		return map[string]interface{}{
			"ok": true, "enabled": true, "current_version": ver,
			"app_key": appKey, "channel": channel, "base_url": "",
			"software": "", "update_available": true, "update_mode": "optional",
			"version": gh.Version, "release_notes": "", "direct_url": "",
			"cloud_url": gh.URL, "sha256": "", "file_name": "", "size": 0,
			"min_version": "", "requires_restart": false,
			"servers": results, "github": gh, "github_only": true,
			"error": errMsg,
		}
	}

	if best == nil {
		writeJSON(w, 200, buildGitHubOnly("三个更新服务器都连不上，请前往 GitHub 下载最新版本"))
		return
	}

	avail := boolVal(best.Data, "update_available")
	if !avail && gh.Newer {
		writeJSON(w, 200, buildGitHubOnly("更新服务器还没有发布新版本，GitHub 已有 "+gh.Version+"，请前往下载"))
		return
	}

	updateMode := strVal(best.Data, "update_mode")
	if updateMode == "" {
		if avail {
			updateMode = "optional"
		} else {
			updateMode = "none"
		}
	}

	writeJSON(w, 200, map[string]interface{}{
		"ok": true, "enabled": true, "base_url": best.URL,
		"app_key": appKey, "channel": channel,
		"software":          strVal(best.Data, "software"),
		"current_version":   ver,
		"update_available":  avail,
		"update_mode":       updateMode,
		"version":           strVal(best.Data, "version"),
		"release_notes":     strVal(best.Data, "release_notes"),
		"direct_url":        strVal(best.Data, "direct_url"),
		"cloud_url":         strVal(best.Data, "cloud_url"),
		"sha256":            strVal(best.Data, "sha256"),
		"file_name":         strVal(best.Data, "file_name"),
		"size":              0,
		"min_version":       strVal(best.Data, "min_version"),
		"requires_restart":  boolVal(best.Data, "requires_restart"),
		"servers":           results,
		"github":            gh,
		"github_only":       false,
		"error":             strVal(best.Data, "error"),
	})
}

func main() {
	flag.Parse()
	log.SetFlags(log.LstdFlags)
	s := newServer(*dataDir)
	s.releaseDefaults()
	s.ensureWallpapers()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.healthz)
	mux.HandleFunc("/api/error", s.apiError)
	mux.HandleFunc("/api/data", s.dataHandler)
	mux.HandleFunc("/api/auth/status", s.authStatusHandler)
	mux.HandleFunc("/api/auth/setup", s.setupHandler)
	mux.HandleFunc("/api/auth/login", s.loginHandler)
	mux.HandleFunc("/api/auth/logout", s.logoutHandler)
	mux.HandleFunc("/api/auth/password", s.passwordHandler)
	mux.HandleFunc("/api/ai/config", s.aiConfigHandler)
	mux.HandleFunc("/api/ai/fill", s.aiFillHandler)
	mux.HandleFunc("/api/scrape", s.scrapeHandler)
	mux.HandleFunc("/api/ai/test", s.aiTestHandler)
	mux.HandleFunc("/api/update/check", s.updateCheckHandler)
	mux.HandleFunc("/api/admin/analytics", s.analyticsHandler)
	mux.HandleFunc("/api/admin/dashboard", s.dashboardHandler)
	mux.HandleFunc("/api/admin/check-links", s.linkCheckHandler)
	mux.HandleFunc("/api/admin/wallpapers", s.wallpapersHandler)
	mux.HandleFunc("/api/admin/wallpapers/switch", s.switchWallpaperHandler)
	mux.HandleFunc("/api/admin/webdav", s.webdavAdminHandler)
	mux.HandleFunc("/api/admin/webdav/test", s.webdavTestHandler)
	mux.HandleFunc("/api/admin/webdav/list", s.webdavListHandler)
	mux.HandleFunc("/api/webdav/file", s.webdavFileHandler)
	mux.HandleFunc("/api/admin/backup", s.backupHandler)
	mux.HandleFunc("/api/admin/backups/delete", s.backupDeleteHandler)
	mux.HandleFunc("/wallpapers/", s.wallpaperFileHandler)
	registerArticleRoutes(mux, s)
	mux.HandleFunc("/", s.staticHandler)

	log.Printf("[hellopage-nav] HelloPage 风格导航站已启动: %s (数据目录: %s)", *addr, *dataDir)
	if err := http.ListenAndServe(*addr, withHeaders(mux)); err != nil {
		log.Printf("[hellopage-nav] 服务器退出: %v", err)
	}
}
