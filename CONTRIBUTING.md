# Contributing

Thanks for helping improve Campus Live Subtitles.

## Local Development

1. Install Python 3.10 or newer.
2. Start the local Whisper server:

   ```powershell
   cd local-whisper-server
   .\run.bat
   ```

3. Load the repository folder as an unpacked extension in Chrome.
4. Test against a Campus.gov.il video page.

## Checks

Run these before opening a pull request:

```powershell
node --check background.js
node --check audio-worklet.js
node --check offscreen.js
node --check popup.js
python -m py_compile local-whisper-server/server.py
```

## Privacy

Do not commit:

- virtual environments
- downloaded model files
- audio samples
- transcripts from private courses
- personal filesystem paths
- secrets or API keys
