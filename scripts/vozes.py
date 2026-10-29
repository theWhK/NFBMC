# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "chatterbox-tts==0.1.7", "setuptools<81", "faster-whisper==1.2.1",
#   "pyloudnorm", "soundfile", "numpy<2", "imageio-ffmpeg",
# ]
# [tool.uv]
# extra-index-url = ["https://download.pytorch.org/whl/cpu"]
# index-strategy = "unsafe-best-match"
# ///
"""Grava as falas do jogo em arquivos pequenos (client/public/vozes/).

Quem fala é o Chatterbox Multilingual (Resemble AI, licença MIT, código e
pesos), que fala português com entonação de verdade e tem um controle de
"exagero" emocional. Ele imita uma gravação de referência: as nossas saem do
Kokoro, com o timbre de cada personagem (scripts/vozes-ref.py, elenco em
scripts/elenco.py). Roda na CPU, sem internet depois de baixar os modelos.

Para cada fala:

1. o texto é dividido em frases (e no "tempo" da piada, o `beat` do roteiro);
2. cada frase é gravada com a emoção da fala (até 3 tentativas: fica a que o
   Whisper entende melhor e que não "inventa" fala no fim);
3. as pontas são aparadas sem cortar o fim da respiração, a velocidade varia
   por frase e as vírgulas ganham pausa de verdade (pelo tempo das palavras);
4. as frases são juntadas com silêncios do tamanho da pontuação e da emoção;
5. vêm o tratamento do personagem (e o rádio), o da emoção, o volume (LUFS) e
   um limitador; sai um MP3 mono pequeno.

O tempo de cada frase vai para vozes/historia/tempos.json: o jogo escreve a
legenda acompanhando a voz.

    uv run scripts/vozes.py              # todas (abertura, corrida e história)
    uv run scripts/vozes.py eat nham     # só algumas
    uv run scripts/vozes.py historia     # só as do modo história
    uv run scripts/vozes.py prologo-3    # uma fala da história (pelo id)

As falas da história vêm do roteiro (shared/src/story.ts, com a emoção de cada
uma), lidas com `node scripts/falas.ts`. Na primeira vez baixa os modelos
(Chatterbox ~3 GB, Whisper small ~460 MB). Na CPU, cada segundo de fala leva
uns 8 s para gravar. Depois, para conferir: uv run scripts/conferir-vozes.py.

O Chatterbox põe uma marca d'água inaudível (Perth) no áudio gerado: fica, é o
jeito honesto de dizer que a voz é sintética.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import pyloudnorm
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from elenco import EMOCAO, FALANTES, LINHAS, LINHAS_RADIO, MANTER, PAUSA_DRAMATICA, PAUSAS, PRONUNCIA, RADIO, VOZES  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "client" / "public" / "vozes"
CACHE = Path(__file__).resolve().parent / ".cache"
REF = CACHE / "ref"
TEMPOS = OUT / "historia" / "tempos.json"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SR = 24000
# Volume de referência das falas (LUFS) e pico máximo.
LUFS = -18.0
PICO = 10 ** (-1.5 / 20)


def ffmpeg(args: list[str]) -> None:
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def filtrar(audio: np.ndarray, chain: str) -> np.ndarray:
    """Passa o áudio por uma cadeia de filtros do ffmpeg (em 48 kHz) e volta a 24 kHz."""
    if not chain:
        return audio
    src, dst = CACHE / "in.wav", CACHE / "out.wav"
    sf.write(src, audio, SR)
    ffmpeg(["-i", str(src), "-af", f"aresample=48000,{chain},aresample={SR}", "-ac", "1", str(dst)])
    out, _ = sf.read(dst, dtype="float32")
    return out


# --- Texto ------------------------------------------------------------------------


# Formas faladas que o Whisper escreve por extenso (não é erro da voz).
EQUIVALENTES = {"ta": "esta", "to": "estou", "pra": "para", "pro": "para", "tava": "estava", **{"1": "um", "2": "dois", "3": "tres", "4": "quatro", "5": "cinco", "6": "seis", "7": "sete", "8": "oito", "9": "nove", "10": "dez", "12": "doze"}}


def palavras(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return [EQUIVALENTES.get(w, w) for w in re.sub(r"[^a-z0-9 ]", " ", text).split()]


def nota(original: str, falado: str, ouvido: str) -> float:
    """Quanto o Whisper entendeu (0 a 1), contra o texto escrito ou o falado (o que for melhor)."""
    heard = palavras(ouvido)
    return max(difflib.SequenceMatcher(None, palavras(t), heard).ratio() for t in (original, falado))


def falado(text: str) -> tuple[str, bool]:
    """Texto para a voz: pronúncia corrigida e palavras em CAIXA ALTA em minúsculas (viram ênfase)."""
    for word, spoken in PRONUNCIA.items():
        text = re.sub(rf"(?<!\w){re.escape(word)}(?!\w)", spoken, text)
    caps = False

    def lower(m: re.Match) -> str:
        nonlocal caps
        caps = True
        return m.group(0).lower()

    text = re.sub(r"\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}\b", lower, text)
    return text.lstrip(" .…").strip(), caps


def frases(text: str, beat: str | None) -> list[dict]:
    """Divide a fala em frases: texto, onde começa (na legenda), a pontuação final e se vem depois de um "tempo"."""
    cuts: list[tuple[int, str]] = []
    for m in re.finditer(r"(\.\.\.|…|[.!?]+|:)(?=\s+\S)", text):
        cuts.append((m.end(), m.group(1)[-1] if m.group(1) not in ("...", "…") else "..."))
    beat_at = text.find(beat) if beat else -1
    if beat_at > 0 and all(abs(c - beat_at) > 1 for c, _ in cuts):
        cuts.append((beat_at, ""))
    cuts.sort()
    out, start = [], 0
    for end, punct in [*cuts, (len(text), "")]:
        piece = text[start:end]
        lead = len(piece) - len(piece.lstrip())
        if piece.strip():
            out.append({"text": piece.strip(), "start": start + lead, "punct": punct, "beat": False})
        start = end
    for i, f in enumerate(out):
        f["beat"] = i > 0 and beat_at >= 0 and f["start"] == beat_at
        # A pontuação que fecha a frase (para a pausa depois dela).
        tail = re.search(r"(\.\.\.|…|[.!?:,;])$", f["text"])
        f["punct"] = f["punct"] or (tail.group(1) if tail else ",")
        if f["punct"] == "…":
            f["punct"] = "..."
    return out


# --- Áudio ------------------------------------------------------------------------


def rms_db(audio: np.ndarray, frame: int) -> np.ndarray:
    n = len(audio) // frame
    if n == 0:
        return np.array([-120.0])
    blocks = audio[: n * frame].reshape(n, frame)
    return 20 * np.log10(np.sqrt(np.mean(blocks**2, axis=1)) + 1e-9)


def aparar(audio: np.ndarray, head: float = 0.04, tail: float = 0.16) -> tuple[np.ndarray, float]:
    """Corta o silêncio das pontas, deixando um respiro no começo e o rabo natural da voz no fim."""
    frame = int(0.01 * SR)
    db = rms_db(audio, frame)
    loud = np.flatnonzero(db > db.max() - 40)
    if not len(loud):
        return audio, 0.0
    a = max(0, loud[0] * frame - int(head * SR))
    b = min(len(audio), (loud[-1] + 1) * frame + int(tail * SR))
    out = audio[a:b].copy()
    fi, fo = min(len(out), int(0.008 * SR)), min(len(out), int(0.04 * SR))
    out[:fi] *= np.linspace(0, 1, fi)
    out[-fo:] *= np.linspace(1, 0, fo) ** 2
    return out, a / SR


def tempo(audio: np.ndarray, factor: float) -> np.ndarray:
    if abs(factor - 1) < 0.01:
        return audio
    return filtrar(audio, f"atempo={factor:.3f}")


def pausas_nas_virgulas(audio: np.ndarray, words: list, spoken: str, alvo: float) -> np.ndarray:
    """Garante a pausa depois de cada vírgula: acha o vão entre as palavras (pelo Whisper) e alarga no ponto mais quieto."""
    text_words = spoken.split()
    norm_text = [(palavras(w) or [""])[0] for w in text_words]
    norm_heard = [(palavras(w.word) or [""])[0] for w in words]
    matcher = difflib.SequenceMatcher(None, norm_text, norm_heard)
    where = {}
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            where[block.a + k] = block.b + k
    inserts = []
    for i, w in enumerate(text_words[:-1]):
        if not w.endswith((",", ";")) or i not in where or i + 1 not in where or where[i + 1] != where[i] + 1:
            continue
        end, start = words[where[i]].end, words[where[i] + 1].start
        gap = max(0.0, start - end)
        if gap >= alvo:
            continue
        lo, hi = int(max(0, end - 0.03) * SR), int(min(len(audio) / SR, start + 0.03) * SR)
        if hi - lo < int(0.01 * SR):
            continue
        frame = int(0.005 * SR)
        db = rms_db(audio[lo:hi], frame)
        at = lo + int(np.argmin(db)) * frame + frame // 2
        inserts.append((at, alvo - gap))
    for at, extra in sorted(inserts, reverse=True):
        audio = np.concatenate([audio[:at], np.zeros(int(extra * SR), dtype=audio.dtype), audio[at:]])
    return audio


# --- Gravação -----------------------------------------------------------------------


class Estudio:
    def __init__(self) -> None:
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        from faster_whisper import WhisperModel

        torch.set_num_threads(max(1, os.cpu_count() or 1))
        self.torch = torch
        self.tts = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
        self.whisper = WhisperModel("small", device="cpu", compute_type="int8")
        self.voz_atual: str | None = None

    def ouvir(self, audio: np.ndarray, lang: str):
        a16 = np.interp(np.arange(0, len(audio), SR / 16000), np.arange(len(audio)), audio).astype(np.float32)
        segments, _ = self.whisper.transcribe(a16, language=lang[:2], word_timestamps=True)
        segments = list(segments)
        return " ".join(s.text for s in segments).strip(), [w for s in segments for w in (s.words or [])]

    def trecho(self, voz: str, text: str, original: str, emo: dict, caps: bool, lang: str):
        """Grava um trecho (até 3 tentativas: fica a que o Whisper entende melhor)."""
        if self.voz_atual != voz:
            self.tts.prepare_conditionals(str(REF / f"{voz}.wav"), exaggeration=emo["exag"])
            self.voz_atual = voz
        exag = min(1.2, emo["exag"] + (0.15 if caps else 0))
        best = None
        for take in range(3):
            # Segunda tentativa se ficou abaixo de 0,8; a terceira só se estiver bem ruim.
            if best and (best[2] >= 0.8 or (take == 2 and best[2] >= 0.6)):
                break
            self.torch.manual_seed(1234 + take * 101)
            try:
                wav = self.tts.generate(text, language_id=lang[:2], exaggeration=exag, cfg_weight=emo["cfg"], temperature=emo["temp"])
            except IndexError:
                # (O Chatterbox às vezes tropeça em fala de uma palavra só: tenta de novo, alongando a vogal.)
                text = re.sub(r"([aeiouáéíóú])", r"\1\1", text, count=1)
                continue
            audio = wav.squeeze(0).numpy().astype(np.float32)
            heard, words = self.ouvir(audio, lang)
            score = nota(original, text, heard)
            if best is None or score > best[2]:
                best = (audio, words, score, heard)
        return best


def alinhar(tokens: list[str], words: list) -> dict[int, int]:
    """Qual palavra ouvida (Whisper) corresponde a cada palavra do texto."""
    a = [(palavras(t) or [""])[0] for t in tokens]
    b = [(palavras(w.word) or [""])[0] for w in words]
    where = {}
    for block in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            where[block.a + k] = block.b + k
    return where


def ponto_quieto(audio: np.ndarray, lo_s: float, hi_s: float) -> int:
    """O ponto mais silencioso entre dois instantes (onde dá para cortar ou abrir uma pausa)."""
    lo, hi = int(max(0, lo_s) * SR), int(min(len(audio) / SR, hi_s) * SR)
    if hi - lo < int(0.01 * SR):
        return (lo + hi) // 2
    frame = int(0.005 * SR)
    db = rms_db(audio[lo:hi], frame)
    return lo + int(np.argmin(db)) * frame + frame // 2


def gravar(studio: Estudio, key: str, text: str, voz: str, emotion: str, radio: bool, beat: str | None, lang: str, story: bool) -> list:
    """
    Grava uma fala: o modelo fala o trecho inteiro de uma vez (a melodia sai
    natural); depois, pelo tempo das palavras, a fala é cortada nas frases para
    cada uma ter a sua velocidade e as pausas do tamanho certo.
    """
    emo = EMOCAO[emotion]
    parts = frases(text, beat)
    for f in parts:
        f["spoken"], f["caps"] = falado(f["text"])
        f["tokens"] = f["spoken"].split()
    # Trechos de até ~24 palavras (falas longas demais fazem o modelo se perder).
    groups: list[list[dict]] = [[]]
    for f in parts:
        if groups[-1] and sum(len(g["tokens"]) for g in groups[-1]) + len(f["tokens"]) > 24:
            groups.append([])
        groups[-1].append(f)

    segments: list[tuple[dict, np.ndarray, list]] = []
    notas = []
    for group in groups:
        spoken = " ".join(f["spoken"] for f in group)
        original = " ".join(f["text"] for f in group)
        audio, words, score, heard = studio.trecho(voz, spoken, original, emo, any(f["caps"] for f in group), lang)
        notas.append(score)
        print(f"   {score:.2f} [{emotion}] {original!r}\n        → {heard!r}", flush=True)
        tokens = [t for f in group for t in f["tokens"]]
        where = alinhar(tokens, words)
        # Fala inventada depois do fim (o modelo repetindo): corta depois da última palavra do texto.
        last = max((where[i] for i in where), default=None)
        if last is not None and last < len(words) - 1:
            cut = ponto_quieto(audio, words[last].end, words[last + 1].start)
            audio, words = audio[:cut], words[: last + 1]
        # Corta nas frases (no ponto mais quieto entre a última palavra de uma e a primeira da seguinte).
        cuts, index = [], 0
        for f in group[:-1]:
            index += len(f["tokens"])
            a, b = where.get(index - 1), where.get(index)
            if a is not None and b is not None and b == a + 1:
                cuts.append((ponto_quieto(audio, words[a].end - 0.02, words[b].start + 0.02), True))
            else:
                cuts.append((None, False))
        start, index = 0, 0
        pending: dict | None = None
        for k, f in enumerate(group):
            first, index = index, index + len(f["tokens"])
            end_cut = cuts[k][0] if k < len(cuts) else len(audio)
            if end_cut is None:
                # Não deu para achar o corte: esta frase vai junto com a próxima.
                pending = pending or f
                continue
            piece = audio[start:end_cut]
            piece_words = [w for w in words if start / SR <= w.start < end_cut / SR]
            for w in piece_words:
                w.start, w.end = w.start - start / SR, w.end - start / SR
            owner = pending or f
            owner_tokens = [t for g in group[group.index(owner): k + 1] for t in g["tokens"]]
            segments.append(({**owner, "punct": f["punct"], "tokens": owner_tokens}, piece, piece_words))
            pending = None
            start = end_cut

    pieces, marks = [], []
    clock = 0.12 if text.startswith("...") else 0.0
    if clock:
        pieces.append(np.zeros(int(clock * SR), dtype=np.float32))
    for i, (f, audio, words) in enumerate(segments):
        audio, offset = aparar(audio)
        for w in words:
            w.start, w.end = w.start - offset, w.end - offset
        # Velocidade por frase: a última um pouco mais lenta, exclamação mais rápida, frase curta com calma.
        factor = emo["tempo"]
        if i == len(segments) - 1 and len(segments) > 1:
            factor *= 0.97
        if f["punct"] == "!":
            factor *= 1.03
        if len(f["tokens"]) <= 3:
            factor *= 0.96
        if f["punct"] == "...":
            factor *= 0.95
        factor = min(1.12, max(0.85, factor))
        audio = tempo(audio, factor)
        for w in words:
            w.start, w.end = w.start / factor, w.end / factor
        audio = pausas_nas_virgulas(audio, words, " ".join(f["tokens"]), PAUSAS[","] * emo["pausa"])
        if i > 0:
            pause = PAUSAS.get(segments[i - 1][0]["punct"], 0.2) * emo["pausa"]
            if f["beat"]:
                pause += PAUSA_DRAMATICA * emo["pausa"]
            # (A frase anterior já termina com ~0,16 s de rabo e esta começa com ~0,04 s.)
            gap = max(0.04, pause - 0.2)
            pieces.append(np.zeros(int(gap * SR), dtype=np.float32))
            clock += gap
        marks.append([f["start"], round(clock + 0.04, 2), round(clock + len(audio) / SR - 0.16, 2)])
        pieces.append(audio)
        clock += len(audio) / SR

    audio = np.concatenate(pieces)
    chain = ",".join(c for c in (VOZES[voz]["post"], emo["fx"], RADIO if radio else "") if c)
    audio = filtrar(audio, chain)
    # Volume: todas no mesmo LUFS, com a emoção um pouco acima ou abaixo; e um limitador no pico.
    meter = pyloudnorm.Meter(SR)
    padded = np.concatenate([audio, np.zeros(max(0, int(0.5 * SR) - len(audio)), dtype=audio.dtype)])
    loud = meter.integrated_loudness(padded)
    target = LUFS + emo["ganho"] - (2 if radio else 0)
    if np.isfinite(loud):
        audio = audio * 10 ** ((target - loud) / 20)
    knee = PICO * 0.8
    over = np.abs(audio) > knee
    if over.any():
        # Limitador suave só no que passa do joelho (sem achatar a fala toda).
        audio = np.where(over, np.sign(audio) * (knee + (PICO - knee) * np.tanh((np.abs(audio) - knee) / (PICO - knee))), audio)
    target_file = OUT / "historia" / f"{key}.mp3" if story else OUT / f"{key}.mp3"
    target_file.parent.mkdir(parents=True, exist_ok=True)
    done = CACHE / f"{key}.fx.wav"
    sf.write(done, audio.astype(np.float32), SR)
    ffmpeg(["-i", str(done), "-ac", "1", "-ar", str(SR), "-c:a", "libmp3lame", "-b:a", "32k" if story else "40k", str(target_file)])
    print(f"{key}: {len(audio) / SR:.2f}s, {target_file.stat().st_size // 1024} KB, nota mínima {min(notas):.2f}", flush=True)
    return marks


def falas() -> dict[str, dict]:
    """Falas do modo história, lidas do roteiro (shared/src/story.ts)."""
    out = subprocess.run(["node", str(ROOT / "scripts" / "falas.ts")], check=True, capture_output=True, text=True).stdout
    return {line["id"]: line for line in json.loads(out)}


def referencias(keys: set[str]) -> None:
    """Grava (com o Kokoro, num ambiente à parte) as referências de timbre que faltarem."""
    missing = sorted(k for k in keys if not (REF / f"{k}.wav").exists())
    if missing:
        command = os.environ.get("NFBMC_REF_CMD", "uv run").split()
        subprocess.run([*command, str(ROOT / "scripts" / "vozes-ref.py"), *missing], check=True)


def main() -> None:
    story = falas()
    asked = sys.argv[1:] or [*(k for k in LINHAS if k not in MANTER), "historia"]
    keys = [k for a in asked for k in (list(story) if a == "historia" else [a])]
    for key in keys:
        if key not in LINHAS and key not in story:
            sys.exit(f"fala desconhecida: {key}")
    CACHE.mkdir(exist_ok=True)
    referencias({LINHAS[k][1] if k in LINHAS else FALANTES.get(story[k]["speaker"], "narrador") for k in keys})
    studio = Estudio()
    tempos = json.loads(TEMPOS.read_text()) if TEMPOS.exists() else {}
    # Agrupa por voz (a referência é preparada uma vez por personagem).
    ordered = sorted(keys, key=lambda k: LINHAS[k][1] if k in LINHAS else FALANTES.get(story[k]["speaker"], "narrador"))
    for key in ordered:
        print(key, flush=True)
        if key in LINHAS:
            text, voz, emotion = LINHAS[key]
            try:
                gravar(studio, key, text, voz, emotion, key in LINHAS_RADIO, None, VOZES[voz]["lang"], story=False)
            except Exception as err:  # noqa: BLE001 (uma fala com problema não para as outras)
                print(f"{key}: FALHOU ({err})", flush=True)
        else:
            line = story[key]
            voz = FALANTES.get(line["speaker"], "narrador")
            tempos[key] = gravar(studio, key, line["text"], voz, line["emotion"], line["radio"], line.get("beat"), "pt-br", story=True)
            TEMPOS.write_text(json.dumps(dict(sorted(tempos.items())), separators=(",", ":")))


if __name__ == "__main__":
    main()
