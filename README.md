# HelloPage 导航 (hellopage-nav)

仿 HelloPage 主题的聚合搜索与分组导航主页，运行在飞牛 fnOS 上，适合作为内网导航站 / 首页使用。

## 功能

- **聚合搜索**：多搜索引擎一键切换
- **分组导航**：自定义站点分组，站点卡片支持 logo / 名称 / 备注，长文本滚动
- **AI 智能填写**：根据网址自动生成站点名称、描述、标签与图标
- **图标优化**：首字占位 + favicon 淡入，加载更快
- **文章系统**：Markdown / HTML 文章，草稿与定时发布
- **仪表盘**：访问统计、站点概览
- **链接检查**：批量检测站点可用性
- **壁纸**：节日 / 季节壁纸自动切换
- **WebDAV 存储** 与 **一键备份**
- **深色 / 浅色主题**
- **多更新源检查更新**：三台更新服务器并行探测，GitHub Releases 兜底，带更新弹窗

## 安装

1. 在 [Releases](https://github.com/cjm2004/hellopage-nav/releases) 下载 `hellopage-nav_1.0.0_x86.fpk`
2. 飞牛桌面 →「应用中心」→ 右上角「手动安装」→ 选择该 fpk
3. 安装完成后桌面出现「HelloPage 导航」图标，点开即可使用

## 从源码构建

需要 Go 1.23（仅使用标准库）：

```bash
cd go-src
go build -o hellopage-nav .
```

前端资源通过 `go:embed` 内嵌到单个二进制中，无需额外部署。

## 更新检查

应用启动时会通过 `/api/update/check` 并行探测三个更新服务器，并检查 GitHub 最新版本号；有新版本时弹出更新窗口，三台服务器都不可用时引导前往 GitHub Releases 下载。

## 技术栈

- Go 1.23，仅标准库
- 原生 HTML / CSS / JavaScript，`go:embed` 内嵌

## 作者

- 作者 / 维护者：无名的小卒
- 仓库：https://github.com/cjm2004/hellopage-nav
