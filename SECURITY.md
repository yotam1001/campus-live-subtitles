# Security

Campus Live Subtitles is designed to be local-first. In the default setup, tab audio is sent only to the local server at `http://127.0.0.1:8765`.

## Reporting Issues

Please do not include private video URLs, transcripts, API keys, or personal filesystem paths in public issues. Open a minimal reproduction with:

- Chrome version
- operating system
- selected Whisper model size
- relevant extension error text
- local server log lines without private content

## Permissions

The extension requests:

- `tabCapture` to capture the active tab audio after the user presses Start.
- `offscreen` to keep audio capture running outside the popup.
- `scripting` and `activeTab` to inject the subtitle overlay into the current Campus page.
- `storage` to save local UI settings.
- `tabs` to identify the active tab and deliver overlay/status messages.

The manifest limits page injection to `https://app.campus.gov.il/*`.
