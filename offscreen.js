const DEFAULT_OPTIONS = {
  chunkSeconds: 4,
  endpoint: "http://127.0.0.1:8765/transcribe",
  language: "he",
  localModelSize: "base",
  maxConcurrent: 2,
  overlapSeconds: 0.8,
  prompt: "This is a Hebrew psychometry preparation lesson. Transcribe the lecturer accurately in Hebrew.",
  stopLocalServerOnStop: true
};

let sessionCounter = 0;
let state = createEmptyState();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return;

  handleMessage(message)
    .then((response) => sendResponse(response ?? { ok: true }))
    .catch((error) => {
      reportError(error.message);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "PING":
      return { ok: true };
    case "START_CAPTURE":
      await startCapture(message.streamId, message.tabId, message.options);
      return { ok: true };
    case "STOP_CAPTURE":
      await stopCapture({ shutdownLocalServer: true });
      return { ok: true };
    default:
      return { ok: false, error: `Unknown offscreen message type: ${message.type}` };
  }
}

function createEmptyState() {
  return {
    audioContext: null,
    chunkSamples: 0,
    inflight: 0,
    maxConcurrent: DEFAULT_OPTIONS.maxConcurrent,
    options: { ...DEFAULT_OPTIONS },
    overlapSamples: 0,
    overlapTail: new Float32Array(0),
    pending: [],
    processor: null,
    queue: [],
    sampleCount: 0,
    sampleRate: 48000,
    sequence: 0,
    sessionId: sessionCounter,
    source: null,
    stream: null,
    tabId: null
  };
}

async function startCapture(streamId, tabId, rawOptions = {}) {
  if (!streamId) throw new Error("Missing tab audio stream id.");

  await stopCapture({ shutdownLocalServer: false });

  const options = normalizeOptions(rawOptions);

  state = createEmptyState();
  state.options = options;
  state.sessionId = ++sessionCounter;
  state.tabId = tabId;
  state.maxConcurrent = options.maxConcurrent;

  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  state.audioContext = new AudioContext();
  await state.audioContext.resume();
  state.sampleRate = state.audioContext.sampleRate;
  state.chunkSamples = Math.max(1, Math.round(options.chunkSeconds * state.sampleRate));
  state.overlapSamples = Math.max(0, Math.round(options.overlapSeconds * state.sampleRate));
  state.source = state.audioContext.createMediaStreamSource(state.stream);

  const playbackGain = state.audioContext.createGain();
  playbackGain.gain.value = 1;
  state.source.connect(playbackGain).connect(state.audioContext.destination);

  await state.audioContext.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js"));

  state.processor = new AudioWorkletNode(state.audioContext, "campus-audio-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1]
  });

  const silentGain = state.audioContext.createGain();
  silentGain.gain.value = 0;

  state.processor.port.onmessage = (event) => handleAudioChunk(event.data);
  state.source.connect(state.processor);
  state.processor.connect(silentGain).connect(state.audioContext.destination);

  reportStatus("Capturing tab audio...");
}

async function stopCapture({ shutdownLocalServer = false } = {}) {
  const previous = state;
  sessionCounter += 1;
  state = createEmptyState();

  if (previous.processor) {
    previous.processor.port.onmessage = null;
    previous.processor.disconnect();
  }

  if (previous.source) previous.source.disconnect();
  if (previous.stream) previous.stream.getTracks().forEach((track) => track.stop());
  if (previous.audioContext) await previous.audioContext.close().catch(() => {});

  if (
    shutdownLocalServer &&
    previous.options?.stopLocalServerOnStop
  ) {
    await shutdownLocalServerForOptions(previous.options);
  }
}

function handleAudioChunk(mono) {
  if (!state.audioContext) return;

  state.queue.push(mono);
  state.sampleCount += mono.length;

  while (state.sampleCount >= state.chunkSamples) {
    const chunk = dequeueSamples(state.chunkSamples);
    const audioForTranscription = concatFloat32(state.overlapTail, chunk);
    state.overlapTail = chunk.slice(Math.max(0, chunk.length - state.overlapSamples));
    enqueueTranscription(audioForTranscription);
  }
}

function dequeueSamples(count) {
  const all = concatFloat32(...state.queue);
  const taken = all.slice(0, count);
  const remainder = all.slice(count);

  state.queue = remainder.length ? [remainder] : [];
  state.sampleCount = remainder.length;
  return taken;
}

function enqueueTranscription(samples) {
  const sequence = ++state.sequence;
  const blob = encodeWav(samples, state.sampleRate);
  state.pending.push({
    blob,
    options: { ...state.options },
    sequence,
    sessionId: state.sessionId,
    tabId: state.tabId
  });
  pumpTranscriptionQueue();
}

function pumpTranscriptionQueue() {
  while (state.pending?.length && state.inflight < state.maxConcurrent) {
    const item = state.pending.shift();
    state.inflight += 1;

    transcribeChunk(item.blob, item.sequence, item.options)
      .then((text) => {
        if (state.sessionId !== item.sessionId) return;
        if (text) {
          chrome.runtime.sendMessage({
            source: "offscreen",
            type: "SUBTITLE_TEXT",
            tabId: item.tabId,
            sequence: item.sequence,
            text
          });
        }
      })
      .catch((error) => {
        if (state.sessionId === item.sessionId) reportError(error.message, item.tabId);
      })
      .finally(() => {
        if (state.sessionId !== item.sessionId) return;
        state.inflight -= 1;
        pumpTranscriptionQueue();
      });
  }
}

async function transcribeChunk(blob, sequence, options) {
  const form = new FormData();
  form.append("file", blob, `campus-live-subtitles-${sequence}.wav`);
  form.append("language", options.language);
  form.append("model_size", options.localModelSize);

  if (options.prompt) {
    form.append("prompt", options.prompt);
  }

  const response = await fetch(options.endpoint, {
    method: "POST",
    body: form
  }).catch(() => {
    throw new Error("Local Whisper server is not reachable. Start .\\run.bat and try again.");
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Local Whisper failed (${response.status}): ${truncate(errorText, 220)}`);
  }

  const data = await response.json();
  return (data.text || "").trim();
}

async function shutdownLocalServerForOptions(options) {
  try {
    const shutdownUrl = getSiblingEndpointUrl(options.endpoint, "/shutdown");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);

    await fetch(shutdownUrl, {
      method: "POST",
      signal: controller.signal
    });

    clearTimeout(timeoutId);
  } catch {
    // The server may already be gone, which is fine after Stop.
  }
}

function getSiblingEndpointUrl(endpoint, pathname) {
  const url = new URL(endpoint);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeOptions(rawOptions) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  options.chunkSeconds = clampNumber(options.chunkSeconds, 2, 12, DEFAULT_OPTIONS.chunkSeconds);
  options.endpoint = String(options.endpoint || DEFAULT_OPTIONS.endpoint).trim() || DEFAULT_OPTIONS.endpoint;
  options.overlapSeconds = clampNumber(options.overlapSeconds, 0, 2, DEFAULT_OPTIONS.overlapSeconds);
  options.maxConcurrent = Math.round(clampNumber(options.maxConcurrent, 1, 4, DEFAULT_OPTIONS.maxConcurrent));
  options.language = String(options.language || DEFAULT_OPTIONS.language).trim() || DEFAULT_OPTIONS.language;
  options.localModelSize = String(options.localModelSize || DEFAULT_OPTIONS.localModelSize).trim() || DEFAULT_OPTIONS.localModelSize;
  options.prompt = String(options.prompt || "").trim();
  options.stopLocalServerOnStop = options.stopLocalServerOnStop !== false;
  return options;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function concatFloat32(...arrays) {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = headerSize;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function reportStatus(text) {
  chrome.runtime.sendMessage({
    source: "offscreen",
    type: "TRANSCRIPTION_STATUS",
    tabId: state.tabId,
    text
  });
}

function reportError(text, tabId = state.tabId) {
  chrome.runtime.sendMessage({
    source: "offscreen",
    type: "TRANSCRIPTION_ERROR",
    tabId,
    text
  });
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}
