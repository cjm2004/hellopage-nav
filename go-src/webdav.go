package main

import (
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type WebDAVConfig struct {
	URL        string `json:"url"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	PhotoPath  string `json:"photoPath"`
	BackupPath string `json:"backupPath"`
	Enabled    bool   `json:"enabled"`
}

func (s *server) webdavConfigPath() string { return filepath.Join(s.dataDir, "webdav.json") }
func (s *server) loadWebDAVConfig() WebDAVConfig {
	cfg := WebDAVConfig{}
	if b, err := os.ReadFile(s.webdavConfigPath()); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
	return cfg
}
func (s *server) saveWebDAVConfig(cfg WebDAVConfig) error {
	b, _ := json.Marshal(cfg)
	return os.WriteFile(s.webdavConfigPath(), b, 0600)
}

func webdavClient(cfg WebDAVConfig) *http.Client { return &http.Client{Timeout: 25 * time.Second} }

func webdavRequest(cfg WebDAVConfig, method, path string, body io.Reader) (*http.Response, error) {
	base := strings.TrimRight(cfg.URL, "/")
	u := base + "/" + strings.TrimLeft(path, "/")
	req, err := http.NewRequest(method, u, body)
	if err != nil {
		return nil, err
	}
	if cfg.Username != "" || cfg.Password != "" {
		req.SetBasicAuth(cfg.Username, cfg.Password)
	}
	return webdavClient(cfg).Do(req)
}

func (s *server) webdavTestHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	cfg := s.loadWebDAVConfig()
	if cfg.URL == "" {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请先填写 WebDAV 地址"})
		return
	}
	resp, err := webdavRequest(cfg, "PROPFIND", cfg.PhotoPath, strings.NewReader(`<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>`))
	if err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "连接失败：" + err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 || resp.StatusCode == 207 {
		writeJSON(w, 200, map[string]interface{}{"ok": true, "status": resp.StatusCode})
		return
	}
	writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "连接失败，状态码 " + statusText(resp.StatusCode)})
}

func statusText(code int) string { return http.StatusText(code) }

type davResponse struct {
	Href string `xml:"href"`
}
type davMultiStatus struct {
	Responses []davResponse `xml:"response"`
}

func (s *server) webdavListHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	cfg := s.loadWebDAVConfig()
	if cfg.URL == "" {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "WebDAV 未配置"})
		return
	}
	resp, err := webdavRequest(cfg, "PROPFIND", cfg.PhotoPath, strings.NewReader(`<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>`))
	if err != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "读取失败：" + err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "读取失败，状态码 " + http.StatusText(resp.StatusCode)})
		return
	}
	var multi davMultiStatus
	if xml.NewDecoder(resp.Body).Decode(&multi) != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "解析目录失败"})
		return
	}
	files := []map[string]string{}
	for _, item := range multi.Responses {
		if item.Href == "" {
			continue
		}
		lower := strings.ToLower(item.Href)
		if !strings.HasSuffix(lower, ".jpg") && !strings.HasSuffix(lower, ".jpeg") && !strings.HasSuffix(lower, ".png") && !strings.HasSuffix(lower, ".webp") && !strings.HasSuffix(lower, ".gif") {
			continue
		}
		files = append(files, map[string]string{"name": filepath.Base(item.Href), "path": item.Href})
	}
	writeJSON(w, 200, map[string]interface{}{"files": files})
}

func (s *server) webdavFileHandler(w http.ResponseWriter, r *http.Request) {
	cfg := s.loadWebDAVConfig()
	if cfg.URL == "" {
		http.NotFound(w, r)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.NotFound(w, r)
		return
	}
	resp, err := webdavRequest(cfg, "GET", path, nil)
	if err != nil {
		http.Error(w, "读取失败", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	io.Copy(w, io.LimitReader(resp.Body, 32<<20))
}

func (s *server) webdavAdminHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		cfg := s.loadWebDAVConfig()
		cfg.Password = ""
		writeJSON(w, 200, map[string]interface{}{"config": cfg})
	case http.MethodPut:
		var cfg WebDAVConfig
		if readJSON(r, &cfg) != nil {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求无效"})
			return
		}
		old := s.loadWebDAVConfig()
		if cfg.Password == "" {
			cfg.Password = old.Password
		}
		if err := s.saveWebDAVConfig(cfg); err != nil {
			writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "保存失败"})
			return
		}
		writeJSON(w, 200, map[string]interface{}{"ok": true})
	default:
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
	}
}
