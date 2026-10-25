/* 后台壁纸管理：查看、上传、修改分类/标识/标签、删除。 */
(function (global) {
  'use strict';
  var panel = global.document.getElementById('panel-wallpapers');
  if (!panel || panel.dataset.wpReady) return;
  panel.dataset.wpReady = 'true';

  function el(tag, cls, text) { var n = global.document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(msg) { if (typeof global.toast === 'function') { global.toast(msg); return; } var t = global.document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function api(method, url, body) { return fetch(url, { method: method, credentials: 'same-origin', headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || ('请求失败 ' + r.status)); return d; }); }); }

  var hint = el('p', 'panel-hint', '壁纸保存在本机数据目录，不再请求外部图片 API。分类：season 季节（key 填 spring/summer/autumn/winter）、festival 节日（key 填 newyear/chunjie 等）、rotation 每日轮换（key 留空）。');
  panel.appendChild(hint);

  var upload = el('div', 'wp-upload');
  var uploadTitle = el('h3', 'wp-sub-title', '新增壁纸');
  upload.appendChild(uploadTitle);
  var upGrid = el('div', 'wp-upload-grid');
  var cat = el('select');
  [
    ['rotation', '每日轮换 rotation'],
    ['season', '季节 season'],
    ['festival', '节日 festival']
  ].forEach(function (p) { var o = el('option'); o.value = p[0]; o.textContent = p[1]; cat.appendChild(o); });
  var keyInput = el('input'); keyInput.placeholder = 'key，例如 spring 或 newyear（轮换留空）';
  var labelInput = el('input'); labelInput.placeholder = '标签，例如 春天壁纸 01';
  var fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
  var upBtn = el('button', 'wp-btn primary', '上传');
  upGrid.append(cat, keyInput, labelInput, fileInput, upBtn);
  upload.appendChild(upGrid);
  panel.appendChild(upload);

  var grid = el('div', 'wp-grid');
  panel.appendChild(grid);
  var status = el('p', 'wp-status');
  panel.appendChild(status);

  function render(list) {
    grid.replaceChildren();
    if (!list.length) { status.textContent = '暂无壁纸，请上传。'; return; }
    status.textContent = '';
    list.forEach(function (img) {
      var card = el('div', 'wp-card');
      var thumb = el('img', 'wp-thumb');
      thumb.src = img.url; thumb.alt = img.label || img.id; thumb.loading = 'lazy';
      var body = el('div', 'wp-body');
      var label = el('input'); label.value = img.label || ''; label.placeholder = '标签';
      var csel = el('select');
      [
        ['rotation', '每日轮换'],
        ['season', '季节'],
        ['festival', '节日']
      ].forEach(function (p) { var o = el('option'); o.value = p[0]; o.textContent = p[1]; csel.appendChild(o); });
      csel.value = img.category || 'rotation';
      var key = el('input'); key.value = img.key || ''; key.placeholder = 'key';
      var actions = el('div', 'wp-actions');
      var save = el('button', 'wp-btn', '保存');
      var del = el('button', 'wp-btn danger', '删除');
      actions.append(save, del);
      body.append(label, csel, key, actions);
      card.append(thumb, body);
      grid.appendChild(card);
      save.addEventListener('click', function () {
        save.disabled = true;
        api('PUT', '/api/admin/wallpapers', JSON.stringify({ id: img.id, label: label.value.trim(), category: csel.value, key: key.value.trim() }))
          .then(function () { toast('已保存'); })
          .catch(function (e) { toast('保存失败：' + e.message); })
          .finally(function () { save.disabled = false; });
      });
      del.addEventListener('click', function () {
        if (!global.confirm('确定删除「' + (label.value || img.label || img.id) + '」吗？')) return;
        api('DELETE', '/api/admin/wallpapers?id=' + encodeURIComponent(img.id))
          .then(function () { toast('已删除'); load(); })
          .catch(function (e) { toast('删除失败：' + e.message); });
      });
    });
  }

  function load() {
    status.textContent = '正在加载…';
    api('GET', '/api/admin/wallpapers')
      .then(function (d) { render(Array.isArray(d.images) ? d.images : []); })
      .catch(function (e) { status.textContent = '加载失败：' + e.message; });
  }

  upBtn.addEventListener('click', function () {
    if (!fileInput.files || !fileInput.files.length) { toast('请选择图片文件'); return; }
    var fd = new FormData();
    fd.append('file', fileInput.files[0]);
    fd.append('category', cat.value);
    fd.append('key', keyInput.value.trim());
    fd.append('label', labelInput.value.trim());
    upBtn.disabled = true;
    api('POST', '/api/admin/wallpapers', fd)
      .then(function () { toast('上传成功'); keyInput.value = ''; labelInput.value = ''; fileInput.value = ''; load(); })
      .catch(function (e) { toast('上传失败：' + e.message); })
      .finally(function () { upBtn.disabled = false; });
  });

  load();
})(window);
