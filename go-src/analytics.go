package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var analyticsMu sync.Mutex

type analyticsDocument struct {
	Days map[string]map[string]int `json:"days"`
}

func (s *server) analyticsPath() string { return filepath.Join(s.dataDir, "analytics.json") }

func (s *server) analyticsRecord(page string) {
	if page == "" {
		return
	}
	analyticsMu.Lock()
	defer analyticsMu.Unlock()
	doc := analyticsDocument{Days: map[string]map[string]int{}}
	if b, err := os.ReadFile(s.analyticsPath()); err == nil {
		_ = json.Unmarshal(b, &doc)
		if doc.Days == nil {
			doc.Days = map[string]map[string]int{}
		}
	}
	key := time.Now().Format("2006-01-02")
	if doc.Days[key] == nil {
		doc.Days[key] = map[string]int{}
	}
	doc.Days[key][page]++
	b, _ := json.Marshal(doc)
	_ = os.WriteFile(s.analyticsPath(), b, 0600)
}

func (s *server) analyticsHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	days := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 366 {
			days = n
		}
	}
	analyticsMu.Lock()
	defer analyticsMu.Unlock()
	doc := analyticsDocument{Days: map[string]map[string]int{}}
	if b, err := os.ReadFile(s.analyticsPath()); err == nil {
		_ = json.Unmarshal(b, &doc)
		if doc.Days == nil {
			doc.Days = map[string]map[string]int{}
		}
	}
	today := time.Now()
	dates := make([]string, 0, days)
	for i := days - 1; i >= 0; i-- {
		dates = append(dates, today.AddDate(0, 0, -i).Format("2006-01-02"))
	}
	keys := map[string]bool{}
	for _, d := range dates {
		for k := range doc.Days[d] {
			if strings.HasPrefix(k, "article:") || k == "home" || k == "articles-index" {
				keys[k] = true
			}
		}
	}
	ordered := make([]string, 0, len(keys))
	for k := range keys {
		ordered = append(ordered, k)
	}
	sort.Slice(ordered, func(i, j int) bool {
		ri := strings.TrimPrefix(ordered[i], "article:")
		rj := strings.TrimPrefix(ordered[j], "article:")
		if ri == "home" {
			return true
		}
		if rj == "home" {
			return false
		}
		if ri == "articles-index" {
			return rj != "home"
		}
		if rj == "articles-index" {
			return false
		}
		return ri < rj
	})
	series := []map[string]interface{}{}
	for _, k := range ordered {
		points := make([]map[string]interface{}, 0, days)
		for _, d := range dates {
			points = append(points, map[string]interface{}{"date": d, "count": doc.Days[d][k]})
		}
		series = append(series, map[string]interface{}{
			"key":    k,
			"label":  analyticsLabel(k),
			"points": points,
		})
	}
	writeJSON(w, 200, map[string]interface{}{"days": days, "dates": dates, "series": series})
}

func analyticsLabel(key string) string {
	switch key {
	case "home":
		return "主页"
	case "articles-index":
		return "文章列表"
	}
	if strings.HasPrefix(key, "article:") {
		slug := strings.TrimPrefix(key, "article:")
		return "文章 /" + slug
	}
	return key
}
