#!/usr/bin/env python3
"""Generate WebVTT captions for every video in ../videos/ using OpenAI Whisper.

Usage:
    python scripts/transcribe.py                  # transcribe new videos only
    python scripts/transcribe.py --force          # re-transcribe everything
    python scripts/transcribe.py --model small    # smaller / faster model
"""

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIDEO_DIR = ROOT / "videos"
TRANSCRIPT_DIR = ROOT / "transcripts"
SUPPORTED_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}


def format_timestamp(seconds: float) -> str:
    """Format seconds as a WebVTT timestamp (HH:MM:SS.mmm)."""
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def write_vtt(segments, out_path: Path) -> None:
    lines = ["WEBVTT", ""]
    for seg in segments:
        start = format_timestamp(seg["start"])
        end = format_timestamp(seg["end"])
        text = seg["text"].strip()
        if not text:
            continue
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")


def transcribe_one(model, video_path: Path, out_path: Path, fp16: bool) -> bool:
    print(f"  → {video_path.name}", flush=True)
    t0 = time.time()
    try:
        result = model.transcribe(str(video_path), verbose=False, fp16=fp16)
    except Exception as exc:  # noqa: BLE001 — we want to keep going on any failure
        print(f"    ✗ failed ({exc})", flush=True)
        return False
    write_vtt(result.get("segments", []), out_path)
    print(f"    ✓ {out_path.name} ({time.time() - t0:.1f}s)", flush=True)
    return True


def pick_device(requested: str) -> str:
    """Return a torch device string. 'auto' prefers MPS > CUDA > CPU."""
    if requested != "auto":
        return requested
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe videos to WebVTT.")
    parser.add_argument("--force", action="store_true",
                        help="Re-transcribe even if a matching VTT already exists.")
    parser.add_argument("--model", default="medium",
                        help="Whisper model size: tiny | base | small | medium | large (default: medium)")
    parser.add_argument("--device", default="auto",
                        help="Compute device: auto | cpu | mps | cuda (default: auto)")
    args = parser.parse_args()

    if not VIDEO_DIR.exists():
        print(f"Video directory not found: {VIDEO_DIR}", file=sys.stderr)
        return 1
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)

    videos = sorted(p for p in VIDEO_DIR.iterdir()
                    if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)
    if not videos:
        print(f"No videos found in {VIDEO_DIR}.")
        return 0

    try:
        import whisper  # type: ignore
    except ImportError:
        print("openai-whisper is not installed.\n"
              "Install with:\n  pip install openai-whisper",
              file=sys.stderr)
        return 1

    device = pick_device(args.device)
    fp16 = device == "cuda"  # MPS fp16 is flaky for some ops; CPU fp16 is unsupported.
    print(f"Loading Whisper model: {args.model} on {device}")
    t_load = time.time()
    model = whisper.load_model(args.model, device=device)
    print(f"  loaded in {time.time() - t_load:.1f}s\n")

    total_start = time.time()
    done = skipped = failed = 0

    for v in videos:
        out_path = TRANSCRIPT_DIR / f"{v.stem}.vtt"
        if out_path.exists() and not args.force:
            print(f"  ⤷ skip {v.name} (already has VTT — use --force to redo)")
            skipped += 1
            continue
        if transcribe_one(model, v, out_path, fp16=fp16):
            done += 1
        else:
            failed += 1

    elapsed = time.time() - total_start
    print(f"\nFinished: {done} transcribed, {skipped} skipped, {failed} failed "
          f"in {elapsed:.1f}s.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
