(function () {
    "use strict";

    if (window.__linkEditorLoaded) return;
    window.__linkEditorLoaded = true;

    var MAX_TEXT = 4096;
    var MAX_NAME = 256;
    var MAX_ARTICLE = 16000;
    var MAX_LOGO_CHARS = 262144;
    var MAX_LOGO_BYTES = 180 * 1024;
    var SVG_NS = "http://www.w3.org/2000/svg";
    var state = null;
    var dialog = null;
    var form = null;
    var uploadToken = 0;

    function text(value) { return value == null ? "" : String(value); }
    function trim(value) { return text(value).trim(); }
    function byId(id) { return document.getElementById(id); }

    function validationError(field, message) {
        var error = new Error(message);
        error.field = field;
        return error;
    }

    function isHttpUrl(value) {
        var source = trim(value);
        if (!source || /[\\\s\u0000-\u001f]/.test(source)) return false;
        try {
            var parsed = new URL(source);
            return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
        } catch (error) {
            return false;
        }
    }

    function isLinkUrl(value) {
        var url = trim(value);
        if (!url || url.length > MAX_TEXT || /[\\\s\u0000-\u001f]/.test(url)) return false;
        if (isHttpUrl(url)) return true;
        if (/^[a-z][a-z\d+.-]*:/i.test(url) || /^\/\//.test(url)) return false;
        return true;
    }

    function isPlainText(value) {
        return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(text(value));
    }

    var SVG_ELEMENTS = {
        svg: true, g: true, path: true, circle: true, rect: true, line: true,
        polyline: true, polygon: true, ellipse: true
    };
    var SVG_ATTRIBUTES = {
        xmlns: true, viewBox: true, d: true, fill: true, stroke: true, "stroke-width": true,
        width: true, height: true, cx: true, cy: true, r: true, rx: true, ry: true,
        x: true, y: true, x1: true, x2: true, y1: true, y2: true, points: true,
        transform: true, opacity: true, "fill-rule": true, "clip-rule": true,
        "stroke-linecap": true, "stroke-linejoin": true, "stroke-miterlimit": true,
        "stroke-dasharray": true, "stroke-dashoffset": true, "fill-opacity": true,
        "stroke-opacity": true, preserveAspectRatio: true, "aria-hidden": true
    };

    function parseSvg(value) {
        var source = text(value);
        if (!source.trim()) throw validationError("customSvg", "请填写 SVG 内容");
        if (source.length > MAX_LOGO_CHARS) throw validationError("customSvg", "SVG 内容不能超过 262144 个字符");
        var documentNode = new DOMParser().parseFromString(source, "image/svg+xml");
        var root = documentNode.documentElement;
        if (!root || root.localName.toLowerCase() !== "svg" || documentNode.querySelector("parsererror")) {
            throw validationError("customSvg", "SVG 格式无效");
        }

        function copy(node, parent, preview) {
            var name = node.localName && node.localName.toLowerCase();
            if (!node || node.nodeType !== 1 || !SVG_ELEMENTS[name]) throw validationError("customSvg", "SVG 包含不允许的元素");
            var element = preview ? document.createElementNS(SVG_NS, name) : null;
            for (var i = 0; i < node.attributes.length; i += 1) {
                var attribute = node.attributes[i];
                var attrName = attribute.name;
                var attrKey = attrName.toLowerCase();
                if (/^on/i.test(attrName) || !SVG_ATTRIBUTES[attrName] && !SVG_ATTRIBUTES[attrKey]) {
                    throw validationError("customSvg", "SVG 包含不允许的属性");
                }
                if (attrKey === "xmlns" && attribute.value !== SVG_NS) {
                    throw validationError("customSvg", "SVG 命名空间无效");
                }
                if (/url\s*\(|<|>|[\\\u0000-\u001f]/i.test(attribute.value)) {
                    throw validationError("customSvg", "SVG 属性值包含不允许的引用");
                }
                if (preview) element.setAttribute(attrName, attribute.value);
            }
            if (preview) {
                parent.appendChild(element);
                for (var j = 0; j < node.children.length; j += 1) copy(node.children[j], element, true);
            } else {
                for (var k = 0; k < node.children.length; k += 1) copy(node.children[k], null, false);
            }
        }

        copy(root, null, false);
        return documentNode;
    }

    function validateSvg(value) {
        parseSvg(value);
        return true;
    }

    function validateLogo(value) {
        var logo = text(value);
        if (!logo) return true;
        if (logo.length > MAX_LOGO_CHARS) throw validationError("logo", "Logo 不能超过 262144 个字符");
        if (/^data:/i.test(logo)) {
            if (!/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/]+=*$/i.test(logo)) {
                throw validationError("logo", "Logo DataURL 必须是 PNG、JPEG、GIF 或 WebP");
            }
            return true;
        }
        if (!isHttpUrl(logo)) throw validationError("logo", "Logo 必须是完整的 HTTP(S) 地址");
        return true;
    }

    function validateLinkDraft(link, options) {
        if (!link || typeof link !== "object" || Array.isArray(link)) throw new Error("链接数据无效");
        var allowRelative = !options || options.allowRelative !== false;
        if (typeof link.name !== "string" || !trim(link.name)) throw validationError("name", "链接名称不能为空");
        if (link.name.length > MAX_NAME) throw validationError("name", "链接名称不能超过 256 个字符");
        if (typeof link.url !== "string" || !trim(link.url)) throw validationError("url", "网站地址不能为空");
        if (!isLinkUrl(link.url) || (!allowRelative && !isHttpUrl(link.url))) throw validationError("url", "请填写完整的 HTTP(S) 地址；旧链接可保留原有相对地址");
        if (typeof link.description !== "undefined" && (typeof link.description !== "string" || link.description.length > MAX_TEXT)) throw validationError("description", "描述不能超过 4096 个字符");
        if (typeof link.logo !== "undefined" && typeof link.logo !== "string") throw validationError("logo", "Logo 字段必须是字符串");
        validateLogo(link.logo);

        ["backlinkUrl", "rssUrl"].forEach(function (field) {
            if (typeof link[field] !== "undefined") {
                if (typeof link[field] !== "string" || link[field].length > MAX_TEXT) throw validationError(field, "地址不能超过 4096 个字符");
                if (link[field] && !isHttpUrl(link[field])) throw validationError(field, field === "rssUrl" ? "RSS 地址必须是完整的 HTTP(S) 地址" : "反链地址必须是完整的 HTTP(S) 地址");
            }
        });
        ["rssEnabled", "articleEnabled", "customSvg", "loginOnly"].forEach(function (field) {
            if (typeof link[field] !== "undefined" && typeof link[field] !== "boolean") throw validationError(field, field + " 必须是布尔值");
        });
        ["articleTitle", "articleContent"].forEach(function (field) {
            if (typeof link[field] !== "undefined" && typeof link[field] !== "string") throw validationError(field, field + " 必须是字符串");
        });
        if (typeof link.articleTitle !== "undefined" && link.articleTitle.length > MAX_NAME) throw validationError("articleTitle", "文章标题不能超过 256 个字符");
        if (typeof link.articleContent !== "undefined" && link.articleContent.length > MAX_ARTICLE) throw validationError("articleContent", "文章内容不能超过 16000 个字符");
        if (typeof link.articleTitle !== "undefined" && !isPlainText(link.articleTitle)) throw validationError("articleTitle", "文章标题必须是纯文本");
        if (typeof link.articleContent !== "undefined" && !isPlainText(link.articleContent)) throw validationError("articleContent", "文章内容必须是纯文本");
        if (link.rssEnabled === true && !isHttpUrl(link.rssUrl)) throw validationError("rssUrl", "开启 RSS 后必须填写完整的 HTTP(S) 地址");
        if (link.articleEnabled === true) {
            if (!trim(link.articleTitle)) throw validationError("articleTitle", "关联文章标题不能为空");
            if (!trim(link.articleContent)) throw validationError("articleContent", "关联文章内容不能为空");
        }
        if (link.customSvg === true) validateSvg(link.icon);
        return true;
    }

    window.validateLinkDraft = validateLinkDraft;

    function createDialog() {
        dialog = document.createElement("dialog");
        dialog.className = "link-editor-dialog";
        dialog.setAttribute("aria-labelledby", "link-editor-title");
        dialog.innerHTML =
            '<form class="link-editor-form" novalidate>' +
            '<header class="le-header"><div><h2 id="link-editor-title"></h2><p class="le-subtitle">链接配置</p></div><button type="button" class="le-icon-button" data-action="cancel" aria-label="关闭">×</button></header>' +
            '<div class="le-body">' +
            '<section class="le-section"><h3>常规</h3><div class="le-section-content">' +
            '<div class="le-field-row"><label for="le-name">名称 <span>*</span></label><div><input id="le-name" type="text" maxlength="256" required autocomplete="off"><p class="le-error" id="le-name-error" role="alert"></p></div></div>' +
            '<div class="le-field-row"><label for="le-url">网站地址 <span>*</span></label><div><div class="le-inline"><input id="le-url" type="text" maxlength="4096" required autocomplete="url"><button type="button" class="le-button le-button-secondary" data-action="scrape" title="只抓取网页原始信息，不调用 AI">抓取网页</button><button type="button" class="le-button le-button-secondary" data-action="ai-fill" title="调用已配置的 AI 生成名称与备注">AI 填写</button></div><p class="le-error" id="le-url-error" role="alert"></p></div></div>' +
            '<div class="le-field-row"><span class="le-label">所属分组</span><div><div class="le-group-row"><select id="le-group" aria-label="所属分组" required></select><button type="button" class="le-button le-button-secondary" data-action="new-group">+ 新增分组</button></div><div class="le-new-group" hidden><label for="le-new-group-name">新分组名称</label><div class="le-inline"><input id="le-new-group-name" type="text" maxlength="256" autocomplete="off"><button type="button" class="le-button le-button-quiet" data-action="cancel-new-group">× 取消</button></div><p class="le-error" id="le-new-group-error" role="alert"></p></div></div></div>' +
            '<div class="le-field-row"><label for="le-description">描述</label><div><textarea id="le-description" maxlength="4096" rows="3"></textarea><p class="le-count" data-count-for="le-description"></p><p class="le-error" id="le-description-error" role="alert"></p></div></div>' +
            '<div class="le-field-row"><span class="le-label">Logo</span><div><div class="le-logo-row"><div class="le-logo-preview" id="le-logo-preview" aria-hidden="true"></div><div class="le-logo-controls"><div class="le-inline"><button type="button" class="le-button le-button-secondary" data-action="upload">+ 上传图片</button><button type="button" class="le-button le-button-quiet" data-action="clear-logo">× 清除</button><input id="le-logo-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden></div><input id="le-logo" type="text" maxlength="262144" aria-label="Logo URL 或 DataURL" placeholder="或粘贴 Logo URL" autocomplete="off"><p class="le-upload-status" id="le-logo-status" role="status"></p></div></div><p class="le-help">PNG / JPEG / GIF / WebP，文件不超过 180 KB。</p><p class="le-error" id="le-logo-error" role="alert"></p></div></div>' +
            '</div></section>' +
            '<section class="le-section"><h3>链接检测</h3><div class="le-section-content"><div class="le-field-row"><label for="le-backlink">反链检测页面</label><div><div class="le-inline"><input id="le-backlink" type="text" maxlength="4096" inputmode="url" placeholder="可选，人工打开核验"><button type="button" class="le-button le-button-secondary" data-action="open-backlink">打开</button></div><p class="le-error" id="le-backlink-error" role="alert"></p></div></div></div></section>' +
            '<section class="le-section"><h3>RSS 订阅</h3><div class="le-section-content"><div class="le-field-row"><span class="le-label">RSS 开关</span><div><div class="le-radio-row"><label><input type="radio" name="le-rss-enabled" value="false" id="le-rss-no" required>否</label><label><input type="radio" name="le-rss-enabled" value="true" id="le-rss-enabled">是</label></div><div class="le-panel" id="le-rss-panel" hidden><label class="le-sub-label" for="le-rss-url">RSS URL <span>*</span></label><input id="le-rss-url" type="text" maxlength="4096" aria-label="RSS URL" inputmode="url" placeholder="https://example.com/feed.xml"><p class="le-error" id="le-rss-error" role="alert"></p></div></div></div></div></section>' +
            '<section class="le-section"><h3>元数据</h3><div class="le-section-content">' +
            '<fieldset class="le-meta-fieldset"><legend>关联文章</legend><div class="le-radio-row"><label><input type="radio" name="le-article-enabled" value="false" id="le-article-no" required>否</label><label><input type="radio" name="le-article-enabled" value="true" id="le-article-yes">是</label></div><div class="le-panel" id="le-article-panel" hidden><div class="le-field-row"><label for="le-article-title">文章标题 <span>*</span></label><div><input id="le-article-title" type="text" maxlength="256"><p class="le-error" id="le-article-title-error" role="alert"></p></div></div><div class="le-field-row"><label for="le-article-content">文章内容 <span>*</span></label><div><textarea id="le-article-content" maxlength="16000" rows="6"></textarea><p class="le-count" data-count-for="le-article-content"></p><p class="le-error" id="le-article-content-error" role="alert"></p></div></div></div></fieldset>' +
            '<fieldset class="le-meta-fieldset"><legend>自定义 SVG</legend><div class="le-radio-row"><label><input type="radio" name="le-svg-enabled" value="false" id="le-svg-no" required>否</label><label><input type="radio" name="le-svg-enabled" value="true" id="le-svg-yes">是</label></div><div class="le-panel" id="le-svg-panel" hidden><div class="le-field-row"><label for="le-svg">SVG 内容 <span>*</span></label><div><textarea id="le-svg" maxlength="262144" rows="7" spellcheck="false" placeholder="&lt;svg viewBox=&quot;0 0 24 24&quot;&gt;...&lt;/svg&gt;"></textarea><p class="le-error" id="le-custom-svg-error" role="alert"></p></div></div></div></fieldset>' +
            '<fieldset class="le-meta-fieldset"><legend>登录可见</legend><div class="le-radio-row"><label><input type="radio" name="le-login-visible" value="false" id="le-login-no" required>否</label><label><input type="radio" name="le-login-visible" value="true" id="le-login-only">是</label></div></fieldset>' +
            '</div></section>' +
            '</div>' +
            '<footer class="le-footer"><p class="le-submit-status" id="le-submit-status" role="status"></p><div class="le-footer-actions"><button type="button" class="le-button le-button-secondary" data-action="cancel">取消</button><button type="submit" class="le-button le-button-primary" data-action="save">保存链接</button></div></footer>' +
            '</form>';
        document.body.appendChild(dialog);
        form = dialog.querySelector(".link-editor-form");
        bindEvents();
    }

    var FIELD_IDS = {
        name: "name", url: "url", description: "description", logo: "logo", newGroup: "new-group", backlinkUrl: "backlink",
        rssUrl: "rss", articleTitle: "article-title", articleContent: "article-content", customSvg: "custom-svg"
    };

    function fieldError(field, message) {
        var key = FIELD_IDS[field] || field;
        var error = byId("le-" + key + "-error");
        var input = byId("le-" + key);
        if (error) error.textContent = message || "";
        if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
    }

    function clearErrors() {
        Object.keys(FIELD_IDS).forEach(function (field) { fieldError(field, ""); });
        form.querySelectorAll(".le-invalid").forEach(function (node) { node.classList.remove("le-invalid"); });
    }

    function setError(error) {
        var field = error && error.field ? error.field : "name";
        fieldError(field, error.message || "内容无效");
        var input = byId({newGroup:"le-new-group-name", rssUrl:"le-rss-url", customSvg:"le-svg"}[field] || "le-" + (FIELD_IDS[field] || field));
        if (input) {
            input.classList.add("le-invalid");
            input.focus();
        }
    }

    function setCount(id) {
        var input = byId(id);
        var count = form.querySelector('[data-count-for="' + id + '"]');
        if (input && count) count.textContent = input.value.length + " / " + input.maxLength;
    }

    function setStatus(message, error) {
        var status = byId("le-submit-status");
        status.textContent = message || "";
        status.classList.toggle("le-status-error", !!error);
    }

    function closeEditorDialog(reason) {
        if (!dialog) return;
        if (typeof dialog.close === "function") dialog.close(reason || "cancel");
        else {
            dialog.removeAttribute("open");
            dialog.hidden = true;
            uploadToken += 1;
            if (state) state.uploading = false;
        }
    }

    function getExistingGroups() {
        return window.data && Array.isArray(window.data.navGroups) ? window.data.navGroups : [];
    }

    function populateGroups(selected) {
        var select = byId("le-group");
        var groups = getExistingGroups();
        select.replaceChildren();
        groups.forEach(function (group, index) {
            var option = document.createElement("option");
            option.value = String(index);
            option.textContent = text(group && group.name) || "未命名分组";
            select.appendChild(option);
        });
        if (!groups.length) {
            var empty = document.createElement("option");
            empty.value = "";
            empty.textContent = "暂无分组，请新增";
            select.appendChild(empty);
        }
        if (selected !== undefined && groups[selected]) select.value = String(selected);
        else if (groups.length) select.value = "0";
        else select.value = "";
    }

    function setNewGroupVisible(visible, name) {
        var wrap = dialog.querySelector(".le-new-group");
        var select = byId("le-group");
        wrap.hidden = !visible;
        if (visible) {
            if (!select.querySelector('option[value="__new__"]')) {
                var option = document.createElement("option");
                option.value = "__new__";
                option.textContent = "新分组（保存时创建）";
                select.appendChild(option);
            }
            select.value = "__new__";
            if (name !== undefined) byId("le-new-group-name").value = name;
            byId("le-new-group-name").focus();
        } else {
            fieldError("newGroup", "");
        }
    }

    function checkedValue(name) {
        var radio = form.querySelector('input[name="' + name + '"]:checked');
        return radio ? radio.value === "true" : false;
    }

    function setRadio(name, value) {
        form.querySelectorAll('input[name="' + name + '"]').forEach(function (radio) { radio.checked = (radio.value === "true") === !!value; });
    }

    function updatePanels() {
        var article = checkedValue("le-article-enabled");
        var svg = checkedValue("le-svg-enabled");
        var rss = checkedValue("le-rss-enabled");
        byId("le-article-panel").hidden = !article;
        byId("le-svg-panel").hidden = !svg;
        byId("le-rss-panel").hidden = !rss;
        byId("le-article-title").required = article;
        byId("le-article-content").required = article;
        byId("le-svg").required = svg;
        byId("le-rss-url").required = rss;
    }

    function safeSvgPreview(value) {
        try {
            var parsed = parseSvg(value);
            var preview = document.createElementNS(SVG_NS, "svg");
            var root = parsed.documentElement;
            for (var i = 0; i < root.attributes.length; i += 1) preview.setAttribute(root.attributes[i].name, root.attributes[i].value);
            function append(node, parent) {
                for (var j = 0; j < node.children.length; j += 1) {
                    var child = node.children[j];
                    var safe = document.createElementNS(SVG_NS, child.localName.toLowerCase());
                    for (var k = 0; k < child.attributes.length; k += 1) safe.setAttribute(child.attributes[k].name, child.attributes[k].value);
                    parent.appendChild(safe);
                    append(child, safe);
                }
            }
            append(root, preview);
            return preview;
        } catch (error) {
            return null;
        }
    }

    function renderLogoPreview() {
        var preview = byId("le-logo-preview");
        preview.replaceChildren();
        var logo = trim(state && state.draft.logo);
        var icon = trim(state && state.draft.icon);
        var value = logo || icon;
        if (!value) { preview.textContent = "无"; return; }
        if ((state && state.draft.customSvg === true) || /^<\s*svg\b/i.test(value)) {
            var safeSvg = safeSvgPreview(value);
            if (safeSvg) { preview.appendChild(safeSvg); return; }
            preview.textContent = "SVG 无效";
            return;
        }
        if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value) || isHttpUrl(value) || isLinkUrl(value)) {
            var image = document.createElement("img");
            image.alt = "Logo 预览";
            image.src = value;
            image.onerror = function () { preview.textContent = "无法预览"; };
            preview.appendChild(image);
            return;
        }
        preview.textContent = "无效";
    }

    function updateDraft(field, value) {
        if (!state) return;
        state.draft[field] = value;
        state.version += 1;
        fieldError(field, "");
        if (field === "description") setCount("le-description");
        if (field === "articleContent") setCount("le-article-content");
        if (field === "logo") { state.logoInputDirty = true; renderLogoPreview(); }
    }

    function readForm() {
        state.draft.name = trim(byId("le-name").value);
        state.draft.url = trim(byId("le-url").value);
        state.draft.description = byId("le-description").value;
        if (state.logoInputDirty) state.draft.logo = trim(byId("le-logo").value);
        state.draft.backlinkUrl = trim(byId("le-backlink").value);
        state.draft.rssEnabled = checkedValue("le-rss-enabled");
        state.draft.rssUrl = trim(byId("le-rss-url").value);
        state.draft.articleEnabled = checkedValue("le-article-enabled");
        state.draft.articleTitle = byId("le-article-title").value;
        state.draft.articleContent = byId("le-article-content").value;
        state.draft.customSvg = checkedValue("le-svg-enabled");
        if (state.draft.customSvg) state.draft.icon = byId("le-svg").value;
        state.draft.loginOnly = checkedValue("le-login-visible");
    }

    function fillForm(link, groupIndex) {
        byId("le-name").value = text(link.name);
        byId("le-url").value = text(link.url);
        byId("le-description").value = text(link.description);
        var logo = text(link.logo);
        byId("le-logo").value = /^data:image\/(png|jpeg|gif|webp);base64,/i.test(logo) ? "" : logo;
        byId("le-backlink").value = text(link.backlinkUrl);
        setRadio("le-rss-enabled", link.rssEnabled === true);
        byId("le-rss-url").value = text(link.rssUrl);
        setRadio("le-article-enabled", link.articleEnabled === true);
        byId("le-article-title").value = text(link.articleTitle);
        byId("le-article-content").value = text(link.articleContent);
        setRadio("le-svg-enabled", link.customSvg === true);
        byId("le-svg").value = link.customSvg === true ? text(link.icon) : "";
        setRadio("le-login-visible", link.loginOnly === true);
        populateGroups(groupIndex);
        dialog.querySelector(".le-new-group").hidden = true;
        byId("le-logo-status").textContent = "";
        setCount("le-description");
        setCount("le-article-content");
        updatePanels();
        renderLogoPreview();
        clearErrors();
        setStatus("");
    }

    function currentTarget() {
        var selectValue = byId("le-group").value;
        if (selectValue === "__new__") {
            var name = trim(byId("le-new-group-name").value);
            if (!name) throw validationError("newGroup", "新分组名称不能为空");
            if (name.length > MAX_NAME) throw validationError("newGroup", "分组名称不能超过 256 个字符");
            return { isNew: true, name: name };
        }
        var index = Number(selectValue);
        var groups = getExistingGroups();
        if (!Number.isInteger(index) || !groups[index]) throw validationError("newGroup", "请选择有效分组");
        return { isNew: false, index: index };
    }

    function removeLinkAt(groupIndex, linkIndex, expected) {
        var group = getExistingGroups()[groupIndex];
        if (!group || !Array.isArray(group.links)) return false;
        var index = expected ? group.links.indexOf(expected) : linkIndex;
        if (index < 0) return false;
        group.links.splice(index, 1);
        return true;
    }

    function applyDraft(target) {
        var groups = getExistingGroups();
        var targetIndex = target.index;
        if (target.isNew && state.newGroupIndex === undefined) {
            groups.push({ name: target.name, links: [] });
            state.newGroupIndex = groups.length - 1;
        }
        if (target.isNew) {
            targetIndex = state.newGroupIndex;
            groups[targetIndex].name = target.name;
        }
        if (!state.applied) {
            var candidate = Object.assign({}, state.draft);
            var originalGroup = state.original && groups[state.original.gi];
            if (state.original && originalGroup && originalGroup.links[state.original.li] === state.source) {
                if (state.original.gi === targetIndex) {
                    originalGroup.links[state.original.li] = candidate;
                    state.applied = { gi: targetIndex, li: state.original.li, ref: candidate };
                } else {
                    originalGroup.links.splice(state.original.li, 1);
                    groups[targetIndex].links.push(candidate);
                    state.applied = { gi: targetIndex, li: groups[targetIndex].links.length - 1, ref: candidate };
                }
            } else {
                groups[targetIndex].links.push(candidate);
                state.applied = { gi: targetIndex, li: groups[targetIndex].links.length - 1, ref: candidate };
            }
        } else {
            var applied = state.applied;
            var currentGroup = groups[applied.gi];
            var currentIndex = currentGroup && currentGroup.links ? currentGroup.links.indexOf(applied.ref) : -1;
            if (currentIndex < 0) currentIndex = applied.li;
            if (applied.gi !== targetIndex) {
                removeLinkAt(applied.gi, currentIndex, applied.ref);
                groups[targetIndex].links.push(applied.ref);
                applied.gi = targetIndex;
                applied.li = groups[targetIndex].links.length - 1;
            } else {
                applied.li = currentIndex;
            }
            Object.assign(applied.ref, state.draft);
        }
        state.appliedVersion = state.version;
        if (typeof window.markDirty === "function") window.markDirty();
        if (typeof window.renderGroups === "function") window.renderGroups();
        populateGroups(state.applied.gi);
        setNewGroupVisible(false);
        setStatus("草稿已应用，正在保存到服务器…");
    }

    function saveResultSucceeded(result) {
        if (result === false) return false;
        if (result === true) return true;
        return window.dirty === false;
    }

    function rollbackAppliedDraft() {
        if (!state || !state.applied) return;
        var groups = getExistingGroups();
        var group = groups[state.applied.gi];
        if (group && Array.isArray(group.links)) removeLinkAt(state.applied.gi, state.applied.li, state.applied.ref);
        if (state.source) {
            var originalGroup = groups[state.original.gi];
            if (originalGroup && Array.isArray(originalGroup.links)) originalGroup.links.splice(state.original.li, 0, state.source);
        }
        if (state.newGroupIndex !== undefined && groups[state.newGroupIndex] && groups[state.newGroupIndex].links.length === 0) groups.splice(state.newGroupIndex, 1);
        state.applied = null;
        state.newGroupIndex = undefined;
        state.appliedVersion = -1;
        if (typeof window.renderGroups === "function") window.renderGroups();
        if (state.originalDirty !== undefined) {
            window.dirty = state.originalDirty;
            var saveStatus = byId("save-status");
            if (saveStatus) saveStatus.textContent = state.originalDirty ? "有未保存的修改" : "配置已加载";
        }
    }

    async function submit() {
        if (!state || state.saving || state.uploading) return;
        clearErrors();
        var target;
        try {
            readForm();
            target = currentTarget();
            if (!form.checkValidity()) {
                form.reportValidity();
                var invalid = form.querySelector(":invalid");
                if (invalid) invalid.focus();
                return;
            }
            validateLinkDraft(state.draft, { allowRelative: !!state.source });
        } catch (error) {
            setError(error);
            return;
        }
        state.saving = true;
        setControlsDisabled(true);
        try {
            if (!state.applied || state.appliedVersion !== state.version) applyDraft(target);
            var result = await window.save();
            if (!saveResultSucceeded(result)) throw new Error("服务器保存失败，请检查网络后重试");
            setStatus("已保存");
            closeEditorDialog("saved");
        } catch (error) {
            setStatus(error.message || "服务器保存失败，请重试", true);
        } finally {
            state.saving = false;
            setControlsDisabled(false);
        }
    }

    function setControlsDisabled(disabled) {
        dialog.querySelectorAll("input, textarea, select, button").forEach(function (control) {
            if (disabled && !state.saving && (control.getAttribute("data-action") === "cancel" || control.getAttribute("data-action") === "clear-logo")) return;
            control.disabled = disabled;
        });
    }

    function finishUpload(token, message) {
        if (token !== uploadToken || !state) return;
        state.uploading = false;
        byId("le-logo-status").textContent = "";
        if (message) fieldError("logo", message);
        setControlsDisabled(false);
    }

    function uploadLogo(file) {
        if (!file || !state) return;
        var token = ++uploadToken;
        state.uploading = true;
        byId("le-logo-status").textContent = "正在读取并校验…";
        fieldError("logo", "");
        byId("le-logo-file").value = "";
        setControlsDisabled(true);
        if (file.size > MAX_LOGO_BYTES) { finishUpload(token, "Logo 文件不能超过 180 KB"); return; }
        var allowed = ["image/png", "image/jpeg", "image/gif", "image/webp"];
        var extension = /\.([a-z\d]+)$/i.exec(file.name || "");
        var extensionAllowed = extension && ["png", "jpg", "jpeg", "gif", "webp"].indexOf(extension[1].toLowerCase()) >= 0;
        if (allowed.indexOf(file.type) < 0 && !(!file.type && extensionAllowed)) { finishUpload(token, "Logo 必须是 PNG、JPEG、GIF 或 WebP"); return; }
        var reader = new FileReader();
        reader.onload = function () {
            if (token !== uploadToken || !state) return;
            var dataUrl = text(reader.result);
            var image = new Image();
            var done = false;
            function success() {
                if (done || token !== uploadToken || !state) return;
                done = true;
                if (dataUrl.length > MAX_LOGO_CHARS) { finishUpload(token, "Logo DataURL 不能超过 262144 个字符"); return; }
                state.draft.logo = dataUrl;
                state.logoInputDirty = false;
                state.version += 1;
                byId("le-logo").value = "";
                byId("le-logo-status").textContent = "已载入图片";
                renderLogoPreview();
                state.uploading = false;
                setControlsDisabled(false);
            }
            function failure() {
                if (done || token !== uploadToken || !state) return;
                done = true;
                finishUpload(token, "Logo 图片解码失败");
            }
            image.onload = function () {
                Promise.resolve(typeof image.decode === "function" ? image.decode() : undefined).then(success).catch(failure);
            };
            image.onerror = failure;
            image.src = dataUrl;
        };
        reader.onerror = function () { finishUpload(token, "Logo 文件读取失败"); };
        reader.readAsDataURL(file);
    }

    function clearLogo() {
        if (!state) return;
        uploadToken += 1;
        state.uploading = false;
        state.draft.logo = "";
        state.logoInputDirty = false;
        state.version += 1;
        byId("le-logo").value = "";
        byId("le-logo-file").value = "";
        byId("le-logo-status").textContent = "";
        fieldError("logo", "");
        renderLogoPreview();
        setControlsDisabled(false);
    }

    async function scrapeSite() {
        var url = trim(byId("le-url").value);
        if (!isHttpUrl(url)) { fieldError("url", "请先填写完整的 HTTP(S) 地址"); return; }
        var btn = dialog.querySelector('[data-action="scrape"]'); if (btn) btn.disabled = true;
        setStatus("正在抓取网页原始信息…");
        try {
            var r = await fetch("/api/scrape", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({url:url}), signal:AbortSignal.timeout(30000)});
            var result = await r.json(); if (!r.ok) throw new Error(result.error || "抓取失败");
            if (result.name) { byId("le-name").value=result.name; updateDraft("name",result.name); }
            var desc=result.description || result.tags || ""; if(desc){ byId("le-description").value=desc; updateDraft("description",desc); }
            if(result.icon){ byId("le-logo").value=result.icon; updateDraft("logo",result.icon); }
            setStatus("网页信息已抓取（未调用 AI）");
        } catch(error) { setStatus(error.message || "抓取失败",true); } finally { if(btn) btn.disabled=false; }
    }

    async function aiFill() {
        var url = trim(byId("le-url").value);
        if (!isHttpUrl(url)) { fieldError("url", "请先填写完整的 HTTP(S) 地址"); return; }
        var btn = dialog.querySelector('[data-action="ai-fill"]');
        if (btn) btn.disabled = true;
        setStatus("正在调用 AI 生成信息…");
        try {
            var r = await fetch("/api/ai/fill", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({url:url}), signal:AbortSignal.timeout(60000)});
            var result = await r.json();
            if (!r.ok) throw new Error(result.error || "AI 填写失败");
            if (result.name) { byId("le-name").value = result.name; updateDraft("name", result.name); }
            var desc = result.description || result.tags || "";
            if (desc) { byId("le-description").value = desc; updateDraft("description", desc); setCount("le-description"); }
            if (result.icon) { byId("le-logo").value = result.icon; updateDraft("logo", result.icon); }
            if (!result.aiUsed) throw new Error("AI 未生成有效结果");
            setStatus("AI 已生成，可继续修改");
        } catch (error) {
            setStatus(error.message || "AI 填写失败", true);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function bindEvents() {
        form.addEventListener("submit", function (event) { event.preventDefault(); submit(); });
        form.addEventListener("input", function (event) {
            var target = event.target;
            var map = { "le-name": "name", "le-url": "url", "le-description": "description", "le-logo": "logo", "le-new-group-name": "newGroup", "le-article-title": "articleTitle", "le-article-content": "articleContent", "le-svg": "svg", "le-backlink": "backlinkUrl", "le-rss-url": "rssUrl" };
            if (map[target.id]) {
                if (target.id === "le-svg") { state.draft.icon = target.value; state.version += 1; fieldError("customSvg", ""); renderLogoPreview(); }
                else updateDraft(map[target.id], target.value);
                if (target.id === "le-new-group-name") fieldError("newGroup", "");
            }
        });
        form.addEventListener("change", function (event) {
            var target = event.target;
            if (target.id === "le-group") { if (target.value === "__new__") setNewGroupVisible(true); state.version += 1; return; }
            if (target.name === "le-rss-enabled" || target.name === "le-article-enabled" || target.name === "le-svg-enabled" || target.name === "le-login-visible") { state.version += 1; updatePanels(); renderLogoPreview(); return; }
            if (target.id === "le-logo-file") uploadLogo(target.files && target.files[0]);
        });
        dialog.addEventListener("cancel", function (event) {
            if (state && state.saving) { event.preventDefault(); setStatus("正在保存，请稍候", true); return; }
            event.preventDefault();
            rollbackAppliedDraft();
            closeEditorDialog("cancel");
        });
        dialog.addEventListener("close", function () { uploadToken += 1; if (state) state.uploading = false; });
        dialog.addEventListener("click", function (event) {
            var action = event.target.getAttribute("data-action");
            if (action === "cancel") {
                if (state && state.saving) { setStatus("正在保存，请稍候", true); return; }
                rollbackAppliedDraft();
                dialog.close("cancel");
            }
            if (action === "upload") byId("le-logo-file").click();
            if (action === "clear-logo") clearLogo();
            if (action === "new-group") setNewGroupVisible(true);
            if (action === "cancel-new-group") { populateGroups(state.original ? state.original.gi : 0); setNewGroupVisible(false); state.version += 1; }
            if (action === "scrape") scrapeSite();
            if (action === "ai-fill") aiFill();
            if (action === "open-backlink") {
                var url = trim(byId("le-backlink").value);
                if (!isHttpUrl(url)) { fieldError("backlinkUrl", "请填写完整的 HTTP(S) 地址后再打开"); return; }
                var opened = window.open(url, "_blank", "noopener,noreferrer");
                if (!opened) setStatus("浏览器阻止了新窗口，请允许弹窗后重试", true);
            }
        });
    }

    function openLinkEditor(groupIndex, linkIndex) {
        if (!dialog) createDialog();
        var groups = getExistingGroups();
        var group = groups[groupIndex];
        if (!group || !Array.isArray(group.links)) return;
        var source = linkIndex === undefined || linkIndex === null ? null : group.links[linkIndex];
        uploadToken += 1;
        state = {
            original: source ? { gi: groupIndex, li: linkIndex } : null,
            source: source,
            originalDirty: window.dirty,
            draft: Object.assign({}, source || { name: "", url: "", icon: "" }),
            version: 0,
            appliedVersion: -1,
            applied: null,
            newGroupIndex: undefined,
            logoInputDirty: false,
            uploading: false,
            saving: false
        };
        if (typeof state.draft.rssEnabled !== "boolean") state.draft.rssEnabled = false;
        if (typeof state.draft.articleEnabled !== "boolean") state.draft.articleEnabled = false;
        if (typeof state.draft.customSvg !== "boolean") state.draft.customSvg = false;
        if (typeof state.draft.loginOnly !== "boolean") state.draft.loginOnly = false;
        byId("link-editor-title").textContent = (source ? "编辑链接 - " : "创建链接 - ") + (text(group.name) || "未命名分组");
        fillForm(state.draft, groupIndex);
        setControlsDisabled(false);
        if (typeof dialog.showModal === "function") dialog.showModal();
        else {
            dialog.hidden = false;
            dialog.setAttribute("open", "");
        }
        window.setTimeout(function () { byId("le-name").focus(); }, 0);
    }

    window.openLinkEditor = openLinkEditor;
}());
