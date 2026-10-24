// Logotipo do jogo em SVG, desenhado à mão. É uma paródia do estilo dos jogos
// de corrida dos anos 2000 (letra cromada inclinada + carimbo de "procurado"),
// sem copiar a marca de ninguém.

export const LOGO_SVG = `
<svg class="logo" viewBox="0 0 820 330" role="img" aria-label="Need for Burgers: Most Calories">
  <defs>
    <linearGradient id="logo-chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.45" stop-color="#d9dde2"/>
      <stop offset="0.5" stop-color="#6d737b"/>
      <stop offset="0.62" stop-color="#b9bec5"/>
      <stop offset="1" stop-color="#f4f6f8"/>
    </linearGradient>
    <linearGradient id="logo-mustard" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd23f"/>
      <stop offset="1" stop-color="#e88a0c"/>
    </linearGradient>
    <filter id="logo-glow" x="-10%" y="-30%" width="120%" height="160%">
      <feGaussianBlur stdDeviation="7" result="blur"/>
      <feFlood flood-color="#ff7a00" flood-opacity="0.75"/>
      <feComposite in2="blur" operator="in"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- Textura "gasta" do carimbo: buracos aleatórios recortando as letras. -->
    <filter id="logo-worn">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.4 1.45"/>
      <feComposite in="SourceGraphic" operator="in"/>
    </filter>
  </defs>

  <g transform="translate(410 0) skewX(-12)">
    <text x="-8" y="62" text-anchor="middle" font-family="'Russo One', sans-serif" font-size="44"
      letter-spacing="18" fill="#ffffff" stroke="#000" stroke-width="2" paint-order="stroke">NEED FOR</text>
    <rect x="-330" y="72" width="140" height="5" fill="#ff7a00"/>
    <rect x="175" y="72" width="140" height="5" fill="#ff7a00"/>

    <g filter="url(#logo-glow)">
      <text x="0" y="190" text-anchor="middle" font-family="'Russo One', sans-serif" font-size="138"
        fill="url(#logo-chrome)" stroke="#111" stroke-width="7" paint-order="stroke" letter-spacing="2">BURGERS</text>
    </g>
  </g>

  <!-- Faixa de carimbo, levemente torta, com um hambúrguer no lugar do "O". -->
  <g transform="translate(410 262) rotate(-3)">
    <rect x="-330" y="-46" width="660" height="88" fill="#16110d" stroke="url(#logo-mustard)" stroke-width="5"/>
    <g filter="url(#logo-worn)" font-family="'Black Ops One', sans-serif" font-size="60" fill="url(#logo-mustard)">
      <text x="-306" y="22" textLength="50" lengthAdjust="spacingAndGlyphs">M</text>
      <text x="-188" y="22" textLength="496" lengthAdjust="spacingAndGlyphs">ST CALORIES</text>
    </g>
    <g transform="translate(-222 -2) scale(0.92)">
      <path d="M-26 -4 a26 22 0 0 1 52 0 z" fill="#e0a24a" stroke="#16110d" stroke-width="2"/>
      <rect x="-28" y="-4" width="56" height="6" rx="3" fill="#5cb83a"/>
      <rect x="-26" y="2" width="52" height="10" rx="4" fill="#5a3418"/>
      <path d="M-27 12 h54 l-6 6 h-42 z" fill="#f6c945"/>
      <rect x="-25" y="17" width="50" height="9" rx="4" fill="#d9973f" stroke="#16110d" stroke-width="2"/>
      <circle cx="-9" cy="-14" r="1.6" fill="#fff6d8"/><circle cx="4" cy="-18" r="1.6" fill="#fff6d8"/><circle cx="13" cy="-11" r="1.6" fill="#fff6d8"/>
    </g>
  </g>
</svg>`;
