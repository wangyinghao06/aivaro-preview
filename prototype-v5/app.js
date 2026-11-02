/* Aivaro prototype v4 — chat-first workspace demo. All replies & numbers are LOCAL simulations. */
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const MODEL_ID = "cohere/north-mini-code:free";
const DEMO_TOTAL = 50000;

/* ---------- markdown (light, demo-grade) ---------- */
function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function inlineMd(t) {
  return esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
function mdToHtml(src) {
  const lines = src.split("\n"); let html = "", i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.trim().startsWith("```")) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      html += '<div class="codeblock"><div class="cb-bar"><span>code</span><button data-copy>复制</button></div><pre>' + esc(buf.join("\n")) + "</pre></div>";
      continue;
    }
    if (ln.trim().startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const head = ln.split("|").map(s => s.trim()).filter(Boolean); i += 2; const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(lines[i].split("|").map(s => s.trim()).filter(Boolean)); i++; }
      html += "<table><tr>" + head.map(h => "<th>" + inlineMd(h) + "</th>").join("") + "</tr>" +
        rows.map(r => "<tr>" + r.map(c => "<td>" + inlineMd(c) + "</td>").join("") + "</tr>").join("") + "</table>";
      continue;
    }
    if (/^#{1,4}\s/.test(ln)) { html += "<h4>" + inlineMd(ln.replace(/^#{1,4}\s/, "")) + "</h4>"; i++; continue; }
    if (/^[-*]\s/.test(ln)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s/, "")); i++; }
      html += "<ul>" + items.map(x => "<li>" + inlineMd(x) + "</li>").join("") + "</ul>"; continue;
    }
    if (ln.trim() === "") { i++; continue; }
    html += "<p>" + inlineMd(ln) + "</p>"; i++;
  }
  return html;
}

/* ---------- demo responder ---------- */
function demoAnswer(q) {
  if (/python|代码|函数|脚本|code/i.test(q)) return {
    md: "好，这是带缓存优化的斐波那契实现：\n\n```python\nfrom functools import lru_cache\n\n@lru_cache(maxsize=None)\ndef fib(n: int) -> int:\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint([fib(i) for i in range(10)])\n# 输出：[0, 1, 1, 2, 3, 5, 8, 13, 21, 34]\n```\n\n#### 说明\n- `lru_cache` 把重复子问题缓存起来，时间复杂度从指数降到 **O(n)**\n- 缺点是递归太深时可能爆栈；n 很大时建议改迭代写法\n\n（演示回复：代码块右上角可以一键复制。）"
  };
  if (/额度|价格|费用|收费|计费|收据|扣费/.test(q)) return {
    md: "Aivaro 的计费分三步，每一步都会记在收据里：\n\n| 步骤 | 发生什么 |\n|---|---|\n| 预扣 | 发起请求时按最坏情况先冻结一笔额度，确保并发时不会透支 |\n| 结算 | 上游返回真实用量后，按实际输入/输出 token 扣费 |\n| 退回 | 预扣多出的部分自动退回；请求失败则全额退回、不计费 |\n\n展开这条回复下方的**收据**，就能看到这一笔的预扣、结算和退回——这三行数字来自网关里真实运行的计费台账机制（原型里是按同样口径估算的演示值）。"
  };
  if (/介绍|你是谁|功能|是什么/.test(q)) return {
    md: "我是 Aivaro 的对话助手（演示版）。Aivaro 是一个 AI API 网关：你用一个 Key 接入模型，每笔调用都有**收据**，每次失败都有**诊断**。\n\n当前真实接入的模型只有一个：**Cohere North Mini Code（免费测试）**，经 OpenRouter 免费池调用。公开注册和充值尚未开放。\n\n在这个原型里你可以试：新建/搜索/删除会话、切换模型面板、在任意回复下方展开收据、点「演示：请求失败诊断」看诊断卡。"
  };
  return {
    md: "收到，这是演示模式的模拟回复——真实模型调用没有接入这个原型。\n\n不过流程是完整的，你可以留意三件事：\n- 回复是**逐字流式**出现的，生成中可以点停止\n- 回复下方有一张**收据**，写明这一笔的预扣、结算与退回\n- 每条回复可以**重新生成**，或**从这里分支**开一条新会话，不污染当前上下文\n\n换个问法试试：问我「额度是怎么扣费的」，或让我「写一段 Python 代码」。"
  };
}

/* ---------- sessions ---------- */
const LS_KEY = "aivaro-prototype-v5-sessions";
let seq = 100;
function mkSession(title, msgs, ts) {
  return { id: "s" + (++seq), title: title || "新对话", msgs: msgs || [], ts: ts || Date.now() };
}
let sessions, activeId;
function seed() {
  const old = mkSession("介绍一下你自己", [
    { role: "user", text: "介绍一下你自己" },
    { role: "ai", text: "我是 Aivaro 的对话助手（演示版）。Aivaro 是一个 AI API 网关：你用一个 Key 接入模型，每笔调用都有**收据**，每次失败都有**诊断**。", receipt: { inTok: 24, outTok: 58, reserve: 624, settle: 82, status: "成功", ms: 1180 } }
  ], Date.now() - 86400000);
  const cur = mkSession("新对话", []);
  sessions = [cur, old]; activeId = cur.id;
}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ sessions, activeId, seq })); } catch (e) {} }
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) { seed(); return; }
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.sessions) || !d.sessions.length) { seed(); return; }
    sessions = d.sessions; activeId = d.activeId; seq = d.seq || 100;
    if (!sessions.find(s => s.id === activeId)) activeId = sessions[0].id;
  } catch (e) { seed(); }
}
const active = () => sessions.find(s => s.id === activeId);
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay) return "今天";
  if (d.toDateString() === y.toDateString()) return "昨天";
  return "更早";
}
function renderSessions() {
  const q = ($("#sessSearch").value || "").trim();
  const list = $("#sessList");
  const groups = {};
  sessions.forEach(s => {
    if (q && s.title.indexOf(q) === -1) return;
    (groups[dayLabel(s.ts)] = groups[dayLabel(s.ts)] || []).push(s);
  });
  let html = "";
  ["今天", "昨天", "更早"].forEach(g => {
    if (!groups[g]) return;
    html += '<div class="sess-group">' + g + "</div>";
    groups[g].forEach(s => {
      html += '<div class="sess' + (s.id === activeId ? " on" : "") + '" data-sess="' + s.id + '">' +
        '<span class="t">' + esc(s.title) + '</span><span class="n">' + s.msgs.length + ' 条</span>' +
        '<button class="del" data-del="' + s.id + '" aria-label="删除会话">×</button></div>';
    });
  });
  list.innerHTML = html || '<p class="sess-empty">没有匹配的会话。</p>';
}
function renderMessages() {
  const s = active();
  placeComposer();
  $("#welcome").style.display = s.msgs.length ? "none" : "";
  const box = $("#messages");
  box.innerHTML = s.msgs.map((m, idx) => {
    if (m.role === "user") return '<div class="msg user"><div class="bubble">' + esc(m.text) + "</div></div>";
    if (m.diag) return '<div class="msg"><div class="body">' + diagHtml(m.diag) +
      actHtml(idx) + (m.receipt ? receiptHtml(m.receipt) : "") + "</div></div>";
    return '<div class="msg"><div class="body"><div class="md">' + mdToHtml(m.text) + "</div>" +
      actHtml(idx) + (m.receipt ? receiptHtml(m.receipt) : "") + "</div></div>";
  }).join("");
  scrollThread(true);
}
function actHtml(idx) {
  return '<div class="msg-actions"><button data-act="regen" data-idx="' + idx + '">重新生成</button>' +
    '<button data-act="branch" data-idx="' + idx + '">从这里分支</button></div>';
}
function receiptHtml(r) {
  const refund = r.reserve - r.settle;
  return '<details class="receipt"><summary>收据 · 结算 <b>' + r.settle + "</b> · 退回 <b>" + refund + "</b> · " + r.status + "</summary>" +
    "<table>" +
    "<tr><td>模型</td><td>" + MODEL_ID + "</td></tr>" +
    "<tr><td>输入 / 输出（估算）</td><td>" + r.inTok + " / " + r.outTok + " tok</td></tr>" +
    "<tr><td>预扣</td><td>" + r.reserve + "</td></tr>" +
    "<tr><td>实际结算</td><td>" + r.settle + "</td></tr>" +
    "<tr><td>退回</td><td>" + refund + "</td></tr>" +
    "<tr><td>耗时（模拟）</td><td>" + r.ms + " ms</td></tr>" +
    '</table><p class="fine">演示数据，非真实账单。口径与网关现行台账一致，费率为测试标定 1:1。</p></details>';
}
function diagHtml(d) {
  return '<div class="diag"><h4>请求失败 · ' + esc(d.title) + "</h4><p>" + esc(d.what) + "</p><p><strong>计费：</strong>" +
    esc(d.billing) + "</p><p><strong>下一步：</strong>" + esc(d.next) + '</p><div class="d-actions">' +
    '<button class="primary" data-diag="retry">重试一次</button><button data-diag="status">查看服务状态</button>' +
    '<button data-diag="copy">复制诊断信息</button></div></div>';
}
function scrollThread(bottom) {
  const th = $("#thread");
  if (bottom) th.scrollTop = th.scrollHeight;
}


/* ---------- composer placement ---------- */
function placeComposer() {
  const s = active();
  const dock = $("#composerDock");
  if (!dock) return;
  if (s && s.msgs.length === 0) { $("#composerSlotEmpty").appendChild(dock); }
  else { $("#dockSlotBottom").appendChild(dock); }
}

/* ---------- quota (demo) ---------- */
let quotaUsed = 0;
function renderQuota() {
  const left = DEMO_TOTAL - quotaUsed;
  $("#qmLeft").textContent = left.toLocaleString();
  $("#qmToday").textContent = quotaUsed.toLocaleString();
  $("#qmDays").textContent = quotaUsed > 0 ? "约 " + Math.max(1, Math.floor(left / Math.max(quotaUsed, 1))) + " 天" : "—";
  $("#qmBar").style.width = Math.max(2, left / DEMO_TOTAL * 100) + "%";
  $("#pulseLeft").textContent = left.toLocaleString();
}
function estimate(text) { return Math.max(1, Math.round(text.length / 1.7) + 12); }
function makeReceipt(userText, replyText, status) {
  const inTok = estimate(userText), outTok = estimate(replyText);
  const reserve = inTok + 600;
  const settle = status === "失败" ? 0 : inTok + outTok;
  return { inTok, outTok, reserve, settle, status, ms: 600 + Math.round(replyText.length * 2.2) };
}

/* ---------- streaming send ---------- */
let streamTimer = null, streaming = false;
function setSendMode() {
  const b = $("#sendBtn");
  b.textContent = streaming ? "■" : "↑";
  b.classList.toggle("stop", streaming);
  b.setAttribute("aria-label", streaming ? "停止生成" : "发送");
}
function stopStream(finalize) {
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
  if (streaming && finalize) finalize();
  streaming = false; setSendMode();
}
function pushAiPlaceholder() {
  const s = active();
  const m = { role: "ai", text: "", receipt: null };
  s.msgs.push(m);
  return m;
}
function renderStreaming(m) {
  const s = active(); const idx = s.msgs.indexOf(m);
  $("#welcome").style.display = "none";
  let el = $("#messages").children[idx * 1]; // messages are 1:1 with children
  const html = '<div class="msg"><div class="body"><div class="md"><p>' +
    esc(m.text).replace(/\n/g, "<br>") + '<span class="cursor"></span></p></div></div></div>';
  if (el && el.dataset.streaming === "1") { el.outerHTML = html.replace('<div class="msg">', '<div class="msg" data-streaming="1">'); }
  else {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const node = wrap.firstChild; node.dataset.streaming = "1";
    $("#messages").appendChild(node);
  }
  scrollThread(true);
}
function send(text) {
  const q = (text || "").trim();
  if (!q || streaming) return;
  const s = active();
  s.msgs.push({ role: "user", text: q });
  if (s.title === "新对话") s.title = q.slice(0, 22);
  s.ts = Date.now();
  renderSessions(); renderMessages();
  const full = demoAnswer(q).md;
  const m = pushAiPlaceholder();
  streaming = true; setSendMode();
  let pos = 0;
  const step = Math.max(2, Math.round(full.length / 55));
  streamTimer = setInterval(() => {
    pos = Math.min(full.length, pos + step);
    m.text = full.slice(0, pos);
    renderStreaming(m);
    if (pos >= full.length) {
      stopStream(() => {});
      m.receipt = makeReceipt(q, full, "成功");
      quotaUsed += m.receipt.settle; renderQuota();
      renderMessages(); save();
    }
  }, 32);
  m._finishStop = () => {
    m.receipt = makeReceipt(q, m.text || "（已停止）", "已停止");
    quotaUsed += m.receipt.settle; renderQuota();
  };
}
function stopCurrent() {
  const s = active(); const m = s.msgs[s.msgs.length - 1];
  stopStream(() => { if (m && m._finishStop) m._finishStop(); });
  renderMessages(); save();
}
function sendDiag() {
  if (streaming) return;
  const s = active();
  s.msgs.push({ role: "user", text: "演示：请求失败诊断" });
  if (s.title === "新对话") s.title = "演示：请求失败诊断";
  s.ts = Date.now();
  const m = {
    role: "ai", text: "", diag: {
      title: "问题在上游一侧",
      what: "网关返回 429。这不是你的 Key 或参数有问题：当前模型走 OpenRouter 免费池，池子的每日共享额度已被用完，请求在到达模型前被上游拒绝。",
      billing: "本次失败不计费，预扣已全额退回（见下方收据口径）。",
      next: "等免费池次日恢复，或降低请求频率后重试；持续出现请看服务状态页公告。"
    },
    receipt: { inTok: 18, outTok: 0, reserve: 618, settle: 0, status: "失败 · 未计费", ms: 240 }
  };
  s.msgs.push(m);
  renderSessions(); renderMessages(); save();
}

/* ---------- views ---------- */
function showView(name) {
  ["chat", "models", "dev", "status", "about"].forEach(v => {
    $("#view-" + v).hidden = v !== name;
  });
  if (name === "status") loadGatewayStatus();
  closeRail();
  window.scrollTo(0, 0);
}
function loadGatewayStatus() {
  const dot = $("#gwDot"), txt = $("#gwText");
  dot.className = "dot"; txt.textContent = "正在查询…";
  fetch("https://8081-agqyuuzd3ejtzmhsnnby2wcjxm.instabox.tech/api/status")
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => {
      dot.className = "dot ok";
      const up = d.start_time ? "已运行自 " + new Date(d.start_time * 1000).toLocaleString() : "状态正常";
      txt.textContent = "运行中 · 版本 " + (d.version || "未知") + " · " + up + " · 查询时间 " + new Date().toLocaleTimeString();
    })
    .catch(() => {
      dot.className = "dot bad";
      txt.textContent = "暂时无法取得状态：可能是沙盒闲置暂停（免费计划 30 分钟无活动自动暂停，下一次访问会唤醒，约需 15–45 秒），稍后刷新本页重试。";
    });
}

/* ---------- error doctor / wizard ---------- */
const ERR = {
  "401": { title: "问题多半在请求一侧", what: "网关没有认出你的身份：Key 缺失、写错、已被撤销，或请求头格式不对。", next: "依次检查：①Authorization 头是否为 Bearer 加完整 Key；②Key 是否刚被撤销或重置；③是否把控制台登录密码当成了 API Key（两者不是一回事）。" },
  "403": { title: "身份没问题，是额度或权限不足", what: "用户总额度耗尽、这把 Key 的额度上限耗尽，或该 Key 被限制为只能调用部分模型。", next: "先看控制台的总额度与该 Key 的已用额度；再确认 Key 的模型限制里包含你要调的模型。" },
  "404": { title: "通常是模型名写错了", what: "网关里没有这个模型 ID。免费模型的 ID 带 :free 后缀，漏写就会 404。", next: "对照模型中心页的完整 ID 逐字核对，包括冒号和后缀。" },
  "429": { title: "问题在通道一侧：太忙了", what: "两种可能：触发了网关的每分钟请求上限；或上游免费池的共享额度耗尽。", next: "先把频率降下来重试；仍持续出现，多半是免费池耗尽，等次日恢复或看状态页公告。本次失败不计费。" },
  "500": { title: "问题在上游一侧", what: "上游返回错误、超时或连接中断，网关把原因脱敏后回传。", next: "稍后重试一次；持续出现请把请求时间与 request_id 附在反馈里。失败请求不计费。" }
};
const WIZ = {
  "401": ERR["401"], "403": ERR["403"], "429": ERR["429"],
  "spin": { title: "先分清卡在哪一层", what: "对话站是「等完整回复再显示」的模式，长回答本来就会等一会儿；超过 90 秒还没有结果，通常是上游免费池拥堵或沙盒刚被唤醒。", next: "①先等满 90 秒；②刷新页面重发一次；③还不行，看本页上方的网关状态是否为运行中。" },
  "down": { title: "多半不是你的问题", what: "托管在免费计划沙盒上，闲置 30 分钟会自动暂停，下一次访问触发唤醒（约 15–45 秒）；偶发还会遇到平台发布层抖动。", next: "等 30–60 秒刷新；持续 5 分钟以上打不开，而本页（GitHub Pages 托管）能打开，说明问题在沙盒一侧，等它恢复即可。" }
};
function card(d) {
  return '<div class="diag"><h4>' + esc(d.title) + "</h4><p>" + esc(d.what) + "</p><p><strong>下一步：</strong>" + esc(d.next) + "</p></div>";
}
function renderErr(code) { $("#errCard").innerHTML = card(ERR[code]); }
function renderWiz(k) { $("#wizCard").innerHTML = card(WIZ[k]); }

/* ---------- rail drawer ---------- */
function openRail() { $("#rail").classList.add("open"); $("#scrim").classList.add("open"); }
function closeRail() { $("#rail").classList.remove("open"); $("#scrim").classList.remove("open"); }

/* ---------- model sheet ---------- */
function openSheet() { $("#modelSheet").classList.add("open"); $("#sheetScrim").classList.add("open"); }
function closeSheet() { $("#modelSheet").classList.remove("open"); $("#sheetScrim").classList.remove("open"); }

/* ---------- events ---------- */
document.addEventListener("DOMContentLoaded", () => {
  load(); renderSessions(); renderMessages(); renderQuota(); renderErr("401"); renderWiz("401");

  $("#newSessBtn").addEventListener("click", () => {
    const s = mkSession("新对话", []);
    sessions.unshift(s); activeId = s.id;
    renderSessions(); renderMessages(); save(); closeRail(); showView("chat");
    $("#composerInput").focus();
  });
  $("#sessSearch").addEventListener("input", renderSessions);
  $("#sessList").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      e.stopPropagation();
      sessions = sessions.filter(s => s.id !== del.dataset.del);
      if (!sessions.length) { const s = mkSession("新对话", []); sessions = [s]; }
      if (!sessions.find(s => s.id === activeId)) activeId = sessions[0].id;
      renderSessions(); renderMessages(); save(); return;
    }
    const item = e.target.closest("[data-sess]");
    if (item) { activeId = item.dataset.sess; renderSessions(); renderMessages(); save(); closeRail(); }
  });
  $$("[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#railOpen").addEventListener("click", openRail);
  $("#railClose").addEventListener("click", closeRail);
  $("#scrim").addEventListener("click", closeRail);

  $("#chips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip]"); if (!chip) return;
    if (chip.dataset.chip === "__diag__") { showView("chat"); sendDiag(); return; }
    send(chip.textContent);
  });
  $("#messages").addEventListener("click", (e) => {
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      const pre = cp.closest(".codeblock").querySelector("pre");
      if (navigator.clipboard) navigator.clipboard.writeText(pre.textContent).catch(() => {});
      cp.textContent = "已复制"; setTimeout(() => cp.textContent = "复制", 1200); return;
    }
    const dg = e.target.closest("[data-diag]");
    if (dg) {
      if (dg.dataset.diag === "status") showView("status");
      if (dg.dataset.diag === "copy" && navigator.clipboard) {
        navigator.clipboard.writeText("Aivaro 诊断信息（演示）：HTTP 429 · 上游免费池共享额度耗尽 · 本次未计费 · request_id demo-429").catch(() => {});
        dg.textContent = "已复制"; setTimeout(() => dg.textContent = "复制诊断信息", 1200);
      }
      if (dg.dataset.diag === "retry") send("额度是怎么扣费的？");
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const s = active(); const idx = Number(act.dataset.idx);
    const m = s.msgs[idx]; if (!m) return;
    if (act.dataset.act === "branch") {
      const copy = s.msgs.slice(0, idx + 1).map(x => JSON.parse(JSON.stringify(x)));
      const ns = mkSession(s.title.replace(/（分支）$/, "") + "（分支）", copy);
      sessions.unshift(ns); activeId = ns.id;
      renderSessions(); renderMessages(); save();
    }
    if (act.dataset.act === "regen") {
      const userMsg = s.msgs.slice(0, idx).reverse().find(x => x.role === "user");
      s.msgs = s.msgs.slice(0, idx);
      renderMessages();
      if (userMsg) {
        const full = demoAnswer(userMsg.text).md;
        const nm = pushAiPlaceholder();
        streaming = true; setSendMode();
        let pos = 0; const step = Math.max(2, Math.round(full.length / 55));
        streamTimer = setInterval(() => {
          pos = Math.min(full.length, pos + step);
          nm.text = full.slice(0, pos); renderStreaming(nm);
          if (pos >= full.length) {
            stopStream(() => {});
            nm.receipt = makeReceipt(userMsg.text, full, "成功");
            quotaUsed += nm.receipt.settle; renderQuota();
            renderMessages(); save();
          }
        }, 32);
        nm._finishStop = () => { nm.receipt = makeReceipt(userMsg.text, nm.text || "（已停止）", "已停止"); quotaUsed += nm.receipt.settle; renderQuota(); };
      }
    }
  });

  const input = $("#composerInput");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  function doSend() {
    if (streaming) { stopCurrent(); return; }
    const v = input.value; input.value = ""; input.style.height = "auto";
    send(v);
  }
  $("#sendBtn").addEventListener("click", () => { if (streaming) stopCurrent(); else doSend(); });

  $("#modelPill").addEventListener("click", openSheet);
  $("#sheetClose").addEventListener("click", closeSheet);
  $("#sheetScrim").addEventListener("click", closeSheet);
  $("#optReal").addEventListener("click", closeSheet);

  $("#errTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-err]"); if (!b) return;
    $$("#errTabs button").forEach(x => x.classList.toggle("on", x === b));
    renderErr(b.dataset.err);
  });
  $("#wizTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-wiz]"); if (!b) return;
    $$("#wizTabs button").forEach(x => x.classList.toggle("on", x === b));
    renderWiz(b.dataset.wiz);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheet(); closeRail(); } });
});
