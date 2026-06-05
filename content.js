(() => {
  if (window.__campusLiveSubtitlesInstalled) return;
  window.__campusLiveSubtitlesInstalled = true;

  const overlay = document.createElement("div");
  overlay.id = "campus-live-subtitles-overlay";
  overlay.setAttribute("aria-live", "polite");
  overlay.hidden = true;

  const textNode = document.createElement("div");
  textNode.className = "campus-live-subtitles-text";
  overlay.appendChild(textNode);

  document.documentElement.appendChild(overlay);

  let hideTimer = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "CLS_SUBTITLE") {
      show(message.text, "subtitle", 9000);
    }

    if (message.type === "CLS_STATUS") {
      show(message.text, "status", 3500);
    }

    if (message.type === "CLS_ERROR") {
      show(message.text, "error", 12000);
    }

    if (message.type === "CLS_STOPPED") {
      show("Subtitles stopped", "status", 1800);
    }
  });

  function show(text, mode, timeoutMs) {
    if (!text) return;

    clearTimeout(hideTimer);
    overlay.hidden = false;
    overlay.dataset.mode = mode;
    textNode.textContent = text;

    hideTimer = setTimeout(() => {
      overlay.hidden = true;
    }, timeoutMs);
  }
})();
