/* fnOS update manager integration（多更新源 + GitHub 兜底）。
   Config: app_key=hellopage, current version 由服务端 TRIM_APPVER 注入。 */
(function (global) {
  'use strict';
  var CONFIG = {
    appName: 'HelloPage 导航',
    appKey: 'hellopage',
    currentVersion: '1.0.0',
    channel: 'stable'
  };

  function versionCompare(a, b) {
    var pa = String(a || '0').replace(/^v/, '').split('.').map(Number);
    var pb = String(b || '0').replace(/^v/, '').split('.').map(Number);
    var len = Math.max(pa.length, pb.length);
    for (var i = 0; i < len; i++) {
      var x = isFinite(pa[i]) ? pa[i] : 0;
      var y = isFinite(pb[i]) ? pb[i] : 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function buildCheckURL() {
    // 走本站后端代理，避免浏览器跨域；后端并行探测多个更新源。
    return '/api/update/check';
  }

  function openURL(url) {
    if (!url) return;
    try {
      global.open(url, '_blank', 'noopener,noreferrer');
    } catch (ignore) {
      try {
        var a = global.document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        global.document.body.appendChild(a); a.click(); a.remove();
      } catch (e2) {}
    }
  }

  function el(tag, cls, text) {
    var node = global.document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function showModal(data, forced) {
    var existing = global.document.getElementById('hp-update-modal');
    if (existing) existing.remove();

    var overlay = el('div', 'hp-update-overlay');
    overlay.id = 'hp-update-modal';
    var panel = el('div', 'hp-update-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'hp-update-title');

    var title = el('h2', '', '发现新版本');
    title.id = 'hp-update-title';

    var version = data.version || (data.github && data.github.version) || '';
    var content = el('p', 'hp-update-content');
    content.textContent = '检测到 ' + CONFIG.appName + ' 有新版本 v' + version + '，' +
      (forced ? '更新后才能继续使用。' : '是否立即更新？');

    var notes = el('p', 'hp-update-notes');
    notes.textContent = data.release_notes || data.error || '';

    var meta = el('p', 'hp-update-notes');
    meta.style.marginBottom = '14px';
    if (data.github && data.github.version) {
      meta.textContent = 'GitHub 最新版本：v' + data.github.version;
    }

    var actions = el('div', 'hp-update-actions');
    var link = data.direct_url || data.cloud_url || '';
    if (data.github_only && !link) link = (data.github && data.github.url) || '';

    var primary = el('button', 'hp-update-btn primary');
    if (data.github_only) {
      primary.textContent = '前往 GitHub 下载';
      primary.addEventListener('click', function () {
        openURL((data.github && data.github.url) || link);
      });
    } else if (data.direct_url) {
      primary.textContent = '立即下载';
      primary.addEventListener('click', function () { openURL(data.direct_url); });
    } else if (link) {
      primary.textContent = '前往下载页';
      primary.addEventListener('click', function () { openURL(link); });
    } else {
      primary.textContent = '知道了';
      primary.addEventListener('click', function () { overlay.remove(); });
    }
    actions.appendChild(primary);

    if (!forced) {
      var later = el('button', 'hp-update-btn', '稍后');
      later.addEventListener('click', function () { overlay.remove(); });
      actions.appendChild(later);
    }

    panel.append(title, content, notes, meta, actions);
    overlay.appendChild(panel);
    if (!forced) {
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) overlay.remove();
      });
    }
    global.document.body.appendChild(overlay);
  }

  async function check() {
    try {
      var response = await fetch(buildCheckURL(), {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        var message = '更新服务返回 ' + response.status;
        try {
          var failure = await response.json();
          if (failure && failure.error) message = failure.error;
        } catch (ignore) {}
        throw new Error(message);
      }
      var data = await response.json();
      if (data.current_version) CONFIG.currentVersion = data.current_version;
      var min = data.min_version;
      var forced = data.update_mode === 'forced' ||
        (min && versionCompare(CONFIG.currentVersion, min) < 0);
      var available = !!(data.update_available || forced);
      if (available) showModal(data, forced);
      return { available: available, forced: forced, data: data };
    } catch (error) {
      return { error: (error && error.message) ? error.message : '网络错误' };
    }
  }

  global.hpCheckUpdate = check;
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})(window);
