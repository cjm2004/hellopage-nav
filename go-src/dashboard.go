package main

import (
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type dashSeriesPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type dashSeries struct {
	Key    string            `json:"key"`
	Label  string            `json:"label"`
	Points []dashSeriesPoint `json:"points"`
}

type dashTopPage struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

func (s *server) dashboardHandler(w http.ResponseWriter, r *http.Request) {
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
	now := time.Now()
	dates := make([]string, 0, days)
	for i := days - 1; i >= 0; i-- {
		dates = append(dates, now.AddDate(0, 0, -i).Format("2006-01-02"))
	}

	var analytics analyticsDocument
	if b, err := os.ReadFile(s.analyticsPath()); err == nil {
		_ = json.Unmarshal(b, &analytics)
	}
	if analytics.Days == nil {
		analytics.Days = map[string]map[string]int{}
	}
	todayKey := now.Format("2006-01-02")
	todayViews := 0
	totalViews := 0
	keySet := map[string]bool{}
	for d, pages := range analytics.Days {
		for k, c := range pages {
			totalViews += c
			if d == todayKey {
				todayViews += c
			}
			keySet[k] = true
		}
	}
	ordered := make([]string, 0, len(keySet))
	for k := range keySet {
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
	series := make([]dashSeries, 0, len(ordered))
	for _, k := range ordered {
		points := make([]dashSeriesPoint, 0, days)
		for _, d := range dates {
			points = append(points, dashSeriesPoint{Date: d, Count: analytics.Days[d][k]})
		}
		series = append(series, dashSeries{Key: k, Label: analyticsLabel(k), Points: points})
	}

	// data.json
	groups, links := 0, 0
	if b, err := os.ReadFile(s.dataJSONPath()); err == nil {
		var d struct {
			NavGroups []struct {
				Links []map[string]interface{} `json:"links"`
			} `json:"navGroups"`
		}
		if json.Unmarshal(b, &d) == nil {
			groups = len(d.NavGroups)
			for _, g := range d.NavGroups {
				links += len(g.Links)
			}
		}
	}

	// articles + comments
	published, draft, scheduled, comments := 0, 0, 0, 0
	if b, err := os.ReadFile(s.dataDir + "/articles.json"); err == nil {
		var d struct {
			Articles []struct {
				Status string `json:"status"`
			} `json:"articles"`
		}
		if json.Unmarshal(b, &d) == nil {
			for _, a := range d.Articles {
				switch a.Status {
				case "published":
					published++
				case "draft":
					draft++
				case "scheduled":
					scheduled++
				}
			}
		}
	}
	if b, err := os.ReadFile(s.dataDir + "/comments.json"); err == nil {
		var d struct {
			Comments []map[string]interface{} `json:"comments"`
		}
		if json.Unmarshal(b, &d) == nil {
			comments = len(d.Comments)
		}
	}

	// lotteries
	lotteries, active, entries := 0, 0, 0
	if b, err := os.ReadFile(s.dataDir + "/lotteries.json"); err == nil {
		var d struct {
			Lotteries []struct {
				Status string `json:"status"`
			} `json:"lotteries"`
			Entries []map[string]interface{} `json:"entries"`
		}
		if json.Unmarshal(b, &d) == nil {
			lotteries = len(d.Lotteries)
			entries = len(d.Entries)
			for _, l := range d.Lotteries {
				if l.Status == "active" {
					active++
				}
			}
		}
	}

	wallpapers := 0
	if b, err := os.ReadFile(s.wallpaperJSONPath()); err == nil {
		var d struct {
			Images []map[string]interface{} `json:"images"`
		}
		if json.Unmarshal(b, &d) == nil {
			wallpapers = len(d.Images)
		}
	}

	// top pages
	pageTotals := map[string]int{}
	for _, pages := range analytics.Days {
		for k, c := range pages {
			pageTotals[k] += c
		}
	}
	top := make([]dashTopPage, 0)
	for k, c := range pageTotals {
		top = append(top, dashTopPage{Key: k, Label: analyticsLabel(k), Count: c})
	}
	sort.Slice(top, func(i, j int) bool { return top[i].Count > top[j].Count })
	if len(top) > 8 {
		top = top[:8]
	}

	writeJSON(w, 200, map[string]interface{}{
		"ok": true,
		"days": days,
		"dates": dates,
		"views": map[string]interface{}{
			"today": todayViews,
			"total": totalViews,
		},
		"links":    links,
		"groups":   groups,
		"articles": map[string]interface{}{"published": published, "draft": draft, "scheduled": scheduled, "total": published + draft + scheduled},
		"comments": comments,
		"lotteries": map[string]interface{}{"total": lotteries, "active": active, "entries": entries},
		"wallpapers": wallpapers,
		"series": series,
		"topPages": top,
	})
}
