/* 后台仪表盘：主页 / 文章浏览量时间折线图。可拖动、缩放、悬停查看详情。 */
(function (global) {
  'use strict';
  var panel = global.document.getElementById('panel-dashboard');
  if (!panel || panel.dataset.dashboardReady) return;
  panel.dataset.dashboardReady = 'true';

  var COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];
  var state = { data: null, days: 30, step: 44, offsetX: 0, dragging: false, hover: null };

  function el(tag, cls, text) { var n = global.document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (s) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]; }); }

  var head = el('div', 'dash-head');
  var title = el('h2', '', '浏览量仪表盘');
  var hint = el('p', 'dash-hint', '主页与各文章的每日浏览次数。拖动画布可左右平移，滚轮缩放时间跨度，悬停节点查看详情。');
  head.append(title, hint);
  panel.appendChild(head);

  var controls = el('div', 'dash-controls');
  var daysSelect = el('select', 'dash-select');
  [['7', '近 7 天'], ['30', '近 30 天'], ['90', '近 90 天']].forEach(function (p) { var o = el('option'); o.value = p[0]; o.textContent = p[1]; daysSelect.appendChild(o); });
  daysSelect.value = '30';
  controls.appendChild(el('span', 'dash-label', '时间范围'));
  controls.appendChild(daysSelect);
  panel.appendChild(controls);

  var cards = el('div', 'dash-cards');
  panel.appendChild(cards);
  var top = el('div', 'dash-top');
  panel.appendChild(top);
  var legend = el('div', 'dash-legend');
  panel.appendChild(legend);
  var canvasWrap = el('div', 'dash-canvas-wrap');
  var canvas = el('canvas', 'dash-canvas');
  var tooltip = el('div', 'dash-tooltip');
  tooltip.hidden = true;
  canvasWrap.append(canvas, tooltip);
  panel.appendChild(canvasWrap);
  var message = el('p', 'dash-message');
  panel.appendChild(message);

  function load() {
    message.textContent = '正在加载仪表盘…';
    fetch('/api/admin/dashboard?days=' + state.days, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.data.error || '读取失败');
        state.data = res.data;
        state.offsetX = 0;
        state.hover = null;
        renderStats(res.data);
        renderLegend();
        resize();
        draw();
        message.textContent = res.data.series && res.data.series.length ? '' : '暂无浏览量数据。';
      })
      .catch(function (error) { message.textContent = '加载失败：' + error.message; });
  }

  function statCard(label, value, sub) {
    var c = el('div', 'dash-card');
    c.appendChild(el('span', 'dash-card-label', label));
    c.appendChild(el('strong', 'dash-card-value', String(value)));
    if (sub) c.appendChild(el('small', 'dash-card-sub', sub));
    return c;
  }
  function renderStats(d) {
    cards.replaceChildren();
    var v = d.views || {};
    var a = d.articles || {};
    var l = d.lotteries || {};
    cards.append(
      statCard('今日浏览', v.today || 0),
      statCard('累计浏览', v.total || 0),
      statCard('导航分组', d.groups || 0),
      statCard('导航链接', d.links || 0),
      statCard('文章', a.total || 0, '发布 ' + (a.published || 0) + ' · 草稿 ' + (a.draft || 0) + ' · 定时 ' + (a.scheduled || 0)),
      statCard('评论', d.comments || 0),
      statCard('抽奖活动', l.total || 0, '进行中 ' + (l.active || 0)),
      statCard('抽奖参与', l.entries || 0),
      statCard('壁纸', d.wallpapers || 0)
    );
    top.replaceChildren();
    var heading = el('h3', 'dash-sub-title', '浏览量 TOP');
    top.appendChild(heading);
    var list = Array.isArray(d.topPages) ? d.topPages : [];
    if (!list.length) {
      top.appendChild(el('p', 'dash-message', '暂无浏览记录'));
    } else {
      list.forEach(function (item) {
        var row = el('div', 'dash-top-row');
        row.appendChild(el('span', '', item.label));
        row.appendChild(el('strong', '', String(item.count) + ' 次'));
        top.appendChild(row);
      });
    }
  }

  function renderLegend() {
    legend.replaceChildren();
    if (!state.data || !Array.isArray(state.data.series)) return;
    state.data.series.forEach(function (series, i) {
      var item = el('div', 'dash-legend-item');
      var dot = el('span', 'dash-legend-dot');
      dot.style.background = COLORS[i % COLORS.length];
      item.append(dot, el('span', '', series.label));
      legend.appendChild(item);
    });
  }

  function resize() {
    var rect = canvasWrap.getBoundingClientRect();
    var dpr = global.devicePixelRatio || 1;
    canvas.width = Math.max(320, Math.floor(rect.width * dpr));
    canvas.height = Math.floor(340 * dpr);
    canvas.style.width = Math.max(320, Math.floor(rect.width)) + 'px';
    canvas.style.height = '340px';
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function maxCount() {
    if (!state.data) return 0;
    var max = 0;
    state.data.series.forEach(function (s) { s.points.forEach(function (p) { if (p.count > max) max = p.count; }); });
    return Math.max(max, 10);
  }

  function draw() {
    if (!state.data) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.width / (global.devicePixelRatio || 1);
    var h = canvas.height / (global.devicePixelRatio || 1);
    var left = 46, right = 14, top = 14, bottom = 28;
    var plotW = w - left - right;
    var plotH = h - top - bottom;
    var days = state.data.dates.length;
    var virtualW = days * state.step;
    var maxOffset = Math.max(0, virtualW - plotW);
    if (state.offsetX > maxOffset) state.offsetX = maxOffset;
    if (state.offsetX < 0) state.offsetX = 0;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#9aa3b2';
    ctx.strokeStyle = 'rgba(148,163,184,.35)';
    var yMax = maxCount();
    var ticks = 5;
    for (var t = 0; t <= ticks; t++) {
      var y = top + plotH * t / ticks;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + plotW, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(String(Math.round(yMax * (1 - t / ticks))), left - 8, y + 4);
    }
    var visibleStart = Math.max(0, Math.floor(state.offsetX / state.step) - 1);
    var visibleEnd = Math.min(days - 1, Math.ceil((state.offsetX + plotW) / state.step) + 1);
    ctx.textAlign = 'center';
    var labelEvery = Math.max(1, Math.ceil(62 / state.step));
    for (var i = visibleStart; i <= visibleEnd; i++) {
      if (i % labelEvery !== 0) continue;
      var x = left + i * state.step - state.offsetX;
      if (x < left - 10 || x > left + plotW + 10) continue;
      var label = state.data.dates[i].slice(5);
      ctx.fillText(label, x, h - 8);
    }
    state.hit = [];
    state.data.series.forEach(function (series, si) {
      var color = COLORS[si % COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      series.points.forEach(function (p, pi) {
        var px = left + pi * state.step - state.offsetX;
        var py = top + plotH * (1 - p.count / yMax);
        if (pi === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.fillStyle = color;
      series.points.forEach(function (p, pi) {
        var px = left + pi * state.step - state.offsetX;
        var py = top + plotH * (1 - p.count / yMax);
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
        state.hit.push({ x: px, y: py, pi: pi, si: si, point: p, series: series, color: color });
      });
    });
    if (state.hover && state.hover.visible) drawTooltip(state.hover.item);
  }

  function hitTest(px, py) {
    if (!state.hit) return null;
    var best = null, bestD = 14;
    for (var i = 0; i < state.hit.length; i++) {
      var h = state.hit[i];
      if (h.x < 46 || h.x > canvas.width / (global.devicePixelRatio || 1) - 14) continue;
      var d = Math.abs(h.x - px) + Math.abs(h.y - py);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  function drawTooltip(item) {
    if (!item) { tooltip.hidden = true; return; }
    tooltip.hidden = false;
    tooltip.style.borderLeftColor = item.color;
    tooltip.replaceChildren(
      el('strong', '', item.series.label),
      el('span', '', item.point.date + ' · ' + item.point.count + ' 次浏览')
    );
    var rect = canvasWrap.getBoundingClientRect();
    var x = item.x - rect.left + 14;
    var y = item.y - rect.top + 14;
    tooltip.style.left = Math.min(x, rect.width - 180) + 'px';
    tooltip.style.top = Math.max(8, y - 44) + 'px';
  }

  daysSelect.addEventListener('change', function () { state.days = parseInt(daysSelect.value, 10); load(); });
  global.addEventListener('resize', resize);

  canvas.addEventListener('pointerdown', function (event) {
    state.dragging = true; canvas.setPointerCapture(event.pointerId); state.lastX = event.clientX;
  });
  canvas.addEventListener('pointermove', function (event) {
    if (state.dragging) {
      var dx = event.clientX - state.lastX; state.lastX = event.clientX;
      state.offsetX = Math.max(0, Math.min(state.offsetX - dx, Math.max(0, state.data.dates.length * state.step - (canvas.width / (global.devicePixelRatio || 1) - 46 - 14))));
      state.hover = null; tooltip.hidden = true; draw(); return;
    }
    var rect = canvas.getBoundingClientRect();
    var item = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    state.hover = { item: item, visible: true };
    drawTooltip(item);
  });
  canvas.addEventListener('pointerup', function () { state.dragging = false; });
  canvas.addEventListener('pointerleave', function () { if (!state.dragging) { tooltip.hidden = true; state.hover = null; } });
  canvas.addEventListener('wheel', function (event) {
    event.preventDefault();
    var factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    state.step = Math.max(14, Math.min(90, state.step * factor));
    draw();
  }, { passive: false });

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', load); else load();
})(window);