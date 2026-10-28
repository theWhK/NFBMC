# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["faster-whisper==1.2.1", "numpy", "imageio-ffmpeg"]
# ///
"""Confere as vozes do modo história com o Whisper (reconhecimento de fala).

Para cada fala gravada em client/public/vozes/historia/, transcreve o áudio e
compara com o texto do roteiro. Mostra a nota (0 a 1) de cada uma e lista as
que ficaram abaixo do mínimo, para regravar com outra voz ou outro texto.

    uv run scripts/conferir-vozes.py            # todas
    uv run scripts/conferir-vozes.py prologo-3  # algumas

Na primeira vez baixa o modelo "small" do Whisper (~460 MB, cache do Hugging Face).
"""

from __future__ import annotations

import difflib
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent
VOZES = ROOT / "client" / "public" / "vozes" / "historia"
MINIMO = 0.8


def words(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]", " ", text).split()


def audio(path: Path) -> np.ndarray:
    """MP3 → amostras a 16 kHz mono (o que o Whisper espera)."""
    raw = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def main() -> None:
    lines = json.loads(subprocess.run(["node", str(ROOT / "scripts" / "falas.ts")], check=True, capture_output=True, text=True).stdout)
    asked = set(sys.argv[1:])
    model = WhisperModel("small", device="cpu", compute_type="int8")
    bad = []
    for line in lines:
        if asked and line["id"] not in asked:
            continue
        path = VOZES / f"{line['id']}.mp3"
        if not path.exists():
            bad.append((line["id"], 0.0, "(sem arquivo)"))
            continue
        segments, _ = model.transcribe(audio(path), language="pt")
        heard = " ".join(s.text for s in segments).strip()
        score = difflib.SequenceMatcher(None, words(line["text"]), words(heard)).ratio()
        print(f"{score:.2f}  {line['id']:22s} [{line['speaker'] or 'narrador'}] {heard}")
        if score < MINIMO:
            bad.append((line["id"], score, heard))
    print(f"\n{len(bad)} abaixo de {MINIMO}:" if bad else "\nTodas as falas passaram.")
    for key, score, heard in bad:
        print(f"  {key}: {score:.2f} {heard}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
