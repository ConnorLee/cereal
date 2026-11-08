// Original artwork for the demo's three made-up companies, drawn as SVG:
//   Northwind Field Co. — offline field notes for botanists (moss, lichen, vellum; a bookish serif)
//   Lumen Lighting Labs — lighting scenes for small venues (night, amber, violet, rose; a geometric sans)
//   Paperboat Press     — a quiet monthly newsletter tool (paper, terracotta, ink; an italic serif)
// Each has an app icon, a wordmark, product screens and a landing-page header with a product mockup.
const F = 'font-family="-apple-system, BlinkMacSystemFont, \'Helvetica Neue\', Helvetica, Arial, sans-serif"';
const SANS = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const NW_SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const LU_SANS = "'Avenir Next', Avenir, Futura, 'Century Gothic', 'Helvetica Neue', Arial, sans-serif";
const PB_SERIF = "Georgia, 'Times New Roman', serif";

export const identities = {
  northwind: { company: 'Northwind Field Co.', brand: { surface: '#F2EFE6', ink: '#16211B', accent: '#2F6B4A', glow: '#DCE8DA', mode: 'light', font: 'Iowan Old Style' } },
  lumen: { company: 'Lumen Lighting Labs', brand: { surface: '#0B0A10', ink: '#F6F3FF', accent: '#F2A33A', glow: '#7A5CFF', mode: 'dark', font: 'Avenir Next' } },
  paperboat: { company: 'Paperboat Press', brand: { surface: '#F6F0EA', ink: '#231A12', accent: '#B4693A', glow: '#EBD8C6', mode: 'light', font: 'Georgia' } },
};

// ---------- marks: drawn once, used in the icon, the wordmark and the landing header ----------
const leaf = (fill, rib) => `<path d="M128 46c44 32 58 82 34 128-9 17-21 28-34 34-13-6-25-17-34-34-24-46-10-96 34-128z" fill="${fill}"/><path d="M128 74v128" stroke="${rib}" stroke-width="7" stroke-linecap="round"/><path d="M128 118l-22-15M128 146l26-17M128 172l-18-12" stroke="${rib}" stroke-width="6" stroke-linecap="round"/>`;
const nwMark = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s / 256})"><circle cx="128" cy="128" r="112" fill="none" stroke="#2F6B4A" stroke-width="10" opacity="0.28"/>${leaf('#2F6B4A', '#F2EFE6')}<circle cx="128" cy="42" r="11" fill="#E3B341"/></g>`;
const luMark = (x, y, s, core = '#FFF6E3') => `<g transform="translate(${x} ${y}) scale(${s / 256})"><circle cx="100" cy="104" r="62" fill="#F2A33A" opacity="0.95"/><circle cx="156" cy="104" r="62" fill="#7A5CFF" opacity="0.85" style="mix-blend-mode:screen"/><circle cx="128" cy="152" r="62" fill="#FF5FA2" opacity="0.85" style="mix-blend-mode:screen"/><circle cx="128" cy="120" r="20" fill="${core}"/></g>`;
const pbMark = (x, y, s, c = '#B4693A', c2 = '#D9A27E') => `<g transform="translate(${x} ${y}) scale(${s / 256})"><path d="M40 146h176l-30 46H70z" fill="${c}"/><path d="M128 40l60 106h-60z" fill="${c}"/><path d="M128 62l-40 84h40z" fill="${c2}"/><path d="M34 214c22 11 44 11 66 0s44-11 66 0 44 11 60 0" stroke="${c}" stroke-width="9" fill="none" stroke-linecap="round"/></g>`;

export const icons = {
  northwind: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C8E66"/><stop offset="1" stop-color="#1F4A33"/></linearGradient></defs><rect width="256" height="256" rx="58" fill="url(#g)"/><circle cx="128" cy="128" r="96" fill="none" stroke="#F2EFE6" stroke-width="5" opacity="0.22"/><path d="M128 20v14M128 222v14M20 128h14M222 128h14" stroke="#F2EFE6" stroke-width="5" stroke-linecap="round" opacity="0.3"/>${leaf('#F2EFE6', '#2B5E42')}<circle cx="128" cy="44" r="10" fill="#E3B341"/></svg>`,
  lumen: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><radialGradient id="h" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#2A2338"/><stop offset="1" stop-color="#0B0A10"/></radialGradient></defs><rect width="256" height="256" rx="58" fill="url(#h)"/>${luMark(0, 0, 256)}</svg>`,
  paperboat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C47A48"/><stop offset="1" stop-color="#A85F33"/></linearGradient></defs><rect width="256" height="256" rx="58" fill="url(#p)"/>${pbMark(0, 0, 256, '#F8F2EB', '#E8D3C0')}</svg>`,
};

// Wordmarks are logotypes in the brand's dark ink: they sit on Cereal's light paper, next to the app icon.
export const wordmarks = {
  northwind: `<svg xmlns="http://www.w3.org/2000/svg" width="510" height="140" viewBox="0 0 510 140"><text x="4" y="106" font-family="${NW_SERIF}" font-weight="600" font-size="96" letter-spacing="-2.5" fill="#1B3A29">Northwind</text></svg>`,
  lumen: `<svg xmlns="http://www.w3.org/2000/svg" width="310" height="140" viewBox="0 0 310 140"><text x="2" y="104" font-family="${LU_SANS}" font-weight="700" font-size="104" letter-spacing="-5" fill="#17151F">lumen</text></svg>`,
  paperboat: `<svg xmlns="http://www.w3.org/2000/svg" width="510" height="140" viewBox="0 0 510 140"><text x="4" y="104" font-family="${PB_SERIF}" font-style="italic" font-size="92" letter-spacing="-3" fill="#8A4E2A">paperboat</text></svg>`,
};

// ---------- product screens, committed as App Store shots and mockups ----------
const phone = (inner, bg = '#F4F7F4') => `<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2532" viewBox="0 0 390 844" ${F}><rect width="390" height="844" fill="${bg}"/><text x="28" y="40" font-size="15" font-weight="600" fill="#14201A">9:41</text><rect x="318" y="30" width="44" height="13" rx="4" fill="none" stroke="#14201A" stroke-width="1.5"/><rect x="321" y="33" width="32" height="7" rx="2" fill="#14201A"/>${inner}<rect x="128" y="822" width="134" height="5" rx="2.5" fill="#14201A" opacity="0.85"/></svg>`;
const card = (y, title, sub, tone) => `<rect x="20" y="${y}" width="350" height="96" rx="22" fill="#FFFFFF"/><rect x="36" y="${y + 16}" width="64" height="64" rx="16" fill="${tone}"/><path d="M68 ${y + 30}c10 8 13 20 7 31-2 4-5 7-7 8-3-1-6-4-8-8-6-11-3-23 8-31z" fill="#FFFFFF" opacity="0.85"/><text x="116" y="${y + 44}" font-size="19" font-weight="600" fill="#14201A">${title}</text><text x="116" y="${y + 70}" font-size="15" fill="#5E6B63">${sub}</text>`;

export const screens = {
  northwind: [
    phone(`<text x="24" y="104" font-size="34" font-weight="700" fill="#14201A" letter-spacing="-1">Field notes</text><text x="24" y="134" font-size="16" fill="#5E6B63">Kew transect B · 14 specimens</text>
      ${card(160, 'Wood anemone', 'Plot 3 · tagged 9:12', '#58A27A')}${card(272, 'Lesser celandine', 'Plot 3 · tagged 9:30', '#C9B23A')}${card(384, 'Dog violet', 'Plot 4 · tagged 10:05', '#7B5BD6')}${card(496, 'Ramsons', 'Plot 5 · photo pending', '#3F7D5B')}
      <rect x="20" y="716" width="350" height="64" rx="32" fill="#3F7D5B"/><text x="195" y="756" text-anchor="middle" font-size="19" font-weight="600" fill="#FFFFFF">Tag a specimen</text>`),
    phone(`<rect x="0" y="60" width="390" height="784" fill="#DCE9DF"/><path d="M0 220c80-30 140 10 220-20s120-60 170-40v160c-60-10-120 40-200 30S60 300 0 330z" fill="#CBDFD0"/><path d="M0 520c90 20 150-30 240 0s110 30 150 10v314H0z" fill="#C2D9C8"/>
      <path d="M70 250l90-20 40 70-70 40z" fill="#58A27A" opacity="0.35" stroke="#2E6A49" stroke-width="2"/><path d="M220 380l100-10 10 90-90 20z" fill="#C9B23A" opacity="0.35" stroke="#8A7A1F" stroke-width="2"/><path d="M110 560l90-30 50 80-110 30z" fill="#7B5BD6" opacity="0.3" stroke="#4A3CC4" stroke-width="2"/>
      <circle cx="140" cy="285" r="10" fill="#2E6A49"/><circle cx="270" cy="420" r="10" fill="#8A7A1F"/><circle cx="180" cy="590" r="10" fill="#4A3CC4"/><circle cx="196" cy="470" r="14" fill="#FFFFFF" stroke="#3F7D5B" stroke-width="5"/>
      <rect x="20" y="88" width="350" height="52" rx="26" fill="#FFFFFF"/><text x="44" y="121" font-size="17" fill="#5E6B63">Offline map · 3 plots cached</text>
      <rect x="20" y="676" width="350" height="104" rx="26" fill="#FFFFFF"/><text x="44" y="718" font-size="20" font-weight="600" fill="#14201A">Plot 3</text><text x="44" y="746" font-size="15" fill="#5E6B63">6 specimens · 2.4 s cold start</text>`, '#DCE9DF'),
    phone(`<rect x="0" y="60" width="390" height="430" fill="#2E6A49"/><path d="M195 120c70 50 90 140 50 220-14 28-34 46-50 56-16-10-36-28-50-56-40-80-20-170 50-220z" fill="#9FD0B2"/><path d="M195 160v236" stroke="#2E6A49" stroke-width="6"/><path d="M195 240l-40-28M195 290l46-32M195 340l-34-22" stroke="#2E6A49" stroke-width="5" stroke-linecap="round"/>
      <text x="24" y="536" font-size="30" font-weight="700" fill="#14201A" letter-spacing="-0.8">Wood anemone</text><text x="24" y="566" font-size="16" font-style="italic" fill="#5E6B63">Anemone nemorosa</text>
      <rect x="24" y="592" width="104" height="34" rx="17" fill="#E3F0E7"/><text x="76" y="615" text-anchor="middle" font-size="14" fill="#2E6A49">Plot 3</text><rect x="138" y="592" width="120" height="34" rx="17" fill="#E3F0E7"/><text x="198" y="615" text-anchor="middle" font-size="14" fill="#2E6A49">JPEG export</text>
      <rect x="20" y="716" width="350" height="64" rx="32" fill="#14201A"/><text x="195" y="756" text-anchor="middle" font-size="19" font-weight="600" fill="#FFFFFF">Export to herbarium</text>`, '#FFFFFF'),
  ],
  lumen: `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1500" viewBox="0 0 1600 1000" ${F}><rect width="1600" height="1000" fill="#0E0D14"/>
    <defs><radialGradient id="a" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFC56B"/><stop offset="1" stop-color="#F2A33A" stop-opacity="0"/></radialGradient><radialGradient id="b" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9B85FF"/><stop offset="1" stop-color="#7A5CFF" stop-opacity="0"/></radialGradient><radialGradient id="c" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FF7AA8"/><stop offset="1" stop-color="#FF5FA2" stop-opacity="0"/></radialGradient></defs>
    <rect x="60" y="60" width="1000" height="640" rx="36" fill="#17151F"/><circle cx="380" cy="360" r="260" fill="url(#a)"/><circle cx="700" cy="300" r="220" fill="url(#b)"/><circle cx="820" cy="480" r="180" fill="url(#c)"/>
    <text x="100" y="130" font-size="34" font-weight="700" fill="#F4F2FA" letter-spacing="-1">Friday, late set</text><text x="100" y="170" font-size="20" fill="#9A95AA">Scene · 6 lights · shared by link</text>
    <rect x="1100" y="60" width="440" height="640" rx="36" fill="#17151F"/><text x="1140" y="130" font-size="24" font-weight="600" fill="#F4F2FA">Lights</text>
    ${['Amber wash', 'Violet back', 'Rose spot', 'Bar strip'].map((n, i) => `<text x="1140" y="${200 + i * 110}" font-size="20" fill="#EDEBF3">${n}</text><rect x="1140" y="${222 + i * 110}" width="360" height="10" rx="5" fill="#2B2735"/><rect x="1140" y="${222 + i * 110}" width="${[280, 200, 150, 320][i]}" height="10" rx="5" fill="${['#F2A33A', '#7A5CFF', '#FF5FA2', '#FFD58A'][i]}"/><circle cx="${1140 + [280, 200, 150, 320][i]}" cy="${227 + i * 110}" r="13" fill="#FFFFFF"/>`).join('')}
    ${['Doors', 'Soundcheck', 'Friday, late set', 'Close'].map((n, i) => `<rect x="${60 + i * 377}" y="740" width="350" height="200" rx="28" fill="${i === 2 ? '#2A2235' : '#17151F'}" stroke="${i === 2 ? '#F2A33A' : 'none'}" stroke-width="3"/><circle cx="${130 + i * 377}" cy="810" r="34" fill="${['#7A5CFF', '#3FB6C9', '#F2A33A', '#FF5FA2'][i]}" opacity="0.9"/><text x="${90 + i * 377}" y="900" font-size="24" font-weight="600" fill="#F4F2FA">${n}</text>`).join('')}
  </svg>`,
  paperboat: `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1500" viewBox="0 0 1600 1000" ${F}><rect width="1600" height="1000" fill="#F6F0EA"/>
    <rect x="0" y="0" width="1600" height="72" fill="#FBF7F2"/><circle cx="60" cy="36" r="14" fill="#B4693A"/><text x="90" y="44" font-size="22" font-weight="600" fill="#231A12">Paperboat</text><text x="1400" y="44" font-size="18" fill="#7A6A5C">Archive · About</text>
    <text x="200" y="230" font-family="Georgia, serif" font-size="92" fill="#231A12" letter-spacing="-3">The Monthly Tide</text><text x="204" y="290" font-size="26" fill="#7A6A5C">A letter about slow work, written once a month.</text>
    ${['November', 'October', 'September', 'August'].map((m, i) => `<line x1="200" y1="${380 + i * 140}" x2="1400" y2="${380 + i * 140}" stroke="#E6D9CB" stroke-width="2"/><text x="200" y="${440 + i * 140}" font-size="22" fill="#B4693A">${m} 2026</text><text x="420" y="${440 + i * 140}" font-family="Georgia, serif" font-size="38" fill="#231A12">${['On keeping a small garden', 'Letters that arrive late', 'The case for plain text', 'Notes from a quiet harbour'][i]}</text><text x="420" y="${478 + i * 140}" font-size="20" fill="#7A6A5C">${['6 min read', '4 min read', '5 min read', '7 min read'][i]}</text>`).join('')}
  </svg>`,
};

// ---------- landing-page headers: headline on top, the product rising from below ----------
// 2:1, with everything that matters in the top half, because Cereal fades the lower part into the page.
const cover = (bg, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1200" viewBox="0 0 1600 800" ${F}>${bg}${inner}</svg>`;
const shadow = (id, color = '#000', o = 0.22) => `<filter id="${id}" x="-40%" y="-40%" width="180%" height="220%"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="${color}" flood-opacity="${o}"/></filter>`;
// A wavy closed line around a centre: topographic contours for Northwind.
function contour(cx, cy, r, k, phase) {
  const pts = Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    const rr = r * (1 + 0.09 * Math.sin(3 * t + phase) + 0.05 * Math.sin(5 * t + phase * 1.7));
    return `${(cx + rr * Math.cos(t) * k).toFixed(1)},${(cy + rr * Math.sin(t)).toFixed(1)}`;
  });
  return `M${pts.join('L')}Z`;
}
const nav = ({ mark, name, links, cta, ink, sub, ctaBg, ctaInk }) => `${mark}<text x="112" y="66" ${name}</text>
  ${links.reduceRight((acc, l) => ({ x: acc.x - l.length * 8.4 - 34, out: acc.out + `<text x="${acc.x}" y="64" text-anchor="end" font-size="16" fill="${sub}" letter-spacing="-0.2">${l}</text>` }), { x: 1372, out: '' }).out}
  <rect x="1404" y="38" width="140" height="40" rx="20" fill="${ctaBg}"/><text x="1474" y="64" text-anchor="middle" font-size="15" font-weight="600" fill="${ctaInk}">${cta}</text>`;

export const covers = {
  northwind: cover(
    `<defs>${shadow('s', '#16211B', 0.25)}<radialGradient id="glow" cx="0.5" cy="0" r="0.75"><stop offset="0" stop-color="#DCE8DA"/><stop offset="1" stop-color="#F2EFE6" stop-opacity="0"/></radialGradient></defs>
     <rect width="1600" height="800" fill="#F2EFE6"/><rect width="1600" height="800" fill="url(#glow)"/>
     <g fill="none" stroke="#2F6B4A" stroke-width="1.6">${[60, 110, 160, 210, 260].map((r, i) => `<path d="${contour(1360, 190, r, 1.25, i * 0.5)}" opacity="${0.16 - i * 0.02}"/>`).join('')}${[70, 130, 190, 250].map((r, i) => `<path d="${contour(170, 520, r, 1.1, 1 + i * 0.6)}" opacity="${0.15 - i * 0.025}"/>`).join('')}</g>`,
    `${nav({ mark: nwMark(60, 34, 44), name: `font-family="${NW_SERIF}" font-size="26" font-weight="600" fill="#16211B" letter-spacing="-0.6">Northwind`, links: ['Field guide', 'Teams', 'Pricing'], cta: 'Get the app', sub: '#56655B', ctaBg: '#2F6B4A', ctaInk: '#F2EFE6' })}
     <rect x="588" y="118" width="348" height="34" rx="17" fill="#E2EBDD"/><circle cx="608" cy="135" r="5" fill="#E3B341"/><text x="622" y="140" font-size="15" fill="#2F6B4A">New in 1.2 · A whole season of offline maps</text>
     <text x="800" y="230" text-anchor="middle" font-family="${NW_SERIF}" font-size="64" font-weight="600" fill="#16211B" letter-spacing="-1.8">Field notes that keep working</text>
     <text x="800" y="298" text-anchor="middle" font-family="${NW_SERIF}" font-size="64" font-weight="600" fill="#2F6B4A" letter-spacing="-1.8" font-style="italic">where the signal doesn’t.</text>
     <text x="800" y="346" text-anchor="middle" font-size="20" fill="#56655B">Tag specimens in one tap, map your plots offline, export straight to the herbarium.</text>
     <g filter="url(#s)">
       <rect x="330" y="392" width="940" height="640" rx="40" fill="#16211B"/>
       <rect x="346" y="408" width="908" height="608" rx="26" fill="#F7F6F0"/>
       <rect x="346" y="408" width="280" height="608" rx="26" fill="#EBEFE7"/><rect x="600" y="408" width="26" height="608" fill="#EBEFE7"/>
       <text x="370" y="436" font-size="12" font-weight="600" fill="#16211B">9:41</text>
       <text x="370" y="474" font-family="${NW_SERIF}" font-size="22" font-weight="600" fill="#16211B">Kew transect B</text>
       <text x="370" y="496" font-size="12.5" fill="#6A786F">14 specimens · synced 6:02</text>
       ${[['Wood anemone', 'Plot 3 · 9:12', '#58A27A'], ['Lesser celandine', 'Plot 3 · 9:30', '#E3B341'], ['Dog violet', 'Plot 4 · 10:05', '#7B5BD6'], ['Ramsons', 'Plot 5 · photo pending', '#2F6B4A'], ['Bluebell', 'Plot 5 · 11:40', '#4E6FD8']].map(([n, s, c], i) => `<rect x="362" y="${514 + i * 62}" width="248" height="54" rx="12" fill="${i === 0 ? '#FFFFFF' : 'none'}"/><rect x="372" y="${523 + i * 62}" width="36" height="36" rx="9" fill="${c}"/><path d="M390 ${529 + i * 62}c6 5 8 12 4 19-1 2-3 4-4 5-2-1-3-3-5-5-4-7-2-14 5-19z" fill="#FFFFFF" opacity="0.9"/><text x="420" y="${539 + i * 62}" font-size="14.5" font-weight="600" fill="#16211B">${n}</text><text x="420" y="${556 + i * 62}" font-size="12" fill="#6A786F">${s}</text>`).join('')}
       <rect x="626" y="408" width="628" height="608" rx="0" fill="#DCE8D8"/><path d="M1228 408h0a26 26 0 0 1 26 26v582H1228z" fill="#DCE8D8"/>
       <path d="M626 520c120-40 200 20 320-10s200-70 308-40v170c-100-20-180 40-300 30s-210-40-328 0z" fill="#CFE0CB"/><path d="M626 700c140 30 230-30 360 0s180 40 268 10v306H626z" fill="#C5DABF"/>
       <g fill="none" stroke="#2F6B4A" stroke-width="1.2" opacity="0.25">${[40, 80, 120].map((r, i) => `<path d="${contour(1010, 640, r, 1.5, i)}"/>`).join('')}</g>
       <path d="M720 540l120-26 50 90-96 50z" fill="#58A27A" fill-opacity="0.35" stroke="#2F6B4A" stroke-width="2"/><path d="M930 600l130-14 14 110-118 26z" fill="#E3B341" fill-opacity="0.35" stroke="#8A6D12" stroke-width="2"/><path d="M780 700l110-34 60 96-130 34z" fill="#7B5BD6" fill-opacity="0.3" stroke="#4A3CC4" stroke-width="2"/>
       <circle cx="800" cy="580" r="9" fill="#2F6B4A"/><circle cx="1000" cy="650" r="9" fill="#8A6D12"/><circle cx="866" cy="740" r="9" fill="#4A3CC4"/><circle cx="950" cy="560" r="13" fill="#FFFFFF" stroke="#2F6B4A" stroke-width="5"/>
       <rect x="646" y="428" width="238" height="40" rx="20" fill="#FFFFFF"/><circle cx="668" cy="448" r="5" fill="#58A27A"/><text x="682" y="453" font-size="13.5" fill="#3F4D45">Offline · 3 plots cached</text>
       <rect x="1086" y="428" width="148" height="40" rx="20" fill="#2F6B4A"/><text x="1160" y="453" text-anchor="middle" font-size="13.5" font-weight="600" fill="#F2EFE6">Tag a specimen</text>
     </g>
     <g filter="url(#s)">
       <rect x="1190" y="462" width="226" height="460" rx="40" fill="#16211B"/>
       <rect x="1199" y="471" width="208" height="442" rx="32" fill="#FFFFFF"/>
       <path d="M1199 503a32 32 0 0 1 32-32h144a32 32 0 0 1 32 32v135h-208z" fill="#2F6B4A"/>
       <g transform="translate(1303 556) scale(0.42) translate(-128 -128)">${leaf('#BFE0C9', '#2F6B4A')}</g>
       <text x="1216" y="672" font-family="${NW_SERIF}" font-size="20" font-weight="600" fill="#16211B">Wood anemone</text>
       <text x="1216" y="692" font-size="12" font-style="italic" fill="#6A786F">Anemone nemorosa</text>
       <rect x="1216" y="706" width="58" height="22" rx="11" fill="#E3F0E7"/><text x="1245" y="721" text-anchor="middle" font-size="11" fill="#2F6B4A">Plot 3</text>
       <rect x="1280" y="706" width="80" height="22" rx="11" fill="#E3F0E7"/><text x="1320" y="721" text-anchor="middle" font-size="11" fill="#2F6B4A">JPEG export</text>
     </g>
     <g filter="url(#s)" transform="translate(-60 150)"><rect x="150" y="470" width="236" height="72" rx="16" fill="#FFFFFF"/><circle cx="182" cy="506" r="14" fill="#E3F0E7"/><path d="M175 506l5 5 9-10" stroke="#2F6B4A" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="206" y="500" font-size="14" font-weight="600" fill="#16211B">Exported to herbarium</text><text x="206" y="520" font-size="12" fill="#6A786F">14 specimens · JPEG</text></g>`),

  lumen: cover(
    `<defs>${shadow('s', '#000', 0.6)}<filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
       ${[['ba', '#F2A33A'], ['bv', '#7A5CFF'], ['br', '#FF5FA2']].map(([id, c]) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.9"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`).join('')}
       <radialGradient id="floor" cx="0.5" cy="1" r="0.6"><stop offset="0" stop-color="#3A2A55" stop-opacity="0.8"/><stop offset="1" stop-color="#0B0A10" stop-opacity="0"/></radialGradient>
       <linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFC56B"/><stop offset="0.55" stop-color="#FF8FB8"/><stop offset="1" stop-color="#A996FF"/></linearGradient>
       <radialGradient id="ga" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFC56B"/><stop offset="1" stop-color="#F2A33A" stop-opacity="0"/></radialGradient><radialGradient id="gv" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9B85FF"/><stop offset="1" stop-color="#7A5CFF" stop-opacity="0"/></radialGradient><radialGradient id="gr" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FF7AA8"/><stop offset="1" stop-color="#FF5FA2" stop-opacity="0"/></radialGradient></defs>
     <rect width="1600" height="800" fill="#0B0A10"/><rect width="1600" height="800" fill="url(#floor)"/>
     <g filter="url(#blur)" opacity="0.5"><path d="M470 -10h90l260 820H180z" fill="url(#ba)"/><path d="M760 -10h80l200 820H560z" fill="url(#bv)" style="mix-blend-mode:screen"/><path d="M1040 -10h90l300 820H780z" fill="url(#br)" style="mix-blend-mode:screen"/></g>
     <g fill="#FFFFFF">${[[160, 210, 1.4], [260, 120, 1], [1300, 260, 1.2], [1440, 160, 1.6], [1180, 120, 0.9], [380, 300, 0.8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" opacity="0.5"/>`).join('')}</g>`,
    `${nav({ mark: luMark(56, 30, 52, '#FFFFFF'), name: `font-family="${LU_SANS}" font-size="30" font-weight="700" fill="#F6F3FF" letter-spacing="-1.4">lumen`, links: ['Venues', 'Scenes', 'Pricing'], cta: 'Try a scene', sub: '#A39FB3', ctaBg: '#F2A33A', ctaInk: '#17151F' })}
     <rect x="604" y="118" width="392" height="34" rx="17" fill="#17151F" stroke="#3A3448"/><text x="800" y="140" text-anchor="middle" font-size="15" fill="#CFC9DD">For small venues · No account for guests</text>
     <text x="800" y="232" text-anchor="middle" font-family="${LU_SANS}" font-size="68" font-weight="700" fill="#F6F3FF" letter-spacing="-2.6">Light the whole room</text>
     <text x="800" y="302" text-anchor="middle" font-family="${LU_SANS}" font-size="68" font-weight="700" fill="url(#hl)" letter-spacing="-2.6">from one phone.</text>
     <text x="800" y="348" text-anchor="middle" font-size="20" fill="#A39FB3">Build a scene in seconds, share it by link, and let the crew run it.</text>
     <g filter="url(#s)">
       <rect x="676" y="388" width="248" height="520" rx="44" fill="#050408" stroke="#2E2A38" stroke-width="2"/>
       <rect x="686" y="398" width="228" height="500" rx="36" fill="#14121B"/>
       <rect x="764" y="408" width="72" height="20" rx="10" fill="#050408"/>
       <text x="706" y="458" font-family="${LU_SANS}" font-size="19" font-weight="700" fill="#F6F3FF">Friday, late set</text>
       <text x="706" y="478" font-size="11.5" fill="#8E89A0">6 lights · shared by link</text>
       <rect x="702" y="492" width="196" height="132" rx="20" fill="#1C1926"/>
       <circle cx="770" cy="552" r="58" fill="url(#ga)"/><circle cx="830" cy="540" r="52" fill="url(#gv)" style="mix-blend-mode:screen"/><circle cx="806" cy="584" r="44" fill="url(#gr)" style="mix-blend-mode:screen"/>
       ${[['Amber wash', 0.78, '#F2A33A'], ['Violet back', 0.56, '#7A5CFF'], ['Rose spot', 0.42, '#FF5FA2'], ['Bar strip', 0.88, '#FFD58A']].map(([n, v, c], i) => `<text x="706" y="${654 + i * 46}" font-size="12.5" fill="#EDEBF3">${n}</text><rect x="706" y="${664 + i * 46}" width="188" height="6" rx="3" fill="#2B2735"/><rect x="706" y="${664 + i * 46}" width="${(188 * v).toFixed(0)}" height="6" rx="3" fill="${c}"/><circle cx="${(706 + 188 * v).toFixed(0)}" cy="${667 + i * 46}" r="8" fill="#FFFFFF"/>`).join('')}
     </g>
     <g filter="url(#s)">
       <rect x="352" y="452" width="270" height="214" rx="24" fill="#17151F" stroke="#2A2635"/>
       <text x="376" y="490" font-size="15" font-weight="600" fill="#F6F3FF">Tonight’s scenes</text>
       ${[['Doors', '#7A5CFF', false], ['Soundcheck', '#3FB6C9', false], ['Friday, late set', '#F2A33A', true]].map(([n, c, on], i) => `<rect x="368" y="${506 + i * 48}" width="238" height="40" rx="12" fill="${on ? '#2A2235' : '#1C1926'}" stroke="${on ? '#F2A33A' : 'none'}" stroke-width="1.5"/><circle cx="390" cy="${526 + i * 48}" r="8" fill="${c}"/><text x="408" y="${531 + i * 48}" font-size="13.5" fill="#EDEBF3">${n}</text>${on ? `<text x="590" y="${531 + i * 48}" text-anchor="end" font-size="11.5" fill="#F2A33A">Live</text>` : ''}`).join('')}
     </g>
     <g filter="url(#s)">
       <rect x="978" y="486" width="262" height="128" rx="24" fill="#17151F" stroke="#2A2635"/>
       <text x="1002" y="522" font-size="15" font-weight="600" fill="#F6F3FF">Shared with crew</text>
       ${['#F2A33A', '#7A5CFF', '#FF5FA2'].map((c, i) => `<circle cx="${1018 + i * 26}" cy="560" r="16" fill="${c}" stroke="#17151F" stroke-width="3"/>`).join('')}
       <text x="1096" y="565" font-size="12.5" fill="#A39FB3">3 people can run it</text>
       <text x="1002" y="596" font-size="12" fill="#6F6A80">lumen.live/s/late-set</text>
     </g>`),

  paperboat: cover(
    `<defs>${shadow('s', '#5A3A22', 0.2)}<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#E9B48E"/><stop offset="1" stop-color="#F6F0EA" stop-opacity="0"/></radialGradient></defs>
     <rect width="1600" height="800" fill="#F6F0EA"/><circle cx="1320" cy="130" r="300" fill="url(#sun)" opacity="0.55"/>
     <g fill="none" stroke="#B4693A" stroke-width="2" opacity="0.18">${[560, 600, 640, 680].map((y, i) => `<path d="M0 ${y}c80 18 160 18 240 0s160-18 240 0 160 18 240 0 160-18 240 0 160 18 240 0 160-18 240 0 160 18 160 0" opacity="${1 - i * 0.2}"/>`).join('')}</g>`,
    `${nav({ mark: pbMark(58, 30, 50), name: `font-family="${PB_SERIF}" font-size="30" font-style="italic" fill="#8A4E2A" letter-spacing="-1">paperboat`, links: ['Archive', 'Pricing', 'Sign in'], cta: 'Start writing', sub: '#7A6A5C', ctaBg: '#231A12', ctaInk: '#F6F0EA' })}
     <text x="800" y="140" text-anchor="middle" font-size="14" font-weight="600" fill="#B4693A" letter-spacing="3">PAPERBOAT PRESS · A QUIET NEWSLETTER TOOL</text>
     <text x="800" y="230" text-anchor="middle" font-family="${PB_SERIF}" font-size="68" fill="#231A12" letter-spacing="-2.4">Write once a month.</text>
     <text x="800" y="302" text-anchor="middle" font-family="${PB_SERIF}" font-size="68" font-style="italic" fill="#B4693A" letter-spacing="-2.4">Arrive like a letter.</text>
     <text x="800" y="348" text-anchor="middle" font-size="20" fill="#7A6A5C">Plain-text issues, a calm archive, and no tracking pixels. Ever.</text>
     <g filter="url(#s)">
       <rect x="330" y="392" width="940" height="620" rx="18" fill="#FFFDFA" stroke="#E6D9CB"/>
       <path d="M330 410a18 18 0 0 1 18-18h904a18 18 0 0 1 18 18v28H330z" fill="#EFE6DC"/>
       ${['#E0A48A', '#E6C58A', '#A9C49A'].map((c, i) => `<circle cx="${356 + i * 20}" cy="415" r="6" fill="${c}"/>`).join('')}
       <rect x="640" y="403" width="320" height="24" rx="12" fill="#F8F2EB"/><text x="800" y="420" text-anchor="middle" font-size="12" fill="#7A6A5C">paperboat.press/monthly-tide</text>
       <text x="420" y="510" font-family="${PB_SERIF}" font-size="46" fill="#231A12" letter-spacing="-1.4">The Monthly Tide</text>
       <text x="422" y="544" font-size="16" fill="#7A6A5C">A letter about slow work, written once a month.</text>
       ${['November', 'October', 'September'].map((m, i) => `<line x1="420" y1="${576 + i * 76}" x2="1180" y2="${576 + i * 76}" stroke="#EADFD2"/><text x="420" y="${614 + i * 76}" font-size="14" fill="#B4693A">${m} 2026</text><text x="560" y="${614 + i * 76}" font-family="${PB_SERIF}" font-size="24" fill="#231A12">${['On keeping a small garden', 'Letters that arrive late', 'The case for plain text'][i]}</text><text x="1180" y="${614 + i * 76}" text-anchor="end" font-size="13" fill="#9A8A7C">${['6 min', '4 min', '5 min'][i]}</text>`).join('')}
     </g>
     <g filter="url(#s)" transform="rotate(4 1330 560)">
       <rect x="1196" y="456" width="268" height="196" rx="16" fill="#FFFFFF" stroke="#EADFD2"/>
       <path d="M1196 472l134 86 134-86" fill="none" stroke="#EADFD2" stroke-width="2"/>
       <text x="1218" y="592" font-size="11.5" fill="#9A8A7C">From The Monthly Tide</text>
       <text x="1218" y="616" font-family="${PB_SERIF}" font-size="17" fill="#231A12">On keeping a small garden</text>
       <rect x="1218" y="628" width="190" height="6" rx="3" fill="#EFE6DC"/>
     </g>
     <g transform="translate(150 470)">${pbMark(0, 0, 150)}</g>`),
};
