#!/usr/bin/env python3
"""Kit de identidade visual do Calivix: símbolo, ícones (macOS, iOS/Android, web/Windows/Umbrel),
ícone dos instaladores, nome estilizado, assinaturas, papéis de parede e arte do instalador .dmg.

    python3 marca/gerar.py          (requer rsvg-convert: brew install librsvg)

Tudo sai daqui: para mudar algo, altere o script e rode de novo.
"""
import os
import subprocess

AQUI = os.path.dirname(os.path.abspath(__file__))

INDIGO = '#1e1b4b'
NOITE = '#020617'
TELA = '#0b1022'
MOLDURA = '#cbd5e1'
ROSA = '#f43f5e'
AMBAR = '#f59e0b'
CIANO = '#22d3ee'
TEXTO_CLARO = '#e7eaf6'
TEXTO_ESCURO = '#1e1b4b'


def grad_curva(gid='curva', x1=0, y1=1, x2=1, y2=0, units=''):
    u = f' gradientUnits="userSpaceOnUse"' if units else ''
    return (f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"{u}>'
            f'<stop offset="0" stop-color="{ROSA}"/><stop offset=".5" stop-color="{AMBAR}"/><stop offset="1" stop-color="{CIANO}"/></linearGradient>')


def simbolo_corpo(moldura=MOLDURA, tela=TELA, pe=True, gid='curva'):
    """A TV com a curva de calibração, no quadro 1024×1024 (área útil ~160–864)."""
    return f'''<rect x="160" y="236" width="704" height="452" rx="80" fill="{tela}" stroke="{moldura}" stroke-opacity=".92" stroke-width="26"/>
<path d="M300 470 L724 470" stroke="#475569" stroke-width="10" stroke-dasharray="4 26" stroke-linecap="round"/>
<path d="M232 600 C 360 600, 380 330, 512 330 S 664 520, 792 380" fill="none" stroke="url(#{gid})" stroke-width="40" stroke-linecap="round"/>
<circle cx="512" cy="330" r="34" fill="#fff"/>''' + (f'<path d="M430 760 L594 760 L560 700 L464 700 Z" fill="{moldura}"/>' if pe else '')


def svg(w, h, corpo, defs=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><defs>{defs}</defs>{corpo}</svg>'


FUNDO = (f'<linearGradient id="fundo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{INDIGO}"/>'
         f'<stop offset="1" stop-color="{NOITE}"/></linearGradient>')


def salvar(rel, conteudo):
    caminho = os.path.join(AQUI, rel)
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, 'w', encoding='utf-8') as f:
        f.write(conteudo)


def png(svg_rel, png_rel, largura, altura=None):
    destino = os.path.join(AQUI, png_rel)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    cmd = ['rsvg-convert', '-w', str(largura), '-h', str(altura or largura), os.path.join(AQUI, svg_rel), '-o', destino]
    subprocess.run(cmd, check=True)


TAMANHOS = (64, 128, 180, 192, 256, 512, 1024)


def simbolo():
    salvar('svg/simbolo.svg', svg(1024, 1024, simbolo_corpo(), grad_curva()))
    for t in (256, 512, 1024):
        png('svg/simbolo.svg', f'png/simbolo-{t}.png', t)


def icone_quadrado():
    """iPhone, iPad e Android: sangra até a borda (o sistema arredonda)."""
    salvar('svg/icone-quadrado.svg', svg(1024, 1024, '<rect width="1024" height="1024" fill="url(#fundo)"/>' + simbolo_corpo(), FUNDO + grad_curva()))
    for t in TAMANHOS:
        png('svg/icone-quadrado.svg', f'png/icone-quadrado-{t}.png', t)


def icone_arredondado():
    """Web/PWA, Windows e loja do Umbrel: cantos arredondados, borda transparente."""
    salvar('svg/icone-arredondado.svg', svg(1024, 1024, '<rect width="1024" height="1024" rx="228" fill="url(#fundo)"/>' + simbolo_corpo(), FUNDO + grad_curva()))
    for t in TAMANHOS:
        png('svg/icone-arredondado.svg', f'png/icone-arredondado-{t}.png', t)


def icone_macos(badge=False):
    """Grade oficial do macOS: placa de 824 px com margem de 100 e sombra."""
    sombra = '<filter id="sombra" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity=".35"/></filter>'
    corpo = f'<g filter="url(#sombra)"><rect x="100" y="100" width="824" height="824" rx="185" fill="url(#fundo)"/></g>'
    corpo += f'<g transform="translate(100 100) scale(.8047)">{simbolo_corpo()}</g>'
    if badge:
        # selo de instalação: círculo com seta para baixo, no canto inferior direito
        corpo += (f'<g filter="url(#sombra)"><circle cx="772" cy="772" r="168" fill="#ffffff"/></g>'
                  f'<circle cx="772" cy="772" r="140" fill="url(#selo)"/>'
                  f'<path d="M772 690 V830 M712 776 L772 836 L832 776" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>')
    defs = FUNDO + grad_curva() + sombra + grad_curva('selo', 0, 1, 1, 0)
    nome = 'icone-instalador' if badge else 'icone-macos'
    salvar(f'svg/{nome}.svg', svg(1024, 1024, corpo, defs))
    if badge:
        png(f'svg/{nome}.svg', 'dmg/icone-instalador.png', 1024)
        for t in (256, 512):
            png(f'svg/{nome}.svg', f'png/{nome}-{t}.png', t)
    else:
        for t in TAMANHOS:
            png(f'svg/{nome}.svg', f'png/{nome}-{t}.png', t)


# ------------------------------------------------------------- nome estilizado (traços, sem fonte)
# CALIVIX em letras finas e geométricas; CALI na cor do texto, VIX no degradê da curva.
LETRAS = {
    'C': ('path', 'M78 14 A50 50 0 1 0 78 86'),
    'A': ('poly', '0,100 42,0 84,100|16,64 68,64'),
    'L': ('poly', '0,0 0,100 66,100'),
    'I': ('poly', '0,0 0,100'),
    'V': ('poly', '0,0 42,100 84,0'),
    'X': ('poly', '0,0 80,100|80,0 0,100'),
}
LARG = {'C': 84, 'A': 84, 'L': 66, 'I': 0, 'V': 84, 'X': 80}


def nome_corpo(cor, gid='nomeg', esp=9, gap=34):
    x = 0
    partes = []
    for i, ch in enumerate('CALIVIX'):
        tipo, d = LETRAS[ch]
        traco = cor if i < 4 else f'url(#{gid})'
        if tipo == 'path':
            partes.append(f'<path transform="translate({x} 0)" d="{d}" fill="none" stroke="{traco}" stroke-width="{esp}" stroke-linecap="round"/>')
        else:
            for seg in d.split('|'):
                pts = ' '.join(f'{float(a) + x},{b}' for a, b in (p.split(',') for p in seg.split()))
                partes.append(f'<polyline points="{pts}" fill="none" stroke="{traco}" stroke-width="{esp}" stroke-linecap="round" stroke-linejoin="round"/>')
        x += LARG[ch] + gap
    return ''.join(partes), x - gap


def nome(cor, sufixo):
    corpo, w = nome_corpo(cor)
    pad = 20
    defs = grad_curva('nomeg', units=True).replace('x1="0" y1="1" x2="1" y2="0"', f'x1="{w * .5}" y1="0" x2="{w}" y2="0"')
    salvar(f'svg/nome-{sufixo}.svg', f'<svg xmlns="http://www.w3.org/2000/svg" width="{w + 2 * pad}" height="{100 + 2 * pad}" viewBox="{-pad} {-pad} {w + 2 * pad} {100 + 2 * pad}"><defs>{defs}</defs>{corpo}</svg>')
    for t in (480, 960, 1920):
        png(f'svg/nome-{sufixo}.svg', f'png/nome-{sufixo}-{t}.png', t, round(t * (100 + 2 * pad) / (w + 2 * pad)))
    return w


def assinaturas():
    for sufixo, cor in (('fundo-escuro', TEXTO_CLARO), ('fundo-claro', TEXTO_ESCURO)):
        corpo_nome, w = nome_corpo(cor)
        defs = FUNDO + grad_curva() + grad_curva('nomeg', units=True).replace('x1="0" y1="1" x2="1" y2="0"', f'x1="{w * .5}" y1="0" x2="{w}" y2="0"')
        # horizontal: ícone + nome
        corpo = (f'<rect width="1024" height="1024" rx="228" fill="url(#fundo)" transform="scale(.234)"/>'
                 f'<g transform="scale(.234)">{simbolo_corpo()}</g><g transform="translate(290 70) scale(1)">{corpo_nome}</g>')
        W = 290 + w + 20
        salvar(f'svg/marca-horizontal-{sufixo}.svg', svg(W, 240, corpo, defs))
        for t in (480, 960, 1920):
            png(f'svg/marca-horizontal-{sufixo}.svg', f'png/marca-horizontal-{sufixo}-{t}.png', t, round(t * 240 / W))
        # vertical: ícone em cima, nome e lema embaixo
        Wv = max(w, 520) + 80
        lema_cor = '#94a3b8' if sufixo == 'fundo-escuro' else '#475569'
        corpo = (f'<g transform="translate({(Wv - 360) / 2} 0) scale(.3516)"><rect width="1024" height="1024" rx="228" fill="url(#fundo)"/>{simbolo_corpo()}</g>'
                 f'<g transform="translate({(Wv - w) / 2} 420)">{corpo_nome}</g>'
                 f'<text x="{Wv / 2}" y="590" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="30" letter-spacing="9" fill="{lema_cor}">AJUSTE FINO PARA SUA TV</text>')
        salvar(f'svg/marca-vertical-{sufixo}.svg', svg(Wv, 620, corpo, defs))
        for t in (520, 1040):
            png(f'svg/marca-vertical-{sufixo}.svg', f'png/marca-vertical-{sufixo}-{t}.png', t, round(t * 620 / Wv))


# ------------------------------------------------------------- papéis de parede
def papel(W, H, sufixo):
    s = min(W, H) * .55
    corpo = (f'<rect width="{W}" height="{H}" fill="url(#fundo)"/>'
             f'<g opacity=".08"><path d="M0 {H * .78} C {W * .3} {H * .78}, {W * .35} {H * .25}, {W * .5} {H * .25} S {W * .72} {H * .65}, {W} {H * .4}" fill="none" stroke="url(#largo)" stroke-width="{H * .06}" stroke-linecap="round"/></g>'
             f'<g transform="translate({(W - s) / 2} {(H - s) / 2 - H * .04}) scale({s / 1024})">{simbolo_corpo()}</g>')
    defs = FUNDO + grad_curva() + grad_curva('largo', units=True).replace('x1="0" y1="1" x2="1" y2="0"', f'x1="0" y1="0" x2="{W}" y2="0"')
    salvar(f'papeis-de-parede/{sufixo}.svg', svg(W, H, corpo, defs))
    png(f'papeis-de-parede/{sufixo}.svg', f'papeis-de-parede/{sufixo}.png', W, H)


# ------------------------------------------------------------- instalador .dmg (janela 640 × 400)
def fundo_dmg():
    W, H = 640, 400
    corpo_nome, w = nome_corpo(TEXTO_ESCURO, esp=10)
    defs = (f'<linearGradient id="fundo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfaff"/><stop offset=".55" stop-color="#f1effc"/><stop offset="1" stop-color="#e6e3fa"/></linearGradient>'
            + grad_curva() + grad_curva('nomeg', units=True).replace('x1="0" y1="1" x2="1" y2="0"', f'x1="{w * .5}" y1="0" x2="{w}" y2="0"'))
    esc = 0.2
    corpo = f'<rect width="{W}" height="{H}" fill="url(#fundo)"/>'
    # marca-d'água: anéis e a curva
    corpo += (f'<g opacity=".10"><circle cx="320" cy="214" r="150" fill="none" stroke="url(#curva)" stroke-width="15"/>'
              f'<circle cx="320" cy="214" r="100" fill="none" stroke="url(#curva)" stroke-width="5"/></g>'
              f'<g opacity=".13" transform="translate(196 92) scale(.242)"><path d="M232 600 C 360 600, 380 330, 512 330 S 664 520, 792 380" fill="none" stroke="url(#curva)" stroke-width="40" stroke-linecap="round"/></g>')
    corpo += f'<g transform="translate({(W - w * esc) / 2} 38) scale({esc})">{corpo_nome}</g>'
    # setas pontilhadas entre o app e Aplicativos
    for i in range(6):
        corpo += f'<circle cx="{262 + i * 18}" cy="204" r="4.5" fill="#8b5cf6" fill-opacity=".85"/>'
    corpo += '<polyline points="366,190 380,204 366,218" fill="none" stroke="#8b5cf6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    corpo += '<text x="320" y="352" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="500" fill="#3b3a5e">Arraste o Calivix para Aplicativos</text>'
    salvar('dmg/fundo.svg', svg(W, H, corpo, defs))
    png('dmg/fundo.svg', 'dmg/fundo.png', 640, 400)
    png('dmg/fundo.svg', 'dmg/fundo@2x.png', 1280, 800)


def previa():
    corpo = '<rect width="1800" height="1300" fill="#0f172a"/>'
    corpo += '<text x="60" y="90" font-family="Helvetica Neue, Arial" font-size="44" font-weight="700" fill="#e7eaf6">Calivix — kit de identidade visual</text>'
    itens = [('png/icone-macos-512.png', 'macOS'), ('png/icone-quadrado-512.png', 'iPhone · iPad · Android'), ('png/icone-arredondado-512.png', 'Web · Windows · Umbrel'), ('png/icone-instalador-512.png', 'Instaladores (.dmg / .exe)')]
    for i, (f, t) in enumerate(itens):
        x = 60 + i * 430
        corpo += f'<image href="{f}" x="{x}" y="140" width="360" height="360"/><text x="{x + 180}" y="540" text-anchor="middle" font-family="Helvetica Neue, Arial" font-size="22" fill="#94a3b8">{t}</text>'
    corpo += '<image href="png/marca-horizontal-fundo-escuro-960.png" x="60" y="600" width="820"/>'
    corpo += '<rect x="940" y="590" width="800" height="230" rx="20" fill="#f8fafc"/><image href="png/marca-horizontal-fundo-claro-960.png" x="960" y="610" width="760"/>'
    corpo += '<image href="dmg/fundo@2x.png" x="60" y="880" width="560" height="350"/><text x="660" y="1060" font-family="Helvetica Neue, Arial" font-size="22" fill="#94a3b8">Janela do instalador (.dmg)</text>'
    cores = [(INDIGO, 'Índigo'), (NOITE, 'Noite'), (ROSA, 'Rosa'), (AMBAR, 'Âmbar'), (CIANO, 'Ciano'), (TEXTO_CLARO, 'Texto claro')]
    for i, (c, n) in enumerate(cores):
        x = 1000 + (i % 3) * 250
        y = 900 + (i // 3) * 170
        corpo += f'<rect x="{x}" y="{y}" width="200" height="100" rx="14" fill="{c}" stroke="#334155"/><text x="{x}" y="{y + 132}" font-family="Helvetica Neue, Arial" font-size="20" fill="#cbd5e1">{n} {c}</text>'
    salvar('previa-kit.svg', svg(1800, 1300, corpo))
    png('previa-kit.svg', 'previa-kit.png', 1800, 1300)


def icones_moveis():
    """Camadas do ícone adaptável do Android (108 dp; o símbolo cabe na zona segura de 66 dp) e banner da TV."""
    destino = os.path.join(AQUI, '..', 'clients', 'mobile', 'assets')
    os.makedirs(destino, exist_ok=True)
    def grava(nome, conteudo):
        with open(os.path.join(destino, nome), 'w', encoding='utf-8') as f:
            f.write(conteudo)
    grava('icon-only.svg', svg(1024, 1024, '<rect width="1024" height="1024" fill="url(#fundo)"/>' + simbolo_corpo(), FUNDO + grad_curva()))
    grava('icon-background.svg', svg(1024, 1024, '<rect width="1024" height="1024" fill="url(#fundo)"/>', FUNDO))
    grava('icon-foreground.svg', svg(1024, 1024, f'<g transform="translate(184 184) scale(.6406)">{simbolo_corpo()}</g>', grad_curva()))
    # banner da tela inicial das TVs Android (320×180)
    corpo_nome, w = nome_corpo(TEXTO_CLARO)
    defs_nome = grad_curva('nomeg', units=True).replace('x1="0" y1="1" x2="1" y2="0"', f'x1="{w * .5}" y1="0" x2="{w}" y2="0"')
    banner = (f'<rect width="1280" height="720" fill="url(#fundo)"/><g transform="translate(110 150) scale(.41)">{simbolo_corpo()}</g>'
              f'<g transform="translate(560 305) scale({620 / w})">{corpo_nome}</g>')
    grava('banner-tv.svg', svg(1280, 720, banner, FUNDO + grad_curva() + defs_nome))
    nativo = os.path.join(AQUI, '..', 'clients', 'mobile', 'native', 'android')
    os.makedirs(nativo, exist_ok=True)
    subprocess.run(['rsvg-convert', '-w', '320', '-h', '180', os.path.join(destino, 'banner-tv.svg'), '-o', os.path.join(nativo, 'banner_tv.png')], check=True)


if __name__ == '__main__':
    simbolo()
    icone_quadrado()
    icone_arredondado()
    icone_macos()
    icone_macos(badge=True)
    nome(TEXTO_CLARO, 'fundo-escuro')
    nome(TEXTO_ESCURO, 'fundo-claro')
    assinaturas()
    papel(3840, 2160, 'desktop-4k')
    papel(1290, 2796, 'iphone')
    papel(2732, 2048, 'ipad')
    fundo_dmg()
    previa()
    icones_moveis()
    print('Kit gerado em', AQUI)
