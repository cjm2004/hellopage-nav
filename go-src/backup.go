package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func (s *server) backupDir() string { return filepath.Join(s.dataDir, "backups") }

func (s *server) createBackupArchive() (string, error) {
	_ = os.MkdirAll(s.backupDir(), 0700)
	name := "backup-" + time.Now().Format("20060102-150405") + ".tar.gz"
	path := filepath.Join(s.backupDir(), name)
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	gw := gzip.NewWriter(f)
	tw := tar.NewWriter(gw)
	err = filepath.Walk(s.dataDir, func(fp string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if fp == s.backupDir() {
			return filepath.SkipDir
		}
		rel, err := filepath.Rel(s.dataDir, fp)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = rel
		if info.IsDir() {
			hdr.Name += "/"
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		file, err := os.Open(fp)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(tw, file)
		return err
	})
	if err != nil {
		_ = tw.Close()
		_ = gw.Close()
		return "", err
	}
	if err := tw.Close(); err != nil {
		return "", err
	}
	if err := gw.Close(); err != nil {
		return "", err
	}
	return path, nil
}

func (s *server) backupHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	switch r.Method {
	case http.MethodPost:
		var req struct {
			Target string `json:"target"`
		}
		if readJSON(r, &req) != nil {
			writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "请求无效"})
			return
		}
		path, err := s.createBackupArchive()
		if err != nil {
			writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "创建备份失败：" + err.Error()})
			return
		}
		if req.Target == "webdav" {
			cfg := s.loadWebDAVConfig()
			if cfg.URL == "" {
				writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "WebDAV 未配置"})
				return
			}
			data, err := os.ReadFile(path)
			if err != nil {
				writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "读取备份失败"})
				return
			}
			remote := strings.TrimRight(cfg.BackupPath, "/") + "/" + filepath.Base(path)
			resp, err := webdavRequest(cfg, "PUT", remote, bytes.NewReader(data))
			if err != nil {
				writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "上传 WebDAV 失败：" + err.Error()})
				return
			}
			resp.Body.Close()
			if resp.StatusCode >= 300 {
				writeJSON(w, 500, map[string]interface{}{"ok": false, "error": "上传 WebDAV 失败，状态码 " + http.StatusText(resp.StatusCode)})
				return
			}
		}
		writeJSON(w, 200, map[string]interface{}{"ok": true, "file": filepath.Base(path), "path": path})
	case http.MethodGet:
		_ = os.MkdirAll(s.backupDir(), 0700)
		entries, _ := os.ReadDir(s.backupDir())
		list := []map[string]interface{}{}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			list = append(list, map[string]interface{}{"name": e.Name(), "size": info.Size(), "time": info.ModTime().Format(time.RFC3339)})
		}
		sort.Slice(list, func(i, j int) bool { return list[i]["name"].(string) > list[j]["name"].(string) })
		writeJSON(w, 200, map[string]interface{}{"backups": list})
	default:
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
	}
}

func (s *server) backupDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if !s.isAuthenticated(r) {
		writeJSON(w, 401, map[string]interface{}{"ok": false, "error": "未登录"})
		return
	}
	if r.Method != http.MethodDelete {
		writeJSON(w, 405, map[string]interface{}{"ok": false, "error": "方法不允许"})
		return
	}
	name := filepath.Base(r.URL.Query().Get("name"))
	if name == "" || name == "." || name == ".." {
		writeJSON(w, 400, map[string]interface{}{"ok": false, "error": "参数无效"})
		return
	}
	_ = os.Remove(filepath.Join(s.backupDir(), name))
	writeJSON(w, 200, map[string]interface{}{"ok": true})
}

