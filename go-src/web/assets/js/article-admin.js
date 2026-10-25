(function () {
    'use strict';
    if (window.__hpArticleAdminLoaded) return;
    window.__hpArticleAdminLoaded = true;
    var STATUS = { draft: '草稿', published: '已发布', scheduled: '定时发布', hidden: '已隐藏' };
    var STORE = 'hp.article.draft.v1:', panel, ui = {}, article = null, articles = [], lotteries = [], comments = [];
    var baseline = '', busy = false, editVersion = 0, previewTimer, autosaveTimer, currentTab = 'articles';
    var history = [], historyIndex = -1, historyTimer, filename = '', localFailed = false;
    var selection = { start: 0, end: 0 }, lotteryBaseline = '', lotteryCurrent = null, tick = String.fromCharCode(96);
    function str(v) { return v == null ? '' : String(v); }
    function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function btn(text, fn, style) {
        var b = el('button', 'aa-btn' + (style ? ' aa-' + style : ''), text); b.type = 'button';
        if (fn) b.addEventListener('click', function () { Promise.resolve().then(fn).catch(report); }); return b;
    }
    function hint(text) { return el('p', 'aa-hint', text); }
    function field(label, type, parent, options) {
        var wrap = el('div', 'aa-field'), input = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
        input.id = 'aa-field-' + (++field.count); if (input.tagName === 'INPUT') input.type = type || 'text';
        var lab = el('label', '', label); lab.htmlFor = input.id;
        if (options) options.forEach(function (o) { var option = el('option', '', o[1]); option.value = o[0]; input.appendChild(option); });
        wrap.append(lab, input); parent.appendChild(wrap); return input;
    }
    field.count = 0;
    function status(text, error) { ui.message.textContent = text; ui.message.classList.toggle('aa-error', !!error); }
    function notify(text) { status(text); if (typeof window.toast === 'function') window.toast(text); }
    function report(error) { var text = error && error.message || '操作失败，请重试'; status(text, true); if (typeof window.toast === 'function') window.toast(text); }
    async function api(path, method, body) {
        var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, path.endsWith('/ai') ? 120000 : 30000);
        var opts = { method: method || 'GET', credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json' } };
        if (body instanceof FormData) opts.body = body;
        else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        try {
            var response = await fetch(path, opts), data; try { data = await response.json(); } catch (_) { data = {}; }
            if (!response.ok) {
                var msg = typeof data.error === 'string' ? data.error : data.error && data.error.message || data.message;
                var error = new Error(response.status === 409 ? '版本冲突：服务器内容已更新。当前修改已保留，请先导出，再重新载入服务器版本。' : msg || '请求失败（' + response.status + '）'); error.status = response.status; throw error;
            }
            return data;
        } catch (e) { if (e.name === 'AbortError') throw new Error('请求超时，当前修改仍保留，请检查网络后重试。'); throw e; }
        finally { clearTimeout(timer); }
    }
    function modal(title, build, accept, label) {
        return new Promise(function (resolve) {
            var dialog = el('dialog', 'aa-dialog'), form = el('form', 'aa-dialog-form'), head = el('div', 'aa-dialog-head');
            var heading = el('h3', '', title); heading.id = 'aa-dialog-' + (++field.count); dialog.setAttribute('aria-labelledby', heading.id);
            head.append(heading, btn('关闭', function () { dialog.close('cancel'); }, 'quiet'));
            var body = el('div', 'aa-dialog-body'), foot = el('div', 'aa-dialog-foot'), error = el('p', 'aa-dialog-error'); error.setAttribute('role', 'alert');
            var submit = btn(label || '确定', null, 'primary'); submit.type = 'submit'; foot.append(btn('取消', function () { dialog.close('cancel'); }), submit);
            form.append(head, body, error, foot); dialog.appendChild(form); document.body.appendChild(dialog); var controls = build(body) || {};
            var submitting = false;
            dialog.addEventListener('cancel', function (event) { if (submitting) event.preventDefault(); });
            form.addEventListener('submit', async function (event) {
                event.preventDefault(); if (submitting) return; submitting = true; error.textContent = ''; submit.disabled = true;
                head.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
                foot.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
                try { var result = await accept(controls, body); if (result !== false) { resolve(result); dialog.close('accepted'); } }
                catch (e) { error.textContent = e.message || '操作失败'; } finally {
                    submitting = false; head.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); foot.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
                }
            });
            dialog.addEventListener('close', function () { if (dialog.returnValue !== 'accepted') resolve(null); dialog.remove(); }, { once: true }); dialog.showModal();
        });
    }
    async function confirmAction(title, text, label) { return await modal(title, function (body) { body.appendChild(el('p', '', text)); }, function () { return true; }, label || '继续') === true; }
    function safeURL(v) {
        var raw = str(v).trim(), parsed;
        if (!raw || /[\s<>\\\u0000-\u001f]/.test(raw)) throw new Error('请输入有效的网址（http、https 或站内路径）');
        try { parsed = new URL(raw, location.origin); } catch (_) { throw new Error('网址格式无效'); }
        if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error('仅支持 http、https 或站内网址'); return raw;
    }
    function escapeHTML(v) { return str(v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function escapeMD(v) { return str(v).replace(/[\\\[\]*_]/g, '\\$&').split(tick).join('\\' + tick).replace(/[\r\n]+/g, ' '); }
    function localDate(v) {
        if (!v) return ''; var d = new Date(v); if (!Number.isFinite(d.getTime())) return '';
        function pad(n) { return String(n).padStart(2, '0'); }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function isoDate(input, required) {
        if (!input.value) { if (required) throw new Error('请选择日期和时间'); return ''; }
        var d = new Date(input.value);
        if (!input.checkValidity() || !Number.isFinite(d.getTime()) || localDate(d) !== input.value.slice(0, 16)) throw new Error('所选本地时间不存在或无效，请重新选择'); return d.toISOString();
    }
    function dateText(v) { var d = new Date(v); return v && Number.isFinite(d.getTime()) ? d.toLocaleString() : '未设置'; }
    function values() { return { title: ui.title.value, slug: ui.slug.value, summary: ui.summary.value, cover: ui.cover.value, format: ui.format.value, content: ui.content.value, publishAt: ui.publishAt.value, commentsEnabled: ui.commentsEnabled.checked }; }
    function dirty() { return baseline !== JSON.stringify(values()); }
    function lotteryDirty() { return ui.lotteryForm && lotteryBaseline !== JSON.stringify(lotteryValues()); }
    function draftKey() { return STORE + (article && article.id ? encodeURIComponent(article.id) : 'new'); }
    function persist() {
        clearTimeout(autosaveTimer); if (!dirty()) return;
        try {
            localStorage.setItem(draftKey(), JSON.stringify({ articleID: article && article.id || '', revision: article && article.revision, values: values(), filename: filename, savedAt: new Date().toISOString() }));
            ui.localStatus.textContent = '本机草稿已保存 · ' + new Date().toLocaleTimeString(); localFailed = false;
        } catch (_) { localFailed = true; ui.localStatus.textContent = '本机存储不可用，请手动保存或导出'; }
    }
    function readDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch (_) { return null; } }
    function removeDraft() { try { localStorage.removeItem(draftKey()); } catch (_) {} }
    function draftBanner() {
        ui.restore.replaceChildren(); var saved = readDraft(); ui.restore.hidden = !saved || !saved.values; if (ui.restore.hidden) return;
        ui.restore.append(el('div', '', '发现本机草稿 · ' + dateText(saved.savedAt) + '。恢复仅载入编辑器，不会保存到服务器。'), btn('恢复草稿', async function () {
            if (dirty() && !await confirmAction('恢复本机草稿', '恢复将替换当前编辑内容，是否继续？')) return;
            applyValues(saved.values); filename = str(saved.filename);
            // Retain the draft revision to detect a server update since this local draft.
            if (article && saved.articleID === article.id && saved.revision != null) article.revision = saved.revision;
            ui.restore.hidden = true; resetHistory(); changed(); notify('已恢复本机草稿，请检查后明确保存');
        }, 'primary'), btn('丢弃本机草稿', async function () {
            if (await confirmAction('丢弃本机草稿', '删除此篇文章在本机保存的恢复副本？服务器内容不会受影响。', '丢弃')) { removeDraft(); ui.restore.hidden = true; }
        }));
    }
    function applyValues(v) {
        ['title', 'slug', 'summary', 'cover', 'content'].forEach(function (k) { ui[k].value = str(v[k]); });
        ui.format.value = v.format === 'html' ? 'html' : 'markdown'; ui.publishAt.value = str(v.publishAt); ui.commentsEnabled.checked = v.commentsEnabled !== false; updateFormat();
    }
    async function mayLeave() {
        if (busy) { notify('请等待当前操作完成'); return false; } if (!dirty()) return true;
        persist(); return confirmAction('未保存的文章修改', '当前修改尚未保存到服务器。' + (localFailed ? '本机恢复副本不可用，请先导出。' : '已保存本机恢复副本，可稍后通过“本机草稿”恢复。') + '是否离开当前文章？', '离开文章');
    }
    function openArticle(item) {
        article = item ? Object.assign({}, item) : null; filename = ''; editVersion += 1;
        applyValues(item ? Object.assign({}, item, { publishAt: localDate(item.publishAt) }) : { commentsEnabled: true });
        baseline = JSON.stringify(values()); resetHistory(); draftBanner(); updateStats(); renderPreview();
        ui.articleState.textContent = item ? (STATUS[item.status] || item.status || '草稿') + ' · 版本 ' + str(item.revision) : '新文章';
        ui.localStatus.textContent = '自动保存到本机；服务器保存需点击操作按钮'; updatePreviewLink(); renderArticles();
    }
    function changed() {
        editVersion += 1; updateStats(); updatePreviewLink(); clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 260);
        clearTimeout(autosaveTimer); autosaveTimer = setTimeout(persist, 700); ui.localStatus.textContent = '有未保存到服务器的修改';
    }
    function updateStats() {
        var text = ui.content.value, cjk = (text.match(/[\u3400-\u9fff]/g) || []).length, words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/\S+/g) || []).length + cjk;
        ui.wordCount.textContent = words.toLocaleString() + ' 字/词 · ' + text.length.toLocaleString() + ' 字符'; ui.unsaved.textContent = dirty() ? '未保存' : '已同步'; ui.unsaved.classList.toggle('aa-dirty', dirty());
        ui.undo.disabled = historyIndex <= 0; ui.redo.disabled = historyIndex >= history.length - 1;
    }
    function updatePreviewLink() {
        var slug = article && article.slug; ui.previewLink.hidden = !slug || !article;
        ui.previewLink.href = slug ? '/articles/' + encodeURIComponent(slug) + '?preview=1' : '#';
    }
    function updateFormat() {
        var html = ui.format.value === 'html'; ui.editorHelp.textContent = html ? 'HTML 源码 · 脚本仅在隔离预览中运行。PHP、Python 等服务端代码不受支持。' : 'Markdown · Ctrl/⌘ B 加粗、I 斜体、K 链接、S 保存草稿；Tab 缩进';
        ui.markdownTools.forEach(function (b) { b.disabled = html; });
    }
    function renderInto(container, content, format) {
        container.replaceChildren(); var renderer = window.HPArticles;
        if (format === 'html') {
            if (!renderer || typeof renderer.renderHTML !== 'function') { container.appendChild(hint('HTML 隔离预览组件尚未加载，源码仍可编辑和保存。')); return; }
            // Shared renderer builds safe srcdoc with CSP. Imported HTML never enters the admin document.
            renderer.renderHTML(container, content);
            container.querySelectorAll('iframe').forEach(function (f) { f.setAttribute('sandbox', 'allow-scripts allow-popups'); f.setAttribute('referrerpolicy', 'no-referrer'); f.title = 'HTML 隔离预览'; });
        } else if (renderer && typeof renderer.render === 'function') renderer.render(container, content, { preview: true, interactive: false });
        else container.appendChild(el('pre', 'aa-plain-preview', content || '开始写作，内容将在这里预览。'));
    }
    function renderPreview() { try { renderInto(ui.preview, ui.content.value, ui.format.value); } catch (_) { ui.preview.replaceChildren(hint('预览暂时无法渲染，编辑内容已保留。')); } }
    function rememberSelection() { selection = { start: ui.content.selectionStart, end: ui.content.selectionEnd }; }
    function snapshot() { return { value: ui.content.value, start: ui.content.selectionStart, end: ui.content.selectionEnd }; }
    function resetHistory() { clearTimeout(historyTimer); rememberSelection(); history = [snapshot()]; historyIndex = 0; }
    function pushHistory() {
        clearTimeout(historyTimer); var s = snapshot(); if (history[historyIndex] && history[historyIndex].value === s.value) { history[historyIndex] = s; return; }
        history = history.slice(0, historyIndex + 1); history.push(s); if (history.length > 150) history.shift(); historyIndex = history.length - 1;
    }
    function travel(step) {
        pushHistory(); var next = historyIndex + step; if (next < 0 || next >= history.length) return;
        historyIndex = next; var s = history[next]; ui.content.value = s.value; ui.content.focus(); ui.content.setSelectionRange(s.start, s.end); rememberSelection(); changed();
    }
    function replace(text, start, end, selectStart, selectEnd) {
        ui.content.focus(); pushHistory(); var a = start == null ? selection.start : start, b = end == null ? selection.end : end;
        ui.content.setRangeText(text, a, b, 'end'); if (selectStart != null) ui.content.setSelectionRange(a + selectStart, a + selectEnd); rememberSelection(); pushHistory(); changed();
    }
    function wrap(before, after, placeholder) { var a = selection.start, b = selection.end, selected = ui.content.value.slice(a, b) || placeholder; replace(before + selected + after, a, b, before.length, before.length + selected.length); }
    function lines(prefix) {
        var text = ui.content.value, a = text.lastIndexOf('\n', selection.start - 1) + 1, end = text.indexOf('\n', selection.end), b = end < 0 ? text.length : end;
        replace(text.slice(a, b).split('\n').map(function (line, index) { return (typeof prefix === 'function' ? prefix(index) : prefix) + line; }).join('\n'), a, b);
    }
    function block(text) { var a = selection.start, value = ui.content.value; replace((a && value[a - 1] !== '\n' ? '\n\n' : a ? '\n' : '') + text + '\n\n'); }
    function indent(outdent) {
        if (!outdent && selection.start === selection.end) { replace('    '); return; }
        var text = ui.content.value, a = text.lastIndexOf('\n', selection.start - 1) + 1, end = text.indexOf('\n', selection.end), b = end < 0 ? text.length : end;
        replace(text.slice(a, b).split('\n').map(function (line) { return outdent ? line.replace(/^( {1,4}|\t)/, '') : '    ' + line; }).join('\n'), a, b);
    }
    async function saveArticle(nextStatus) {
        if (busy) return;
        if (!ui.title.value.trim()) { ui.title.focus(); throw new Error('请填写文章标题'); }
        var payload = values(); payload.title = payload.title.trim(); payload.slug = payload.slug.trim(); payload.status = nextStatus;
        if (!payload.slug) { ui.slug.focus(); throw new Error('请填写文章路径，服务器将验证格式与唯一性'); }
        payload.cover = payload.cover.trim() ? safeURL(payload.cover) : ''; payload.publishAt = nextStatus === 'published' ? '' : isoDate(ui.publishAt, nextStatus === 'scheduled');
        if (nextStatus === 'scheduled' && new Date(payload.publishAt).getTime() <= Date.now()) throw new Error('定时发布必须选择未来的本地时间');
        if (nextStatus === 'published' && !await confirmAction('发布文章', '发布后文章将对访客可见。确认发布“' + payload.title + '”？', '确认发布')) return;
        if (nextStatus === 'hidden' && !await confirmAction('隐藏文章', '保存当前修改并隐藏此文章？', '保存并隐藏')) return;
        if (article && article.id) { payload.id = article.id; payload.revision = article.revision; }
        var captured = JSON.stringify(values()), version = editVersion, oldKey = draftKey(); busy = true; setSaving(true); persist();
        try {
            var result = await api('/api/admin/articles', 'POST', payload); if (!result.article || !result.article.id) throw new Error('服务器未返回文章，当前内容已保留，请重新载入列表核对');
            article = Object.assign({}, result.article); articles = articles.filter(function (a) { return a.id !== article.id; }); articles.unshift(article);
            try { localStorage.removeItem(oldKey); } catch (_) {}
            if (editVersion === version) { applyValues(Object.assign({}, article, { publishAt: localDate(article.publishAt) })); baseline = JSON.stringify(values()); removeDraft(); }
            else { baseline = captured; persist(); }
            ui.restore.hidden = true; ui.articleState.textContent = (STATUS[article.status] || article.status) + ' · 版本 ' + str(article.revision);
            updateStats(); updatePreviewLink(); renderArticles(); notify('文章已保存为' + (STATUS[article.status] || article.status));
        } finally { busy = false; setSaving(false); }
    }
    function setSaving(saving) { ui.saveButtons.forEach(function (b) { b.disabled = saving; }); ui.saveState.textContent = saving ? '正在保存…' : '各操作均保存当前内容'; }
    async function loadArticles() {
        ui.listMessage.textContent = '正在加载文章…';
        try { var data = await api('/api/admin/articles'); articles = Array.isArray(data.articles) ? data.articles : []; renderArticles(); }
        catch (e) { ui.listMessage.textContent = '文章加载失败，可点击刷新重试'; throw e; }
    }
    function renderArticles() {
        var filter = ui.filter.value, query = ui.search.value.trim().toLowerCase(); ui.articleList.replaceChildren();
        var found = articles.filter(function (a) { return (!filter || a.status === filter) && (!query || [a.title, a.slug, a.summary].some(function (v) { return str(v).toLowerCase().includes(query); })); });
        ui.listMessage.textContent = found.length + ' / ' + articles.length + ' 篇文章';
        if (!found.length) ui.articleList.appendChild(el('p', 'aa-empty', articles.length ? '没有符合条件的文章' : '尚无文章，开始撰写第一篇吧。'));
        found.forEach(function (item) {
            var row = el('div', 'aa-list-item' + (article && article.id === item.id ? ' aa-selected' : ''));
            var open = btn(item.title || '未命名文章', async function () { if (await mayLeave()) openArticle(item); }, 'article-open');
            var meta = el('div', 'aa-item-meta'); meta.append(el('span', 'aa-badge aa-status-' + (Object.prototype.hasOwnProperty.call(STATUS, item.status) ? item.status : 'draft'), STATUS[item.status] || str(item.status)), el('span', '', item.slug || '自动生成路径'));
            if (item.status === 'scheduled') meta.appendChild(el('span', '', dateText(item.publishAt)));
            var remove = btn('删除', async function () {
                if (busy || !await confirmAction('删除文章', '永久删除“' + str(item.title) + '”？此操作无法撤销。', '删除')) return;
                if (article && article.id === item.id && !await mayLeave()) return; remove.disabled = true;
                try { await api('/api/admin/articles/' + encodeURIComponent(item.id), 'DELETE'); articles = articles.filter(function (a) { return a.id !== item.id; }); if (article && article.id === item.id) openArticle(null); renderArticles(); notify('文章已删除'); }
                finally { remove.disabled = false; }
            }, 'danger small'); row.append(open, meta, remove); ui.articleList.appendChild(row);
        });
    }
    async function upload(file) {
        if (!file) throw new Error('请选择文件'); var form = new FormData(); form.append('file', file);
        var result = await api('/api/admin/uploads', 'POST', form); if (!result.url) throw new Error('上传响应缺少文件网址'); result.url = safeURL(result.url); return result;
    }
    async function insertMedia() {
        rememberSelection(); var identity = article && article.id, version = editVersion;
        await modal('插入媒体', function (body) {
            var kind = field('媒体类型', 'select', body, [['image', '图片'], ['video', '视频'], ['audio', '音频']]), url = field('媒体网址', 'text', body), alt = field('说明文字', 'text', body), file = field('或上传文件', 'file', body);
            file.accept = 'image/*,video/*,audio/*'; body.appendChild(hint('填写网址或选择文件，上传后仍需保存文章才会应用。')); return { kind: kind, url: url, alt: alt, file: file };
        }, async function (f) {
            var url = f.url.value.trim(), kind = f.kind.value;
            if (f.file.files[0]) { var uploaded = await upload(f.file.files[0]); url = uploaded.url; var type = str(uploaded.type || f.file.files[0].type); if (type.startsWith('video/')) kind = 'video'; else if (type.startsWith('audio/')) kind = 'audio'; else if (type.startsWith('image/')) kind = 'image'; }
            url = safeURL(url); if ((article && article.id) !== identity || editVersion !== version) throw new Error('文章已变化，请关闭后重新插入');
            if (ui.format.value === 'html') block(kind === 'image' ? '<img src="' + escapeHTML(url) + '" alt="' + escapeHTML(f.alt.value) + '" loading="lazy">' : '<' + kind + ' controls src="' + escapeHTML(url) + '"></' + kind + '>');
            else if (kind === 'video') block(':::video ' + url + '\n:::');
            else if (kind === 'audio') block(':::audio ' + url + '\n:::');
            else block('![' + escapeMD(f.alt.value) + '](' + url.replace(/\(/g, '%28').replace(/\)/g, '%29') + ')'); return true;
        }, '插入');
    }
    async function insertLink() {
        rememberSelection();
        await modal('插入链接', function (body) {
            var title = field('链接文字', 'text', body), url = field('链接网址', 'text', body); title.value = ui.content.value.slice(selection.start, selection.end); url.required = true; return { title: title, url: url };
        }, function (f) { var url = safeURL(f.url.value), title = f.title.value.trim() || url; replace(ui.format.value === 'html' ? '<a href="' + escapeHTML(url) + '">' + escapeHTML(title) + '</a>' : '[' + escapeMD(title) + '](' + url.replace(/\(/g, '%28').replace(/\)/g, '%29') + ')'); return true; }, '插入链接');
    }
    async function insertCard() {
        rememberSelection();
        await modal('插入链接卡片', function (body) {
            var f = {}; [['title', '标题'], ['url', '网址'], ['image', '图片网址（可选）'], ['description', '简介（可选）']].forEach(function (p) { f[p[0]] = field(p[1], p[0] === 'description' ? 'textarea' : 'text', body); }); f.title.required = true; f.url.required = true; return f;
        }, function (f) { var card = { title: f.title.value.trim(), url: safeURL(f.url.value), image: f.image.value.trim() ? safeURL(f.image.value) : '', description: f.description.value.trim() }; block(':::card\n' + JSON.stringify(card) + '\n:::'); return true; }, '插入卡片');
    }
    async function insertLottery() {
        rememberSelection(); await loadLotteries(false);
        await modal('插入抽奖', function (body) {
            if (!lotteries.length) body.appendChild(hint('暂无抽奖，请先到“抽奖管理”创建。'));
            var select = field('选择已有抽奖', 'select', body, lotteries.map(function (l) { return [l.id, l.title + (l.status === 'closed' ? '（已关闭）' : '')]; }));
            body.appendChild(hint('公开表单按用户 Cookie 限制抽取一次。奖品随机分配，中奖后仅联系管理员领取。')); return { select: select };
        }, function (f) { if (!f.select.value) throw new Error('请先创建抽奖'); if (/[\s\r\n]/.test(f.select.value)) throw new Error('抽奖编号无效'); block(':::lottery ' + f.select.value + '\n:::'); return true; }, '插入抽奖');
    }
    async function importFile(file) {
        if (!file) return; if (!/\.(md|txt|html?|markdown)$/i.test(file.name)) throw new Error('仅支持 .html、.htm、.md、.txt 文件，PHP/Python 服务端代码无法执行。');
        if (file.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB，请使用较小的文本文件'); var content = await file.text();
        if (dirty() && !await confirmAction('导入文件', '导入会替换正文，当前修改将保留在本机草稿。是否继续？', '导入')) return;
        persist(); filename = file.name; ui.content.value = content; ui.format.value = /\.html?$/i.test(file.name) ? 'html' : 'markdown'; if (!ui.title.value) ui.title.value = file.name.replace(/\.[^.]+$/, '');
        updateFormat(); resetHistory(); changed(); notify('文件已载入，请检查后保存；可使用 AI 识别 / 转换');
    }
    async function aiConvert() {
        if (!ui.content.value.trim()) throw new Error('请先导入文件或填写正文');
        var request = await modal('AI 识别 / 转换', function (body) {
            body.appendChild(hint('使用后台已有 AI 配置处理当前编辑内容。结果将先供审阅，不会自动保存或发布。'));
            var mode = field('目标格式', 'select', body, [['markdown', 'Markdown'], ['html', 'HTML（隔离脚本预览）']]); mode.value = ui.format.value; return { mode: mode };
        }, function (f) { return { mode: f.mode.value }; }, '开始识别'); if (!request) return;
        var source = ui.content.value, version = editVersion; ui.ai.disabled = true; status('AI 正在处理，请稍候…');
        try {
            var result = await api('/api/admin/articles/ai', 'POST', { content: source, filename: filename || 'article.' + (ui.format.value === 'html' ? 'html' : 'md'), mode: request.mode });
            if (typeof result.content !== 'string' || !['markdown', 'html'].includes(result.format)) throw new Error('AI 返回内容格式无效');
            await modal('审阅 AI 处理结果', function (body) {
                body.append(el('h4', '', result.title || '未提供标题'), hint(result.summary || '未提供简介')); var preview = el('div', 'aa-preview aa-ai-preview'); body.appendChild(preview); renderInto(preview, result.content, result.format);
                var details = el('details'); details.append(el('summary', '', '查看返回源码（' + result.format + '）'), el('pre', 'aa-ai-source', result.content)); body.append(details, hint('应用只更新编辑器，仍需手动保存。请核对 AI 内容。'));
            }, function () {
                if (version !== editVersion) throw new Error('等待期间编辑内容已变化，请重新生成，以免覆盖新修改');
                persist(); if (result.title) ui.title.value = str(result.title); if (result.summary) ui.summary.value = str(result.summary); ui.content.value = result.content; ui.format.value = result.format;
                updateFormat(); resetHistory(); changed(); notify('已应用 AI 结果，尚未保存到服务器'); return true;
            }, '应用到编辑器');
        } finally { ui.ai.disabled = false; }
    }
    function exportArticle() {
        var blob = new Blob([ui.content.value], { type: ui.format.value === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob), link = el('a');
        link.href = url; link.download = (ui.slug.value || 'article').replace(/[\\/:*?"<>|]/g, '-') + (ui.format.value === 'html' ? '.html' : '.md'); document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    async function browseDrafts() {
        var drafts = [];
        try { for (var i = 0; i < localStorage.length; i += 1) { var key = localStorage.key(i); if (key && key.startsWith(STORE)) { try { var value = JSON.parse(localStorage.getItem(key)); if (value && value.values) drafts.push({ key: key, value: value }); } catch (_) {} } } } catch (_) { throw new Error('本机草稿存储不可用'); }
        var chosen, result = await modal('本机草稿', function (body) {
            if (!drafts.length) body.appendChild(hint('此浏览器没有可恢复的草稿。')); var select = field('选择草稿', 'select', body, drafts.map(function (d, index) { return [String(index), (d.value.values.title || '未命名文章') + ' · ' + dateText(d.value.savedAt)]; }));
            body.appendChild(hint('载入后显示恢复横幅，由你决定是否恢复。不会自动覆盖服务器。')); return { select: select };
        }, function (f) { if (!drafts.length) throw new Error('没有可恢复的草稿'); chosen = drafts[Number(f.select.value)].value; return true; }, '查看草稿');
        if (!result || !chosen || !await mayLeave()) return;
        var server = articles.find(function (a) { return a.id === chosen.articleID; });
        if (chosen.articleID && !server) { openArticle(null); ui.restore.hidden = false; ui.restore.replaceChildren(hint('此草稿对应的服务器文章不存在，可作为新文章恢复。'), btn('恢复为新文章', function () { applyValues(chosen.values); filename = str(chosen.filename); ui.restore.hidden = true; resetHistory(); changed(); }, 'primary')); }
        else openArticle(server || null);
    }
    function lotteryValues() { return { title: ui.lotteryTitle.value, description: ui.lotteryDescription.value, prizes: ui.lotteryPrizes.value, status: ui.lotteryStatus.value, startsAt: ui.lotteryStarts.value, endsAt: ui.lotteryEnds.value }; }
    function openLottery(item) {
        lotteryCurrent = item ? Object.assign({}, item) : null;
        ui.lotteryTitle.value = item ? str(item.title) : ''; ui.lotteryDescription.value = item ? str(item.description) : '';
        ui.lotteryPrizes.value = item && Array.isArray(item.prizes) ? item.prizes.map(function (p) { return p.name + '|' + p.stock; }).join('\n') : '';
        ui.lotteryStatus.value = item && item.status === 'closed' ? 'closed' : 'active'; ui.lotteryStarts.value = localDate(item && item.startsAt); ui.lotteryEnds.value = localDate(item && item.endsAt);
        ui.lotteryIdentity.textContent = item ? '编辑抽奖 · ' + item.id + ' · 版本 ' + str(item.revision) : '新建抽奖'; lotteryBaseline = JSON.stringify(lotteryValues()); ui.results.replaceChildren();
    }
    async function mayLeaveLottery() { return !lotteryDirty() || await confirmAction('未保存的抽奖修改', '抽奖信息尚未保存，继续将丢弃这些修改。', '丢弃并继续'); }
    async function loadLotteries(render) { var data = await api('/api/admin/lotteries'); lotteries = Array.isArray(data.lotteries) ? data.lotteries : []; if (render !== false) renderLotteries(); }
    function renderLotteries() {
        ui.lotteryList.replaceChildren(); if (!lotteries.length) ui.lotteryList.appendChild(el('p', 'aa-empty', '还没有抽奖活动'));
        lotteries.forEach(function (l) {
            var row = el('div', 'aa-lottery-item'), meta = el('div'); meta.append(el('strong', '', l.title || '未命名抽奖'), hint((l.status === 'closed' ? '已关闭' : '开放参与 / 等待开始') + ' · ' + str(l.id)));
            var actions = el('div', 'aa-actions'); actions.append(btn('编辑', async function () { if (await mayLeaveLottery()) openLottery(l); }), btn('中奖记录', function () { return loadResults(l); }), btn('删除', async function () {
                if (!await confirmAction('删除抽奖', '永久删除“' + str(l.title) + '”？', '删除')) return;
                if (lotteryCurrent && lotteryCurrent.id === l.id && !await mayLeaveLottery()) return;
                await api('/api/admin/lotteries/' + encodeURIComponent(l.id), 'DELETE'); if (lotteryCurrent && lotteryCurrent.id === l.id) openLottery(null); await loadLotteries(); notify('抽奖已删除');
            }, 'danger')); row.append(meta, actions); ui.lotteryList.appendChild(row);
        });
    }
    async function saveLottery() {
        var title = ui.lotteryTitle.value.trim(); if (!title) { ui.lotteryTitle.focus(); throw new Error('请填写抽奖标题'); }
        var rows = ui.lotteryPrizes.value.split(/\r?\n/).filter(function (line) { return line.trim(); }); if (!rows.length) throw new Error('至少填写一个奖品，格式为 名称|库存');
        var names = new Set(), prizes = rows.map(function (line, index) {
            var parts = line.split('|'), name = parts[0].trim(), stock = parts.length === 2 ? parts[1].trim() : '';
            if (!name || !/^\d+$/.test(stock) || !Number.isSafeInteger(Number(stock))) throw new Error('第 ' + (index + 1) + ' 行格式错误，库存必须为非负整数');
            if (names.has(name)) throw new Error('奖品名称不能重复'); names.add(name); return { name: name, stock: Number(stock) };
        });
        var startsAt = isoDate(ui.lotteryStarts, false), endsAt = isoDate(ui.lotteryEnds, false);
        if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw new Error('结束时间必须晚于开始时间');
        var payload = { title: title, description: ui.lotteryDescription.value, prizes: prizes, status: ui.lotteryStatus.value, startsAt: startsAt, endsAt: endsAt };
        if (lotteryCurrent) { payload.id = lotteryCurrent.id; payload.revision = lotteryCurrent.revision; }
        var captured = JSON.stringify(lotteryValues()), identity = lotteryCurrent && lotteryCurrent.id; ui.lotterySave.disabled = true;
        try {
            var result = await api('/api/admin/lotteries', 'POST', payload); if (!result.lottery) throw new Error('服务器未返回抽奖信息');
            if ((lotteryCurrent && lotteryCurrent.id) === identity) { if (JSON.stringify(lotteryValues()) === captured) openLottery(result.lottery); else { lotteryCurrent = result.lottery; lotteryBaseline = captured; } }
            await loadLotteries(); notify('抽奖已保存');
        } finally { ui.lotterySave.disabled = false; }
    }
    async function loadResults(lottery) {
        ui.results.replaceChildren(hint('正在加载中奖记录…'));
        try {
            var result = await api('/api/admin/lottery-results?lottery=' + encodeURIComponent(lottery.id)), entries = Array.isArray(result.entries) ? result.entries : [];
            ui.results.replaceChildren(el('h4', '', lottery.title + ' · 抽奖记录（' + entries.length + '）')); if (!entries.length) ui.results.appendChild(hint('暂无记录'));
            entries.forEach(function (entry) { var row = el('div', 'aa-result'); Object.keys(entry).forEach(function (key) { var v = entry[key]; row.appendChild(el('p', '', key + '：' + (v && typeof v === 'object' ? JSON.stringify(v) : str(v)))); }); ui.results.appendChild(row); });
        } catch (e) { ui.results.replaceChildren(hint('记录加载失败，请重试')); throw e; }
    }
    async function loadComments() {
        ui.commentsMessage.textContent = '正在加载评论…';
        try { var data = await api('/api/admin/comments'); comments = Array.isArray(data.comments) ? data.comments : []; renderComments(); }
        catch (e) { ui.commentsMessage.textContent = '评论加载失败，请点击刷新重试'; throw e; }
    }
    function renderComments() {
        var query = ui.commentSearch.value.trim().toLowerCase(), filter = ui.commentFilter.value;
        var found = comments.filter(function (c) { return (!filter || c.status === filter) && (!query || [c.name, c.content, c.articleID, c.articleSlug].some(function (v) { return str(v).toLowerCase().includes(query); })); });
        ui.commentList.replaceChildren(); ui.commentsMessage.textContent = found.length + ' / ' + comments.length + ' 条评论'; if (!found.length) ui.commentList.appendChild(el('p', 'aa-empty', '没有符合条件的评论'));
        found.forEach(function (c) {
            var item = el('article', 'aa-comment'), head = el('div', 'aa-comment-head'); head.append(el('strong', '', c.name || '匿名访客'), el('span', 'aa-badge', ({ pending: '待审核', approved: '已通过', rejected: '已拒绝' })[c.status] || str(c.status)), el('time', '', dateText(c.createdAt)));
            var ref = hint('文章 ID：' + str(c.articleID));
            if (c.articleSlug) { var link = el('a', '', '文章：' + c.articleSlug); link.href = '/articles/' + encodeURIComponent(c.articleSlug) + '?preview=1'; link.target = '_blank'; link.rel = 'noopener noreferrer'; ref.replaceChildren(link); }
            var actions = el('div', 'aa-actions');
            async function moderate(next) {
                actions.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
                try { await api('/api/admin/comments/' + encodeURIComponent(c.id), 'POST', { status: next }); c.status = next; renderComments(); notify(next === 'approved' ? '评论已通过' : '评论已拒绝'); }
                finally { actions.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); }
            }
            var approve = btn('通过', function () { return moderate('approved'); }, 'primary small'); approve.disabled = c.status === 'approved';
            var reject = btn('拒绝', function () { return moderate('rejected'); }, 'small'); reject.disabled = c.status === 'rejected';
            actions.append(approve, reject, btn('删除', async function () {
                if (!await confirmAction('删除评论', '永久删除此条评论？此操作无法撤销。', '删除')) return;
                await api('/api/admin/comments/' + encodeURIComponent(c.id), 'DELETE'); comments = comments.filter(function (v) { return v.id !== c.id; }); renderComments(); notify('评论已删除');
            }, 'danger small')); item.append(head, ref, el('p', 'aa-comment-content', c.content), actions); ui.commentList.appendChild(item);
        });
    }
    function buildArticles(view) {
        var library = el('section', 'aa-library'), head = el('div', 'aa-section-head'); head.append(el('h3', '', '文章库'), btn('刷新', loadArticles, 'small')); library.appendChild(head);
        var filters = el('div', 'aa-filters'); ui.search = field('搜索文章', 'search', filters); ui.search.placeholder = '标题、路径或简介';
        ui.filter = field('文章状态', 'select', filters, [['', '全部状态']].concat(Object.keys(STATUS).map(function (key) { return [key, STATUS[key]]; })));
        ui.search.addEventListener('input', renderArticles); ui.filter.addEventListener('change', renderArticles); ui.listMessage = hint(''); ui.articleList = el('div', 'aa-article-list'); library.append(filters, ui.listMessage, ui.articleList); view.appendChild(library);
        var author = el('section', 'aa-author'), authorHead = el('div', 'aa-section-head'), badges = el('div', 'aa-actions');
        ui.articleState = el('span', 'aa-badge'); ui.unsaved = el('span', 'aa-sync'); badges.append(ui.articleState, ui.unsaved); authorHead.append(el('h3', '', '文章创作'), badges); author.appendChild(authorHead);
        var actions = el('div', 'aa-actions aa-top-actions'); actions.append(btn('＋ 新文章', async function () { if (await mayLeave()) { openArticle(null); ui.title.focus(); } }, 'primary'), btn('本机草稿', browseDrafts), btn('导出正文', exportArticle));
        ui.previewLink = el('a', 'aa-btn', '登录预览 ↗'); ui.previewLink.target = '_blank'; ui.previewLink.rel = 'noopener noreferrer'; actions.appendChild(ui.previewLink); author.appendChild(actions);
        ui.restore = el('aside', 'aa-restore'); ui.restore.hidden = true; author.appendChild(ui.restore);
        var metadata = el('div', 'aa-metadata'); ui.title = field('文章标题', 'text', metadata); ui.title.maxLength = 300; ui.title.placeholder = '为这篇文章起个标题';
        var pair = el('div', 'aa-grid2'); metadata.appendChild(pair); ui.slug = field('自定义路径（必填）', 'text', pair); ui.slug.placeholder = '例如 my-first-article；由服务器验证'; ui.slug.required = true; ui.format = field('编辑格式', 'select', pair, [['markdown', 'Markdown'], ['html', 'HTML']]);
        ui.summary = field('文章简介', 'textarea', metadata); ui.summary.rows = 2;
        var cover = el('div', 'aa-cover-row'); ui.cover = field('封面网址', 'text', cover); ui.cover.placeholder = 'https://… 或 /uploads/…';
        var coverFile = el('input'); coverFile.type = 'file'; coverFile.accept = 'image/*'; coverFile.hidden = true; coverFile.setAttribute('aria-label', '选择封面图片');
        var uploadCover = btn('上传封面', function () { coverFile.click(); }); coverFile.addEventListener('change', async function () {
            var file = coverFile.files[0]; if (!file) return; var identity = article && article.id; uploadCover.disabled = true;
            try { if (file.type && !file.type.startsWith('image/')) throw new Error('请选择图片文件'); var result = await upload(file); if ((article && article.id) !== identity) { notify('封面已上传，但文章已切换，请重新选择'); return; } ui.cover.value = result.url; changed(); notify('封面已上传，保存文章后生效'); }
            catch (e) { report(e); } finally { uploadCover.disabled = false; coverFile.value = ''; }
        }); cover.append(uploadCover, coverFile); metadata.appendChild(cover); author.appendChild(metadata);
        var workspace = el('div', 'aa-workspace'); ui.workspace = workspace; var toolhead = el('div', 'aa-workspace-head'), importInput = el('input');
        importInput.type = 'file'; importInput.accept = '.md,.txt,.html,.htm,.markdown'; importInput.hidden = true; importInput.setAttribute('aria-label', '导入文章文件');
        importInput.addEventListener('change', function () { importFile(importInput.files[0]).catch(report).finally(function () { importInput.value = ''; }); });
        ui.ai = btn('AI 识别 / 转换', aiConvert); var full = btn('全屏写作', function () { var active = workspace.classList.toggle('aa-fullscreen'); document.body.classList.toggle('aa-editor-fullscreen', active); full.textContent = active ? '退出全屏' : '全屏写作'; full.setAttribute('aria-pressed', String(active)); }); ui.fullscreen = full;
        toolhead.append(btn('导入文件', function () { importInput.click(); }), importInput, ui.ai, full); workspace.appendChild(toolhead);
        workspace.appendChild(hint('支持 .md / .txt / .html / .htm 导入。HTML 中的 JavaScript 仅在隔离预览运行，PHP / Python 等服务端代码无法执行。'));
        var toolbar = el('div', 'aa-toolbar'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Markdown 编辑工具'); ui.markdownTools = [];
        var headings = el('select'); headings.setAttribute('aria-label', '插入标题'); [['', '标题'], ['# ', 'H1'], ['## ', 'H2'], ['### ', 'H3'], ['#### ', 'H4'], ['##### ', 'H5'], ['###### ', 'H6']].forEach(function (p) { var option = el('option', '', p[1]); option.value = p[0]; headings.appendChild(option); });
        headings.addEventListener('change', function () { if (headings.value) lines(headings.value); headings.value = ''; }); toolbar.appendChild(headings); ui.markdownTools.push(headings);
        function tool(label, title, fn, md) { var b = btn(label, fn, 'tool'); b.title = title; b.setAttribute('aria-label', title); b.addEventListener('mousedown', function (event) { event.preventDefault(); }); toolbar.appendChild(b); if (md !== false) ui.markdownTools.push(b); return b; }
        tool('B', '加粗 Ctrl/⌘ B', function () { wrap('**', '**', '加粗文字'); }); tool('I', '斜体 Ctrl/⌘ I', function () { wrap('*', '*', '斜体文字'); }); tool('S̶', '删除线', function () { wrap('~~', '~~', '删除文字'); });
        tool('❯', '引用', function () { lines('> '); }); tool('< >', '行内代码', function () { wrap(tick, tick, 'code'); }); tool('{ }', '代码块', function () { wrap(tick.repeat(3) + '\n', '\n' + tick.repeat(3), '代码'); });
        tool('1.', '有序列表', function () { lines(function (i) { return (i + 1) + '. '; }); }); tool('•', '无序列表', function () { lines('- '); }); tool('☑', '任务列表', function () { lines('- [ ] '); });
        tool('▦', '插入表格', function () { block('| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |'); }); tool('―', '水平分隔线', function () { block('---'); });
        tool('链接', '插入链接 Ctrl/⌘ K', insertLink, false); tool('媒体', '上传或插入图片、视频、音频', insertMedia, false); tool('卡片', '插入链接卡片', insertCard); tool('抽奖', '插入已有抽奖', insertLottery);
        ui.undo = tool('↶', '撤销 Ctrl/⌘ Z', function () { travel(-1); }, false); ui.redo = tool('↷', '重做 Ctrl/⌘ Shift Z', function () { travel(1); }, false); workspace.appendChild(toolbar);
        var mobile = el('div', 'aa-mobile-tabs'); mobile.setAttribute('role', 'tablist'); mobile.setAttribute('aria-label', '编辑器视图');
        var editTab = btn('编辑', function () { setMobile(false); }), previewTab = btn('预览', function () { setMobile(true); });
        function setMobile(preview) { workspace.classList.toggle('aa-show-preview', preview); editTab.setAttribute('aria-selected', String(!preview)); previewTab.setAttribute('aria-selected', String(preview)); if (preview) renderPreview(); }
        editTab.setAttribute('role', 'tab'); previewTab.setAttribute('role', 'tab'); setMobile(false); mobile.append(editTab, previewTab); workspace.appendChild(mobile);
        var panes = el('div', 'aa-panes'), editPane = el('div', 'aa-edit-pane'), previewPane = el('div', 'aa-preview-pane'), editLabel = el('label', 'aa-pane-label', '正文源码');
        editLabel.htmlFor = 'aa-content'; ui.content = el('textarea', 'aa-content'); ui.content.id = 'aa-content'; ui.content.spellcheck = false; ui.content.placeholder = '从一个想法开始…';
        ui.preview = el('div', 'aa-preview'); ui.preview.setAttribute('aria-label', '文章内容预览'); editPane.append(editLabel, ui.content); previewPane.append(el('div', 'aa-pane-label', '实时预览'), ui.preview); panes.append(editPane, previewPane); workspace.appendChild(panes);
        var foot = el('div', 'aa-editor-foot'); ui.wordCount = el('span'); ui.localStatus = el('span'); foot.append(ui.wordCount, ui.localStatus); workspace.appendChild(foot); ui.editorHelp = hint(''); workspace.appendChild(ui.editorHelp); author.appendChild(workspace);
        var publication = el('div', 'aa-publication'), schedule = el('div', 'aa-grid2'); ui.publishAt = field('发布时间（浏览器本地时区）', 'datetime-local', schedule);
        var check = el('label', 'aa-check'); ui.commentsEnabled = el('input'); ui.commentsEnabled.type = 'checkbox'; check.append(ui.commentsEnabled, document.createTextNode('允许访客评论（审核后展示）')); schedule.appendChild(check); publication.appendChild(schedule);
        var zone; try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { zone = '浏览器本地时区'; } publication.appendChild(hint('时间按 ' + zone + ' 输入，提交时转换为 ISO 时间。定时发布需选择未来时间。'));
        var saves = el('div', 'aa-actions aa-save-actions'); ui.saveButtons = [];
        [['draft', '保存草稿'], ['published', '立即发布'], ['scheduled', '定时发布'], ['hidden', '保存并隐藏']].forEach(function (p) { var b = btn(p[1], function () { return saveArticle(p[0]); }, p[0] === 'published' ? 'primary' : ''); saves.appendChild(b); ui.saveButtons.push(b); });
        ui.saveState = el('span', 'aa-hint', '各操作均保存当前内容'); publication.append(saves, ui.saveState); author.appendChild(publication); view.appendChild(author);
        author.addEventListener('input', function (event) { if (event.target === ui.content) { clearTimeout(historyTimer); historyTimer = setTimeout(function () { pushHistory(); updateStats(); }, 350); } changed(); });
        ui.format.addEventListener('change', function () { updateFormat(); changed(); }); ['select', 'keyup', 'click', 'blur'].forEach(function (event) { ui.content.addEventListener(event, rememberSelection); });
        ui.content.addEventListener('keydown', function (event) {
            rememberSelection(); var mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
            if (event.key === 'Tab') { event.preventDefault(); indent(event.shiftKey); }
            else if (mod && ['b', 'i', 'k', 's', 'z', 'y'].includes(key)) {
                if (ui.format.value === 'html' && (key === 'b' || key === 'i')) return; event.preventDefault();
                if (key === 'b') wrap('**', '**', '加粗文字'); else if (key === 'i') wrap('*', '*', '斜体文字'); else if (key === 'k') insertLink().catch(report); else if (key === 's') saveArticle('draft').catch(report); else travel(key === 'y' || event.shiftKey ? 1 : -1);
            }
        });
    }
    function buildLotteries(view) {
        var head = el('div', 'aa-section-head'); head.append(el('h3', '', '抽奖管理'), btn('刷新', function () { return loadLotteries(); })); view.appendChild(head);
        view.appendChild(hint('在文章中插入抽奖后，访客可通过公开表单参与。每个用户 Cookie 限抽一次；奖品随机分配，中奖仅联系管理员领取。'));
        ui.lotteryList = el('div', 'aa-lottery-list'); view.appendChild(ui.lotteryList); var form = el('section', 'aa-lottery-form'); ui.lotteryForm = form;
        var formHead = el('div', 'aa-section-head'); ui.lotteryIdentity = el('h4'); formHead.append(ui.lotteryIdentity, btn('＋ 新抽奖', async function () { if (await mayLeaveLottery()) openLottery(null); })); form.appendChild(formHead);
        ui.lotteryTitle = field('抽奖标题', 'text', form); ui.lotteryDescription = field('活动说明', 'textarea', form); ui.lotteryDescription.rows = 3;
        ui.lotteryPrizes = field('奖品及库存（每行 名称|库存）', 'textarea', form); ui.lotteryPrizes.rows = 5; ui.lotteryPrizes.placeholder = '一等奖|1\n纪念奖|20';
        var dates = el('div', 'aa-grid2'); ui.lotteryStarts = field('开始时间（本地，可选）', 'datetime-local', dates); ui.lotteryEnds = field('结束时间（本地，可选）', 'datetime-local', dates); form.appendChild(dates);
        ui.lotteryStatus = field('活动状态', 'select', form, [['active', '开放参与'], ['closed', '已关闭']]); ui.lotterySave = btn('保存抽奖', saveLottery, 'primary'); form.appendChild(ui.lotterySave); view.appendChild(form);
        ui.results = el('div', 'aa-results'); ui.results.setAttribute('aria-live', 'polite'); view.appendChild(ui.results); openLottery(null);
    }
    function buildComments(view) {
        var head = el('div', 'aa-section-head'); head.append(el('h3', '', '评论审核'), btn('刷新', loadComments)); view.appendChild(head); view.appendChild(hint('审核通过后评论才会公开展示。拒绝会保留记录，删除无法撤销。'));
        var filters = el('div', 'aa-filters'); ui.commentSearch = field('搜索评论', 'search', filters); ui.commentSearch.placeholder = '昵称、正文或文章'; ui.commentFilter = field('审核状态', 'select', filters, [['', '全部评论'], ['pending', '待审核'], ['approved', '已通过'], ['rejected', '已拒绝']]);
        ui.commentSearch.addEventListener('input', renderComments); ui.commentFilter.addEventListener('change', renderComments); ui.commentsMessage = hint(''); ui.commentList = el('div', 'aa-comment-list'); view.append(filters, ui.commentsMessage, ui.commentList);
    }
    function init() {
        panel = document.getElementById('panel-articles'); if (!panel || panel.dataset.articleAdminReady) return; panel.dataset.articleAdminReady = 'true'; panel.classList.add('aa-root');
        var head = el('div', 'aa-panel-head'), title = el('h2', '', '文章与互动'); title.id = 'heading-articles'; panel.setAttribute('aria-labelledby', title.id); head.append(title, hint('写作、发布与读者互动，在这里完成。')); panel.appendChild(head);
        var tabs = el('div', 'aa-subtabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '文章管理'); ui.tabs = {}; ui.views = {};
        [['articles', '文章创作'], ['lotteries', '抽奖管理'], ['comments', '评论审核']].forEach(function (p, index) {
            var tab = btn(p[1], function () { return changeTab(p[0]); }); tab.id = 'aa-tab-' + p[0]; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(index === 0)); tab.tabIndex = index === 0 ? 0 : -1; tab.setAttribute('aria-controls', 'aa-view-' + p[0]); ui.tabs[p[0]] = tab; tabs.appendChild(tab);
            var view = el('div', 'aa-view'); view.id = 'aa-view-' + p[0]; view.setAttribute('role', 'tabpanel'); view.setAttribute('aria-labelledby', tab.id); view.hidden = index !== 0; ui.views[p[0]] = view;
        }); panel.appendChild(tabs);
        tabs.addEventListener('keydown', function (event) { var keys = Object.keys(ui.tabs), index = keys.indexOf(currentTab), next; if (event.key === 'ArrowRight') next = (index + 1) % keys.length; else if (event.key === 'ArrowLeft') next = (index + keys.length - 1) % keys.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = keys.length - 1; if (next != null) { event.preventDefault(); ui.tabs[keys[next]].focus(); changeTab(keys[next]).catch(report); } });
        ui.message = el('p', 'aa-message'); ui.message.setAttribute('role', 'status'); ui.message.setAttribute('aria-live', 'polite'); panel.appendChild(ui.message); Object.keys(ui.views).forEach(function (key) { panel.appendChild(ui.views[key]); });
        buildArticles(ui.views.articles); buildLotteries(ui.views.lotteries); buildComments(ui.views.comments); openArticle(null); loadArticles().catch(report);
        window.addEventListener('beforeunload', function (event) { if (dirty() || lotteryDirty()) { persist(); event.preventDefault(); event.returnValue = ''; } });
        document.addEventListener('visibilitychange', function () { if (document.hidden) persist(); });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && ui.workspace.classList.contains('aa-fullscreen') && !document.querySelector('dialog[open]')) ui.fullscreen.click();
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !panel.hidden && currentTab === 'articles' && !document.querySelector('dialog[open]') && event.target !== ui.content) { event.preventDefault(); saveArticle('draft').catch(report); }
        });
    }
    async function changeTab(name) {
        if (name === currentTab) return; currentTab = name;
        Object.keys(ui.tabs).forEach(function (key) { var active = key === name; ui.tabs[key].setAttribute('aria-selected', String(active)); ui.tabs[key].tabIndex = active ? 0 : -1; ui.views[key].hidden = !active; });
        if (name === 'lotteries') await loadLotteries(); else if (name === 'comments') await loadComments();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
}());
