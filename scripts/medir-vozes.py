# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["librosa", "pyloudnorm", "faster-whisper==1.2.1", "soundfile", "numpy<2", "imageio-ffmpeg"]
# ///
"""Mede as vozes sem precisar ouvir (e compara com uma versão anterior).

Para cada fala: quanto o Whisper entende, as pausas nas vírgulas e entre
frases (pelo tempo das palavras), a melodia (variação do tom, F0, em
semitons), a dinâmica (variação do volume entre as sílabas), o volume
integrado (LUFS) e se há clipping. No fim, uma tabela por personagem.

    uv run scripts/medir-vozes.py                       # as vozes atuais
    uv run scripts/medir-vozes.py --antes pasta/antiga  # compara com outra pasta (mesma estrutura de vozes/)
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
import librosa
import numpy as np
import pyloudnorm
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from elenco import FALANTES, LINHAS  # noqa: E402

SR = 16000


def palavras(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    # (Formas faladas que o Whisper escreve por extenso: tá → está, pra → para.)
    eq = {"ta": "esta", "to": "estou", "pra": "para", "pro": "para", "tava": "estava", **{"1": "um", "2": "dois", "3": "tres", "4": "quatro", "5": "cinco", "6": "seis", "7": "sete", "8": "oito", "9": "nove", "10": "dez", "12": "doze"}}
    return [eq.get(w, w) for w in re.sub(r"[^a-z0-9 ]", " ", text).split()]


def carregar(path: Path) -> np.ndarray:
    raw = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def medir(whisper: WhisperModel, path: Path, text: str) -> dict:
    audio = carregar(path)
    segments, _ = whisper.transcribe(audio, language="pt", word_timestamps=True)
    segments = list(segments)
    heard = " ".join(s.text for s in segments)
    words = [w for s in segments for w in (s.words or [])]
    # Pausas: vão entre uma palavra e a seguinte, pela pontuação que o Whisper pôs.
    virgula, frase = [], []
    for a, b in zip(words, words[1:]):
        gap = max(0.0, b.start - a.end)
        if a.word.strip().endswith((",", ";")):
            virgula.append(gap)
        elif a.word.strip().endswith((".", "!", "?", "…", ":")):
            frase.append(gap)
    # Melodia: o tom (F0) das partes com voz, em semitons.
    f0, voiced, _ = librosa.pyin(audio, fmin=60, fmax=500, sr=SR, frame_length=1024)
    f0 = f0[voiced & np.isfinite(f0)]
    st = 12 * np.log2(f0 / np.median(f0)) if len(f0) > 5 else np.array([0.0])
    # Dinâmica: variação do volume (dB) entre os quadros com fala.
    frame = int(0.025 * SR)
    n = len(audio) // frame
    db = 20 * np.log10(np.sqrt(np.mean(audio[: n * frame].reshape(n, frame) ** 2, axis=1)) + 1e-9)
    db = db[db > db.max() - 40]
    padded = np.concatenate([audio, np.zeros(max(0, SR - len(audio)), dtype=np.float32)])
    return dict(
        nota=difflib.SequenceMatcher(None, palavras(text), palavras(heard)).ratio(),
        dur=len(audio) / SR,
        virgula=float(np.median(virgula)) if virgula else None,
        frase=float(np.median(frase)) if frase else None,
        f0_desvio=float(np.std(st)),
        f0_faixa=float(np.percentile(st, 95) - np.percentile(st, 5)),
        dinamica=float(np.std(db)),
        lufs=float(pyloudnorm.Meter(SR).integrated_loudness(padded)),
        pico=float(20 * np.log10(np.max(np.abs(audio)) + 1e-9)),
        clip=int(np.sum(np.abs(audio) >= 0.999)),
    )


def main() -> None:
    args = sys.argv[1:]
    antes = Path(args[args.index("--antes") + 1]) if "--antes" in args else None
    only = {a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--antes")}
    lines = json.loads(subprocess.run(["node", str(ROOT / "scripts" / "falas.ts")], check=True, capture_output=True, text=True).stdout)
    todas = [(f"historia/{l['id']}.mp3", l["text"], l["speaker"] or "Narrador") for l in lines]
    todas += [(f"{k}.mp3", t, f"({voz})") for k, (t, voz, _) in LINHAS.items()]
    whisper = WhisperModel("small", device="cpu", compute_type="int8")
    pastas = [("depois", ROOT / "client" / "public" / "vozes")] + ([("antes", antes)] if antes else [])
    resultado: dict[str, dict[str, list[dict]]] = {}
    for nome, pasta in pastas:
        for rel, text, who in todas:
            path = pasta / rel
            if (only and Path(rel).stem not in only) or not path.exists():
                continue
            m = medir(whisper, path, text)
            resultado.setdefault(who, {}).setdefault(nome, []).append(m)
            print(f"{nome:6s} {rel:28s} nota {m['nota']:.2f} F0 ±{m['f0_desvio']:.1f} st, din {m['dinamica']:.1f} dB, "
                  f"{m['lufs']:.1f} LUFS, pico {m['pico']:.1f} dB, vírgula {m['virgula']}, frase {m['frase']}", flush=True)

    def media(ms: list[dict], k: str):
        v = [m[k] for m in ms if m[k] is not None and np.isfinite(m[k])]
        return f"{np.mean(v):.2f}" if v else "–"

    cols = ["nota", "f0_desvio", "f0_faixa", "dinamica", "virgula", "frase", "lufs", "pico", "clip"]
    print("\n| personagem | falas | " + " | ".join(f"{c} antes → depois" for c in cols) + " |")
    print("|---|---|" + "---|" * len(cols))
    for who, by in sorted(resultado.items()):
        d, a = by.get("depois", []), by.get("antes", [])
        cells = [f"{media(a, c)} → {media(d, c)}" if a else media(d, c) for c in cols]
        print(f"| {who} | {len(d)} | " + " | ".join(cells) + " |")
    todas_d = [m for by in resultado.values() for m in by.get("depois", [])]
    lufs = [m["lufs"] for m in todas_d if np.isfinite(m["lufs"])]
    print(f"\nLUFS das falas: média {np.mean(lufs):.1f}, desvio {np.std(lufs):.1f}; clipping: {sum(m['clip'] for m in todas_d)} amostras")


if __name__ == "__main__":
    main()
