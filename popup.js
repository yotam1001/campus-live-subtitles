const DEFAULTS = {
  chunkSeconds: 4,
  endpoint: "http://127.0.0.1:8765/transcribe",
  language: "he",
  localModelSize: "base",
  prompt: "This is a Hebrew psychometry preparation lesson. Transcribe the lecturer accurately in Hebrew.",
  stopLocalServerOnStop: true
};

const els = {
  chunkSeconds: document.querySelector("#chunkSeconds"),
  endpoint: document.querySelector("#endpoint"),
  language: document.querySelector("#language"),
  localModelSize: document.querySelector("#localModelSize"),
  prompt: document.querySelector("#prompt"),
  start: document.querySelector("#start"),
  status: document.querySelector("#status"),
  stop: document.querySelector("#stop"),
  stopLocalServerOnStop: document.querySelector("#stopLocalServerOnStop")
};

restoreSettings();

els.start.addEventListener("click", start);
els.stop.addEventListener("click", stop);

async function restoreSettings() {
  const saved = await chrome.storage.local.get({
    campusLiveSubtitles: DEFAULTS
  });

  const settings = { ...DEFAULTS, ...saved.campusLiveSubtitles };
  els.chunkSeconds.value = settings.chunkSeconds;
  els.endpoint.value = settings.endpoint;
  els.language.value = settings.language;
  els.localModelSize.value = settings.localModelSize;
  els.prompt.value = settings.prompt;
  els.stopLocalServerOnStop.checked = settings.stopLocalServerOnStop !== false;
}

async function start() {
  setBusy(true, "Starting...");

  try {
    const settings = readSettings();
    await chrome.storage.local.set({ campusLiveSubtitles: settings });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");
    if (!tab.url?.startsWith("https://app.campus.gov.il/")) {
      throw new Error("Open the Campus.gov.il video tab first, then press Start.");
    }

    await checkLocalServer(settings.endpoint);

    await injectOverlay(tab.id);

    const response = await chrome.runtime.sendMessage({
      type: "START_TRANSCRIPTION",
      tabId: tab.id,
      options: settings
    });

    if (!response?.ok) throw new Error(response?.error || "Could not start transcription.");
    setStatus("Running. You can close this popup.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function stop() {
  setBusy(true, "Stopping...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "STOP_TRANSCRIPTION" });
    if (!response?.ok) throw new Error(response?.error || "Could not stop transcription.");
    setStatus("Stopped.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function readSettings() {
  return {
    chunkSeconds: Number(els.chunkSeconds.value) || DEFAULTS.chunkSeconds,
    endpoint: els.endpoint.value.trim() || DEFAULTS.endpoint,
    language: els.language.value.trim() || DEFAULTS.language,
    localModelSize: els.localModelSize.value,
    prompt: els.prompt.value.trim(),
    stopLocalServerOnStop: els.stopLocalServerOnStop.checked
  };
}

async function injectOverlay(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["overlay.css"]
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function checkLocalServer(endpoint) {
  const healthUrl = new URL(endpoint);
  healthUrl.pathname = "/health";
  healthUrl.search = "";
  healthUrl.hash = "";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(healthUrl.toString(), {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`health check returned ${response.status}`);
  } catch {
    throw new Error("Local Whisper server is not running. Start it with .\\run.bat, then press Start again.");
  } finally {
    clearTimeout(timeoutId);
  }
}

function setBusy(isBusy, statusText) {
  els.start.disabled = isBusy;
  els.stop.disabled = isBusy;
  if (statusText) setStatus(statusText);
}

function setStatus(text) {
  els.status.textContent = text;
}
