/* Shared theme palette, mode and CSS-variable applier. */
(function (global) {
  'use strict';
  if (global.__hpThemeLoaded) return;
  global.__hpThemeLoaded = true;

  var THEMES = {
    indigo: { name: '靛紫', accent: '#6366f1', accent2: '#8b5cf6' },
    blue:   { name: '海蓝', accent: '#2563eb', accent2: '#0ea5e9' },
    teal:   { name: '青碧', accent: '#0d9488', accent2: '#14b8a6' },
    green:  { name: '翠绿', accent: '#16a34a', accent2: '#65a30d' },
    amber:  { name: '暖橙', accent: '#f59e0b', accent2: '#f97316' },
    rose:   { name: '玫红', accent: '#e11d48', accent2: '#ec4899' },
    slate:  { name: '石墨', accent: '#475569', accent2: '#64748b' }
  };
  global.HP_THEMES = THEMES;
  global.HP_THEME_MODES = { light: '白天', dark: '黑暗', system: '跟随系统' };

  var currentColor = 'indigo';
  var currentMode = 'system';

  function hexToRgb(hex) {
    var value = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (value.length === 3) value = value.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(value, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgbString(hex, alpha) { return 'rgba(' + hexToRgb(hex).join(', ') + ', ' + alpha + ')'; }
  function mix(hexA, hexB, weightB) {
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    return '#' + a.map(function (v, i) {
      var m = Math.round(v + (b[i] - v) * weightB);
      return m.toString(16).padStart(2, '0');
    }).join('');
  }
  function effectiveDark(mode) {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  global.applyThemeMode = function (mode) {
    if (!/^(light|dark|system)$/.test(mode)) mode = 'system';
    currentMode = mode;
    var dark = effectiveDark(mode);
    global.document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { global.localStorage.setItem('hp_theme_mode', mode); } catch (ignore) {}
    global.applyThemeColor(currentColor);
    return { mode: mode, dark: dark };
  };
  global.getThemeMode = function () { return currentMode; };
  global.cycleThemeMode = function () {
    var next = currentMode === 'light' ? 'dark' : (currentMode === 'dark' ? 'system' : 'light');
    return global.applyThemeMode(next);
  };

  global.applyThemeColor = function (key) {
    var theme = THEMES[key] || THEMES.indigo;
    currentColor = theme.accent === THEMES.indigo.accent && key !== 'indigo' ? currentColor : (THEMES[key] ? key : currentColor);
    var dark = effectiveDark(currentMode);
    var root = global.document.documentElement;
    var rgb = hexToRgb(theme.accent);
    var rgb2 = hexToRgb(theme.accent2);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-2', theme.accent2);
    root.style.setProperty('--accent-rgb', rgb.join(', '));
    root.style.setProperty('--accent-2-rgb', rgb2.join(', '));
    root.style.setProperty('--accent-soft', rgbString(theme.accent, dark ? 0.26 : 0.14));
    root.style.setProperty('--accent-faint', rgbString(theme.accent, dark ? 0.16 : 0.08));
    if (dark) {
      root.style.setProperty('--glass-bg', rgbString(mix('#111827', theme.accent, 0.10), 0.78));
      root.style.setProperty('--glass-border', rgbString(mix('#1f2937', theme.accent, 0.18), 0.85));
      root.style.setProperty('--control-bg', rgbString(mix('#111827', theme.accent, 0.08), 0.86));
      root.style.setProperty('--page-bg', mix('#0f1522', theme.accent, 0.08));
      root.style.setProperty('--page-bg-2', mix('#141b2e', theme.accent2, 0.08));
    } else {
      root.style.setProperty('--glass-bg', rgbString(mix('#ffffff', theme.accent, 0.08), 0.55));
      root.style.setProperty('--glass-border', rgbString(mix('#ffffff', theme.accent, 0.22), 0.7));
      root.style.setProperty('--control-bg', rgbString(mix('#ffffff', theme.accent, 0.05), 0.72));
      root.style.setProperty('--page-bg', mix('#eef0f8', theme.accent, 0.10));
      root.style.setProperty('--page-bg-2', mix('#e8ebf8', theme.accent2, 0.10));
    }
    try { global.localStorage.setItem('hp_theme', currentColor); } catch (ignore) {}
    return theme;
  };
  global.updateThemeModeButton = function (button) {
    if (!button) return;
    var label = global.HP_THEME_MODES[currentMode] || '跟随系统';
    button.textContent = '外观：' + label;
    button.setAttribute('aria-label', '切换外观模式');
  };

  if (global.matchMedia) {
    var mq = global.matchMedia('(prefers-color-scheme: dark)');
    var onSystemChange = function () { if (currentMode === 'system') global.applyThemeMode('system'); };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }
  try { currentMode = global.localStorage.getItem('hp_theme_mode') || 'system'; } catch (ignore) {}
  try { currentColor = global.localStorage.getItem('hp_theme') || 'indigo'; } catch (ignore) {}
  global.applyThemeMode(currentMode);
})(window);