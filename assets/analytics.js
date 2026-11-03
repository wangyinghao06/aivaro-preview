/* Aivaro 基础统计（预留版）＋订阅登记（预留） · 原创实现
 *
 * 事件结构（统一经 sendEvent 发出）：
 *   { type: 'pv' | 'click_out' | 'subscribe',
 *     page: 所在页面文件名（如 'index.html'，go.html 点击为 'go.html'）,
 *     service_id: 相关服务 id（pv 为 null，点击/订阅按场景填）,
 *     referrer_channel: 'direct' | 'search' | 'social' | 'referral'（按 document.referrer 粗分）,
 *     ts: 毫秒时间戳, date: 'YYYY-MM-DD'（本地日期） }
 *
 * 本轮口径（预留，未接通）：
 * - ANALYTICS_ENDPOINT 为空 → 事件只写入浏览器 localStorage 环形缓冲
 *   （键 aivaro_events_v1，上限 500 条），不向任何服务器发送；
 * - 正式站统计改走现成工具（见 ANALYTICS_PROVIDER），上线日由站点所有者创建账号后
 *   在下方单一注入点填入，本文件不含任何第三方脚本；
 * - 订阅登记同理：SUBSCRIBE_MODE='hidden' 为发布默认（页脚不渲染订阅框）；
 *   'demo' 仅供本地自测（可用 window.AIVARO_CFG_OVERRIDE 在加载前覆盖）；
 *   正式开启前必须先接通真实收集端点。
 */
'use strict';

const AIVARO_CFG = Object.assign({
  ANALYTICS_ENDPOINT: '',        // 二期自建事件端点（InstaBox 服务），本轮置空
  ANALYTICS_PROVIDER: '',        // 正式站统计服务（Umami / Cloudflare Web Analytics / 百度统计其一），上线日填入
  SUBSCRIBE_MODE: 'hidden',      // 'hidden'（发布默认） | 'demo'（本地自测）
  EVENT_KEY: 'aivaro_events_v1', // 事件环形缓冲 localStorage 键
  EVENT_CAP: 500,                // 环形缓冲上限（条）
  SUB_KEY: 'aivaro_subscriptions_v1', // 订阅登记 localStorage 键（仅 demo/未来端点模式使用）
}, (typeof window !== 'undefined' && window.AIVARO_CFG_OVERRIDE) || {});

/* —— 第三方统计单一注入点（预留）：ANALYTICS_PROVIDER 非空时才由部署方在此接入，
      本轮保持为空实现，不加载任何第三方脚本。 —— */
function initProviderAnalytics() { /* intentionally empty in this build */ }

function referrerChannel(ref) {
  if (!ref) return 'direct';
  let host = '';
  try { host = new URL(ref).hostname; } catch (e) { return 'referral'; }
  if (/(google|bing|baidu|duckduckgo|sogou|yandex|search\.|so\.com)/i.test(host)) return 'search';
  if (/(weibo|wechat|mp\.weixin|t\.me|telegram|twitter|x\.com|facebook|instagram|zhihu|xiaohongshu|bilibili)/i.test(host)) return 'social';
  return 'referral';
}

function loadEvents() {
  try { return JSON.parse(localStorage.getItem(AIVARO_CFG.EVENT_KEY) || '[]'); }
  catch (e) { return []; }
}

function sendEvent(type, fields) {
  fields = fields || {};
  const now = new Date();
  const ev = {
    type: type,
    page: fields.page || (location.pathname.split('/').pop() || 'index.html'),
    service_id: fields.service_id != null ? fields.service_id : null,
    referrer_channel: referrerChannel(document.referrer || ''),
    ts: now.getTime(),
    date: now.toLocaleDateString('sv-SE'), // YYYY-MM-DD（本地时区）
  };
  if (AIVARO_CFG.ANALYTICS_ENDPOINT) {
    try {
      fetch(AIVARO_CFG.ANALYTICS_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ev), keepalive: true,
      }).catch(() => {});
    } catch (e) { /* 端点异常不阻塞页面 */ }
  } else {
    try {
      const buf = loadEvents();
      buf.push(ev);
      while (buf.length > AIVARO_CFG.EVENT_CAP) buf.shift();
      localStorage.setItem(AIVARO_CFG.EVENT_KEY, JSON.stringify(buf));
    } catch (e) { /* localStorage 不可用时静默降级 */ }
  }
  return ev;
}

function loadSubscriptions() {
  try { return JSON.parse(localStorage.getItem(AIVARO_CFG.SUB_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveSubscription(email) {
  const subs = loadSubscriptions();
  const now = new Date();
  subs.push({ email: email, ts: now.getTime(), date: now.toLocaleDateString('sv-SE') });
  try { localStorage.setItem(AIVARO_CFG.SUB_KEY, JSON.stringify(subs)); } catch (e) {}
  return subs.length;
}
