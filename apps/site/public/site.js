// Small progressive enhancements. The page works fully without JavaScript.
(function () {
  var nav = document.getElementById("nav");
  var onScroll = function () { nav.classList.toggle("scrolled", window.scrollY > 10); };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  var yr = document.getElementById("yr"); if (yr) yr.textContent = String(new Date().getFullYear());

  // Reveal on scroll, and count up the stat numbers once.
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var count = function (el) {
    var to = Number(el.dataset.count), pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
    if (reduce || !to) { el.textContent = pre + to + suf; return; }
    var t0 = performance.now();
    var step = function (t) { var k = Math.min(1, (t - t0) / 1200); el.textContent = pre + Math.round(to * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  var els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("in"); }); document.querySelectorAll("[data-count]").forEach(count); }
  else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("in");
        en.target.querySelectorAll("[data-count]").forEach(count);
        io.unobserve(en.target);
      });
    }, { threshold: 0.12 });
    els.forEach(function (e) { io.observe(e); });
  }

  // Big play button over the video; native controls take over once it starts.
  var v = document.getElementById("demo"), b = document.getElementById("play");
  if (v && b) {
    b.addEventListener("click", function () { b.hidden = true; v.play(); });
    v.addEventListener("play", function () { b.hidden = true; });
  }
})();
