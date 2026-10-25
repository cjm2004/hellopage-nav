/* Public article listing and detail reader. */
(function (global) {
  'use strict';
  try {
    fetch('/api/data').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && d.siteConfig && d.siteConfig.themeColor && window.HP_THEMES && window.HP_THEMES[d.siteConfig.themeColor] && window.applyThemeColor) window.applyThemeColor(d.siteConfig.themeColor);
    }).catch(function () {});
  } catch (ignore) {}
  function text(value) { return value == null ? '' : String(value); }
  function esc(value) {
    return text(value).replace(/[&<>"']/g, function (s) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s];
    });
  }
  async function request(url, options) {
    var response = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Accept': 'application/json' } }, options || {}));
    var data = {};
    try { data = await response.json(); } catch (ignore) { /* Keep status fallback. */ }
    if (!response.ok) {
      var error = new Error(text(data.error || data.message) || (response.status === 404 ? '内容不存在或已下线' : '请求失败，请稍后重试'));
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function emptyState(container, message) {
    container.replaceChildren();
    var p = document.createElement('p');
    p.className = 'article-status';
    p.textContent = message;
    container.append(p);
  }
  function slugFromPath() {
    var path = location.pathname;
    var prefix = '/articles/';
    if (path.indexOf(prefix) !== 0) return '';
    var slug = path.slice(prefix.length);
    try { return decodeURIComponent(slug); } catch (ignore) { return ''; }
  }
  function dateText(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return text(value);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function renderList(container, items) {
    container.replaceChildren();
    if (!items.length) { emptyState(container, '暂无已发布文章。'); return; }
    var fragment = document.createDocumentFragment();
    items.forEach(function (article) {
      var card = document.createElement('article');
      card.className = 'article-card';
      var cover = document.createElement('img');
      cover.className = 'article-card-cover';
      cover.alt = '';
      if (article.cover && window.HPArticles && HPArticles.safeURL(article.cover)) {
        cover.src = HPArticles.safeURL(article.cover);
        cover.loading = 'lazy';
      } else {
        cover.removeAttribute('src');
        cover.style.visibility = 'hidden';
      }
      var content = document.createElement('div');
      content.className = 'article-card-content';
      var heading = document.createElement('h2');
      var link = document.createElement('a');
      link.href = '/articles/' + encodeURIComponent(article.slug || '');
      link.textContent = article.title || '未命名文章';
      heading.append(link);
      content.append(heading);
      if (article.summary) {
        var p = document.createElement('p');
        p.textContent = article.summary;
        content.append(p);
      }
      var date = document.createElement('div');
      date.className = 'article-card-date';
      date.textContent = dateText(article.publishAt || article.createdAt);
      content.append(date);
      card.append(cover, content);
      fragment.append(card);
    });
    container.append(fragment);
  }
  function setupListing() {
    var list = document.getElementById('article-list');
    var status = document.getElementById('article-status');
    var search = document.getElementById('article-search');
    if (!list) return false;
    var items = [];
    status.textContent = '正在加载…';
    request('/api/articles').then(function (data) {
      items = Array.isArray(data.articles) ? data.articles : [];
      renderList(list, items);
      status.textContent = '';
    }).catch(function (error) {
      status.textContent = error.message;
      var retry = document.createElement('button');
      retry.className = 'article-retry';
      retry.type = 'button';
      retry.textContent = '重新加载';
      retry.addEventListener('click', function () { setupListing(); });
      status.append(document.createTextNode(' '), retry);
    });
    if (search) search.addEventListener('input', function () {
      var query = search.value.trim().toLowerCase();
      renderList(list, query ? items.filter(function (article) {
        return text(article.title).toLowerCase().indexOf(query) >= 0 || text(article.summary).toLowerCase().indexOf(query) >= 0;
      }) : items);
    });
    return true;
  }
  function setupDetail() {
    var slug = slugFromPath();
    var status = document.getElementById('article-status');
    var notice = document.getElementById('article-notice');
    var hero = document.getElementById('article-hero');
    var body = document.getElementById('article-body');
    if (!slug || !status || !body) return false;
    status.textContent = '正在加载…';
    var preview = new URLSearchParams(location.search).get('preview') === '1';
    var url = '/api/articles/' + encodeURIComponent(slug) + (preview ? '?preview=1' : '');
    request(url).then(function (data) {
      var article = data.article || data;
      if (!article || article.slug === undefined) throw new Error('文章数据无效');
      document.title = text(article.title) + ' · 文章';
      document.getElementById('article-title').textContent = article.title || '';
      document.getElementById('article-summary').textContent = article.summary || '';
      document.getElementById('article-meta').textContent = [dateText(article.publishAt || article.createdAt), article.commentsEnabled ? '评论已开启' : ''].filter(Boolean).join(' · ');
      var cover = document.getElementById('article-cover');
      if (article.cover && window.HPArticles && HPArticles.safeURL(article.cover)) { cover.src = HPArticles.safeURL(article.cover); cover.hidden = false; }
      hero.hidden = false;
      status.textContent = '';
      if (preview) {
        notice.hidden = false;
        notice.className = 'article-notice';
        notice.textContent = '草稿/隐藏预览：此页面仅登录管理员可见。';
      } else {
        notice.hidden = true;
      }
      if (article.format === 'html') {
        HPArticles.renderHTML(body, article.content);
      } else {
        HPArticles.render(body, article.content, { interactive: true, toc: document.getElementById('article-toc') });
      }
      setupComments(article);
    }).catch(function (error) {
      status.textContent = error.message;
    });
    return true;
  }
  function setupComments(article) {
    var section = document.getElementById('article-comments');
    var list = document.getElementById('comment-list');
    var form = document.getElementById('comment-form');
    if (!section || !article.commentsEnabled) return;
    section.hidden = false;
    form.hidden = false;
    function load() {
      request('/api/articles/' + encodeURIComponent(article.slug) + '/comments').then(function (data) {
        list.replaceChildren();
        var comments = Array.isArray(data.comments) ? data.comments : [];
        if (!comments.length) { var p = document.createElement('p'); p.className = 'article-status'; p.textContent = '还没有评论。'; list.append(p); return; }
        comments.forEach(function (comment) {
          var item = document.createElement('div');
          item.className = 'comment-item';
          var strong = document.createElement('strong');
          strong.textContent = comment.name || '匿名';
          var p = document.createElement('p');
          p.textContent = comment.content || '';
          item.append(strong, p);
          list.append(item);
        });
      }).catch(function (error) { list.replaceChildren(); list.append(document.createTextNode(error.message)); });
    }
    load();
    var feedback = document.getElementById('comment-feedback');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = document.getElementById('comment-name').value.trim();
      var content = document.getElementById('comment-content').value.trim();
      if (!name || !content) { feedback.textContent = '请填写称呼和评论内容。'; return; }
      var button = form.querySelector('button');
      button.disabled = true;
      feedback.textContent = '正在提交…';
      request('/api/articles/' + encodeURIComponent(article.slug) + '/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, content: content })
      }).then(function () {
        feedback.textContent = '评论已提交，审核通过后将公开显示。';
        document.getElementById('comment-name').value = '';
        document.getElementById('comment-content').value = '';
      }).catch(function (error) {
        feedback.textContent = error.message;
      }).finally(function () { button.disabled = false; });
    });
  }
  if (setupListing() || setupDetail()) {
    /* Recognized page. */
  }
})(window);