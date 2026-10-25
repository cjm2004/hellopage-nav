package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type linkCheckRequest struct {
	URLs []string `json:"urls"`
}

type linkCheckResult struct {
	URL    string `json:"url"`
	OK     bool   `json:"ok"`
	Status int    `json:"status"`
	Error  string `json:"error,omitempty"`
}

func checkOneURL(url string) linkCheckResult {
	res := linkCheckResult{URL: url}
	client := &http.Client{
		Timeout: 12 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodHead, url, nil)
	if err != nil {
		res.Error = "无效网址"
		return res
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	resp, err := client.Do(req)
	if err == nil && (resp.StatusCode == http.StatusMethodNotAllowed || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusBadRequest) {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 512))
		resp.Body.Close()
		getReq, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
		getReq.Header.Set("User-Agent", req.Header.Get("User-Agent"))
		resp, err = client.Do(getReq)
	}
	if err != nil {
		res.Error = "请求失败"
		return res
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
	res.Status = resp.StatusCode
	res.OK = resp.StatusCode >= 200 && resp.StatusCode < 500
	if !res.OK {
		res.Error = http.StatusText(resp.StatusCode)
	}
	return res
}

func (s *server) linkCheckHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	var req linkCheckRequest
	if readJSON(r, &req) != nil {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求无效"})
		return
	}
	if len(req.URLs) > 500 {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "一次最多检测 500 个链接"})
		return
	}
	results := make([]linkCheckResult, len(req.URLs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, u := range req.URLs {
		u = strings.TrimSpace(u)
		if u == "" {
			results[i] = linkCheckResult{URL: u, OK: false, Error: "空地址"}
			continue
		}
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			results[i] = linkCheckResult{URL: u, OK: false, Error: "非 HTTP 地址"}
			continue
		}
		wg.Add(1)
		go func(idx int, url string) {
			defer wg.Done()
			sem <- struct{}{}
			results[idx] = checkOneURL(url)
			<-sem
		}(i, u)
	}
	wg.Wait()
	b, _ := json.Marshal(map[string]interface{}{"results": results})
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(200)
	w.Write(b)
}
