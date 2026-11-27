/* Zavbox gate: this game's TV page only starts when it was opened from Zavbox.
   Zavbox adds ?from=zavbox when it launches a game. Without it, this page swaps
   itself for open-from-zavbox.html (a short note with a link to Zavbox) before the
   game loads. The flag is remembered for this tab only (sessionStorage), so reloads
   and in-game restarts keep working. Phone pages do not load this file.
   This is a UX gate, not security: anyone who adds ?from=zavbox can still play. */
(function () {
  var KEY = "zavbox.launched." + (location.pathname.split("/").filter(Boolean)[0] || "game");
  var ok = false;
  try {
    if (new URLSearchParams(location.search).get("from") === "zavbox") {
      ok = true;
      try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    } else {
      try { ok = sessionStorage.getItem(KEY) === "1"; } catch (e) {}
    }
  } catch (e) { ok = true; } /* a very old browser: never lock it out */
  window.__zavboxGate = ok ? "open" : "blocked";
  if (!ok) location.replace(new URL("open-from-zavbox.html", location.href).href);
})();
