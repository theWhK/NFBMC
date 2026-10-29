# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["kokoro-onnx==0.6.1", "soundfile", "numpy", "imageio-ffmpeg"]
# ///
"""Grava a referência de timbre de cada voz do elenco (scripts/elenco.py).

O Chatterbox (vozes.py) fala imitando uma gravação de referência. As nossas
referências saem do Kokoro (modelo de voz livre, Apache 2.0), com a mistura de
vozes e o tom escolhidos para cada personagem: assim o timbre é nosso, cada
personagem soa diferente, e não usamos a voz de ninguém.

    uv run scripts/vozes-ref.py              # todas
    uv run scripts/vozes-ref.py crossfit mia # algumas

Saem em scripts/.cache/ref/<voz>.wav (fora do git; o vozes.py chama este script
sozinho se faltar alguma). Na primeira vez baixa o modelo do Kokoro (~90 MB).
"""

from __future__ import annotations

import subprocess
import sys
import urllib.request
from pathlib import Path

import imageio_ffmpeg
import soundfile as sf
from kokoro_onnx import Kokoro

sys.path.insert(0, str(Path(__file__).resolve().parent))
from elenco import REF_TEXT, VOZES  # noqa: E402

CACHE = Path(__file__).resolve().parent / ".cache"
REF = CACHE / "ref"
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.int8.onnx", "voices-v1.0.bin"]


def model() -> Kokoro:
    CACHE.mkdir(exist_ok=True)
    for name in FILES:
        path = CACHE / name
        if not path.exists():
            print(f"baixando {name}...")
            urllib.request.urlretrieve(MODEL_URL + name, path)
    return Kokoro(str(CACHE / FILES[0]), str(CACHE / FILES[1]))


def style(kokoro: Kokoro, spec: str):
    """Voz do Kokoro pelo nome, ou mistura de vozes ("pm_alex*0.6+em_santa*0.4")."""
    if "+" not in spec:
        return spec
    return sum(float(weight) * kokoro.get_voice_style(name) for name, weight in (part.split("*") for part in spec.split("+")))


def main() -> None:
    keys = sys.argv[1:] or list(VOZES)
    kokoro = model()
    REF.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for key in keys:
        voz = VOZES[key]
        text = REF_TEXT if voz["lang"] == "pt-br" else "Listen. The race starts at midnight... and nobody can be late. Understood?"
        samples, rate = kokoro.create(text, voice=style(kokoro, voz["kokoro"]), speed=voz["speed"], lang=voz["lang"])
        raw = REF / f"{key}.raw.wav"
        sf.write(raw, samples, rate)
        # O tom do personagem entra na referência (o Chatterbox copia o timbre já ajustado).
        pitch = f"rubberband=pitch={voz['pitch']}:formant=shifted," if voz["pitch"] != 1 else ""
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw),
                        "-af", f"aresample=48000,{pitch}aresample=24000", "-ac", "1", str(REF / f"{key}.wav")], check=True)
        raw.unlink()
        print(f"referência {key}: ok")


if __name__ == "__main__":
    main()
