/* ============================================================
   HelloPage 风格导航站 — 交互脚本
   （基于 Anye 的 HelloPage 主题 v1.1.2 script.js 改造，
    去除 jQuery 依赖，其余交互与原版保持一致）
   ============================================================ */

/* ---------- 工具函数 ---------- */

// 站点图标兜底：favicon 加载失败时显示「渐变首字块」
var FALLBACK_PALETTES = [
    ["#6366f1", "#8b5cf6"],
    ["#0ea5e9", "#22d3ee"],
    ["#10b981", "#34d399"],
    ["#f59e0b", "#fbbf24"],
    ["#ef4444", "#fb7185"],
    ["#ec4899", "#f472b6"]
];

// 根据名称生成稳定的柔和渐变
function paletteFor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return FALLBACK_PALETTES[h % FALLBACK_PALETTES.length];
}

function makeFallback(name) {
    var span = document.createElement("span");
    span.className = "letter-fallback";
    var c = paletteFor(name);
    span.style.background = "linear-gradient(135deg, " + c[0] + ", " + c[1] + ")";
    span.textContent = name.charAt(0);
    return span;
}

// HTML 转义
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (s) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s];
    });
}

// 获取站点域名
function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return "";
    }
}

/* ---------- 后台数据加载（管理后台保存的数据优先于默认数据） ---------- */

// 先呈现默认配置；异步读取服务器，避免同步 XHR 卡住菜单和整页。
function safeURL(value) {
    if (typeof value !== "string" || !value.trim() || /[\\\u0000-\u0020]/.test(value)) return "";
    try {
        var url = new URL(value, location.href);
        return /^(?:https?:)$/.test(url.protocol) ? value : "";
    } catch (error) { return ""; }
}
function safeImage(value) {
    if (typeof value !== "string" || !value.trim() || /[\\\u0000-\u0020]/.test(value)) return "";
    var image = value.trim();
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+=*$/i.test(image)) return image;
    if (/^[a-z][a-z0-9+.-]*:/i.test(image) && !/^https?:/i.test(image)) return "";
    try {
        var url = new URL(image, location.href);
        return /^(?:https?:)$/.test(url.protocol) ? image : "";
    } catch (error) { return ""; }
}
function safeIcon(value) {
    var host = document.createElement("span");
    host.className = "group-icon";
    if (typeof value !== "string") return host;
    if (!value.includes("<")) { host.textContent = value.slice(0, 32); return host; }
    var source = new DOMParser().parseFromString(value, "image/svg+xml");
    if (source.querySelector("parsererror") || !source.documentElement || source.documentElement.localName !== "svg") return host;
    var tags = ["svg", "path", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse" ];
    var attrs = ["class", "viewBox", "d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "width", "height", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "points", "transform"];
    function copy(node, parent) {
        if (node.nodeType !== 1 || !tags.includes(node.localName)) return;
        var el = document.createElementNS("http://www.w3.org/2000/svg", node.localName);
        Array.from(node.attributes).forEach(function (attr) {
            if (attrs.includes(attr.name) && !/url\s*\(|javascript\s*:/i.test(attr.value)) el.setAttribute(attr.name, attr.value);
        });
        Array.from(node.children).forEach(function (child) { copy(child, el); });
        parent.appendChild(el);
    }
    copy(source.documentElement, host);
    return host;
}
function storageGet(key) { try { return localStorage.getItem(key); } catch (error) { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (error) { /* 隐私模式允许继续使用 */ } }
var backendLoadSequence = 0;
function hideLoginOnlyEntries() {
    document.querySelectorAll("[data-login-only]").forEach(function (node) { node.hidden = true; });
}
async function loadBackendData() {
    var sequence = ++backendLoadSequence;
    hideLoginOnlyEntries();
    try {
        var response = await fetch("/api/data", { signal: AbortSignal.timeout(4000) });
        if (sequence !== backendLoadSequence) return;
        if (response.status === 404) {
            window.NAV_GROUPS = (window.NAV_GROUPS || []).map(function (g) { return Object.assign({}, g, {links:g.links.filter(function (l) { return l.loginOnly !== true; })}); });
            renderNavGroups(); filterSites(); return;
        }
        if (!response.ok) return;
        var d = await response.json();
        if (sequence !== backendLoadSequence) return;
        if (Array.isArray(d.navGroups) && d.navGroups.every(function (g) { return g && typeof g.name === "string" && Array.isArray(g.links); })) window.NAV_GROUPS = d.navGroups;
        if (d.siteConfig && typeof d.siteConfig === "object" && !Array.isArray(d.siteConfig)) window.SITE_CONFIG = Object.assign({}, window.SITE_CONFIG, d.siteConfig);
        renderBase(); renderNavGroups(); filterSites();
    } catch (error) {
        if (sequence === backendLoadSequence) hideLoginOnlyEntries();
    }
}

/* ---------- 背景解析：固定图 > 节日壁纸 > 季节壁纸 > 公开图片 API ---------- */

var SEASONAL_BG = {
    spring: "assets/img/seasonal/spring.jpg",
    summer: "assets/img/seasonal/summer.jpg",
    autumn: "assets/img/seasonal/autumn.jpg",
    winter: "assets/img/seasonal/winter.jpg"
};

// 节日专属壁纸（有专用图的节日）
var FESTIVAL_BG = {
    newyear: "assets/img/festival/newyear.jpg",      // 元旦
    chunjie: "assets/img/festival/chunjie.jpg",      // 春节
    yuanxiao: "assets/img/festival/yuanxiao.jpg",    // 元宵
    valentine: "assets/img/festival/valentine.jpg",  // 情人节
    qingming: "assets/img/festival/qingming.jpg",    // 清明
    duanwu: "assets/img/festival/duanwu.jpg",        // 端午
    qixi: "assets/img/festival/qixi.jpg",            // 七夕
    zhongqiu: "assets/img/festival/zhongqiu.jpg",    // 中秋
    guoqing: "assets/img/festival/guoqing.jpg",      // 国庆
    christmas: "assets/img/festival/christmas.jpg"   // 圣诞
};

// 公历节日与二十四节气（月-日 → key）。节气日期采用常年近似日，允许前后一天。
var SOLAR_FESTIVALS = {
    "1-1": "newyear",
    "1-5": "xiaohan", "1-20": "dahan",
    "2-4": "lichun", "2-14": "valentine", "2-19": "yushui",
    "3-5": "jingzhe", "3-8": "women", "3-12": "tree", "3-15": "consumer", "3-20": "chunfen",
    "4-1": "fools", "4-4": "qingming", "4-5": "qingming", "4-20": "guyu",
    "5-1": "labour", "5-4": "youth", "5-5": "lixia", "5-12": "nurse", "5-21": "xiaoman",
    "6-1": "children", "6-5": "environment", "6-6": "mangzhong", "6-21": "xiazhi",
    "7-1": "cpc", "7-7": "xiaoshu", "7-23": "dashu",
    "8-1": "army", "8-7": "liqiu", "8-23": "chushu",
    "9-7": "bailu", "9-10": "teacher", "9-23": "qiufen",
    "10-1": "guoqing", "10-8": "hanlu", "10-23": "shuangjiang", "10-31": "halloween",
    "11-7": "lidong", "11-22": "xiaoxue",
    "12-7": "daxue", "12-22": "dongzhi", "12-24": "christmas", "12-25": "christmas"
};

// 农历节日公历日期对照表（覆盖 2025-2030 年，超出范围退化为季节壁纸）
var LUNAR_FESTIVALS = {
    2025: { chunjie: "1-29", yuanxiao: "2-12", duanwu: "5-31", qixi: "8-29", zhongqiu: "10-6" },
    2026: { chunjie: "2-17", yuanxiao: "3-3", duanwu: "6-19", qixi: "8-19", zhongqiu: "9-25" },
    2027: { chunjie: "2-6", yuanxiao: "2-20", duanwu: "6-9", qixi: "8-8", zhongqiu: "9-15" },
    2028: { chunjie: "1-26", yuanxiao: "2-9", duanwu: "5-28", qixi: "8-26", zhongqiu: "10-3" },
    2029: { chunjie: "2-13", yuanxiao: "2-27", duanwu: "6-16", qixi: "8-16", zhongqiu: "9-22" },
    2030: { chunjie: "2-3", yuanxiao: "2-17", duanwu: "6-5", qixi: "8-5", zhongqiu: "9-12" }
};

function getSeasonName(month) {
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
}

// 返回当前日期的节日 key（公历节日/节气优先，其次农历节日），非节日返回 null
function getFestivalKey(now) {
    var m = now.getMonth() + 1;
    var d = now.getDate();
    var key = m + "-" + d;
    if (SOLAR_FESTIVALS[key]) return SOLAR_FESTIVALS[key];
    var lunar = LUNAR_FESTIVALS[now.getFullYear()];
    if (lunar) {
        for (var fk in lunar) {
            if (lunar[fk] === key) return fk;
        }
    }
    return null;
}

function resolveBackground(cfg) {
    var now = new Date();
    var month = now.getMonth() + 1;
    var season = getSeasonName(month);

    // 1. 节日/节气壁纸：开启且当天命中时整天保持，优先于定时切换
    if (cfg.bgFestival !== false) {
        var fest = getFestivalKey(now);
        if (fest) {
            var festImg = FESTIVAL_BG[fest] || SEASONAL_BG[season];
            if (festImg) return festImg;
        }
    }

    // 2. 定时轮换背景
    if (cfg.bgRotate === true) {
        var pool = (Array.isArray(cfg.bgRotateImages) ? cfg.bgRotateImages : []).filter(function (url) { return safeURL(url); });
        if (pool.length) {
            var intervals = { hourly: 3600000, sixHours: 21600000, halfDay: 43200000, daily: 86400000 };
            var interval = intervals[cfg.bgRotateInterval] || 86400000;
            var idx = Math.floor(now.getTime() / interval) % pool.length;
            return pool[idx];
        }
    }

    // 3. 季节壁纸
    if (cfg.bgSeason !== false && SEASONAL_BG[season]) return SEASONAL_BG[season];

    // 4. 公开图片 API
    if (cfg.bgApi && cfg.bgApi.trim()) return cfg.bgApi.trim();

    // 5. 兜底：返回空，使用 CSS 光斑渐变背景
    return "";
}

/* ---------- 页面基础信息渲染 ---------- */

function renderBase() {
    var cfg = window.SITE_CONFIG || (typeof SITE_CONFIG !== "undefined" ? SITE_CONFIG : {});
    if (window.applyThemeColor) window.applyThemeColor(cfg.themeColor);

    // 标题 / 副标题 / 浏览器标签标题
    var titleEl = document.getElementById("site-title");
    var subEl = document.getElementById("site-subtitle");
    if (titleEl) titleEl.textContent = cfg.title || document.title;
    if (subEl) subEl.textContent = cfg.subtitle || "";
    document.title = cfg.siteName || document.title;

    // 顶部菜单
    var menuEl = document.getElementById("nav-menu");
    menuEl.replaceChildren();
    (Array.isArray(cfg.menus) ? cfg.menus : []).forEach(function (m) {
        if (!m || !safeURL(m.href) || /(?:^|\/)admin\.html$/.test(m.href)) return;
        var li = document.createElement("li");
        li.className = "nav-item";
        var a = document.createElement("a");
        a.className = "nav-link";
        a.textContent = m.name;
        a.href = m.href || "#";
        if (m.target === "_blank") { a.target = "_blank"; a.rel = "noopener noreferrer"; }
        li.appendChild(a);
        menuEl.appendChild(li);
    });

    // 背景：固定图/视频 > 季节节日壁纸 > 公开图片 API；mp4 走 <video>，其余走 <img>
    var banner = document.getElementById("banner");
    banner.querySelectorAll("img, video").forEach(function (node) { node.remove(); });
    var cover = safeURL(cfg.coverImg) || safeURL(resolveBackground(cfg));
    if (cover) {
        var isVideo = /\.mp4(?:[?#]|$)/i.test(cover);
        var media = document.createElement(isVideo ? "video" : "img");
        if (isVideo) {
            media.setAttribute("autoplay", "");
            media.setAttribute("loop", "");
            media.setAttribute("muted", "");
            media.setAttribute("playsinline", "");
            var source = document.createElement("source");
            source.src = cover;
            source.type = "video/mp4";
            media.appendChild(source);
        } else {
            media.src = cover;
            media.alt = "页面背景";
            media.onerror = function () { media.remove(); }; // 加载失败回退到光斑背景
        }
        banner.insertBefore(media, banner.firstChild);
    }
    banner.classList.toggle("fixed", !!cfg.coverFixed);
    icpReset();
    function icpReset() { ["beian-icp", "beian-gongan"].forEach(function (id) { var el = document.getElementById(id); if (el) el.replaceChildren(); }); }

    // 页脚：备案 + 版权
    var icpEl = document.getElementById("beian-icp");
    var gaEl = document.getElementById("beian-gongan");
    if (cfg.icp && icpEl) {
        icpEl.innerHTML = '<a class="icp" href="http://beian.miit.gov.cn/" target="_blank" rel="nofollow noopener">' +
            escapeHtml(cfg.icp) + "</a>";
    }
    if (cfg.gongan && gaEl) {
        var code = (cfg.gongan.match(/\d+/) || [""])[0];
        gaEl.innerHTML = '<a class="icp" href="https://beian.mps.gov.cn/#/query/webSearch?recordcode=' +
            code + '" target="_blank" rel="nofollow noopener">' + escapeHtml(cfg.gongan) + "</a>";
    }
    var footerEl = document.getElementById("footer-copyright");
    if (footerEl) {
        footerEl.innerHTML = "Copyright &copy; " + new Date().getFullYear() +
            ' <a href="#">' + escapeHtml(cfg.siteName || "我的导航") + "</a>. All Rights Reserved." +
            ' Style by <a href="https://github.com/Anyexyz/theme-hellopage" target="_blank" rel="noopener">HelloPage</a>';
    }
}
renderBase();

/* ---------- 搜索引擎切换条渲染 ---------- */

(function renderEngines() {
    var ul = document.getElementById("search-type");
    (typeof SEARCH_ENGINES !== "undefined" ? SEARCH_ENGINES : []).forEach(function (eng, idx) {
        if (!eng || !safeURL(eng.url)) return;
        var li = document.createElement("li");
        li.innerHTML =
            '<input class="engine-radio" type="radio" name="type" id="type-' + idx + '" value="' + escapeHtml(eng.url) + '"' +
            (idx === 0 ? " checked" : "") + ' data-placeholder="' + escapeHtml(eng.placeholder || "") + '" />' +
            '<label for="type-' + idx + '" style="font-weight:600"><span>' + escapeHtml(eng.name) + "</span></label>";
        li.querySelector("label").prepend(safeIcon(eng.icon));
        ul.appendChild(li);
    });
})();

/* ---------- 导航分组列表渲染 ---------- */

function openArticle(link) {
    var dialog = document.getElementById("article-dialog");
    function closeArticle() {
        if (!dialog) return;
        if (typeof dialog.close === "function") dialog.close();
        else {
            dialog.removeAttribute("open");
            dialog.hidden = true;
        }
    }
    if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "article-dialog";
        dialog.className = "article-dialog";
        var panel = document.createElement("div");
        panel.className = "article-panel";
        var heading = document.createElement("h2");
        heading.className = "article-title";
        var content = document.createElement("div");
        content.className = "article-content";
        var close = document.createElement("button");
        close.type = "button";
        close.className = "article-close";
        close.textContent = "关闭";
        close.addEventListener("click", closeArticle);
        panel.appendChild(heading);
        panel.appendChild(content);
        panel.appendChild(close);
        dialog.appendChild(panel);
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) closeArticle();
        });
        dialog.addEventListener("cancel", function (event) {
            event.preventDefault();
            closeArticle();
        });
        document.body.appendChild(dialog);
    }
    dialog.querySelector(".article-title").textContent = typeof link.articleTitle === "string" ? link.articleTitle : link.name;
    dialog.querySelector(".article-content").textContent = typeof link.articleContent === "string" ? link.articleContent : "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else {
        dialog.hidden = false;
        dialog.setAttribute("open", "");
        dialog.classList.add("article-dialog-fallback");
    }
}

function clearNavigationForRefresh() {
    backendLoadSequence++;
    if (Array.isArray(window.NAV_GROUPS)) window.NAV_GROUPS = window.NAV_GROUPS.map(function (g) {
        return Object.assign({}, g, {links:g.links.filter(function (l) { return l.loginOnly !== true; })});
    });
    var nav = document.getElementById("nav-list");
    if (nav) nav.replaceChildren();
    var status = document.getElementById("filter-status");
    if (status) status.textContent = "";
    var empty = document.getElementById("nav-empty");
    if (empty) empty.hidden = false;
    var dialog = document.getElementById("article-dialog");
    if (dialog) dialog.remove();
}

function refreshNavigation() {
    clearNavigationForRefresh();
    loadBackendData();
}

document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") clearNavigationForRefresh();
    if (document.visibilityState === "visible") refreshNavigation();
});
window.addEventListener("pageshow", function () { refreshNavigation(); });

function marqueeSpeed(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) && n >= 5 && n <= 100 ? n : fallback;
}
function applyMarquees(root) {
    var cfg = window.SITE_CONFIG || {};
    (root || document).querySelectorAll(".site-text .name, .site-text .description").forEach(function (el) {
        var track = el.querySelector(".marquee-track");
        if (!track) return;
        track.classList.remove("marquee");
        track.style.animationDuration = "";
        track.style.removeProperty("--marquee-distance");
        var overflow = track.getBoundingClientRect().width - el.getBoundingClientRect().width;
        if (overflow > 16) {
            track.classList.add("marquee");
            track.style.setProperty("--marquee-distance", overflow + "px");
            var speed = el.classList.contains("name") ? marqueeSpeed(cfg.nameScrollSpeed, 24) : marqueeSpeed(cfg.descriptionScrollSpeed, 18);
            // Movement occupies 76% of the cycle; the ends each pause for 12%.
            track.style.animationDuration = Math.max(8, overflow / speed / 0.76) + "s";
            el.title = track.textContent;
        }
    });
}
var marqueeResizeFrame;
window.addEventListener("resize", function () {
    cancelAnimationFrame(marqueeResizeFrame);
    marqueeResizeFrame = requestAnimationFrame(function () { applyMarquees(); });
});
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { applyMarquees(); });
}
function renderNavGroups() {
    var wrap = document.getElementById("nav-list");
    wrap.replaceChildren();
    (window.NAV_GROUPS || (typeof NAV_GROUPS !== "undefined" ? NAV_GROUPS : [])).forEach(function (group, gi) {
        if (!group || !Array.isArray(group.links)) return;
        var ul = document.createElement("section");
        ul.className = "mylist anim";
        ul.style.animationDelay = (gi * 40) + "ms";

        // 分组标题（图标 + 名称 + 站点数量）
        var liTitle = document.createElement("h2");
        liTitle.className = "title";
        liTitle.innerHTML = "<span>" + escapeHtml(group.name) + "</span>" +
            '<span class="count">' + group.links.length + " 个站点</span>";
        liTitle.prepend(safeIcon(group.icon));
        ul.appendChild(liTitle);

        // 站点网格
        var sites = document.createElement("div");
        sites.className = "sites";
        (group.links || []).forEach(function (link) {
            if (!link || typeof link.name !== "string" || !safeURL(link.url)) return;
            var hasArticle = link.articleEnabled === true;
            var hasRSS = link.rssEnabled === true && !!safeURL(link.rssUrl);
            var item = hasArticle || hasRSS ? document.createElement("div") : null;
            if (item) item.className = "site-item";
            var a = document.createElement("a");
            a.className = "site";
            a.dataset.search = (link.name + " " + link.url + " " + group.name + " " + (typeof link.description === "string" ? link.description : "")).toLowerCase();
            a.rel = "nofollow noopener noreferrer";
            a.href = safeURL(link.url);
            a.target = "_blank";
            a.title = link.name;
            if (link.loginOnly === true) {
                (item || a).dataset.loginOnly = "true";
                (item || a).hidden = false;
            }

            var logo = safeImage(link.logo);
            var customSvg = link.customSvg === true && typeof link.icon === "string" && link.icon.includes("<");
            var iconURL = logo || "";
            if (!iconURL && !customSvg) {
                var oldIcon = safeImage(link.icon);
                iconURL = oldIcon || (getDomain(link.url) ? "https://favicon.cccyun.cc/" + getDomain(link.url) : "");
            }
            if (customSvg) {
                a.appendChild(safeIcon(link.icon));
            } else if (iconURL) {
                var box = document.createElement("span");
                box.className = "logo-box";
                var iconImg = document.createElement("img");
                iconImg.src = iconURL;
                iconImg.alt = "";
                iconImg.loading = "lazy";
                iconImg.decoding = "async";
                iconImg.referrerPolicy = "no-referrer";
                iconImg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;transition:opacity .25s ease, transform .2s ease;";
                iconImg.addEventListener("load", function () { iconImg.style.opacity = "1"; }, { once: true });
                iconImg.addEventListener("error", function () { iconImg.remove(); }, { once: true });
                box.appendChild(makeFallback(link.name));
                box.appendChild(iconImg);
                a.appendChild(box);
            } else {
                a.appendChild(makeFallback(link.name));
            }

            var textDiv = document.createElement("div");
            textDiv.className = "site-text";
            var nameSpan = document.createElement("span");
            nameSpan.className = "name";
            var nameTrack = document.createElement("span");
            nameTrack.className = "marquee-track";
            nameTrack.textContent = link.name;
            nameSpan.appendChild(nameTrack);
            textDiv.appendChild(nameSpan);
            var tags = Array.isArray(link.tags) ? link.tags.filter(function (tag) { return typeof tag === "string" && tag.trim(); }).join(" · ") : (typeof link.tags === "string" ? link.tags.trim() : "");
            var note = (typeof link.description === "string" ? link.description.trim() : "") || tags || group.name;
            var description = document.createElement("span");
            description.className = "description";
            var descriptionTrack = document.createElement("span");
            descriptionTrack.className = "marquee-track";
            descriptionTrack.textContent = note;
            description.appendChild(descriptionTrack);
            description.title = note;
            textDiv.appendChild(description);
            a.appendChild(textDiv);
            if (!item) {
                sites.appendChild(a);
                return;
            }

            item.appendChild(a);
            var actions = document.createElement("div");
            actions.className = "info";
            var rss = safeURL(link.rssUrl);
            if (hasRSS && rss) {
                var rssLink = document.createElement("a");
                rssLink.className = "info-action";
                rssLink.href = rss;
                rssLink.target = "_blank";
                rssLink.rel = "nofollow noopener noreferrer";
                rssLink.textContent = "RSS";
                actions.appendChild(rssLink);
            }
            if (hasArticle) {
                var readButton = document.createElement("button");
                readButton.type = "button";
                readButton.className = "info-action";
                readButton.textContent = "阅读";
                readButton.addEventListener("click", function () { openArticle(link); });
                actions.appendChild(readButton);
            }
            if (actions.childElementCount) item.appendChild(actions);
            sites.appendChild(item);
        });
        ul.appendChild(sites);
        wrap.appendChild(ul);
    });
    applyMarquees(wrap);
}
renderNavGroups();
loadBackendData();

// 本站筛选与外部搜索相互独立，不会改变搜索引擎行为。
function filterSites() {
    var field = document.getElementById("site-filter");
    var query = field ? field.value.trim().toLowerCase() : "";
    var found = 0;
    document.querySelectorAll(".mylist").forEach(function (group) {
        var count = 0;
        group.querySelectorAll(".site").forEach(function (site) {
            var item = site.closest(".site-item") || site;
            item.hidden = !!query && !site.dataset.search.includes(query);
            if (!item.hidden) count++;
        });
        group.hidden = !!query && !count;
        group.querySelector(".count").textContent = count + " 个站点";
        found += count;
    });
    var status = document.getElementById("filter-status");
    if (status) status.textContent = query ? "找到 " + found + " 个站点" : "共 " + found + " 个站点";
    var empty = document.getElementById("nav-empty");
    if (empty) empty.hidden = found > 0;
}
document.getElementById("site-filter").addEventListener("input", filterSites);
filterSites();

/* ---------- 输入框自动聚焦 ---------- */

window.addEventListener("load", function () {
    var text = document.getElementById("search-text");
    if (text && matchMedia("(pointer: fine) and (min-width: 769px)").matches) text.focus();
});

/* ---------- 搜索引擎切换功能（localStorage 记忆选中） ---------- */

(function () {
    function initializeSearch() {
        selectDefaultSearchEngine();
        updatePlaceholder();
        updateFormAction();
    }

    function selectDefaultSearchEngine() {
        var storedType = storageGet("superSearchtype");
        var input = Array.from(searchEngineInputs).find(function (item) { return item.value === storedType; }) || searchEngineInputs[0];
        if (input) {
            input.checked = true;
            highlightSelectedSearchEngine(input);
        }
    }

    function updatePlaceholder() {
        var checkedInput = document.querySelector('input[name="type"]:checked');
        var placeholder = checkedInput ? checkedInput.getAttribute("data-placeholder") : "";
        searchTextInput.setAttribute("placeholder", placeholder);
    }

    function updateFormAction() {
        var checkedInput = document.querySelector('input[name="type"]:checked');
        var actionUrl = checkedInput ? checkedInput.value : "";
        searchForm.action = actionUrl;
    }

    function highlightSelectedSearchEngine(input) {
        for (var i = 0; i < searchGroups.length; i++) {
            searchGroups[i].classList.remove("s-current");
        }
        if (input && input.parentNode && input.parentNode.parentNode && input.parentNode.parentNode.parentNode) {
            input.parentNode.parentNode.parentNode.classList.add("s-current");
        }
    }

    function handleSearchEngineChange(event) {
        currentSearchEngine = event.target;
        updatePlaceholder();
        updateFormAction();
        storageSet("superSearchtype", event.target.value);
        searchTextInput.focus();
        highlightSelectedSearchEngine(event.target);
    }

    function handleFormSubmit(event) {
        event.preventDefault();
        if (searchTextInput.value.trim() === "") {
            searchTextInput.focus();
            return false;
        }
        var currentInput = document.querySelector('input[name="type"]:checked');
        if (!currentInput) return false;
        searchForm.action = currentInput.value + encodeURIComponent(searchTextInput.value.trim());
        searchForm.removeAttribute("target");
        location.href = searchForm.action;
    }

    var searchEngineInputs = document.querySelectorAll('input[name="type"]');
    var searchForm = document.querySelector("#super-search-fm");
    var searchTextInput = document.querySelector("#search-text");
    var searchGroups = document.querySelectorAll(".search-group");
    var currentSearchEngine = searchEngineInputs[0];

    if (!searchEngineInputs.length || !searchForm || !searchTextInput) return;
    initializeSearch();

    for (var i = 0; i < searchEngineInputs.length; i++) {
        searchEngineInputs[i].addEventListener("change", handleSearchEngineChange);
    }

    if (searchForm) {
        searchForm.addEventListener("submit", handleFormSubmit);
    }
})();

/* ---------- 关键词搜索建议（百度 sug 接口，原生 JSONP） ---------- */

(function () {
    var searchInput = document.getElementById("search-text");
    var wordBox = document.getElementById("word");
    var selectedWordIndex = -1;
    var ignoreKeyEvents = false;
    var jsonpSeq = 0;

    function wordList() {
        return wordBox.getElementsByTagName("li");
    }

    function fetchSuggest(keywords) {
        var seq = ++jsonpSeq;
        var cbName = "baiduSugCallback_" + seq;
        var script = document.createElement("script");
        var timer = null;

        window[cbName] = function (data) {
            clearTimeout(timer);
            cleanup();
            if (seq !== jsonpSeq) return; // 丢弃过期响应
            wordBox.innerHTML = "";
            if (!data || !Array.isArray(data.s) || data.s.length === 0 || !searchInput.value.trim()) {
                wordBox.style.display = "none";
                return;
            }
            data.s.slice(0, 8).filter(function (w) { return typeof w === "string"; }).forEach(function (w) {
                var li = document.createElement("li");
                li.textContent = w;
                wordBox.appendChild(li);
            });
            wordBox.style.display = "block";
            selectedWordIndex = -1;
        };

        function cleanup() {
            if (script.parentNode) script.parentNode.removeChild(script);
            try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        }

        script.src = "https://suggestion.baidu.com/su?wd=" + encodeURIComponent(keywords) + "&cb=" + cbName;
        script.onerror = function () {
            clearTimeout(timer);
            cleanup();
            wordBox.style.display = "none";
        };
        timer = setTimeout(function () {
            cleanup();
            wordBox.style.display = "none";
        }, 5000);
        document.body.appendChild(script);
    }

    // 键盘事件：上下键选择建议
    searchInput.addEventListener("keydown", function (event) {
        var words = wordList();
        if (wordBox.style.display === "none" || event.isComposing) return;
        switch (event.key) {
            case "ArrowUp":
                event.preventDefault();
                if (selectedWordIndex > 0) {
                    if (words[selectedWordIndex]) words[selectedWordIndex].classList.remove("selected");
                    selectedWordIndex--;
                    words[selectedWordIndex].classList.add("selected");
                    searchInput.value = words[selectedWordIndex].innerText;
                    ignoreKeyEvents = true;
                }
                break;
            case "ArrowDown":
                event.preventDefault();
                if (selectedWordIndex < words.length - 1) {
                    if (selectedWordIndex >= 0 && words[selectedWordIndex]) words[selectedWordIndex].classList.remove("selected");
                    selectedWordIndex++;
                    words[selectedWordIndex].classList.add("selected");
                    searchInput.value = words[selectedWordIndex].innerText;
                    ignoreKeyEvents = true;
                }
                break;
            default:
                ignoreKeyEvents = false;
                break;
        }
    });

    // 输入触发建议
    var debounce;
    searchInput.addEventListener("input", function (event) {
        clearTimeout(debounce);
        ++jsonpSeq; // 输入变化后立即作废旧响应，包括清空输入的情况。
        wordBox.replaceChildren(); wordBox.style.display = "none";
        var keywords = this.value.trim();
        if (!keywords || event.isComposing) return;
        debounce = setTimeout(function () { fetchSuggest(keywords); }, 250);
    });
    searchInput.addEventListener("compositionend", function () { this.dispatchEvent(new Event("input")); });
    searchInput.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { ++jsonpSeq; clearTimeout(debounce); wordBox.style.display = "none"; }
    });

    // 点击建议词：填入并搜索
    wordBox.addEventListener("click", function (e) {
        if (e.target.tagName === "LI") {
            searchInput.value = e.target.textContent;
            wordBox.innerHTML = "";
            wordBox.style.display = "none";
            document.querySelector(".submit").click();
        }
    });

    // 点击页面其他区域隐藏建议
    document.addEventListener("click", function (e) {
        if (!e.target.closest("#search")) {
            wordBox.innerHTML = "";
            wordBox.style.display = "none";
        }
    });
})();

/* ---------- 日期时间显示（每秒更新） ---------- */

(function () {
    function updateDate() {
        var el = document.getElementById("show_date");
        if (el) {
            el.textContent = new Date().toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "long"
            });
        }
    }

    function updateTime() {
        var el = document.getElementById("show_time");
        if (el) {
            el.textContent = new Date().toLocaleTimeString("zh-CN", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });
        }
    }

    updateDate();
    updateTime();
    setInterval(updateDate, 1000);
    setInterval(updateTime, 1000);
})();

/* ---------- 移动端汉堡菜单 ---------- */

(function () {
    var toggler = document.getElementById("navbar-toggler");
    var collapse = document.getElementById("navbarsExample05");
    if (!toggler || !collapse) return;

    function setMenu(open) {
        collapse.classList.toggle("show", open);
        toggler.classList.toggle("collapsed", !open);
        toggler.setAttribute("aria-expanded", open ? "true" : "false");
        var mobile = matchMedia("(max-width: 768px)").matches;
        collapse.setAttribute("aria-hidden", mobile && !open ? "true" : "false");
    }

    setMenu(false);
    window.addEventListener("resize", function () { setMenu(false); });
    toggler.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        setMenu(!collapse.classList.contains("show"));
    });

    collapse.addEventListener("click", function (event) {
        if (event.target.closest("a")) setMenu(false);
    });

    document.addEventListener("click", function (event) {
        if (!event.target.closest(".navbar")) setMenu(false);
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") setMenu(false);
    });
})();

/* ---------- 返回顶部按钮 ---------- */

(function () {
    var toTop = document.createElement("button");
    toTop.type = "button";
    toTop.id = "toTop";
    toTop.setAttribute("role", "button");
    toTop.setAttribute("aria-label", "返回顶部");
    toTop.style.cursor = "pointer";
    toTop.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
    document.body.appendChild(toTop);

    window.addEventListener("scroll", function () {
        if (window.pageYOffset > 100) {
            toTop.style.display = "flex";
        } else {
            toTop.style.display = "none";
        }
    });

    toTop.addEventListener("click", function () {
        var duration = 300;
        var start = window.pageYOffset;
        var startTime = null;
        function animate(time) {
            if (!startTime) startTime = time;
            var progress = Math.min((time - startTime) / duration, 1);
            window.scrollTo(0, start * (1 - progress));
            if (progress < 1) requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
    });
})();
