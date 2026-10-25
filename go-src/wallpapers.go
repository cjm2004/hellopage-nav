package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var wallpaperMu sync.Mutex

type Wallpaper struct {
	ID       string `json:"id"`
	Category string `json:"category"` // season / festival / rotation
	Key      string `json:"key"`      // spring/summer/autumn/winter 或 newyear 等节日 key，轮换为空
	Label    string `json:"label"`
	File     string `json:"file"`
	URL      string `json:"url"`
}

type wallpaperDocument struct {
	Images []Wallpaper `json:"images"`
}

func (s *server) wallpaperDir() string { return filepath.Join(s.dataDir, "wallpapers") }
func (s *server) wallpaperJSONPath() string {
	return filepath.Join(s.dataDir, "wallpapers.json")
}

func (s *server) wallpaperList() []Wallpaper {
	b, err := os.ReadFile(s.wallpaperJSONPath())
	if err != nil {
		return []Wallpaper{}
	}
	var doc wallpaperDocument
	if json.Unmarshal(b, &doc) != nil {
		return []Wallpaper{}
	}
	for i := range doc.Images {
		doc.Images[i].URL = "/wallpapers/" + doc.Images[i].File
	}
	return doc.Images
}

func (s *server) saveWallpapers(doc wallpaperDocument) {
	b, _ := json.Marshal(doc)
	_ = os.WriteFile(s.wallpaperJSONPath(), b, 0600)
}

func (s *server) ensureWallpapers() {
	wallpaperMu.Lock()
	defer wallpaperMu.Unlock()
	dir := s.wallpaperDir()
	if _, err := os.Stat(s.wallpaperJSONPath()); err == nil {
		return
	}
	_ = os.MkdirAll(dir, 0700)
	doc := wallpaperDocument{Images: []Wallpaper{}}
	add := func(id, category, key, label string, data []byte, ext string) bool {
		if len(data) == 0 {
			return false
		}
		name := id + "." + ext
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			return false
		}
		doc.Images = append(doc.Images, Wallpaper{ID: id, Category: category, Key: key, Label: label, File: name, URL: "/wallpapers/" + name})
		return true
	}
	seasonNames := map[string]string{"spring": "春天", "summer": "夏天", "autumn": "秋天", "winter": "冬天"}
	for _, k := range []string{"spring", "summer", "autumn", "winter"} {
		if b, err := webFS.ReadFile("web/assets/img/seasonal/" + k + ".jpg"); err == nil {
			add("season-"+k, "season", k, seasonNames[k]+"壁纸", b, "jpg")
		}
	}
	festivalNames := map[string]string{
		"newyear": "元旦", "chunjie": "春节", "yuanxiao": "元宵", "valentine": "情人节",
		"qingming": "清明", "duanwu": "端午", "qixi": "七夕", "zhongqiu": "中秋",
		"guoqing": "国庆", "christmas": "圣诞",
	}
	for k, label := range festivalNames {
		if b, err := webFS.ReadFile("web/assets/img/festival/" + k + ".jpg"); err == nil {
			add("festival-"+k, "festival", k, label+"壁纸", b, "jpg")
		}
	}
	client := &http.Client{Timeout: 18 * time.Second}
	for i := 1; i <= 12; i++ {
		seed := fmt.Sprintf("hellopage%d", i)
		url := "https://picsum.photos/seed/" + seed + "/1920/1080"
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 6<<20))
		resp.Body.Close()
		if len(body) < 20000 {
			continue
		}
		ext := "jpg"
		if ct := http.DetectContentType(body); strings.HasPrefix(ct, "image/png") {
			ext = "png"
		} else if strings.HasPrefix(ct, "image/webp") {
			ext = "webp"
		}
		add(fmt.Sprintf("rotation-%02d", i), "rotation", "", fmt.Sprintf("每日壁纸 %02d", i), body, ext)
	}
	s.saveWallpapers(doc)
}

func (s *server) wallpaperFileHandler(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Path)
	if name == "" || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.wallpaperDir(), name))
}

func (s *server) wallpapersHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		wallpaperMu.Lock()
		list := s.wallpaperList()
		wallpaperMu.Unlock()
		writeJSON(w, 200, map[string]interface{}{"images": list})
	case http.MethodPost:
		wallpaperMu.Lock()
		defer wallpaperMu.Unlock()
		if err := r.ParseMultipartForm(20 << 20); err != nil {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "上传失败：文件过大或表单无效"})
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请选择图片文件"})
			return
		}
		defer file.Close()
		body, _ := io.ReadAll(io.LimitReader(file, 20<<20))
		if len(body) < 100 {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "文件内容为空"})
			return
		}
		ct := http.DetectContentType(body)
		ext := "jpg"
		switch {
		case strings.HasPrefix(ct, "image/png"):
			ext = "png"
		case strings.HasPrefix(ct, "image/webp"):
			ext = "webp"
		case strings.HasPrefix(ct, "image/gif"):
			ext = "gif"
		case !strings.HasPrefix(ct, "image/jpeg"):
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "仅支持 JPG/PNG/WEBP/GIF 图片"})
			return
		}
		_ = os.MkdirAll(s.wallpaperDir(), 0700)
		id := fmt.Sprintf("wp-%d", time.Now().UnixNano())
		name := id + "." + ext
		if err := os.WriteFile(filepath.Join(s.wallpaperDir(), name), body, 0600); err != nil {
			writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "写入失败"})
			return
		}
		category := r.FormValue("category")
		if category != "season" && category != "festival" && category != "rotation" {
			category = "rotation"
		}
		key := strings.TrimSpace(r.FormValue("key"))
		label := strings.TrimSpace(r.FormValue("label"))
		if label == "" {
			label = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
		}
		doc := wallpaperDocument{Images: s.wallpaperList()}
		img := Wallpaper{ID: id, Category: category, Key: key, Label: label, File: name, URL: "/wallpapers/" + name}
		doc.Images = append(doc.Images, img)
		s.saveWallpapers(doc)
		writeJSON(w, 200, map[string]interface{}{"ok": true, "image": img})
	case http.MethodPut:
		wallpaperMu.Lock()
		defer wallpaperMu.Unlock()
		var req Wallpaper
		if readJSON(r, &req) != nil || req.ID == "" {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求无效"})
			return
		}
		doc := wallpaperDocument{Images: s.wallpaperList()}
		hit := false
		for i := range doc.Images {
			if doc.Images[i].ID == req.ID {
				doc.Images[i].Label = req.Label
				doc.Images[i].Category = req.Category
				doc.Images[i].Key = req.Key
				hit = true
				break
			}
		}
		if !hit {
			writeJSON(w, 404, map[string]interface{}{"ok": false, "error": "壁纸不存在"})
			return
		}
		s.saveWallpapers(doc)
		writeJSON(w, 200, map[string]interface{}{"ok": true})
	case http.MethodDelete:
		wallpaperMu.Lock()
		defer wallpaperMu.Unlock()
		id := r.URL.Query().Get("id")
		if id == "" {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少 id"})
			return
		}
		doc := wallpaperDocument{Images: s.wallpaperList()}
		var remaining []Wallpaper
		var removed Wallpaper
		for _, img := range doc.Images {
			if img.ID == id {
				removed = img
			} else {
				remaining = append(remaining, img)
			}
		}
		if removed.ID == "" {
			writeJSON(w, 404, map[string]interface{}{"ok": false, "error": "壁纸不存在"})
			return
		}
		_ = os.Remove(filepath.Join(s.wallpaperDir(), removed.File))
		doc.Images = remaining
		s.saveWallpapers(doc)
		writeJSON(w, 200, map[string]interface{}{"ok": true})
	default:
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
	}
}

func (s *server) switchWallpaperHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	wallpaperMu.Lock()
	list := s.wallpaperList()
	wallpaperMu.Unlock()
	if len(list) == 0 {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "壁纸库为空"})
		return
	}
	b, err := os.ReadFile(s.dataJSONPath())
	if err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "读取配置失败"})
		return
	}
	var cfg map[string]interface{}
	if json.Unmarshal(b, &cfg) != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "配置解析失败"})
		return
	}
	site, _ := cfg["siteConfig"].(map[string]interface{})
	if site == nil {
		site = map[string]interface{}{}
		cfg["siteConfig"] = site
	}
	interval := 24 * time.Hour
	switch site["bgRotateInterval"] {
	case "hourly":
		interval = time.Hour
	case "sixHours":
		interval = 6 * time.Hour
	case "halfDay":
		interval = 12 * time.Hour
	}
	current := ""
	if v, ok := site["bgOverride"].(string); ok {
		current = v
	}
	candidates := make([]Wallpaper, 0, len(list))
	for _, img := range list {
		if img.URL != current {
			candidates = append(candidates, img)
		}
	}
	if len(candidates) == 0 {
		candidates = list
	}
	pick := candidates[rand.Intn(len(candidates))]
	site["bgOverride"] = pick.URL
	site["bgOverrideUntil"] = time.Now().Add(interval).UnixMilli()
	out, _ := json.Marshal(cfg)
	if err := os.WriteFile(s.dataJSONPath(), out, 0644); err != nil {
		writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "写入配置失败"})
		return
	}
	writeJSON(w, 200, map[string]interface{}{"ok": true, "url": pick.URL, "label": pick.Label})
}
