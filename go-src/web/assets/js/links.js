/**
 * 站点分组数据 —— 在这里添加 / 修改 / 删除你的导航站点
 *
 * 字段说明:
 *   name       分组名称
 *   icon       分组图标（SVG 或 <img>，建议 20x20 单色）
 *   links      站点列表
 *     name     站点名称（显示在图标下方）
 *     url      站点地址
 *     icon     站点图标，留空 "" 则自动抓取该站点 favicon；
 *              也可手动填写图片地址，如 "https://example.com/logo.png"
 *
 * 图标加载失败时会自动显示站点名称首字作为兜底，无需担心图标挂掉。
 */
var NAV_GROUPS = [
  {
    name: "推荐常用",
    icon: '<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M512 64l116.9 236.9L896 339l-192 187.4L954.9 864 512 722.8 69.1 864 320 526.4 128 339l267.1-38.1z" fill="#f7b84c"/></svg>',
    links: [
      { name: "百度", url: "https://www.baidu.com", icon: "" },
      { name: "Google", url: "https://www.google.com", icon: "" },
      { name: "Bing必应", url: "https://cn.bing.com", icon: "" },
      { name: "哔哩哔哩", url: "https://www.bilibili.com", icon: "" },
      { name: "知乎", url: "https://www.zhihu.com", icon: "" },
      { name: "微博", url: "https://weibo.com", icon: "" },
      { name: "GitHub", url: "https://github.com", icon: "" },
      { name: "淘宝", url: "https://www.taobao.com", icon: "" },
      { name: "京东", url: "https://www.jd.com", icon: "" },
      { name: "豆瓣", url: "https://www.douban.com", icon: "" },
      { name: "抖音", url: "https://www.douyin.com", icon: "" },
      { name: "QQ邮箱", url: "https://mail.qq.com", icon: "" },
    ],
  },
  {
    name: "AI 工具",
    icon: '<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M736 480a224 224 0 1 0-448 0 224 224 0 0 0 448 0z m64 0a288 288 0 1 1-576 0 288 288 0 0 1 576 0zM512 640a32 32 0 0 1-32-32v-96h-96a32 32 0 0 1 0-64h96v-96a32 32 0 0 1 64 0v96h96a32 32 0 0 1 0 64h-96v96a32 32 0 0 1-32 32zM480 128h64a32 32 0 0 1 0 64h-64a32 32 0 0 1 0-64z m0 704h64a32 32 0 0 1 0 64h-64a32 32 0 0 1 0-64z" fill="#4e6ef2"/></svg>',
    links: [
      { name: "ChatGPT", url: "https://chatgpt.com", icon: "" },
      { name: "Claude", url: "https://claude.ai", icon: "" },
      { name: "DeepSeek", url: "https://chat.deepseek.com", icon: "" },
      { name: "Kimi", url: "https://kimi.moonshot.cn", icon: "" },
      { name: "豆包", url: "https://www.doubao.com", icon: "" },
      { name: "文心一言", url: "https://yiyan.baidu.com", icon: "" },
      { name: "通义千问", url: "https://tongyi.aliyun.com", icon: "" },
      { name: "秘塔AI搜索", url: "https://metaso.cn", icon: "" },
      { name: "Perplexity", url: "https://www.perplexity.ai", icon: "" },
      { name: "HuggingFace", url: "https://huggingface.co", icon: "" },
      { name: "通义万相", url: "https://wanx.aliyun.com", icon: "" },
      { name: "Copilot", url: "https://copilot.microsoft.com", icon: "" },
    ],
  },
  {
    name: "影音娱乐",
    icon: '<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M512 64a448 448 0 1 0 448 448A448 448 0 0 0 512 64z m0 832a384 384 0 1 1 384-384 384 384 0 0 1-384 384z" fill="#f56c6c"/><path d="M448 352l256 160-256 160V352z" fill="#f56c6c"/></svg>',
    links: [
      { name: "哔哩哔哩", url: "https://www.bilibili.com", icon: "" },
      { name: "爱奇艺", url: "https://www.iqiyi.com", icon: "" },
      { name: "腾讯视频", url: "https://v.qq.com", icon: "" },
      { name: "优酷", url: "https://www.youku.com", icon: "" },
      { name: "芒果TV", url: "https://www.mgtv.com", icon: "" },
      { name: "YouTube", url: "https://www.youtube.com", icon: "" },
      { name: "豆瓣电影", url: "https://movie.douban.com", icon: "" },
      { name: "网易云音乐", url: "https://music.163.com", icon: "" },
      { name: "QQ音乐", url: "https://y.qq.com", icon: "" },
      { name: "酷安", url: "https://www.coolapk.com", icon: "" },
      { name: "猫眼电影", url: "https://www.maoyan.com", icon: "" },
      { name: "Spotify", url: "https://open.spotify.com", icon: "" },
    ],
  },
  {
    name: "技术社区",
    icon: '<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M832 128H192a64 64 0 0 0-64 64v448a64 64 0 0 0 64 64h192l96 128 96-128h256a64 64 0 0 0 64-64V192a64 64 0 0 0-64-64z m-512 384a32 32 0 1 1 32-32 32 32 0 0 1-32 32z m192 0a32 32 0 1 1 32-32 32 32 0 0 1-32 32z m192 0a32 32 0 1 1 32-32 32 32 0 0 1-32 32z" fill="#67c23a"/></svg>',
    links: [
      { name: "掘金", url: "https://juejin.cn", icon: "" },
      { name: "CSDN", url: "https://www.csdn.net", icon: "" },
      { name: "SegmentFault", url: "https://segmentfault.com", icon: "" },
      { name: "博客园", url: "https://www.cnblogs.com", icon: "" },
      { name: "开源中国", url: "https://www.oschina.net", icon: "" },
      { name: "V2EX", url: "https://www.v2ex.com", icon: "" },
      { name: "StackOverflow", url: "https://stackoverflow.com", icon: "" },
      { name: "少数派", url: "https://sspai.com", icon: "" },
      { name: "InfoQ", url: "https://www.infoq.cn", icon: "" },
      { name: "腾讯云社区", url: "https://cloud.tencent.com/developer", icon: "" },
      { name: "阿里云社区", url: "https://developer.aliyun.com", icon: "" },
      { name: "Linux中国", url: "https://linux.cn", icon: "" },
    ],
  },
  {
    name: "开发工具",
    icon: '<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M301.3 496.7L136.4 331.8a32 32 0 0 1 0-45.2l118.2-118.2a32 32 0 0 1 45.2 0l164.9 164.9a32 32 0 0 1 0 45.2L346.5 496.7a32 32 0 0 1-45.2 0z m452.4 0L588.8 331.8a32 32 0 0 1 0-45.2L753.7 121.7l45.2 45.2L644 321.8l142.1 142.1a32 32 0 0 1-32 32.8zM85.5 819.4a32 32 0 0 1 0-45.2l181-181a32 32 0 0 1 45.3 45.2l-181 181a32 32 0 0 1-45.3 0z m853-45.2a32 32 0 0 1-45.2 45.2l-181-181 45.2-45.2 181 181zM512 960a32 32 0 0 1-32-32V544a32 32 0 0 1 64 0v384a32 32 0 0 1-32 32z" fill="#e6a23c"/></svg>',
    links: [
      { name: "GitHub", url: "https://github.com", icon: "" },
      { name: "Gitee", url: "https://gitee.com", icon: "" },
      { name: "MDN", url: "https://developer.mozilla.org", icon: "" },
      { name: "Can I Use", url: "https://caniuse.com", icon: "" },
      { name: "npm", url: "https://www.npmjs.com", icon: "" },
      { name: "Vue.js", url: "https://cn.vuejs.org", icon: "" },
      { name: "React", url: "https://react.dev", icon: "" },
      { name: "TailwindCSS", url: "https://tailwindcss.com", icon: "" },
      { name: "Regex101", url: "https://regex101.com", icon: "" },
      { name: "JSON.cn", url: "https://www.json.cn", icon: "" },
      { name: "CodePen", url: "https://codepen.io", icon: "" },
      { name: "Vite", url: "https://vitejs.dev", icon: "" },
    ],
  },
  {
    name: "设计资源",
    icon: '<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M820 64H204a140 140 0 0 0-140 140v616a140 140 0 0 0 140 140h616a140 140 0 0 0 140-140V204A140 140 0 0 0 820 64z m76 756a76 76 0 0 1-76 76H204a76 76 0 0 1-76-76V204a76 76 0 0 1 76-76h616a76 76 0 0 1 76 76z" fill="#909399"/><path d="M352 672V352h128a96 96 0 0 1 0 192h-64v128z" fill="#909399"/></svg>',
    links: [
      { name: "iconfont", url: "https://www.iconfont.cn", icon: "" },
      { name: "Dribbble", url: "https://dribbble.com", icon: "" },
      { name: "Behance", url: "https://www.behance.net", icon: "" },
      { name: "站酷", url: "https://www.zcool.com.cn", icon: "" },
      { name: "UI中国", url: "https://www.ui.cn", icon: "" },
      { name: "Figma", url: "https://www.figma.com", icon: "" },
      { name: "蓝湖", url: "https://lanhuapp.com", icon: "" },
      { name: "花瓣", url: "https://huaban.com", icon: "" },
      { name: "Pixabay", url: "https://pixabay.com", icon: "" },
      { name: "Pexels", url: "https://www.pexels.com", icon: "" },
      { name: "Unsplash", url: "https://unsplash.com", icon: "" },
      { name: "渐变神器", url: "https://cssgradient.io", icon: "" },
    ],
  },
  {
    name: "论坛讨论",
    icon: '<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M512 64a448 448 0 1 0 448 448A448 448 0 0 0 512 64z m160 512H416l-96 96v-96h-64a32 32 0 0 1-32-32V288a32 32 0 0 1 32-32h416a32 32 0 0 1 32 32v256a32 32 0 0 1-32 32z" fill="#409eff"/></svg>',
    links: [
      { name: "吾爱破解", url: "https://www.52pojie.cn", icon: "" },
      { name: "恩山论坛", url: "https://www.right.com.cn/forum", icon: "" },
      { name: "Chiphell", url: "https://www.chiphell.com", icon: "" },
      { name: "NGA", url: "https://nga.cn", icon: "" },
      { name: "虎扑", url: "https://www.hupu.com", icon: "" },
      { name: "Reddit", url: "https://www.reddit.com", icon: "" },
      { name: "远景论坛", url: "https://bbs.pcbeta.com", icon: "" },
      { name: "数码之家", url: "https://www.shuma.net", icon: "" },
      { name: "西门吹水", url: "https://www.xmcs.info", icon: "" },
      { name: "GitHub社区", url: "https://github.com/community", icon: "" },
      { name: "码农周刊", url: "https://weekly.manong.io", icon: "" },
      { name: "开发者头条", url: "https://toutiao.io", icon: "" },
    ],
  },
  {
    name: "实用工具",
    icon: '<svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M917.1 334.9a32 32 0 0 0-45.2 0L701.8 505 519 322.2 689.9 151a32 32 0 1 0-45.2-45.2L473.7 276.8l-60.5-60.5L243 386.6a224 224 0 0 0 0 316.8l-179.1 179a32 32 0 1 0 45.2 45.2L602 634.6a224 224 0 0 0 316.8 0l170.2-170.2-45.2-45.2z" fill="#00c9a7"/></svg>',
    links: [
      { name: "ITDOG", url: "https://www.itdog.cn", icon: "" },
      { name: "测速网", url: "https://www.speedtest.cn", icon: "" },
      { name: "站长之家", url: "https://www.chinaz.com", icon: "" },
      { name: "即时工具", url: "https://www.67tool.com", icon: "" },
      { name: "TinyPNG", url: "https://tinypng.com", icon: "" },
      { name: "IP查询", url: "https://www.ipip.net", icon: "" },
      { name: "百度统计", url: "https://tongji.baidu.com", icon: "" },
      { name: "必应壁纸", url: "https://bing.ee123.net", icon: "" },
      { name: "临时邮箱", url: "https://24mail.chacuo.net", icon: "" },
      { name: "草料二维码", url: "https://cli.im", icon: "" },
      { name: "Utools", url: "https://u.tools", icon: "" },
      { name: "Excalidraw", url: "https://excalidraw.com", icon: "" },
    ],
  },
];

/**
 * 站点基础配置（对应 HelloPage 主题的「基本设置 / 备案设置」）
 */
var SITE_CONFIG = {
  title: "上网，从这里开始！",        // 首页大标题
  subtitle: "能说不能行，不是真智慧",   // 标题下的一言 / 副标题
  coverImg: "",                         // 固定背景图/视频（最高优先级，留空则看下方 bgSeason / bgApi）
  bgSeason: true,                       // 是否启用内置「季节/节日」壁纸（按当前日期自动切换）
  bgApi: "",                            // 公开图片 API（如必应每日壁纸 https://bing.ee123.net/img/，每天自动换）
  coverFixed: false,                    // true = 背景固定不跟随滚动
  siteName: "我的导航",                 // 页脚显示的站点名称
  icp: "",                              // ICP 备案号，如 "京ICP备12345678号"，留空不显示
  gongan: "",                          // 公安备案号，留空不显示
  menus: [                             // 顶部导航菜单
    { name: "首页", href: "index.html", target: "" },
    { name: "关于", href: "about.html", target: "" },
  ],
};
