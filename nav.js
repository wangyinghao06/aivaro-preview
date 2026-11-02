// Aivaro 官网 — 共享小脚本：移动端导航开关 + 当前页高亮。
// 纯本地文件，无外部请求；找不到对应元素时静默跳过。
(function () {
  "use strict";

  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.querySelector("[data-nav]");

  function closeNav() {
    if (nav && nav.classList.contains("open")) {
      nav.classList.remove("open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeNav();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
    document.addEventListener("click", function (e) {
      if (nav.classList.contains("open") &&
          !nav.contains(e.target) && !toggle.contains(e.target)) {
        closeNav();
      }
    });
  }

  if (nav) {
    var current = window.location.pathname.split("/").pop() || "index.html";
    var links = nav.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      if (href === current) {
        links[i].classList.add("active");
        links[i].setAttribute("aria-current", "page");
      }
    }
  }
})();
