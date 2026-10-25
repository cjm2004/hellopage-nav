/* Shared reader/editor renderer. No lottery request occurs unless interactive === true. */
(function (global) {
  'use strict';
  var renderSequence = 0;
  var allowedTags = ['p','br','hr','h1','h2','h3','h4','h5','h6','blockquote','pre','code','em','strong','del','s','a','img','ul','ol','li','table','thead','tbody','tfoot','tr','th','td','input','sup','sub','kbd'];
  var allowedAttrs = ['href','src','alt','title','width','height','colspan','rowspan','start','type','checked','disabled'];
  function text(value) { return typeof value === 'string' ? value : value == null ? '' : String(value); }
  function node(tag, className, value) {
    var result = document.createElement(tag);
    if (className) result.className = className;
    if (value !== undefined) result.textContent = text(value);
    return result;
  }
  // Markdown URLs are intentionally limited: network HTTP(S), or this origin's /media/.
  function safeURL(value, anchor) {
    var raw = text(value).trim();
    if (!raw || /[\u0000-\u0020\u007f]/.test(raw)) return '';
    if (anchor && /^#[\w\-\u0080-\uffff]+$/.test(raw)) return raw;
    try {
      var url = new URL(raw, location.origin);
      if (url.username || url.password || !/^https?:$/.test(url.protocol)) return '';
      if (/^https?:\/\//i.test(raw)) return url.href;
      if (raw.indexOf('/media/') === 0 && url.origin === location.origin && url.pathname.indexOf('/media/') === 0) return url.href;
    } catch (ignore) { /* Invalid URL. */ }
    return '';
  }
  function safeLink(a, value) {
    var url = safeURL(value, true);
    if (!url) { a.removeAttribute('href'); return; }
    a.href = url;
    if (url.charAt(0) !== '#') { a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; }
  }
  function image(value, alternative) {
    var url = safeURL(value);
    if (!url) return null;
    var img = node('img'); img.src = url; img.alt = text(alternative); img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', function () { img.hidden = true; });
    return img;
  }
  function blockError(message) { return node('p', 'hp-block-note', message); }
  function card(source) {
    var data;
    try { data = JSON.parse(source); } catch (error) { return blockError('链接卡片格式无效，请检查 JSON。'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return blockError('链接卡片格式无效。');
    var box = node('aside', 'hp-link-card');
    var img = image(data.image, ''); if (img) box.append(img);
    var copy = node('div', 'hp-link-card-copy');
    var title = node('strong', '', data.title || data.url || '链接');
    var url = safeURL(data.url);
    if (url) { var link = node('a'); safeLink(link, url); link.append(title); copy.append(link); }
    else copy.append(title);
    if (data.description) copy.append(node('p', '', data.description));
    if (url) copy.append(node('span', 'hp-card-url', new URL(url).hostname));
    box.append(copy); return box;
  }
  function media(kind, source) {
    var url = safeURL(source);
    if (!url) return blockError('媒体地址无效，仅支持 HTTP(S) 或本站 /media/ 文件。');
    var figure = node('figure', 'hp-media');
    var player = node(kind); player.controls = true; player.preload = 'none'; player.src = url;
    if (kind === 'video') player.playsInline = true;
    var caption = node('figcaption'); var fallback = node('a', '', '打开媒体文件'); safeLink(fallback, url); caption.append(fallback);
    figure.append(player, caption); return figure;
  }
  function cookieName(id) { return 'hp_lottery_' + encodeURIComponent(id).replace(/%/g, '_'); }
  function drawn(id) { return document.cookie.split(';').some(function (part) { return part.trim().indexOf(cookieName(id) + '=1') === 0; }); }
  function rememberDraw(id) { document.cookie = cookieName(id) + '=1; Max-Age=31536000; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); }
  async function request(url, options) {
    var response = await fetch(url, Object.assign({credentials: 'same-origin', headers: {'Accept':'application/json'}}, options || {}));
    var data = {}; try { data = await response.json(); } catch (ignore) { /* Retain useful HTTP error. */ }
    if (!response.ok) {
      var error = new Error(text(data.error || data.message) || (response.status === 429 ? '操作太频繁，请稍后再试。' : response.status === 404 ? '抽奖不存在或已下线。' : '请求失败，请稍后重试。'));
      error.status = response.status; throw error;
    }
    return data;
  }
  function lottery(id, interactive, context) {
    id = text(id).trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return blockError('抽奖编号无效。');
    var box = node('section', 'hp-lottery');
    var title = node('h3', '', '抽奖活动'); var label = node('p', 'hp-block-note', '活动编号：' + id);
    box.append(title, label);
    if (!interactive) { box.append(node('p', 'hp-block-note', '预览占位 · 发布页面可参与抽奖')); return box; }
    var loading = node('p', 'hp-block-note', '正在加载活动…'); box.append(loading);
    var url = '/api/lotteries/' + encodeURIComponent(id);
    function active() { return contexts.get(context.container) === context; }
    request(url, {signal: context.controller.signal}).then(function (data) {
      if (!active()) return;
      var item = data.lottery || data; loading.remove();
      title.textContent = text(item.title) || '抽奖活动';
      if (item.description) box.append(node('p', '', item.description));
      if (Array.isArray(item.prizes)) {
        var prizes = node('ul', 'hp-prizes');
        item.prizes.forEach(function (prize) { prizes.append(node('li', '', text(prize.name) + (prize.stock !== undefined ? ' · 库存 ' + text(prize.stock) : ''))); });
        box.append(prizes);
      }
      var schedule = [];
      [['startsAt','开始'],['endsAt','结束']].forEach(function (pair) { var date = new Date(item[pair[0]]); if (item[pair[0]] && !isNaN(date.getTime())) schedule.push(pair[1] + '：' + date.toLocaleString('zh-CN')); });
      if (schedule.length) box.append(node('p', 'hp-block-note', schedule.join(' / ')));
      var now = Date.now();
      if (item.status && !/^(active|published|open|running)$/i.test(item.status) || item.startsAt && new Date(item.startsAt).getTime() > now || item.endsAt && new Date(item.endsAt).getTime() < now) {
        box.append(node('p', 'hp-block-note', '活动尚未开始或已结束。')); return;
      }
      if (drawn(id)) { box.append(node('p', 'hp-block-note', '此浏览器已参与本次抽奖。')); return; }
      var form = node('form', 'hp-lottery-form');
      var nameLabel = node('label', '', '称呼'); var name = node('input'); name.name = 'name'; name.required = true; name.maxLength = 80; name.autocomplete = 'name'; nameLabel.append(name);
      var contactLabel = node('label', '', '联系方式（仅用于领奖，不公开）'); var contact = node('input'); contact.name = 'contact'; contact.required = true; contact.maxLength = 200; contact.autocomplete = 'off'; contactLabel.append(contact);
      var button = node('button', '', '参与抽奖'); button.type = 'submit';
      var result = node('p', 'hp-draw-result'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite');
      form.append(nameLabel, contactLabel, node('p', 'hp-block-note', '每个浏览器限参与一次，服务器另设频率限制；此限制不代表身份验证。'), button, result);
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (button.disabled || !form.reportValidity()) return;
        if (!name.value.trim() || !contact.value.trim()) { result.textContent = '请填写称呼和联系方式。'; return; }
        if (drawn(id)) { button.disabled = true; result.textContent = '此浏览器已参与本次抽奖。'; return; }
        button.disabled = true; result.textContent = '正在抽取…';
        try {
          var response = await request(url + '/draw', {method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body:JSON.stringify({name:name.value.trim(), contact:contact.value.trim()}), signal:context.controller.signal});
          if (!active()) return;
          rememberDraw(id);
          var prize = response.entry && response.entry.prize !== undefined ? response.entry.prize : response.prize;
          var prizeName = prize && typeof prize === 'object' ? text(prize.name || prize.title) : text(prize);
          result.textContent = prizeName ? '抽奖结果：' + prizeName : text(response.message) || '抽奖结果：未中奖，感谢参与。';
          name.value = ''; contact.value = ''; name.disabled = true; contact.disabled = true;
        } catch (error) {
          if (!active() || error.name === 'AbortError') return;
          result.textContent = error.message;
          if (error.status === 409) rememberDraw(id); else button.disabled = false;
        }
      }); box.append(form);
    }).catch(function (error) {
      if (!active() || error.name === 'AbortError') return;
      loading.textContent = error.message;
      var retry = node('button', 'hp-retry', '重新加载'); retry.type = 'button'; retry.addEventListener('click', function () { if (active()) box.replaceWith(lottery(id, true, context)); }); box.append(retry);
    }); return box;
  }
  var contexts = new WeakMap();
  function start(container) {
    var previous = contexts.get(container); if (previous) previous.controller.abort();
    var context = {container:container, controller:new AbortController()}; contexts.set(container, context);
    container.replaceChildren(); return context;
  }
  function render(container, markdown, options) {
    options = options || {};
    var context = start(container); container.classList.add('hp-rendered');
    if (!global.marked || !global.DOMPurify) { container.append(blockError('文章渲染组件未加载，请检查本地 marked 与 DOMPurify 文件。')); return {headings:[]}; }
    // A per-render parser means editor callers cannot inherit or alter global marked extensions.
    var parser = new global.marked.Marked({gfm:true, breaks:false});
    var blocks = [];
    var nonce = 'HPBLOCK' + (++renderSequence) + '-';
    if (global.crypto && global.crypto.getRandomValues) nonce += Array.from(global.crypto.getRandomValues(new Uint32Array(3))).join('-') + '-';
    // Only the block tokenizer sees this extension. Fenced/indented code is tokenized before its contents.
    parser.use({extensions:[{name:'hpblock', level:'block', start:function (src) { var found = /^(?: {0,3}:::(?:card|lottery|video|audio)\b| {0,3}\[\[lottery:)/m.exec(src); return found ? found.index : undefined; }, tokenizer:function (src) {
      function emit(kind, value, raw) {
        var index = blocks.push({kind:kind, value:value}) - 1;
        return {type:'hpblock', raw:raw, marker:nonce + index};
      }
      // Compact form: :::video URL\n:::  and :::lottery ID\n::: (no body line).
      var inline = /^ {0,3}:::(video|audio|lottery)[ \t]+([^\n]*?)[ \t]*\n {0,3}:::[ \t]*(?:\n|$)/.exec(src);
      if (inline) return emit(inline[1], inline[2].trim(), inline[0]);
      // Block form with a body, used for :::card {json} ::: and optional body payloads.
      var block = /^ {0,3}:::(card|lottery|video|audio)(?:[ \t]+([^\n]*))?[ \t]*\n([\s\S]*?)\n {0,3}:::[ \t]*(?:\n|$)/.exec(src);
      if (block) return emit(block[1], (block[1] === 'card' ? block[3] : (block[2] || block[3])).trim(), block[0]);
      var legacy = /^ {0,3}\[\[lottery:([A-Za-z0-9_-]{1,128})\]\][ \t]*(?:\n|$)/.exec(src);
      if (legacy) return emit('lottery', legacy[1], legacy[0]);
      return undefined;
    }, renderer:function (token) { return '<p>' + token.marker + '</p>\n'; }}]});
    var raw;
    try { raw = parser.parse(text(markdown), {async:false}); } catch (error) { container.append(blockError('文章内容无法解析。')); return {headings:[]}; }
    var fragment = global.DOMPurify.sanitize(raw, {ALLOWED_TAGS:allowedTags, ALLOWED_ATTR:allowedAttrs, ALLOW_DATA_ATTR:false, ALLOW_ARIA_ATTR:false, RETURN_DOM_FRAGMENT:true, FORBID_TAGS:['style','script','iframe','svg','math','form','template'], FORBID_ATTR:['style','id','name']});
    fragment.querySelectorAll('a').forEach(function (a) { safeLink(a, a.getAttribute('href')); });
    fragment.querySelectorAll('img').forEach(function (img) { var url = safeURL(img.getAttribute('src')); if (!url) { img.remove(); return; } img.src = url; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.removeAttribute('width'); img.removeAttribute('height'); });
    fragment.querySelectorAll('input').forEach(function (input) { if (input.type !== 'checkbox') input.remove(); else { input.disabled = true; input.removeAttribute('name'); } });
    // Only exact generated paragraph markers are substituted; arbitrary author HTML cannot create slots.
    fragment.querySelectorAll('p').forEach(function (p) {
      if (p.childNodes.length !== 1 || p.firstChild.nodeType !== 3 || p.textContent.indexOf(nonce) !== 0) return;
      var suffix = p.textContent.slice(nonce.length); if (!/^\d+$/.test(suffix)) return;
      var block = blocks[Number(suffix)]; if (!block) return;
      var component = block.kind === 'card' ? card(block.value) : block.kind === 'lottery' ? lottery(block.value, options.interactive === true && !options.preview, context) : media(block.kind, block.value);
      p.replaceWith(component);
    });
    var headings = [];
    fragment.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(function (heading, index) {
      heading.id = 'hp-heading-' + renderSequence + '-' + (index + 1);
      headings.push({id:heading.id, text:heading.textContent, level:Number(heading.tagName.slice(1))});
    });
    container.append(fragment);
    if (options.toc && options.toc.nodeType === 1) {
      options.toc.replaceChildren();
      if (headings.length) { options.toc.append(node('h2', '', '本文目录')); var list = node('ol'); headings.forEach(function (heading) { var item = node('li'); var link = node('a', '', heading.text); link.href = '#' + heading.id; item.append(link); list.append(item); }); options.toc.append(list); }
    }
    return {headings:headings};
  }
  function renderHTML(container, html) {
    start(container); container.classList.remove('hp-rendered');
    var parsed = new DOMParser().parseFromString(text(html), 'text/html');
    // Never carry policy/base/refresh directives or nested browsing contexts into the frame.
    parsed.querySelectorAll('meta,base,iframe,frame,frameset,object,embed,portal').forEach(function (element) { element.remove(); });
    parsed.querySelectorAll('form').forEach(function (form) { var replacement = parsed.createElement('div'); replacement.append.apply(replacement, Array.from(form.childNodes)); form.replaceWith(replacement); });
    parsed.querySelectorAll('*').forEach(function (element) {
      ['action','formaction','target','formtarget','ping','srcdoc'].forEach(function (attr) { element.removeAttribute(attr); });
      ['src','href','poster'].forEach(function (attr) {
        if (!element.hasAttribute(attr)) return;
        var value = element.getAttribute(attr).trim();
        if (value.indexOf('/media/') === 0) { var resolved = safeURL(value); if (resolved) element.setAttribute(attr, resolved); else element.removeAttribute(attr); }
        // Scriptable navigation URLs have no use in anchors; scripts remain isolated below.
        if (attr === 'href' && element.tagName === 'A') { var url = safeURL(element.getAttribute(attr), true); if (!url) element.removeAttribute(attr); else { element.setAttribute(attr,url); element.setAttribute('target','_blank'); element.setAttribute('rel','noopener noreferrer'); } }
      });
      if (element.hasAttribute('srcset')) element.removeAttribute('srcset');
    });
    var csp = parsed.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
    csp.content = "default-src 'none'; img-src https: http: data:; media-src https: http:; style-src 'unsafe-inline' https: http:; script-src 'unsafe-inline' https: http:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'";
    parsed.head.prepend(csp);
    var charset = parsed.createElement('meta'); charset.setAttribute('charset','utf-8'); csp.after(charset);
    var style = parsed.createElement('style'); style.textContent = 'html{color-scheme:light dark}body{margin:20px;font:16px/1.7 system-ui,sans-serif;overflow-wrap:anywhere}img,video,audio{max-width:100%}pre,table{max-width:100%;overflow:auto}'; parsed.head.append(style);
    var frame = node('iframe', 'hp-html-frame'); frame.title = 'HTML 文章（隔离视图）';
    frame.setAttribute('sandbox','allow-scripts allow-popups'); frame.setAttribute('referrerpolicy','no-referrer');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; clipboard-read 'none'; clipboard-write 'none'");
    // Fixed, scrollable viewport avoids trusting cross-origin postMessage height claims.
    frame.srcdoc = '<!DOCTYPE html>\n' + parsed.documentElement.outerHTML;
    container.append(frame); return frame;
  }
  global.HPArticles = Object.freeze({render:render, renderHTML:renderHTML, safeURL:safeURL});
})(window);
