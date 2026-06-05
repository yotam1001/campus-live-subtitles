import argparse
import os
import re
import tempfile
import threading
from pathlib import Path

from faster_whisper import WhisperModel
from flask import Flask, jsonify, request


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

model_lock = threading.Lock()
loaded_models = {}
default_model_size = "base"
default_device = "cpu"
default_compute_type = "int8"
allowed_model_sizes = {"tiny", "base", "small", "medium", "large-v3"}
language_pattern = re.compile(r"^[a-z]{2,3}$")


@app.before_request
def reject_cross_site_browser_requests():
    origin = request.headers.get("Origin")
    if origin and not origin.startswith("chrome-extension://"):
        return jsonify({"error": "Cross-origin browser requests are not allowed."}), 403


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "models_loaded": list(loaded_models.keys()),
        "allowed_model_sizes": sorted(allowed_model_sizes),
    })


@app.post("/unload")
def unload():
    unload_models()
    return jsonify({"ok": True, "models_loaded": []})


@app.post("/shutdown")
def shutdown():
    unload_models()

    timer = threading.Timer(0.25, stop_process)
    timer.daemon = True
    timer.start()

    return jsonify({"ok": True, "shutting_down": True})


@app.post("/transcribe")
def transcribe():
    audio_file = request.files.get("file")
    if audio_file is None:
        return jsonify({"error": "Missing multipart file field named 'file'."}), 400

    language = (request.form.get("language") or "he").strip() or "he"
    model_size = (request.form.get("model_size") or default_model_size).strip() or default_model_size
    initial_prompt = (request.form.get("prompt") or "").strip() or None
    if initial_prompt and len(initial_prompt) > 500:
        initial_prompt = initial_prompt[:500]

    if model_size not in allowed_model_sizes:
        return jsonify({"error": "Unsupported model size."}), 400

    if not language_pattern.fullmatch(language):
        return jsonify({"error": "Unsupported language code."}), 400

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_file.save(tmp)
        audio_path = tmp.name

    try:
        model = get_model(model_size)
        segments, info = model.transcribe(
            audio_path,
            beam_size=1,
            condition_on_previous_text=False,
            initial_prompt=initial_prompt,
            language=language,
            vad_filter=True,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return jsonify({
            "text": text,
            "language": info.language,
            "duration": info.duration,
            "model_size": model_size,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            pass


def get_model(model_size):
    key = f"{model_size}:{default_device}:{default_compute_type}"
    with model_lock:
        if key not in loaded_models:
            loaded_models[key] = WhisperModel(
                model_size,
                device=default_device,
                compute_type=default_compute_type,
            )
        return loaded_models[key]


def unload_models():
    with model_lock:
        loaded_models.clear()


def stop_process():
    os._exit(0)


def parse_args():
    parser = argparse.ArgumentParser(description="Local Whisper backend for Campus Live Subtitles.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--model", default="base", help="tiny, base, small, medium, or large-v3")
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    parser.add_argument("--compute-type", default="int8", help="int8 for CPU, float16 for CUDA")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.model not in allowed_model_sizes:
        raise SystemExit(f"Unsupported model '{args.model}'. Choose one of: {', '.join(sorted(allowed_model_sizes))}")

    default_model_size = args.model
    default_device = args.device
    default_compute_type = args.compute_type

    cache_dir = Path.home() / ".cache" / "campus-live-subtitles"
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(cache_dir))

    print(f"Campus Live Subtitles local server on http://{args.host}:{args.port}")
    print(f"Whisper model: {default_model_size} / device: {default_device} / compute: {default_compute_type}")
    print("The first transcription may take a while while the model downloads.")
    app.run(host=args.host, port=args.port, debug=False, threaded=True)
