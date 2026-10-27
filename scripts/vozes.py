# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["kokoro-onnx==0.6.1", "soundfile", "numpy", "imageio-ffmpeg"]
# ///
"""Grava as locuções do jogo em arquivos pequenos (client/public/vozes/*.mp3).

O jogo não depende do TTS do navegador: as falas são geradas aqui, uma vez,
com o Kokoro (modelo de voz livre, licença Apache 2.0, roda no computador, sem
internet depois de baixar o modelo), passam por um tratamento (grave de
trailer, rádio da Vigilância, locutor de corrida) e são gravadas em MP3 mono.

Como rodar (precisa do uv: https://docs.astral.sh/uv/):

    uv run scripts/vozes.py            # grava todas
    uv run scripts/vozes.py eat nham   # só algumas

Na primeira vez o script baixa o modelo (~90 MB) para scripts/.cache/
(ignorado pelo git). Para mudar uma fala, edite LINES e rode de novo.
"""

from __future__ import annotations

import subprocess
import sys
import urllib.request
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "client" / "public" / "vozes"
CACHE = Path(__file__).resolve().parent / ".cache"
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.int8.onnx", "voices-v1.0.bin"]
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# Tratamentos (filtros do ffmpeg). As vozes saem "secas": o eco de cada cena é
# posto no jogo (reverberação gerada no código, em client/src/audio.ts).
FX = {
    # Locutor de trailer: voz mais grave, encorpada e bem comprimida.
    "trailer": "rubberband=pitch=0.84:formant=shifted,highpass=f=60,equalizer=f=140:t=q:w=1:g=5,"
    "equalizer=f=3200:t=q:w=1.2:g=4,acompressor=threshold=0.08:ratio=5:attack=4:release=120:makeup=2",
    # Vinheta da EAT: grave de trailer com uma dobra (duas vozes quase juntas).
    "vinheta": "rubberband=pitch=0.8:formant=shifted,highpass=f=60,equalizer=f=120:t=q:w=1:g=6,"
    "equalizer=f=3000:t=q:w=1.2:g=4,chorus=0.7:0.8:22|31:0.35|0.3:0.25|0.3:1.6|2.1,"
    "acompressor=threshold=0.08:ratio=6:attack=3:release=150:makeup=2",
    # Nhamvidia: sussurro grave e misterioso.
    "nham": "rubberband=pitch=0.68:formant=shifted,highpass=f=50,equalizer=f=90:t=q:w=1:g=7,"
    "equalizer=f=5000:t=q:w=1:g=3,acompressor=threshold=0.06:ratio=6:attack=3:release=200:makeup=2",
    # Locutor da corrida: presença e compressão de transmissão esportiva.
    "locutor": "highpass=f=90,equalizer=f=220:t=q:w=1:g=2,equalizer=f=3500:t=q:w=1:g=5,"
    "acompressor=threshold=0.1:ratio=6:attack=2:release=80:makeup=3",
    # Rádio da Vigilância: banda estreita, saturado e "sujo".
    "radio": "highpass=f=450,lowpass=f=2900,equalizer=f=1600:t=q:w=1:g=6,"
    "acompressor=threshold=0.05:ratio=10:attack=1:release=50:makeup=4,acrusher=bits=8:mix=0.25,"
    "highpass=f=400,lowpass=f=3200",
}

# id: (texto, voz do Kokoro, idioma, velocidade, tratamento)
LINES = {
    # Abertura
    "eat": ("Eat Games. Chantilly everything.", "am_onyx", "en-us", 0.82, "vinheta"),
    "nham": ("Nhãm vídia.", "pm_alex", "pt-br", 0.72, "nham"),
    "trailer-cidade": ("Porto Gordo.", "pm_santa", "pt-br", 0.85, "trailer"),
    "trailer-vigilancia": ("A Vigilância Sanitária quer você.", "pm_santa", "pt-br", 0.88, "trailer"),
    "trailer-calorico": ("Só um pode ser... o mais calórico.", "pm_santa", "pt-br", 0.82, "trailer"),
    # Largada e corrida
    "tres": ("Três!", "pm_alex", "pt-br", 1.0, "locutor"),
    "dois": ("Dois!", "pm_alex", "pt-br", 1.0, "locutor"),
    "um": ("Uum!", "pm_alex", "pt-br", 0.95, "locutor"),
    "vai": ("Vai!", "pm_alex", "pt-br", 1.0, "locutor"),
    "ultima-volta": ("Última volta!", "pm_alex", "pt-br", 1.05, "locutor"),
    "vitoria": ("Primeiro lugar! Que barriga!", "pm_alex", "pt-br", 1.02, "locutor"),
    "chegada": ("Bandeirada! Fim de corrida.", "pm_alex", "pt-br", 1.02, "locutor"),
    # Vigilância Sanitária (rádio)
    "radio-perseguicao": ("Central, suspeito comendo na rua. Iniciando perseguição.", "pf_dora", "pt-br", 1.08, "radio"),
    "radio-escapou": ("Central, perdemos o suspeito de vista.", "pf_dora", "pt-br", 1.08, "radio"),
    "radio-autuado": ("Suspeito autuado. Pode recolher a fritura.", "pf_dora", "pt-br", 1.05, "radio"),
}


def model() -> Kokoro:
    CACHE.mkdir(exist_ok=True)
    for name in FILES:
        path = CACHE / name
        if not path.exists():
            print(f"baixando {name}...")
            urllib.request.urlretrieve(MODEL_URL + name, path)
    return Kokoro(str(CACHE / FILES[0]), str(CACHE / FILES[1]))


def ffmpeg(args: list[str]) -> None:
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def render(kokoro: Kokoro, key: str) -> None:
    text, voice, lang, speed, fx = LINES[key]
    samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    raw = CACHE / f"{key}.raw.wav"
    done = CACHE / f"{key}.fx.wav"
    sf.write(raw, samples, rate)
    # 48 kHz para o rubberband trabalhar bem; saída mono.
    ffmpeg(["-i", str(raw), "-af", f"aresample=48000,{FX[fx]}", "-ac", "1", str(done)])
    audio, rate = sf.read(done)
    # Corta o silêncio das pontas (deixa 30 ms) e acerta o volume: RMS da fala
    # em torno de -16 dBFS, pico no máximo em -1 dBFS.
    loud = np.flatnonzero(np.abs(audio) > 0.01)
    if len(loud):
        pad = int(0.03 * rate)
        audio = audio[max(0, loud[0] - pad): loud[-1] + pad]
    speech = audio[np.abs(audio) > 0.02]
    rms = np.sqrt(np.mean(speech**2)) if len(speech) else 0.1
    audio = audio * min(10 ** (-16 / 20) / rms, 10 ** (-1 / 20) / np.max(np.abs(audio)))
    fade = min(len(audio), int(0.01 * rate))
    audio[-fade:] *= np.linspace(1, 0, fade)
    sf.write(done, audio, rate)
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{key}.mp3"
    ffmpeg(["-i", str(done), "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "48k", str(target)])
    print(f"{key}: {len(audio) / rate:.2f}s, {target.stat().st_size // 1024} KB")


def main() -> None:
    keys = sys.argv[1:] or list(LINES)
    kokoro = model()
    for key in keys:
        render(kokoro, key)


if __name__ == "__main__":
    main()
