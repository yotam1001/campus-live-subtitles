const OFFSCREEN_URL = "offscreen.html";

let activeTabId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response ?? { ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    stopCapture().catch(() => {});
  }
});

async function handleMessage(message) {
  if (!message || typeof message !== "object") return { ok: false, error: "Bad message" };
  if (message.target === "offscreen") return undefined;

  if (message.source === "offscreen") {
    await relayOffscreenMessage(message);
    return { ok: true };
  }

  switch (message.type) {
    case "START_TRANSCRIPTION":
      return startCapture(message.tabId, message.options);
    case "STOP_TRANSCRIPTION":
      return stopCapture();
    case "GET_STATUS":
      return { ok: true, activeTabId };
    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

async function startCapture(tabId, options = {}) {
  if (!tabId) throw new Error("No active tab was selected.");

  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  if (activeTabId) {
    await stopCapture();
  }

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  activeTabId = tabId;

  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_CAPTURE",
    streamId,
    tabId,
    options
  });

  await sendToTab(tabId, {
    type: "CLS_STATUS",
    text: "Listening..."
  });

  return { ok: true, activeTabId };
}

async function stopCapture() {
  if (activeTabId) {
    await sendToTab(activeTabId, { type: "CLS_STOPPED" });
  }

  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "STOP_CAPTURE"
  }).catch(() => {});

  activeTabId = null;
  return { ok: true };
}

async function ensureOffscreenDocument() {
  const hasDocument = await chrome.offscreen.hasDocument();
  if (hasDocument) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification: "Capture tab audio and transcribe it into live subtitles."
  });
}

async function waitForOffscreenReady() {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < 3000) {
    try {
      const response = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "PING"
      });

      if (response?.ok) return;
    } catch (error) {
      lastError = error;
    }

    await delay(100);
  }

  throw new Error(lastError?.message || "Offscreen audio worker did not start.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function relayOffscreenMessage(message) {
  const tabId = message.tabId || activeTabId;
  if (!tabId) return;

  if (message.type === "SUBTITLE_TEXT") {
    await sendToTab(tabId, {
      type: "CLS_SUBTITLE",
      text: message.text,
      sequence: message.sequence
    });
  }

  if (message.type === "TRANSCRIPTION_STATUS") {
    await sendToTab(tabId, {
      type: "CLS_STATUS",
      text: message.text
    });
  }

  if (message.type === "TRANSCRIPTION_ERROR") {
    await sendToTab(tabId, {
      type: "CLS_ERROR",
      text: message.text
    });
  }
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The popup injects the content script on demand, but tab changes can race.
  }
}
