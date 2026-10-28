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

    uv run scripts/vozes.py            # grava todas (abertura, corrida e história)
    uv run scripts/vozes.py eat nham   # só algumas
    uv run scripts/vozes.py historia   # só as falas do modo história
    uv run scripts/vozes.py prologo-3  # uma fala da história (pelo id)

As falas do modo história vêm do próprio roteiro (shared/src/story.ts, lido
com `node scripts/falas.ts`): cada personagem tem a sua voz em ELENCO (mistura
de vozes do Kokoro, velocidade e tratamento). Saem em client/public/vozes/historia/.
Para conferir se dá para entender cada fala: uv run scripts/conferir-vozes.py.

Na primeira vez o script baixa o modelo (~90 MB) para scripts/.cache/
(ignorado pelo git). Para mudar uma fala, edite LINES e rode de novo.
"""

from __future__ import annotations

import json
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

# --- Modo história --------------------------------------------------------------
#
# Vozes de cada personagem. O Kokoro só tem três vozes em português (pf_dora,
# pm_alex, pm_santa), mas a pronúncia vem do idioma (pt-br, pelo espeak) e não
# da voz: dá para usar o timbre de qualquer uma, ou misturar duas, e continuar
# falando português (o Whisper entende todas). O resto da personalidade sai da
# velocidade e do tratamento (tom, equalização, compressão, saturação).
#
# personagem: (voz ou mistura "voz*peso+voz*peso", velocidade, tratamento)
ELENCO = {
    # Narrador: voz de documentário, quente e calma.
    "": ("pm_santa*0.5+bm_fable*0.5", 0.95, "rubberband=pitch=0.94:formant=shifted,highpass=f=70,equalizer=f=160:t=q:w=1:g=3,"
         "equalizer=f=3000:t=q:w=1:g=2,acompressor=threshold=0.1:ratio=4:attack=5:release=150:makeup=2"),
    # Sargento Cross-fit: grave, gritado, saturado e espremido (marombeiro de academia).
    "Sargento Cross-fit": ("am_fenrir*0.6+pm_alex*0.4", 1.12, "rubberband=pitch=0.86:formant=shifted,highpass=f=80,"
                           "equalizer=f=180:t=q:w=1:g=4,equalizer=f=2400:t=q:w=1:g=7,asoftclip=type=tanh:output=0.9,"
                           "acompressor=threshold=0.05:ratio=9:attack=2:release=60:makeup=3"),
    # Bruno: devagar, debochado, grave e cheio.
    "Bruno": ("pm_santa*0.5+am_onyx*0.5", 0.9, "rubberband=pitch=0.93:formant=shifted,highpass=f=60,"
              "equalizer=f=140:t=q:w=1:g=4,acompressor=threshold=0.1:ratio=4:attack=5:release=150:makeup=2"),
    # Mia Marmita: calma, baixa e macia.
    "Mia Marmita": ("af_nicole*0.5+pf_dora*0.5", 0.94, "highpass=f=110,equalizer=f=250:t=q:w=1:g=2,"
                    "equalizer=f=7000:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=3:attack=8:release=200:makeup=2"),
    # Você: voz neutra, de quem não leva desaforo para casa.
    "Você": ("pm_alex", 1.05, "highpass=f=90,equalizer=f=2800:t=q:w=1:g=2,acompressor=threshold=0.1:ratio=4:attack=4:release=100:makeup=2"),
    # Repórter do Jornal da Gordura: voz de TV, rápida e com banda de transmissão.
    "Repórter": ("if_sara*0.5+pf_dora*0.5", 1.1, "highpass=f=180,lowpass=f=7000,equalizer=f=2500:t=q:w=1:g=4,"
                 "acompressor=threshold=0.08:ratio=6:attack=2:release=80:makeup=3"),
    # Rivais, do #10 ao #2 (o #1 é o Bruno).
    # Izzy Iogurte: aguda, metida, fala rápido.
    "Izzy Iogurte": ("af_bella*0.5+pf_dora*0.5", 1.0, "rubberband=pitch=1.08:formant=preserved,highpass=f=150,"
                     "equalizer=f=4000:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=4:attack=4:release=100:makeup=2"),
    # Ming Miojo: elétrico, apressado (miojo de 3 minutos).
    "Ming Miojo": ("am_puck*0.5+pm_alex*0.5", 1.18, "rubberband=pitch=1.06:formant=preserved,highpass=f=120,"
                   "equalizer=f=3000:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=5:attack=3:release=80:makeup=2"),
    # JV Pastel: feirante, gritando a oferta.
    "JV Pastel": ("em_santa*0.6+pm_alex*0.4", 1.12, "highpass=f=100,equalizer=f=1800:t=q:w=1:g=6,asoftclip=type=tanh:output=0.95,"
                  "acompressor=threshold=0.06:ratio=7:attack=2:release=70:makeup=3"),
    # Vic Virado: sonolento, grave e arrastado (depois do almoço).
    "Vic Virado": ("am_onyx*0.5+pm_santa*0.5", 0.8, "rubberband=pitch=0.88:formant=shifted,highpass=f=60,lowpass=f=6000,"
                   "equalizer=f=150:t=q:w=1:g=4,acompressor=threshold=0.1:ratio=3:attack=10:release=200:makeup=2"),
    # Earl Esfiha: apresentador de show, empolgado.
    "Earl Esfiha": ("im_nicola", 1.04, "highpass=f=90,equalizer=f=3200:t=q:w=1:g=4,aecho=0.8:0.6:40:0.15,"
                    "acompressor=threshold=0.08:ratio=5:attack=3:release=100:makeup=2"),
    # Ronnie Rocambole: vilão sonso, macio e grave.
    "Ronnie Rocambole": ("bm_george*0.5+pm_alex*0.5", 0.92, "rubberband=pitch=0.95:formant=shifted,highpass=f=70,"
                         "equalizer=f=200:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=4:attack=5:release=150:makeup=2"),
    # Kaze Coxinha: tranquilo, frio, de quem anda de lado.
    "Kaze Coxinha": ("am_echo*0.5+em_alex*0.5", 0.98, "highpass=f=100,equalizer=f=5000:t=q:w=1:g=2,"
                     "acompressor=threshold=0.1:ratio=3:attack=6:release=150:makeup=2"),
    # Baron Brigadeiro: aristocrata, lento e afetado.
    "Baron Brigadeiro": ("bm_lewis*0.6+pm_santa*0.4", 0.88, "rubberband=pitch=0.92:formant=shifted,highpass=f=70,"
                         "equalizer=f=250:t=q:w=1:g=3,equalizer=f=4500:t=q:w=1:g=2,"
                         "acompressor=threshold=0.1:ratio=3:attack=8:release=200:makeup=2"),
    # Razor Bacon: rouco, agressivo, chiando como bacon na chapa.
    "Razor Bacon": ("am_fenrir*0.5+em_alex*0.5", 1.05, "rubberband=pitch=0.9:formant=shifted,highpass=f=90,"
                    "equalizer=f=3500:t=q:w=1:g=5,asoftclip=type=tanh:output=0.85,acrusher=bits=10:mix=0.15,"
                    "acompressor=threshold=0.06:ratio=7:attack=2:release=70:makeup=3"),
}
# Pronúncia: palavras que o Kokoro (ou o Whisper, na conferência) erra. Só
# mudam o que a voz fala; a legenda continua com o texto do roteiro.
PRONUNCIA = {
    "Esfiha": "Esfirra",
    "Kibe-segg": "Kibe-ségue",
    "Skyline": "Skailaine",
    "Shoyu": "Xôiu",
    "Autuado! Viu?": "Pronto, autuado! Viu?",
    "Passei do ponto": "Ai, passei do ponto",
}
# A apresentação do rival (o cartão da Lista Gorda) usa a voz de trailer.
APRESENTA = ("pm_santa", 0.88, FX["trailer"])
# Rádio do Cross-fit: a voz dele passando pelo rádio da Vigilância.
RADIO = FX["radio"]

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


def falas() -> dict[str, dict]:
    """Falas do modo história, lidas do roteiro (shared/src/story.ts)."""
    out = subprocess.run(["node", str(ROOT / "scripts" / "falas.ts")], check=True, capture_output=True, text=True).stdout
    return {line["id"]: line for line in json.loads(out)}


def style(kokoro: Kokoro, spec: str):
    """Voz do Kokoro pelo nome, ou mistura de vozes ("pm_alex*0.6+em_santa*0.4")."""
    if "+" not in spec:
        return spec
    return sum(float(weight) * kokoro.get_voice_style(name) for name, weight in (part.split("*") for part in spec.split("+")))


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


def render(kokoro: Kokoro, key: str, story: dict | None = None) -> None:
    if story:
        # Fala da história: a voz do personagem (e o rádio, nos recados do Cross-fit).
        text = story["text"]
        for word, spoken in PRONUNCIA.items():
            text = text.replace(word, spoken)
        voice, speed, chain = APRESENTA if key.endswith("-apresenta") else ELENCO.get(story["speaker"], ELENCO[""])
        if story["radio"]:
            chain = f"{chain},{RADIO}"
        lang, target, rate_out, bitrate = "pt-br", OUT / "historia" / f"{key}.mp3", "24000", "32k"
    else:
        text, voice, lang, speed, fx = LINES[key]
        chain, target, rate_out, bitrate = FX[fx], OUT / f"{key}.mp3", "44100", "48k"
    samples, rate = kokoro.create(text, voice=style(kokoro, voice), speed=speed, lang=lang)
    raw = CACHE / f"{key}.raw.wav"
    done = CACHE / f"{key}.fx.wav"
    sf.write(raw, samples, rate)
    # 48 kHz para o rubberband trabalhar bem; saída mono.
    ffmpeg(["-i", str(raw), "-af", f"aresample=48000,{chain}", "-ac", "1", str(done)])
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
    target.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg(["-i", str(done), "-ac", "1", "-ar", rate_out, "-c:a", "libmp3lame", "-b:a", bitrate, str(target)])
    print(f"{key}: {len(audio) / rate:.2f}s, {target.stat().st_size // 1024} KB")


def main() -> None:
    story = falas()
    asked = sys.argv[1:] or [*LINES, "historia"]
    keys = [k for a in asked for k in (list(story) if a == "historia" else [a])]
    kokoro = model()
    for key in keys:
        if key not in LINES and key not in story:
            sys.exit(f"fala desconhecida: {key}")
        render(kokoro, key, story.get(key) if key not in LINES else None)


if __name__ == "__main__":
    main()
