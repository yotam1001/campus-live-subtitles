# Campus Live Subtitles

A local-first Chrome extension that captures audio from a Campus.gov.il video tab and overlays live Hebrew subtitles on the page.

The transcription backend runs on your own computer with [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper), a CTranslate2 implementation of OpenAI's open-source [Whisper](https://github.com/openai/whisper) speech recognition models. No OpenAI API key is required.

## What It Does

- Captures audio from the active Campus.gov.il tab with Chrome extension tab capture.
- Sends short WAV chunks to a local server at `http://127.0.0.1:8765`.
- Transcribes locally with Whisper-compatible model sizes such as `base`, `small`, `medium`, and `large-v3`.
- Draws subtitles at the bottom center of the video page.
- Stops the local server by default when the extension is stopped.
- Uses `AudioWorkletNode` for browser audio processing.

## Privacy

In the default setup, audio stays on your machine. The browser extension sends audio only to the local server URL shown in the popup.

The first run may download Whisper model files from Hugging Face through `faster-whisper`. That download is for model weights only; course audio is not uploaded as part of the default local workflow.

The repository does not include course audio, transcripts, model weights, virtual environments, API keys, or local machine paths.

## Requirements

- Chrome or a Chromium-based browser that supports Manifest V3 extension APIs.
- Python 3.10 or newer.
- Windows PowerShell or Command Prompt for the included launch scripts.

The extension uses Chrome's documented audio capture/offscreen-document pattern. See Chrome's [audio recording and screen capture documentation](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture).

## Quick Start

Start the local transcription server:

```powershell
cd local-whisper-server
.\run.bat
```

Or with PowerShell:

```powershell
cd local-whisper-server
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

The first run installs Python dependencies and downloads the selected Whisper model. Keep the server window open while using subtitles.

Load the extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the repository folder.
5. Open a video on `https://app.campus.gov.il/`.
6. Click the Campus Live Subtitles extension icon.
7. Press Start.

Subtitles should appear near the bottom center of the page after the first audio chunks are processed.

## Model Choice

The default local model is `base` because it is relatively fast on CPU. For better Hebrew accuracy, try:

- `small`: better accuracy, often still usable on CPU.
- `medium`: more accurate, but likely slower.
- `large-v3`: best available option in the popup, but can lag badly without a strong machine or GPU setup.

At 2x playback speed, transcription is harder. If accuracy is poor, try `small` and reduce playback to 1.5x.

OpenAI's Whisper model card lists the model size families and notes that larger models generally trade speed for accuracy. See the official [Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md).

## Local Server

The local server exposes:

- `GET /health`: health check.
- `POST /transcribe`: accepts a multipart `file` field and returns JSON transcription text.
- `POST /unload`: unloads currently loaded models from memory.
- `POST /shutdown`: unloads models and exits the server process.

By default, the extension calls `/shutdown` when you press Stop. Turn off "Stop local server when stopped" in the popup if you want to keep the model loaded between videos.

If you disable or remove the extension directly from `chrome://extensions`, Chrome may not give the extension a chance to call `/shutdown`. Press Stop in the popup first when you want the local server to exit cleanly.

The server allowlists supported model sizes and rejects browser requests whose `Origin` is not a Chrome extension origin.

## Development Checks

```powershell
node --check background.js
node --check audio-worklet.js
node --check offscreen.js
node --check popup.js
python -m py_compile local-whisper-server/server.py
```

## License

This project is released under the MIT License. `faster-whisper` and OpenAI Whisper are also MIT-licensed; check their repositories for their full license notices.
