/* Ailexity Retail — landing page behaviour.
   Nothing here is required to read the page: it adds the live APK details,
   the overflow menu, the active nav link, the nav shadow once the page moves,
   and a light scroll reveal. */

(function () {
  "use strict";

  // Only hide the reveal targets once we know we can show them again.
  document.documentElement.classList.add("js");

  /* ---------- year ---------------------------------------------------- */
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- APK details --------------------------------------------- */
  // The server reports whether the package is published, how big it is and
  // which version it carries, so the page never offers a download that 404s.
  var apkButton = document.getElementById("apkButton");
  var apkMeta = document.getElementById("apkMeta");
  var apkLinks = [].slice.call(document.querySelectorAll("[data-apk], #apkButton"));

  function formatSize(bytes) {
    if (!bytes || bytes < 1024) return bytes ? bytes + " B" : "";
    var mb = bytes / (1024 * 1024);
    if (mb >= 1) return (mb >= 10 ? Math.round(mb) : mb.toFixed(1)) + " MB";
    return Math.round(bytes / 1024) + " KB";
  }

  function markUnavailable(message) {
    apkLinks.forEach(function (link) {
      link.setAttribute("aria-disabled", "true");
      link.removeAttribute("download");
      link.setAttribute("href", "mailto:ailexity.info@gmail.com?subject=Ailexity%20Retail%20APK");
      var label = link.querySelector("span");
      if (label) label.textContent = "Ask for the APK";
    });
    if (apkMeta) {
      apkMeta.textContent = message;
      apkMeta.classList.add("is-missing");
    }
  }

  fetch("/api/apk", { headers: { accept: "application/json" } })
    .then(function (response) {
      if (!response.ok) throw new Error("apk info unavailable");
      return response.json();
    })
    .then(function (info) {
      if (!info || !info.available) {
        markUnavailable(
          "The Android package has not been published on this server yet — " +
          "write to us and we will send it."
        );
        return;
      }
      var bits = [];
      if (info.version) bits.push("v" + info.version);
      var size = formatSize(info.size);
      if (size) bits.push(size);
      if (info.minAndroid) bits.push("Android " + info.minAndroid + " and newer");
      bits.push("installs outside the Play Store");
      if (info.updated) {
        var when = new Date(info.updated);
        if (!isNaN(when)) {
          bits.push("updated " + when.toLocaleDateString(undefined, {
            day: "numeric", month: "short", year: "numeric"
          }));
        }
      }
      if (apkMeta) {
        apkMeta.textContent = bits.join("  ·  ");
        apkMeta.classList.remove("is-missing");
      }
      if (apkButton && info.url) {
        apkLinks.forEach(function (link) { link.setAttribute("href", info.url); });
      }
    })
    .catch(function () {
      // Opened as a plain file, or the server is an older build: leave the
      // link alone and state the requirement without inventing a version.
      if (apkMeta) apkMeta.textContent = "Installs outside the Play Store";
    });

  /* ---------- overflow menu (⋮) ---------------------------------------- */
  // On narrow screens it also carries the section links the nav hides.
  var menuToggle = document.getElementById("menuToggle");
  var menu = document.getElementById("navMenu");

  function setMenu(open) {
    if (!menu || !menuToggle) return;
    menu.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
  }

  if (menu && menuToggle) {
    menuToggle.addEventListener("click", function (event) {
      event.stopPropagation();
      setMenu(menu.hidden);
      if (!menu.hidden) {
        var first = menu.querySelector("a");
        if (first && first.offsetParent === null) first = menu.querySelector(".menu-panel > a");
        if (first) first.focus();
      }
    });
    menu.addEventListener("click", function (event) {
      if (event.target.closest("a")) setMenu(false);
    });
    document.addEventListener("click", function (event) {
      if (!menu.hidden && !menu.contains(event.target)) setMenu(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !menu.hidden) {
        setMenu(false);
        menuToggle.focus();
      }
    });
  }

  /* ---------- nav: shadow once scrolled, active section ----------------- */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var navLinks = [].slice.call(document.querySelectorAll(".nav-links a[data-nav]"));
  var sections = navLinks
    .map(function (link) { return document.getElementById(link.dataset.nav); })
    .filter(Boolean);

  function setActive(id) {
    navLinks.forEach(function (link) {
      link.classList.toggle("is-active", link.dataset.nav === id);
    });
  }

  if ("IntersectionObserver" in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    sections.forEach(function (section) { spy.observe(section); });
  }

  /* ---------- scroll reveal ------------------------------------------- */
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var reveals = [].slice.call(document.querySelectorAll(".reveal"));

  if (reduced || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var shower = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        shower.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: .06 });
    reveals.forEach(function (el) { shower.observe(el); });
  }

})();
