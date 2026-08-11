import argparse
import importlib.metadata
import json
import time

from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--media", required=True)
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--prompt", default="")
    args = parser.parse_args()

    started = time.perf_counter()
    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        download_root=args.model_root,
    )
    segments_iter, info = model.transcribe(
        args.media,
        language="zh",
        beam_size=5,
        vad_filter=True,
        initial_prompt=args.prompt[:1000] or None,
    )
    segments = []
    for segment in segments_iter:
        text = str(segment.text or "").strip()
        if text:
            segments.append({
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": text,
            })

    result = {
        "engine": "faster-whisper",
        "engineVersion": importlib.metadata.version("faster-whisper"),
        "model": args.model,
        "device": "cpu",
        "computeType": "int8",
        "language": str(info.language or ""),
        "languageProbability": round(float(info.language_probability or 0), 6),
        "durationSeconds": round(float(info.duration or 0), 3),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "transcript": "".join(item["text"] for item in segments),
        "segments": segments,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
