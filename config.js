// ===== Intramurals 2026 ID — settings =====
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycby3L7YzkIcr9B0aYlNf7I4iB_qWPfdHvNeISF4YAQAUJEPr-O3XYH9Q5SyAsN7VZmt9/exec',

  EVENT_TITLE: 'SPORTFEST 2026',
  EVENT_SUBTITLE: 'STI College Valencia',
  GOLD: '#c9a24a',

  // Official logos. Upload the real files to these paths (PNG with transparent
  // or white background). Missing files are simply skipped.
  LOGOS: { sti: 'assets/logos/sti.webp', ssc: 'assets/logos/ssc.webp' },

  // Back of the ID: heading + rules (edit freely)
  BACK_TITLE: 'REMINDERS',
  BACK_NOTES: [
    'For your use only. Do not lend it.',
    'Remove it while playing.',
    'Found it? Return it to any SSC officer.'
  ],

  // Saved/print image: front + back side by side (pixels at 300 DPI)
  PRINT: { margin: 50, gap: 70, label: 50 },

  // ID layout: 'portrait' or 'landscape'
  ORIENTATION: 'portrait',

  // Printed on the ID instead of signatures
  APPROVED_BY: { name: 'Anthony Sedoro', title: 'President, Supreme Student Council' },

  // Official teams (SSC minutes, Oct 22 2026).
  // Sheet "House" column can use the full name or any alias (capitals don't matter).
  // primary: main team colour (site accents, scanner badge)
  // ink: readable text colour on white | text: text colour on top of primary
  // glow: bright team colour for dark backgrounds (Sorting Hat)
  // stripes: ID band [outer, middle] | wax, waves, metal: site theme accents
  // House colours follow the widely published film palettes (colour-meanings.com)
  // emblem: crest image. White background is removed automatically.
  //         If the file is missing, a letter badge is shown instead.
  HOUSES: {
    'Gryffindor Titans':   { no: 1, aliases: ['Gryffindor', 'Team 1'], primary: '#740001', ink: '#740001', text: '#d3a625', glow: '#e5413b', stripes: ['#9c1a1c', '#e3b52a'], wax: '#8e1014', metal: 'gold',
                             waves: ['#3a0000', '#ae0001', '#d3a625'], emblem: 'assets/crests/gryffindor.webp' },
    'Slytherin Vipers':    { no: 2, aliases: ['Slytherin', 'Team 2'],  primary: '#1a472a', ink: '#1a472a', text: '#e6e6e6', glow: '#3cc46b', stripes: ['#1a472a', '#a9a9a9'], wax: '#1f5a35', metal: 'silver',
                             waves: ['#0b2414', '#2a623d', '#aaaaaa'], emblem: 'assets/crests/slytherin.webp' },
    'Ravenclaw Falcons':   { no: 3, aliases: ['Ravenclaw', 'Team 3'],  primary: '#0e1a40', ink: '#0e1a40', text: '#e2b383', glow: '#5b8ff0', stripes: ['#0e1a40', '#946b2d'], wax: '#1d2b5c', metal: 'bronze',
                             waves: ['#070d22', '#222f5b', '#946b2d'], emblem: 'assets/crests/ravenclaw.webp' },
    'Hufflepuff Warriors': { no: 4, aliases: ['Hufflepuff', 'Team 4'], primary: '#ecb939', ink: '#6e5000', text: '#000000', glow: '#ffd800', stripes: ['#e8b923', '#1a1a1a'], wax: '#c9971a', metal: 'gold',
                             waves: ['#1a1608', '#7a6200', '#ffd800'], emblem: 'assets/crests/hufflepuff.webp' },
    'Dragon Dominion':     { no: 5, aliases: ['Dragon', 'Team 5'],     primary: '#5b3f8f', ink: '#4f3480', text: '#fff4d6', glow: '#b99cf2', stripes: ['#9b7fd1', '#3d2766'], wax: '#6a4c9c', metal: 'silver',
                             waves: ['#1e1236', '#5b3f8f', '#c9b6ec'], emblem: 'assets/crests/dragon-dominion.webp' },
    'Phoenix Legion':      { no: 6, aliases: ['Phoenix', 'Team 6'],    primary: '#141414', ink: '#141414', text: '#f39a2b', glow: '#f39a2b', stripes: ['#141414', '#f39a2b'], wax: '#232323', metal: 'gold',
                             waves: ['#080808', '#3a1a05', '#f39a2b'], emblem: 'assets/crests/phoenix-legion.webp' }
  },
  DEFAULT_HOUSE: { primary: '#3b3b3b', ink: '#3b3b3b', text: '#f1d27a', waves: ['#222222', '#555555', '#bbbbbb'], emblem: null }
};

function houseKey(name) {
  const n = String(name || '').trim().toLowerCase();
  return Object.keys(CONFIG.HOUSES).find(k =>
    k.toLowerCase() === n ||
    (CONFIG.HOUSES[k].aliases || []).some(a => a.toLowerCase() === n)
  ) || null;
}

function houseStyle(name) {
  const key = houseKey(name);
  return key ? CONFIG.HOUSES[key] : CONFIG.DEFAULT_HOUSE;
}

// Official display name (e.g. "Gryffindor" in the Sheet → "Gryffindor Titans")
function houseName(name) {
  return houseKey(name) || String(name || '');
}
