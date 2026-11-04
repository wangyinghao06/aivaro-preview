/* Aivaro 导航站 · 数据驱动渲染与交互（原创实现） */
'use strict';

const CATEGORIES = [
  { id: 'free',       name: '免费 AI API',    desc: '有免费额度（以官网为准）' },
  { id: 'lowcost',    name: '低价 AI API',    desc: '已核实单价低于官方价' },
  { id: 'discount_labeled', name: '标注折扣', desc: '服务商自标原价与折扣价，未经官方价锚点核实' },
  { id: 'claude',     name: 'Claude 中转',    desc: '主打 Anthropic 模型' },
  { id: 'openai',     name: 'OpenAI 中转',    desc: '主打 GPT 系列模型' },
  { id: 'gemini',     name: 'Gemini 中转',    desc: '主打 Google 模型' },
  { id: 'aggregator', name: '多模型聚合',     desc: '一家接入多个厂商' },
  { id: 'tools',      name: '开发工具与资源', desc: '导航与周边工具' },
];

const UNKNOWN = '<span class="unknown">待核实</span>';

/* 模型家族：由已核实的厂商名单推导（编辑口径，见关于页「数据口径」） */
const FAMILY_ORDER = ['Claude', 'GPT', 'Gemini', 'DeepSeek', 'Grok', '国产模型', '其他'];
function vendorFamily(v) {
  const s = String(v || '');
  if (/anthropic/i.test(s)) return 'Claude';
  if (/openai/i.test(s)) return 'GPT';
  if (/google/i.test(s)) return 'Gemini';
  if (/deepseek/i.test(s)) return 'DeepSeek';
  if (/xai/i.test(s)) return 'Grok';
  if (/(qwen|通义|智谱|glm|moonshot|kimi|混元|百度|baai|阶跃|bytedance|豆包|minimax|z\.ai|月之暗面)/i.test(s)) return '国产模型';
  return '其他';
}
function familiesOf(svc) {
  const set = new Set((svc.vendors || []).map(vendorFamily));
  return FAMILY_ORDER.filter(f => set.has(f));
}

/* 服务商站点图标（本站自托管的 data URI 映射，采集自各站官网自身声明的 icon）：
   与数据并行取；文件缺失/取不到/条目缺失一律降级为字母块，行为与无图标时一致。
   例外（2026-11-04）：freemodel、aitokensflux-com 两家官网仅返回空 SVG、无真实图标，
   其条目使用本站自绘的统一占位图（灰色地球线条 SVG），非其官方图标，明细见 data-build/icon-log.md。 */
let ICONS = {};
const _iconsPromise = fetch('assets/icons.json')
  .then(res => (res.ok ? res.json() : {}))
  .catch(() => ({}))
  .then(map => { ICONS = map || {}; return ICONS; });

function logoTileHTML(svc) {
  const initial = esc(String(svc.name || '?').trim().charAt(0).toUpperCase());
  const icon = ICONS[svc && svc.id];
  if (!icon) return '<span class="logo-tile" aria-hidden="true">' + initial + '</span>';
  return '<span class="logo-tile has-icon" aria-hidden="true">' +
    '<span class="logo-letter">' + initial + '</span>' +
    '<img class="logo-img" src="' + icon + '" alt="" loading="lazy" ' +
    'onerror="this.parentNode.classList.remove(\'has-icon\');this.remove()"></span>';
}

let _dataPromise = null;
function loadData() {
  if (!_dataPromise) {
    const dataP = fetch('data/services.json').then(res => {
      if (!res.ok) throw new Error('数据加载失败: ' + res.status);
      return res.json();
    });
    /* 等图标映射就绪后再交数据给渲染层（图标失败不阻塞、不报错） */
    _dataPromise = Promise.all([dataP, _iconsPromise]).then(([data]) => data);
  }
  return _dataPromise;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtUsd(n) {
  if (n == null) return '—';
  return '$' + (Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, '').replace(/\.$/, ''));
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}

/* 该服务已核实的最低美元输入价对应的价格记录（含模型名）；无则 null */
function minUsdPriceRec(svc) {
  const usd = (svc.prices || []).filter(p => p.currency === 'USD' && p.input != null);
  if (!usd.length) return null;
  return usd.reduce((a, b) => (b.input < a.input ? b : a));
}
/* 该服务已核实的最低美元输入价（每 1M tokens）；无则 null */
function minUsdInput(svc) {
  const rec = minUsdPriceRec(svc);
  return rec ? rec.input : null;
}
/* 价格记录的模型名（label 优先；两者皆缺按缺失处理，不编造） */
function priceModelName(rec) {
  if (!rec) return '';
  return rec.model_label || rec.model_id || '对应模型名待核实';
}

function freeLabel(svc) {
  if (!svc.free_quota) return UNKNOWN;
  if (svc.free_quota.has === true) return esc(svc.free_quota.text);
  if (svc.free_quota.has === false) return '无（官网未提供免费层）';
  return UNKNOWN;
}

/* 免费类型细分（2026-11-04 第十四轮定版定义）：依已核实的 free_quota 原文逐家归类，一家可多型；
   长期免费＝以量/价计量且持续有效（零价模型可持续调用、长期免费套餐/额度）；
   注册赠送＝与注册绑定的一次性赠额；限次＝以次数计量（每日/每月/总计 N 次，含每日刷新型，如 OpenRouter 每日 50 次）；
   free_kinds 缺失即不渲染，不臆测补标 */
const FREE_KIND_LABELS = [
  ['long_term', '长期免费'],
  ['signup_credit', '注册赠送'],
  ['limited', '限次'],
];
function freeKindBadgesHTML(svc) {
  const kinds = (svc && svc.free_kinds) || [];
  if (!kinds.length) return '';
  return FREE_KIND_LABELS.filter(([k]) => kinds.includes(k))
    .map(([, label]) => '<span class="badge fkind">' + label + '</span>').join('');
}

/* 价格分层（2026-11-04 第十九轮）：price_tier = 该站 Sonnet 价格相对官方价比例的分层
   （略低 70%–100% / 明显低 30%–70% / 异常低价 <30%），口径见关于页。
   第二十轮口径修正：异常低价警示与分层/入选脱钩——任一锚点模型比例 <30% 即显示警示，
   与「价格不一致」无关（不一致仅决定是否入低价列表）；分层角标（略低/明显低）仍不在
   不一致条目上展示，避免被读作低价背书 */
function hasAbnormalPrice(svc) {
  const pr = (svc && svc.price_ratio) || {};
  return Object.values(pr).some(v => v && typeof v.ratio === 'number' && v.ratio < 0.3);
}
function tierBadgeHTML(svc) {
  if (!svc) return '';
  if (hasAbnormalPrice(svc)) return '<span class="badge tier abn">异常低价 · 注意风险</span>';
  if (!svc.price_tier || svc.price_consistency === 'inconsistent') return '';
  return '<span class="badge tier">' + esc(svc.price_tier) + '</span>';
}

function listOrUnknown(arr) {
  if (!arr || !arr.length) return UNKNOWN;
  return arr.map(esc).join('、');
}

function statusDot(svc) {
  const ok = svc.status === '官网可打开';
  return '<span class="dot ' + (ok ? 'ok' : 'warn') + '" aria-hidden="true"></span>';
}

/* ============ 服务卡片（条件渲染：无数据字段整项不出现） ============
   行序对标真机截图的卡内信息组织：方形字标位＋名称/域名＋起充右对齐 → 简介 →
   模型 chips → 标签（免费额度用橙字语义） → 支付/价格 → 状态行＋绿分段条 → 双按钮。
   分段条呈现的是本站真实字段「信息完整度」（已核实核心字段占比），不是可用性探测，
   卡上带文字口径，绝不冒充可用性。单价摘要与核实时间为 Aivaro 数据增补。 */
function segbarHTML(svc) {
  const total = 7, n = completeness(svc);
  const segs = 14, on = Math.round(segs * n / total);
  let bars = '';
  for (let i = 0; i < segs; i++) bars += '<i class="' + (i < on ? 'on' : '') + '"></i>';
  return '<div class="segbar' + (isAbnormal(svc) ? ' warn' : '') + '" aria-hidden="true">' + bars + '</div>' +
    '<div class="segbar-cap">信息完整度 ' + n + '/' + total + '（已核实字段占比，非可用性探测）</div>';
}

/* ============ 数据时效（按 verified_at 计算；阈值为配置常量） ============
   整体时效：核实超过 STALE_DAYS 天 → 条目「可能已过期」：卡片/详情标记 + 变灰 + 目录排序降权；
   免费时效：免费额度超过 FREE_STALE_DAYS 天未复核 → 免费字段旁单独标「可能已过期」。 */
const FRESHNESS = { STALE_DAYS: 14, FREE_STALE_DAYS: 7 };
function ageDays(dateStr) {
  if (!dateStr) return Infinity;
  const t = new Date(dateStr + 'T00:00:00');
  if (isNaN(t)) return Infinity;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - t) / 86400000);
}
function isStale(svc) { return ageDays(svc && svc.verified_at) > FRESHNESS.STALE_DAYS; }
function isFreeStale(svc) { return ageDays(svc && svc.verified_at) > FRESHNESS.FREE_STALE_DAYS; }
function staleBadgeHTML(svc) { return isStale(svc) ? '<span class="stale-badge">可能已过期</span>' : ''; }
function freeStaleTagHTML(svc) {
  return (isFreeStale(svc) && svc.free_quota && (svc.free_quota.has === true || svc.free_quota.trial))
    ? '<span class="stale-tag">可能已过期</span>' : '';
}

function cardHTML(svc, opts) {
  opts = opts || {};
  const minRec = minUsdPriceRec(svc);
  const min = minRec ? minRec.input : null;
  const priceLine = svc.type === '导航站'
    ? '<div>导航站本身不售卖 API</div>'
    : (min != null
        ? '<div>已核实最低输入价 <b>' + fmtUsd(min) + '</b> / 1M tokens 起（对应模型：' + esc(priceModelName(minRec)) + '）</div>'
        : '<div>价格待核实</div>');
  /* 起充：短值放卡片右上角（对标行序），长口径留在 meta 行 */
  const topupShort = svc.min_topup && svc.min_topup.length <= 10 ? svc.min_topup : '';
  const topupLine = svc.min_topup && !topupShort
    ? '<div>起充：<b>' + esc(svc.min_topup) + '</b></div>' : '';
  const freeBadge = svc.free_quota && svc.free_quota.has === true
    ? '<span class="badge bonus">有免费额度</span>' : '';
  const rec = svc.recommended
    ? '<span class="tip"><button type="button" aria-label="推荐理由"><span class="badge rec">推荐</span></button>' +
      '<span class="tip-body">推荐理由：' + esc(svc.recommend_reason || '') + '</span></span>'
    : '';
  const comBadge = svc.is_commercial ? '<span class="badge com">商业合作</span>' : '';
  /* 标注折扣（第十四轮）：自标折扣证据等级，与「低价」严格分开，不共用文案 */
  const discBadge = (svc.categories || []).includes('discount_labeled') ? '<span class="badge disc">标注折扣</span>' : '';
  const navBadge = svc.type === '导航站' ? '<span class="badge nav">同类导航站</span>' : '';
  const isNew = opts.newIds && opts.newIds.has(svc.id) ? '<span class="badge new">NEW</span>' : '';
  const freeStale = freeStaleTagHTML(svc);
  const kindBadges = freeKindBadgesHTML(svc);
  const tierBadge = tierBadgeHTML(svc);
  const labelRow = (isNew || rec || comBadge || discBadge || navBadge || freeBadge || kindBadges || tierBadge || freeStale)
    ? '<div class="labelrow">' + isNew + rec + comBadge + discBadge + navBadge + freeBadge + kindBadges + tierBadge + freeStale + '</div>' : '';
  const models = svc.models_highlight || [];
  const shown = models.slice(0, 4);
  const more = models.length - shown.length;
  const modelChips = shown.map(m => '<span class="chip grey">' + esc(m) + '</span>').join('') +
    (more > 0 ? '<span class="chip more">+' + more + ' 个模型</span>' : '');
  const payRow = (svc.payments && svc.payments.length)
    ? '<div class="payrow"><span class="payrow-h">支付</span>' +
      svc.payments.map(p => '<span class="pay">' + esc(p) + '</span>').join('') + '</div>'
    : (svc.type === '导航站' ? '' : '<div class="payrow"><span class="payrow-h">支付</span><span>支付方式待核实</span></div>');
  const metaInner = priceLine + topupLine + payRow;
  return '<article class="card' + (isStale(svc) ? ' stale' : '') + '">' +
    '<div class="card-top">' + logoTileHTML(svc) +
    '<div class="card-id"><h3><a href="detail.html?id=' + encodeURIComponent(svc.id) + '">' + esc(svc.name) + '</a></h3>' +
    '<div class="domain">' + esc(hostOf(svc.website)) + ' · ' + esc(svc.op_type || svc.type) + '</div></div>' +
    (topupShort ? '<span class="topup">' + esc(topupShort) + '</span>' : '') + '</div>' +
    '<p class="tag">' + esc(svc.tagline) + '</p>' +
    (modelChips ? '<div class="chips">' + modelChips + '</div>' : '') +
    labelRow +
    (metaInner ? '<div class="meta">' + metaInner + '</div>' : '') +
    '<div class="status-block"><span class="statusline">' + statusDot(svc) + esc(svc.status) + ' · 核实于 ' + esc(svc.verified_at) + '</span>' + staleBadgeHTML(svc) +
    segbarHTML(svc) + '</div>' +
    '<div class="card-actions">' +
      '<a class="go" href="detail.html?id=' + encodeURIComponent(svc.id) + '">详情</a>' +
      '<a class="go site" href="go.html?id=' + encodeURIComponent(svc.id) + '" target="_blank" rel="noopener">访问官网</a>' +
    '</div>' +
    '</article>';
}

/* ============ 广告位（与自然收录严格隔离：不进筛选/排序/计数） ============
   已售广告卡用独立字段集（ad_slots：name/domain/intro/url），不带核实/状态/单价；
   未售满时用招商占位卡补足首排，占位卡整卡链接到广告合作页。 */
function adRowHTML(data) {
  const cfg = data.ads;
  if (!cfg || !cfg.enabled) return '';
  /* 无广告主时目录不展示招商占位（系统与配置保留；有售出后按 taken<total 渲染剩余席位占位） */
  if (!(cfg.seats_taken > 0)) return '';
  const slots = data.ad_slots || [];
  const taken = Math.min(cfg.seats_taken || 0, slots.length);
  const open = Math.max(0, (cfg.seats_total || 0) - taken);
  let html = '';
  for (let i = 0; i < taken; i++) {
    const a = slots[i];
    html += '<article class="ad-card sold"><span class="ad-tag">广告</span>' +
      '<p class="ad-name">' + esc(a.name) + '</p>' +
      '<div class="ad-dom">' + esc(a.domain) + '</div>' +
      '<p class="ad-intro">' + esc(a.intro) + '</p>' +
      '<a class="btn ad-go" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer sponsored">访问官网</a></article>';
  }
  for (let i = 0; i < open; i++) {
    html += '<a class="ad-card" href="advertise.html" aria-label="广告招商"><span class="ad-tag">广告招商</span>' +
      '<span class="ad-empty"><b>招商中</b><span>目录第一排 · 还剩 ' + open + ' 个席位</span></span></a>';
  }
  return html;
}

/* 核实完整度：核心字段中已核实到的项数（用于综合排序的代偿维度，口径见关于页） */
function completeness(svc) {
  let n = 0;
  if ((svc.prices || []).length) n++;
  if ((svc.payments || []).length) n++;
  if (svc.free_quota && svc.free_quota.has !== null && svc.free_quota.has !== undefined) n++;
  if (svc.registration) n++;
  if ((svc.api_formats || []).length) n++;
  if (svc.min_topup) n++;
  if (svc.model_count) n++;
  return n;
}
function isAbnormal(svc) { return svc.status !== '官网可打开'; }
/* 综合排序键：异常沉底 → 核实完整度 → 支付覆盖 → 模型覆盖（厂商数） → 名称 */
function compositeCompare(a, b) {
  const ab = isAbnormal(a) ? 1 : 0, bb = isAbnormal(b) ? 1 : 0;
  if (ab !== bb) return ab - bb;
  const c = completeness(b) - completeness(a);
  if (c) return c;
  const p = (b.payments || []).length - (a.payments || []).length;
  if (p) return p;
  const v = (b.vendors || []).length - (a.vendors || []).length;
  if (v) return v;
  return a.name.localeCompare(b.name, 'zh');
}

/* 收录 7 天内（以数据核实日为基准）视为 NEW */
function newIdSet(services, refDate) {
  const ref = new Date(refDate + 'T00:00:00');
  const set = new Set();
  services.forEach(s => {
    const d = new Date(s.added_at + 'T00:00:00');
    const days = Math.round((ref - d) / 86400000);
    if (days >= 0 && days <= 7) set.add(s.id);
  });
  return set;
}

/* ============ 主题：默认跟随系统，顶栏切换钮手动覆盖（localStorage 记住） ============
   偏好三态循环：auto（跟随系统）→ light → dark → auto。页首内联脚本已先行设定
   data-theme/data-pref 防闪烁，这里负责切换与系统变化时的跟随。 */
function themePref() {
  try { return localStorage.getItem('aivaro-theme') || 'auto'; } catch (e) { return 'auto'; }
}
function applyTheme(pref) {
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = pref === 'dark' || (pref === 'auto' && sysDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.pref = pref;
  try { localStorage.setItem('aivaro-theme', pref); } catch (e) {}
  const btn = document.getElementById('themeBtn');
  if (btn) {
    const label = pref === 'auto'
      ? '主题：跟随系统（当前' + (dark ? '深色' : '浅色') + '），点击切换'
      : '主题：已固定' + (pref === 'dark' ? '深色' : '浅色') + '，点击切换';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}
function initTheme() {
  applyTheme(themePref());
  const btn = document.getElementById('themeBtn');
  if (btn) btn.addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(themePref()) + 1) % order.length];
    applyTheme(next);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themePref() === 'auto') applyTheme('auto');
  });
}

/* ============ 分段导航：按当前页高亮 ============ */
function initSegNav() {
  const nav = document.getElementById('segNav');
  if (!nav) return;
  const file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const map = {
    '': 'index', 'index.html': 'index',
    'directory.html': 'directory', 'detail.html': 'directory',
    'free.html': 'free', 'compare.html': 'compare', 'about.html': 'about',
  };
  const cur = map[file];
  nav.querySelectorAll('a[data-nav]').forEach(a => {
    if (a.dataset.nav === cur) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ============ 顶栏菜单 ============ */
function initTracking() {
  if (typeof sendEvent === 'function') sendEvent('pv');
  const box = document.getElementById('subBox');
  if (!box || typeof AIVARO_CFG === 'undefined') return;
  if (AIVARO_CFG.SUBSCRIBE_MODE === 'hidden') return; /* 发布默认隐藏：未接通真实收集端点前不收集邮箱 */
  box.hidden = false;
  const form = document.getElementById('subForm');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('subEmail').value.trim();
    const consent = document.getElementById('subConsent').checked;
    const msg = document.getElementById('subMsg');
    msg.classList.remove('err'); msg.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = '请填写有效的邮箱地址。'; msg.classList.add('err'); return; }
    if (!consent) { msg.textContent = '请先勾选同意隐私政策，再提交订阅。'; msg.classList.add('err'); return; }
    saveSubscription(email);
    sendEvent('subscribe');
    msg.textContent = '已登记，订阅邮件将在功能开放后发送。';
    form.reset();
  });
}

function initChrome() {
  initTheme();
  initSegNav();
  initTracking();
  const btn = document.getElementById('menuBtn');
  const sheet = document.getElementById('navSheet');
  if (btn && sheet) {
    btn.addEventListener('click', () => {
      const open = sheet.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!sheet.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        sheet.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { sheet.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }
  initSearch();
}

/* ============ 全局搜索面板（⌘K / Ctrl+K） ============ */
let _searchSvc = null;
let _searchSel = 0;

function searchHay(s) {
  return [s.name, s.tagline, s.intro, s.op_type]
    .concat(s.vendors || [], s.models_highlight || [], familiesOf(s))
    .join(' ').toLowerCase();
}

function ensureSearchDom() {
  if (document.getElementById('searchOverlay')) return;
  const div = document.createElement('div');
  div.className = 'search-overlay';
  div.id = 'searchOverlay';
  div.hidden = true;
  div.innerHTML =
    '<div class="search-panel" role="dialog" aria-modal="true" aria-label="全站搜索">' +
      '<div class="search-head">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>' +
        '<input type="text" id="searchInput" placeholder="搜索服务名、模型、厂商…" aria-label="搜索服务" autocomplete="off">' +
        '<kbd>Esc</kbd>' +
      '</div>' +
      '<div class="search-results" id="searchResults" role="listbox"></div>' +
      '<div class="search-foot"><span>↑↓ 选择 · Enter 打开详情 · 无结果时 Enter 去目录搜索</span><span class="search-count" id="searchCount"></span></div>' +
    '</div>';
  document.body.appendChild(div);
  div.addEventListener('click', (e) => { if (e.target === div) closeSearch(); });
  const input = div.querySelector('#searchInput');
  input.addEventListener('input', () => renderSearchResults(input.value));
  input.addEventListener('keydown', (e) => {
    const items = div.querySelectorAll('.search-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1, items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1, items); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const cur = items[_searchSel];
      if (cur) { location.href = cur.dataset.href; }
      else {
        const q = input.value.trim();
        location.href = 'directory.html' + (q ? '?q=' + encodeURIComponent(q) : '');
      }
    }
  });
}

function moveSel(delta, items) {
  if (!items.length) return;
  _searchSel = (_searchSel + delta + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle('sel', i === _searchSel));
  items[_searchSel].scrollIntoView({ block: 'nearest' });
}

function renderSearchResults(q) {
  const box = document.getElementById('searchResults');
  const count = document.getElementById('searchCount');
  if (!box) return;
  const query = (q || '').trim().toLowerCase();
  const list = (_searchSvc || []).filter(s => !query || searchHay(s).includes(query));
  _searchSel = 0;
  count.textContent = list.length + ' 家';
  if (!list.length) {
    box.innerHTML = '<div class="search-empty">没有匹配的服务。按 Enter 去目录页用筛选器找找。</div>';
    return;
  }
  box.innerHTML = list.map((s, i) =>
    '<a class="search-item' + (i === 0 ? ' sel' : '') + '" role="option" data-href="detail.html?id=' + encodeURIComponent(s.id) + '" href="detail.html?id=' + encodeURIComponent(s.id) + '">' +
      '<span class="si-main"><strong>' + esc(s.name) + '</strong><span>' + esc(s.tagline) + '</span></span>' +
      '<span class="si-side">' + statusDot(s) + esc(s.op_type || s.type) + '</span>' +
    '</a>').join('');
}

async function openSearch() {
  ensureSearchDom();
  const ov = document.getElementById('searchOverlay');
  ov.hidden = false;
  document.body.style.overflow = 'hidden';
  if (!_searchSvc) {
    try { _searchSvc = (await loadData()).services; } catch (e) { _searchSvc = []; }
  }
  const input = document.getElementById('searchInput');
  renderSearchResults(input.value || '');
  input.focus();
  input.select();
}
function closeSearch() {
  const ov = document.getElementById('searchOverlay');
  if (ov) { ov.hidden = true; document.body.style.overflow = ''; }
}

function initSearch() {
  const btn = document.getElementById('searchBtn');
  if (btn) btn.addEventListener('click', openSearch);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      const ov = document.getElementById('searchOverlay');
      if (ov && !ov.hidden) closeSearch(); else openSearch();
    }
    if (e.key === 'Escape') closeSearch();
  });
}

document.addEventListener('DOMContentLoaded', initChrome);
