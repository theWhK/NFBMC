"""Elenco e direção das vozes do jogo (usado por vozes.py e vozes-ref.py).

Cada voz tem duas partes:

- o TIMBRE, que sai do Kokoro (uma voz ou a mistura de duas, mais um ajuste de
  tom) e vira a gravação de referência do personagem (vozes-ref.py);
- o TRATAMENTO, filtros do ffmpeg aplicados depois que o Chatterbox fala com
  esse timbre (equalização, compressão, saturação, rádio, TV...).

A interpretação de cada fala (raiva, deboche, tristeza...) vem da emoção dela,
escrita no roteiro (shared/src/story.ts) ou em LINHAS, logo abaixo.
"""

from __future__ import annotations

# Texto da referência: variado (pergunta, exclamação, pausa) para o modelo
# pegar um timbre com alguma melodia, não só uma leitura reta.
REF_TEXT = (
    "Olha só, eu não acredito! Você chegou bem na hora. "
    "Presta atenção: a corrida começa à meia-noite... e ninguém pode se atrasar. Entendeu?"
)

# voz: kokoro (voz ou "voz*peso+voz*peso"), velocidade e tom da referência, idioma, tratamento
VOZES: dict[str, dict] = {
    # Narrador: voz de documentário, quente.
    "narrador": dict(kokoro="pm_santa*0.5+bm_fable*0.5", speed=0.95, pitch=0.94, lang="pt-br",
                     post="highpass=f=70,equalizer=f=160:t=q:w=1:g=3,equalizer=f=3000:t=q:w=1:g=2,"
                          "acompressor=threshold=0.1:ratio=4:attack=5:release=150:makeup=2"),
    # Sargento Cross-fit: grave, marombeiro, bem na cara (saturação e compressão).
    "crossfit": dict(kokoro="am_fenrir*0.6+pm_alex*0.4", speed=1.1, pitch=0.86, lang="pt-br",
                     post="highpass=f=80,equalizer=f=180:t=q:w=1:g=4,equalizer=f=2400:t=q:w=1:g=6,"
                          "asoftclip=type=tanh:output=0.92,acompressor=threshold=0.06:ratio=8:attack=2:release=60:makeup=3"),
    # Bruno: grave, cheio, debochado.
    "bruno": dict(kokoro="pm_santa*0.5+am_onyx*0.5", speed=0.92, pitch=0.93, lang="pt-br",
                  post="highpass=f=60,equalizer=f=140:t=q:w=1:g=4,acompressor=threshold=0.1:ratio=4:attack=5:release=150:makeup=2"),
    # Mia Marmita: calma, baixa e macia.
    "mia": dict(kokoro="af_nicole*0.5+pf_dora*0.5", speed=0.95, pitch=1.0, lang="pt-br",
                post="highpass=f=110,equalizer=f=250:t=q:w=1:g=2,equalizer=f=7000:t=q:w=1:g=3,"
                     "acompressor=threshold=0.1:ratio=3:attack=8:release=200:makeup=2"),
    # Você: neutro, de quem não leva desaforo para casa.
    "voce": dict(kokoro="pm_alex", speed=1.0, pitch=1.0, lang="pt-br",
                 post="highpass=f=90,equalizer=f=2800:t=q:w=1:g=2,acompressor=threshold=0.1:ratio=4:attack=4:release=100:makeup=2"),
    # Repórter do Jornal da Gordura: banda de transmissão de TV.
    "reporter": dict(kokoro="if_sara*0.5+pf_dora*0.5", speed=1.05, pitch=1.0, lang="pt-br",
                     post="highpass=f=180,lowpass=f=7000,equalizer=f=2500:t=q:w=1:g=4,"
                          "acompressor=threshold=0.08:ratio=6:attack=2:release=80:makeup=3"),
    # Rivais (o #1 é o Bruno).
    "izzy": dict(kokoro="af_bella*0.5+pf_dora*0.5", speed=1.0, pitch=1.08, lang="pt-br",
                 post="highpass=f=150,equalizer=f=4000:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=4:attack=4:release=100:makeup=2"),
    "ming": dict(kokoro="am_puck*0.5+pm_alex*0.5", speed=1.1, pitch=1.06, lang="pt-br",
                 post="highpass=f=120,equalizer=f=3000:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=5:attack=3:release=80:makeup=2"),
    "jv": dict(kokoro="em_santa*0.6+pm_alex*0.4", speed=1.05, pitch=1.0, lang="pt-br",
               post="highpass=f=100,equalizer=f=1800:t=q:w=1:g=5,asoftclip=type=tanh:output=0.95,"
                    "acompressor=threshold=0.06:ratio=6:attack=2:release=70:makeup=3"),
    "vic": dict(kokoro="am_onyx*0.5+pm_santa*0.5", speed=0.85, pitch=0.88, lang="pt-br",
                post="highpass=f=60,lowpass=f=6000,equalizer=f=150:t=q:w=1:g=4,acompressor=threshold=0.1:ratio=3:attack=10:release=200:makeup=2"),
    "earl": dict(kokoro="im_nicola", speed=1.0, pitch=1.0, lang="pt-br",
                 post="highpass=f=90,equalizer=f=3200:t=q:w=1:g=4,aecho=0.8:0.6:40:0.12,"
                      "acompressor=threshold=0.08:ratio=5:attack=3:release=100:makeup=2"),
    "ronnie": dict(kokoro="bm_george*0.5+pm_alex*0.5", speed=0.92, pitch=0.95, lang="pt-br",
                   post="highpass=f=70,equalizer=f=200:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=4:attack=5:release=150:makeup=2"),
    "kaze": dict(kokoro="am_echo*0.5+em_alex*0.5", speed=0.98, pitch=1.0, lang="pt-br",
                 post="highpass=f=100,equalizer=f=5000:t=q:w=1:g=2,acompressor=threshold=0.1:ratio=3:attack=6:release=150:makeup=2"),
    "baron": dict(kokoro="bm_lewis*0.6+pm_santa*0.4", speed=0.9, pitch=0.92, lang="pt-br",
                  post="highpass=f=70,equalizer=f=250:t=q:w=1:g=3,equalizer=f=4500:t=q:w=1:g=2,"
                       "acompressor=threshold=0.1:ratio=3:attack=8:release=200:makeup=2"),
    "razor": dict(kokoro="am_fenrir*0.5+em_alex*0.5", speed=1.0, pitch=0.9, lang="pt-br",
                  post="highpass=f=90,equalizer=f=3500:t=q:w=1:g=5,asoftclip=type=tanh:output=0.88,acrusher=bits=10:mix=0.12,"
                       "acompressor=threshold=0.06:ratio=7:attack=2:release=70:makeup=3"),
    # Fora da história: trailer da abertura, vinhetas, locutor da corrida e a central da Vigilância.
    "trailer": dict(kokoro="pm_santa", speed=0.88, pitch=0.84, lang="pt-br",
                    post="highpass=f=60,equalizer=f=140:t=q:w=1:g=5,equalizer=f=3200:t=q:w=1.2:g=4,"
                         "acompressor=threshold=0.08:ratio=5:attack=4:release=120:makeup=2"),
    "vinheta": dict(kokoro="am_onyx", speed=0.85, pitch=0.8, lang="en-us",
                    post="highpass=f=60,equalizer=f=120:t=q:w=1:g=6,equalizer=f=3000:t=q:w=1.2:g=4,"
                         "chorus=0.7:0.8:22|31:0.35|0.3:0.25|0.3:1.6|2.1,acompressor=threshold=0.08:ratio=6:attack=3:release=150:makeup=2"),
    "nham": dict(kokoro="pm_alex", speed=0.8, pitch=0.68, lang="pt-br",
                 post="highpass=f=50,equalizer=f=90:t=q:w=1:g=7,equalizer=f=5000:t=q:w=1:g=3,"
                      "acompressor=threshold=0.06:ratio=6:attack=3:release=200:makeup=2"),
    "locutor": dict(kokoro="pm_alex", speed=1.0, pitch=1.0, lang="pt-br",
                    post="highpass=f=90,equalizer=f=220:t=q:w=1:g=2,equalizer=f=3500:t=q:w=1:g=5,"
                         "acompressor=threshold=0.1:ratio=6:attack=2:release=80:makeup=3"),
    "central": dict(kokoro="pf_dora", speed=1.05, pitch=1.0, lang="pt-br", post=""),
}

# Rádio da Vigilância: banda estreita, saturado e "sujo" (vai depois do tratamento da voz).
RADIO = ("highpass=f=450,lowpass=f=2900,equalizer=f=1600:t=q:w=1:g=6,"
         "acompressor=threshold=0.05:ratio=10:attack=1:release=50:makeup=4,acrusher=bits=8:mix=0.25,"
         "highpass=f=400,lowpass=f=3200")

# Quem fala no roteiro → voz.
FALANTES = {
    "": "narrador", "Sargento Cross-fit": "crossfit", "Bruno": "bruno", "Mia Marmita": "mia", "Você": "voce",
    "Repórter": "reporter", "Izzy Iogurte": "izzy", "Ming Miojo": "ming", "JV Pastel": "jv", "Vic Virado": "vic",
    "Earl Esfiha": "earl", "Ronnie Rocambole": "ronnie", "Kaze Coxinha": "kaze", "Baron Brigadeiro": "baron",
    "Razor Bacon": "razor",
}

# Emoção → como o Chatterbox fala e o que vem depois:
#   exag: exagero emocional do modelo (0,25 contido ... 1 escandaloso)
#   cfg: aderência ao texto/referência (mais baixo = ritmo mais solto e dramático)
#   temp: variação da fala
#   tempo: velocidade (1 = como o modelo falou; varia por frase em vozes.py)
#   pausa: multiplica as pausas entre frases e nas vírgulas
#   fx: tratamento extra da emoção; ganho: dB acima/abaixo do volume de referência
EMOCAO: dict[str, dict] = {
    "neutro": dict(exag=0.5, cfg=0.5, temp=0.8, tempo=1.0, pausa=1.0, fx="", ganho=0.0),
    "calmo": dict(exag=0.35, cfg=0.5, temp=0.7, tempo=0.96, pausa=1.15, fx="", ganho=-1.0),
    "bravo": dict(exag=1.0, cfg=0.3, temp=0.85, tempo=1.03, pausa=0.8,
                  fx="equalizer=f=2500:t=q:w=1:g=3,asoftclip=type=tanh:output=0.95,acompressor=threshold=0.08:ratio=4:attack=2:release=60:makeup=1",
                  ganho=2.0),
    "debochado": dict(exag=0.7, cfg=0.4, temp=0.85, tempo=0.97, pausa=1.15, fx="", ganho=0.0),
    "comico": dict(exag=0.7, cfg=0.4, temp=0.9, tempo=1.0, pausa=1.1, fx="", ganho=0.0),
    "triste": dict(exag=0.45, cfg=0.45, temp=0.7, tempo=0.92, pausa=1.35,
                   fx="lowpass=f=6500,equalizer=f=3000:t=q:w=1:g=-2", ganho=-2.5),
    "assustado": dict(exag=0.85, cfg=0.4, temp=0.9, tempo=1.06, pausa=0.75, fx="", ganho=0.5),
    "empolgado": dict(exag=0.85, cfg=0.35, temp=0.9, tempo=1.04, pausa=0.8, fx="equalizer=f=3000:t=q:w=1:g=2", ganho=1.0),
    "sussurro": dict(exag=0.3, cfg=0.5, temp=0.7, tempo=0.95, pausa=1.25,
                     fx="highpass=f=220,equalizer=f=5500:t=q:w=1:g=4,equalizer=f=200:t=q:w=1:g=-3", ganho=-4.0),
    "oficial": dict(exag=0.4, cfg=0.5, temp=0.7, tempo=1.03, pausa=0.9, fx="", ganho=0.0),
    "ameaca": dict(exag=0.6, cfg=0.35, temp=0.75, tempo=0.93, pausa=1.35, fx="equalizer=f=120:t=q:w=1:g=3", ganho=0.0),
    "triunfante": dict(exag=0.8, cfg=0.4, temp=0.85, tempo=1.0, pausa=1.0, fx="", ganho=1.0),
    "cansado": dict(exag=0.35, cfg=0.5, temp=0.7, tempo=0.9, pausa=1.4, fx="lowpass=f=6000", ganho=-1.5),
    "epico": dict(exag=0.7, cfg=0.3, temp=0.8, tempo=0.92, pausa=1.3, fx="", ganho=0.5),
}

# Pausas (s) depois de cada pontuação, antes da escala da emoção.
PAUSAS = {",": 0.2, ";": 0.3, ":": 0.32, ".": 0.45, "!": 0.5, "?": 0.55, "...": 0.75, "…": 0.75}
# Pausa extra no "tempo" da piada / do momento dramático (o `beat` da fala).
PAUSA_DRAMATICA = 0.55

# Pronúncia: só muda o que a voz fala; a legenda fica com o texto do roteiro.
PRONUNCIA = {
    "Cross-fit": "Cróssfit",
    "Couve-vette": "Couve-véte",
    "Esfiha": "Esfirra",
    "Kibe-segg": "Kibe-ségue",
    "Skyline": "Skailaine",
    "Shoyu": "Xôiu",
    "X-Tudo": "xis-tudo",
    "M3": "eme três",
    "A3": "á três",
    "GTR": "gê tê érre",
    "GTI": "gê tê í",
    "2002": "dois mil e dois",
    "911": "nove onze",
    "food truck": "fúdi trâque",
    "whey": "uêi",
    "spinning": "spínin",
    "remap": "rimépi",
    "Light": "Láiti",
    "drift": "drífiti",
    "Mustang": "Mãstengue",
    "Jornal da Gordura": "Jornal da Gordura",
    "3 minutos": "três minutos",
    "Número 1": "Número um",
    "JV": "Jota Vê",
}

# Falas fora do modo história: id → (texto, voz, emoção)
LINHAS: dict[str, tuple[str, str, str]] = {
    # Abertura
    "eat": ("Eat Games. Chantilly everything.", "vinheta", "epico"),
    "nham": ("Nhãm vídia.", "nham", "sussurro"),
    "trailer-cidade": ("Porto Gordo.", "trailer", "epico"),
    "trailer-vigilancia": ("A Vigilância Sanitária... quer você.", "trailer", "ameaca"),
    "trailer-calorico": ("Só um pode ser... o mais calórico.", "trailer", "epico"),
    # Largada e corrida
    "tres": ("Três!", "locutor", "empolgado"),
    "dois": ("Dois!", "locutor", "empolgado"),
    "um": ("Uum!", "locutor", "empolgado"),
    "vai": ("Vai!", "locutor", "bravo"),
    "ultima-volta": ("Última volta!", "locutor", "empolgado"),
    "vitoria": ("Primeiro lugar! Que barriga!", "locutor", "triunfante"),
    "chegada": ("Bandeirada! Fim de corrida.", "locutor", "triunfante"),
    # Vigilância Sanitária (rádio da central)
    "radio-perseguicao": ("Central, suspeito comendo na rua. Iniciando perseguição.", "central", "oficial"),
    "radio-escapou": ("Central... perdemos o suspeito de vista.", "central", "cansado"),
    "radio-autuado": ("Suspeito autuado. Pode recolher a fritura.", "central", "triunfante"),
}
# Falas que ficam com a gravação antiga (do Kokoro): o Chatterbox não consegue
# falar uma palavra tão curta ("Um!" sai "Hmm" ou trava). Só regrava se pedir pelo id.
MANTER = {"um"}
# Falas fora da história que passam pelo rádio.
LINHAS_RADIO = {"radio-perseguicao", "radio-escapou", "radio-autuado"}
