/* Aivaro 原型逻辑 — 演示模式：所有回复本地模拟，不发起真实模型请求。
   唯一真实网络请求：状态页读取网关公开状态接口（与现网状态页相同）。 */
(function () {
  "use strict";

  /* ---------------- 路由 ---------------- */
  var routes = ["home", "chat", "models", "dev", "console", "status"];
  function currentRoute() {
    var h = (location.hash || "#/home").replace("#/", "");
    return routes.indexOf(h) >= 0 ? h : "home";
  }
  function applyRoute() {
    var r = currentRoute();
    document.querySelectorAll("[data-view]").forEach(function (v) {
      v.classList.toggle("on", v.getAttribute("data-view") === r);
    });
    document.querySelectorAll("[data-route]").forEach(function (a) {
      a.classList.toggle("on", a.getAttribute("data-route") === r);
    });
    if (r === "status") loadGatewayStatus();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", applyRoute);

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
  }
  function $(id) { return document.getElementById(id); }

  /* Markdown-lite：先转义，再处理围栏代码/标题/粗体/行内代码/列表/表格 */
  function renderMarkdown(src) {
    var blocks = [];
    var text = esc(src);
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      blocks.push('<div class="codeblock"><div class="cb-head"><span>' + (lang || "code") +
        '</span><button class="copy-btn" type="button" data-copy="' +
        encodeURIComponent(code.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")) +
        '">复制</button></div><pre><code>' + code + "</code></pre></div>");
      return "\u0001" + (blocks.length - 1) + "\u0001";
    });
    var lines = text.split("\n"), html = "", inList = false, inTable = false;
    function closeBlocks() {
      if (inList) { html += "</ul>"; inList = false; }
      if (inTable) { html += "</tbody></table>"; inTable = false; }
    }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (/^\u0001\d+\u0001$/.test(t)) { closeBlocks(); html += t; return; }
      if (/^\|(.+)\|$/.test(t)) {
        var cells = t.slice(1, -1).split("|").map(function (c) { return c.trim(); });
        if (/^[-\s:|]+$/.test(cells.join(""))) return;
        if (!inTable) { html += "<table><tbody>"; inTable = true; }
        html += "<tr>" + cells.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>";
        return;
      }
      if (inTable && t === "") { closeBlocks(); return; }
      var h = t.match(/^(#{2,4})\s+(.*)$/);
      if (h) { closeBlocks(); var lv = h[1].length === 2 ? 3 : 4; html += "<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">"; return; }
      var li = t.match(/^[-·]\s+(.*)$/);
      if (li) { if (!inList) { html += "<ul>"; inList = true; } html += "<li>" + inline(li[1]) + "</li>"; return; }
      if (inList && t === "") { closeBlocks(); return; }
      if (t === "") return;
      html += "<p>" + inline(t) + "</p>";
    });
    closeBlocks();
    html = html.replace(/\u0001(\d+)\u0001/g, function (_, i) { return blocks[+i]; });
    return html;
    function inline(s) {
      return s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
              .replace(/`([^`]+)`/g, "<code>$1</code>");
    }
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]");
    if (!btn) return;
    var txt = decodeURIComponent(btn.getAttribute("data-copy"));
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(function () {});
    btn.textContent = "已复制";
    setTimeout(function () { btn.textContent = "复制"; }, 1400);
  });

  /* ---------------- 模型 ---------------- */
  var MODELS = [
    { id: "cohere/north-mini-code:free", name: "Cohere North Mini Code", badge: '<span class="badge test">免费测试</span> <span class="badge live">可用</span>',
      desc: "当前唯一接入的模型 · 上下文 256K · 对话与代码 · 上游免费池共享限额", available: true },
    { id: null, name: "更多模型", badge: '<span class="badge">尚未接入</span>',
      desc: "合规上游确认后逐个接入。在那之前不可选 — 模型中心会同步更新真实状态。", available: false }
  ];
  var currentModel = MODELS[0];

  var chip = $("modelChip"), sheet = $("modelSheet"), mask = $("sheetMask");
  function renderChip() { chip.innerHTML = "" + esc(currentModel.name) + ' <span class="badge test">免费</span> ▾'; }
  function renderModelOptions() {
    $("modelOptions").innerHTML = MODELS.map(function (m, i) {
      return '<button type="button" class="model-opt' + (m === currentModel ? " sel" : "") + '"' +
        (m.available ? ' data-model="' + i + '"' : " disabled") + '>' +
        '<span class="nm">' + esc(m.name) + " " + m.badge + '</span>' +
        '<span class="ds">' + esc(m.desc) + "</span></button>";
    }).join("");
    $("modelOptions").querySelectorAll("[data-model]").forEach(function (b) {
      b.addEventListener("click", function () {
        currentModel = MODELS[+b.getAttribute("data-model")];
        renderChip(); renderModelOptions(); closeSheet();
      });
    });
  }
  function openSheet() { sheet.classList.add("open"); mask.classList.add("open"); }
  function closeSheet() { sheet.classList.remove("open"); mask.classList.remove("open"); }
  chip.addEventListener("click", openSheet);
  mask.addEventListener("click", closeSheet);
  $("sheetClose").addEventListener("click", closeSheet);
  renderChip(); renderModelOptions();

  /* ---------------- 会话 ---------------- */
  var LS_KEY = "aivaro-prototype-sessions-v1";
  var sessions = [], activeId = null, seq = 0;
  function newSession(title) {
    var s = { id: "s" + (++seq) + "-" + Date.now(), title: title || "新会话", messages: [] };
    sessions.unshift(s); activeId = s.id; return s;
  }
  function active() { return sessions.find(function (s) { return s.id === activeId; }); }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ sessions: sessions, activeId: activeId, seq: seq })); } catch (e) {} }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (d && d.sessions && d.sessions.length) { sessions = d.sessions; activeId = d.activeId; seq = d.seq || sessions.length; return; }
    } catch (e) {}
    newSession();
  }

  var sessList = $("sessList"), msgsEl = $("msgs");
  function renderSessions(filter) {
    var q = (filter || "").toLowerCase();
    sessList.innerHTML = "";
    sessions.filter(function (s) { return !q || s.title.toLowerCase().indexOf(q) >= 0; })
      .forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "sess" + (s.id === activeId ? " on" : "");
        b.innerHTML = '<span class="del" title="删除会话">✕</span><span class="t">' + esc(s.title) + '</span>' +
          '<span class="m">' + s.messages.length + " 条消息 · 演示数据</span>";
        b.querySelector(".del").addEventListener("click", function (e) {
          e.stopPropagation();
          sessions = sessions.filter(function (x) { return x.id !== s.id; });
          if (!sessions.length) newSession();
          if (activeId === s.id) activeId = sessions[0].id;
          save(); renderSessions($("sessSearch").value); renderMessages();
        });
        b.addEventListener("click", function () {
          activeId = s.id; save(); renderSessions($("sessSearch").value); renderMessages(); closeRail();
        });
        sessList.appendChild(b);
      });
  }
  $("sessSearch").addEventListener("input", function () { renderSessions(this.value); });
  $("newSessBtn").addEventListener("click", function () { newSession(); save(); renderSessions($("sessSearch").value); renderMessages(); closeRail(); $("composerInput").focus(); });

  var rail = $("rail");
  function closeRail() { rail.classList.remove("open"); }
  $("railToggle").addEventListener("click", function () { rail.classList.toggle("open"); });

  /* ---------------- 额度脉搏（演示计数） ---------------- */
  var quota = { total: 50000, used: 0 };
  function renderPulse() {
    $("pulseToday").textContent = quota.used.toLocaleString();
    $("pulseLeft").textContent = (quota.total - quota.used).toLocaleString();
    $("pulseDays").textContent = quota.used > 0 ? "按今日速度约 " + Math.max(1, Math.round((quota.total - quota.used) / Math.max(quota.used, 1))) + " 天" : "—";
  }

  /* ---------------- 演示回复引擎 ---------------- */
  function estTokens(text) { return Math.max(1, Math.round(text.length / 1.7) + 12); }

  var INTRO = "我是 **Aivaro 演示助手**（本地模拟，不联网）。真实服务里，这个位置是模型 `cohere/north-mini-code:free` 在回答。\n\n### 我能演示什么\n- **写代码**：试试点下方「写一段 Python 代码」\n- **失败诊断卡**：点「演示：请求失败诊断」，看失败时长什么样\n- **调用收据**：我的每条回复下方都有一张可展开的收据 — 预扣、结算、退回，逐笔列清\n\n### 为什么强调收据\n多数网关只告诉你「本月用了多少」。Aivaro 的计费台账把每次请求拆开记：失败不计费、预扣多了自动退回。费用透明，是我们做这个产品最在意的事。";
  var CODE = "好，这是一个带缓存的斐波那契实现：\n\n```python\nfrom functools import lru_cache\n\n@lru_cache(maxsize=None)\ndef fib(n: int) -> int:\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint([fib(i) for i in range(10)])\n# 输出: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]\n```\n\n### 说明\n- `lru_cache` 把重复子问题缓存起来，时间复杂度从指数级降到 **O(n)**\n- 缺点是递归深度大时可能爆栈；n 很大时建议改迭代写法\n\n（演示回复：代码块右上角可以一键复制。）";
  var QUOTA = "### 额度是怎么扣的（以现网规则为准）\n\n| 步骤 | 发生什么 |\n| 预扣 | 请求发出前，按「输入 + 最大输出」的最坏值预留额度 |\n| 结算 | 上游返回真实用量后，按实际 Token 结算 |\n| 退回 | 预扣与结算的差额自动退回，不用申请 |\n| 失败 | 上游失败/超时不计费，预留全额退回 |\n\n展开我这条回复下方的**收据**，就能看到这套流程在本条消息上的演示数字。测试阶段费率是 1:1 标定，不产生真实费用。";
  var GENERIC = "（演示回复）真实模型会结合上下文正式回答这个问题。原型阶段先向你展示三件产品设计：\n\n- **流式输出**：文字逐段出现，随时可停\n- **收据**：这条回复下方有本次调用的用量明细（演示估算）\n- **分支**：对任一回复点「从这里分支」，可以从那一点岔出一条新会话，不污染原对话\n\n想看失败长什么样，点输入框上方的「演示：请求失败诊断」。";

  function pickResponse(text) {
    if (/代码|code|python|函数|脚本/i.test(text)) return { type: "text", body: CODE };
    if (/额度|价格|费用|收费|计费|收据/.test(text)) return { type: "text", body: QUOTA };
    if (/介绍|你是谁|功能|是什么/.test(text)) return { type: "text", body: INTRO };
    return { type: "text", body: GENERIC };
  }

  /* ---------------- 消息渲染 ---------------- */
  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  function receiptHtml(m) {
    return '<details class="receipt"><summary>本次调用收据（演示估算）</summary>' +
      "<table><tbody>" +
      "<tr><th>模型</th><td><code>" + esc(m.model) + "</code></td></tr>" +
      "<tr><th>用量</th><td>输入 " + m.inTok + " tok · 输出 " + m.outTok + " tok</td></tr>" +
      "<tr><th>计费</th><td>预扣 " + m.reserve + " → 结算 " + m.settle + "（退回 " + (m.reserve - m.settle) + "）· 测试标定 1:1</td></tr>" +
      "<tr><th>状态</th><td>" + esc(m.status) + " · 耗时 " + m.ms + " ms · 演示数据，非真实账单</td></tr>" +
      "</tbody></table></details>";
  }

  function diagCardHtml() {
    return '<div class="diag"><span class="side">问题在上游一侧</span>' +
      "<h4>诊断卡（演示）：这次请求没有成功</h4>" +
      "<p><strong>发生了什么：</strong>上游免费池今日额度已耗尽，网关返回 429。这不是你的 Key 或参数有问题。</p>" +
      "<p><strong>计费：</strong>本次失败不计费，预扣已全额退回（见下方收据口径）。</p>" +
      "<p><strong>下一步：</strong>等免费池次日恢复，或降低请求频率后重试；持续出现请看服务状态页公告。</p>" +
      '<div class="row"><button class="btn btn-pri btn-sm" type="button" data-act="retry-demo">重试一次</button>' +
      '<a class="btn btn-ghost btn-sm" href="#/status">查看服务状态</a>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="copy-diag">复制诊断信息</button></div></div>';
  }

  function addMessageEl(m, idx) {
    var div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "user" : "ai");
    var who = m.role === "user" ? "你" : "Aivaro · " + currentModel.name;
    var inner = '<div class="who">' + esc(who) + (m.role === "assistant" ? ' <span class="badge demo">演示回复</span>' : "") + "</div>";
    if (m.kind === "diag") {
      inner += diagCardHtml();
    } else {
      inner += '<div class="body">' + (m.html || renderMarkdown(m.text || "")) + "</div>";
    }
    if (m.role === "assistant") {
      inner += '<div class="msg-actions">' +
        '<button type="button" data-act="regen" data-idx="' + idx + '">↻ 重新生成</button>' +
        '<button type="button" data-act="branch" data-idx="' + idx + '">⑂ 从这里分支</button></div>';
      if (m.receipt) inner += receiptHtml(m.receipt);
    }
    div.innerHTML = inner;
    msgsEl.appendChild(div);
    return div;
  }

  function renderMessages() {
    var s = active();
    msgsEl.innerHTML = "";
    if (!s || s.messages.length === 0) {
      msgsEl.innerHTML = '<div class="empty-chat"><div class="big">你好，我是 Aivaro</div>' +
        "<div>演示模式：回复为本地模拟。选一个开始，或直接输入问题。</div>" +
        '<div class="chips">' +
        '<button type="button" data-chip="帮我写一段 Python 斐波那契代码">写一段 Python 代码</button>' +
        '<button type="button" data-chip="介绍一下你自己和 Aivaro 的功能">介绍一下你自己</button>' +
        '<button type="button" data-chip="额度是怎么扣费的？">额度怎么扣费</button>' +
        '<button type="button" data-chip="__diag__">演示：请求失败诊断</button>' +
        "</div></div>";
      msgsEl.querySelectorAll("[data-chip]").forEach(function (c) {
        c.addEventListener("click", function () {
          var v = c.getAttribute("data-chip");
          if (v === "__diag__") { sendUser("为什么我的请求失败了？（演示诊断）", true); }
          else { $("composerInput").value = v; sendFromComposer(); }
        });
      });
      return;
    }
    s.messages.forEach(function (m, i) { addMessageEl(m, i); });
    scrollDown();
  }

  /* ---------------- 发送与流式 ---------------- */
  var input = $("composerInput"), sendBtn = $("sendBtn");
  var streaming = null; // {timer, finish}

  function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 130) + "px"; }
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendFromComposer(); }
  });
  sendBtn.addEventListener("click", function () {
    if (streaming) { streaming.stop(); } else { sendFromComposer(); }
  });
  function sendFromComposer() {
    var text = input.value.trim();
    if (!text || streaming) return;
    input.value = ""; autoGrow();
    sendUser(text, false);
  }

  function sendUser(text, forceDiag) {
    var s = active();
    s.messages.push({ role: "user", text: text });
    if (s.messages.length === 1) s.title = text.slice(0, 20);
    save(); renderSessions($("sessSearch").value); renderMessages();
    startAssistant(text, forceDiag);
  }

  function startAssistant(userText, forceDiag) {
    var s = active();
    var t0 = Date.now();
    var resp = forceDiag ? { type: "diag" } : pickResponse(userText);
    var msg = { role: "assistant", kind: resp.type === "diag" ? "diag" : "text", text: "", receipt: null };
    s.messages.push(msg);
    var idx = s.messages.length - 1;
    var el = addMessageEl(msg, idx);
    var bodyEl = el.querySelector(".body");
    scrollDown();

    function finalize(stopped) {
      var ms = Date.now() - t0;
      var inTok = estTokens(userText);
      var outTok = resp.type === "diag" ? 0 : estTokens(msg.text || "");
      var reserve = inTok + 600, settle = resp.type === "diag" ? 0 : inTok + outTok;
      if (resp.type === "diag") { reserve = inTok + 600; }
      msg.receipt = { model: currentModel.id, inTok: inTok, outTok: outTok, reserve: reserve,
        settle: settle, status: resp.type === "diag" ? "失败 · 未计费" : (stopped ? "已停止 · 按已生成部分结算（演示）" : "成功"), ms: ms };
      quota.used += settle; renderPulse();
      save(); renderMessages();
    }

    if (resp.type === "diag") { setTimeout(function () { finalize(false); }, 500); return; }

    var full = resp.body, pos = 0;
    if (bodyEl) { bodyEl.style.whiteSpace = "pre-wrap"; }
    sendBtn.classList.add("stop"); sendBtn.textContent = "■";
    var timer = setInterval(function () {
      pos = Math.min(full.length, pos + 14 + Math.floor(Math.random() * 10));
      msg.text = full.slice(0, pos);
      if (bodyEl) { bodyEl.textContent = msg.text; }
      scrollDown();
      if (pos >= full.length) { clearInterval(timer); streaming = null; sendBtn.classList.remove("stop"); sendBtn.textContent = "↑"; finalize(false); }
    }, 32);
    streaming = { stop: function () {
      clearInterval(timer); streaming = null;
      sendBtn.classList.remove("stop"); sendBtn.textContent = "↑";
      finalize(true);
    } };
  }

  msgsEl.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    var s = active();
    if (act === "retry-demo") { startAssistant("为什么我的请求失败了？", false); return; }
    if (act === "copy-diag") {
      if (navigator.clipboard) navigator.clipboard.writeText("Aivaro 诊断（演示）：时间 " + new Date().toLocaleString("zh-CN") + " · 模型 " + currentModel.id + " · 结果 429 · 归因 上游免费池额度耗尽 · 计费 未扣费").catch(function () {});
      b.textContent = "已复制"; setTimeout(function () { b.textContent = "复制诊断信息"; }, 1400); return;
    }
    var idx = +b.getAttribute("data-idx");
    if (act === "branch") {
      var copy = s.messages.slice(0, idx + 1).map(function (m) { return Object.assign({}, m); });
      var ns = newSession(s.title + "（分支）");
      ns.messages = copy; activeId = ns.id;
      save(); renderSessions($("sessSearch").value); renderMessages();
    }
    if (act === "regen") {
      var userMsg = null;
      for (var i = idx - 1; i >= 0; i--) { if (s.messages[i].role === "user") { userMsg = s.messages[i]; break; } }
      if (!userMsg) return;
      s.messages.splice(idx, 1);
      save(); renderMessages();
      startAssistant(userMsg.text, /演示诊断/.test(userMsg.text));
    }
  });

  /* ---------------- 开发者：错误卡 ---------------- */
  var ERR = {
    "401": { side: "你的请求一侧", what: "网关没有认出你的 Key：可能没带 Authorization 头、Key 拼错、或 Key 已被撤销。", steps: ["确认请求头是 Authorization: Bearer 你的Key", "到控制台核对 Key 状态，必要时新建一个", "不要把 Key 写进公开代码仓库"] },
    "403": { side: "额度一侧", what: "Key 有效，但账户总额度或该 Key 的上限已耗尽，或该 Key 被限制了可用模型。", steps: ["在控制台看剩余额度与 Key 的模型限制", "测试阶段额度由管理员发放，耗尽后联系管理员", "给不同用途设独立 Key，避免互相挤占"] },
    "404": { side: "请求参数一侧", what: "model 参数与已接入的模型 ID 对不上（测试模型的 :free 后缀最容易漏）。", steps: ["对照模型中心原样复制模型 ID", "检查多余空格与大小写"] },
    "429": { side: "频率/上游一侧", what: "触发了网关限流，或上游免费池的每日/每分钟限额已用完（测试用户共享）。", steps: ["降低并发，间隔数十秒重试", "看服务状态页是否有公告", "持续出现通常是免费池耗尽，次日恢复"] },
    "500": { side: "上游一侧", what: "上游模型服务故障、超时或连接中断。这类失败不扣减额度。", steps: ["稍后重试", "先看服务状态页确认网关本身在线", "多次失败请带请求时间与模型名反馈"] }
  };
  var errCard = $("errCard");
  document.querySelectorAll("#errTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#errTabs button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      var d = ERR[b.getAttribute("data-err")];
      errCard.innerHTML = "<h3>" + b.textContent + ' <span class="badge demo">诊断卡</span></h3>' +
        "<p><strong>问题在哪一侧：</strong>" + d.side + "</p><p><strong>发生了什么：</strong>" + d.what + "</p>" +
        "<p><strong>按顺序排查：</strong></p><ul style='margin:4px 0 0;padding-left:20px;color:var(--soft)'>" +
        d.steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ul>";
    });
  });

  /* ---------------- 状态页 ---------------- */
  function fmtDur(sec) {
    if (sec < 60) return "约 " + Math.floor(sec) + " 秒";
    if (sec < 3600) return "约 " + Math.floor(sec / 60) + " 分钟";
    if (sec < 86400) return "约 " + (sec / 3600).toFixed(1) + " 小时";
    return "约 " + (sec / 86400).toFixed(1) + " 天";
  }
  var gwLoaded = false;
  function loadGatewayStatus() {
    if (gwLoaded) return; gwLoaded = true;
    var dot = $("gwDot"), title = $("gwTitle"), meta = $("gwMeta"), checked = $("gwChecked");
    fetch("https://8081-agqyuuzd3ejtzmhsnnby2wcjxm.instabox.tech/api/status", { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var d = (j && j.data) || j;
        if (!j || j.ok === false || j.success === false) throw new Error("bad");
        dot.className = "dot ok";
        title.textContent = "网关在线，接口可达（实时）";
        var parts = [];
        if (d.version) parts.push("网关版本：" + d.version);
        if (typeof d.start_time === "number" && d.start_time > 0) parts.push("本次启动至今：" + fmtDur(Date.now() / 1000 - d.start_time));
        meta.textContent = parts.join(" · ") || "运行状态：在线（测试环境，闲置时可能暂停）";
      })
      .catch(function () {
        dot.className = "dot bad";
        title.textContent = "暂时无法获取网关状态";
        meta.textContent = "网关可能正在唤醒或处于暂停，请稍后刷新重试。";
      })
      .finally(function () { checked.textContent = "查询时间：" + new Date().toLocaleString("zh-CN"); });
  }

  var DIAG = {
    "401": "这是 Key 问题，与网关是否在线无关：按开发者中心的 401 诊断卡三步自检，多数是请求头或 Key 状态问题。",
    "403": "这是额度问题：网关与上游都正常工作，只是你的账户或该 Key 的额度已耗尽，或 Key 被限制了模型范围。",
    "429": "先分清两种 429：网关限流（请求太密，降频即恢复）与上游免费池耗尽（所有测试用户共享，次日恢复）。看上方网关状态：在线且持续 429，多半是免费池。",
    "slow": "对话站一直转圈通常是上游响应慢或免费池排队，也可能是本机网络问题。先看上方网关状态，再换个简单问题重试；对话站本身不保存记录，刷新不会丢已发送的内容之外的数据。",
    "down": "页面打不开先区分：只有你打不开（本地网络/DNS）还是大家都打不开（看上方网关状态与官网状态页）。免费托管闲置会暂停，首次打开慢几秒到几十秒属正常唤醒。"
  };
  var diagCard = $("diagCard");
  document.querySelectorAll("#diagTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#diagTabs button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      diagCard.innerHTML = "<h3>" + b.textContent + "</h3><p>" + DIAG[b.getAttribute("data-diag")] + "</p>";
    });
  });

  /* ---------------- 控制台演示图 ---------------- */
  (function () {
    var vals = [320, 410, 380, 520, 610, 480, 720, 690, 540, 830, 760, 910, 840, 1787];
    var bars = $("usageBars"), bx = $("usageBarsX");
    if (!bars) return;
    var max = Math.max.apply(null, vals);
    bars.innerHTML = vals.map(function (v) { return '<i style="height:' + Math.max(4, Math.round(v / max * 100)) + '%" title="' + v + '"></i>'; }).join("");
    var today = new Date();
    bx.innerHTML = vals.map(function (_, i) {
      var d = new Date(today.getTime() - (vals.length - 1 - i) * 86400000);
      return "<span>" + (i % 2 === 0 ? (d.getMonth() + 1) + "/" + d.getDate() : "") + "</span>";
    }).join("");
  })();

  /* ---------------- 初始化 ---------------- */
  load();
  renderSessions("");
  renderMessages();
  renderPulse();
  applyRoute();
})();
