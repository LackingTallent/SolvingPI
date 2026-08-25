/* ===================== STATIC GAME DATA ===================== */
const PLANET_TYPES = ['Barren','Gas','Ice','Lava','Oceanic','Plasma','Storm','Temperate'];
const PLANET_RESOURCES = {
  Barren:['Aqueous Liquids','Base Metals','Carbon Compounds','Micro Organisms','Noble Metals'],
  Gas:['Aqueous Liquids','Base Metals','Ionic Solutions','Noble Gas','Reactive Gas'],
  /* Ice carries PLANKTIC COLONIES, not Suspended Plasma. Reported by a user
     looking at his own scan, and confirmed against EVE University, Thonky's
     guide and eve-webtools.

     It mattered twice over: Planktic Colonies is one of only three raw
     materials bound to two planet types (Ice and Oceanic), so this made
     Biomass look impossible from Ice — and it offered Plasmoids from a planet
     that cannot produce them. Suspended Plasma is Lava, Storm and Plasma
     only. */
  Ice:['Aqueous Liquids','Heavy Metals','Micro Organisms','Noble Gas','Planktic Colonies'],
  Lava:['Base Metals','Felsic Magma','Heavy Metals','Non-CS Crystals','Suspended Plasma'],
  Oceanic:['Aqueous Liquids','Carbon Compounds','Complex Organisms','Micro Organisms','Planktic Colonies'],
  Plasma:['Base Metals','Heavy Metals','Noble Metals','Non-CS Crystals','Suspended Plasma'],
  Storm:['Aqueous Liquids','Base Metals','Ionic Solutions','Noble Gas','Suspended Plasma'],
  Temperate:['Aqueous Liquids','Autotrophs','Carbon Compounds','Complex Organisms','Micro Organisms'],
};
const P0_TO_P1 = {
  "Aqueous Liquids": "Water",
  "Autotrophs": "Industrial Fibers",
  "Base Metals": "Reactive Metals",
  "Carbon Compounds": "Biofuels",
  "Complex Organisms": "Proteins",
  "Felsic Magma": "Silicon",
  "Heavy Metals": "Toxic Metals",
  "Ionic Solutions": "Electrolytes",
  "Micro Organisms": "Bacteria",
  "Noble Gas": "Oxygen",
  "Noble Metals": "Precious Metals",
  "Non-CS Crystals": "Chiral Structures",
  "Planktic Colonies": "Biomass",
  "Reactive Gas": "Oxidizing Compound",
  "Suspended Plasma": "Plasmoids"
};

// Type IDs: all 83 commodities, verified against EVE Ref + fuzzwork.co.uk/pi/ (a single
// consolidated, CCP-SDE-derived source covering the entire PI recipe tree).
const TYPE_IDS = {
  "Aqueous Liquids": 2268,
  "Autotrophs": 2305,
  "Base Metals": 2267,
  "Carbon Compounds": 2288,
  "Complex Organisms": 2287,
  "Felsic Magma": 2307,
  "Heavy Metals": 2272,
  "Ionic Solutions": 2309,
  "Micro Organisms": 2073,
  "Noble Gas": 2310,
  "Noble Metals": 2270,
  "Non-CS Crystals": 2306,
  "Planktic Colonies": 2286,
  "Reactive Gas": 2311,
  "Suspended Plasma": 2308,
  "Water": 3645,
  "Industrial Fibers": 2397,
  "Reactive Metals": 2398,
  "Biofuels": 2396,
  "Proteins": 2395,
  "Silicon": 9828,
  "Toxic Metals": 2400,
  "Electrolytes": 2390,
  "Bacteria": 2393,
  "Oxygen": 3683,
  "Precious Metals": 2399,
  "Chiral Structures": 2401,
  "Biomass": 3779,
  "Oxidizing Compound": 2392,
  "Plasmoids": 2389,
  "Superconductors": 9838,
  "Coolant": 9832,
  "Rocket Fuel": 9830,
  "Synthetic Oil": 3691,
  "Oxides": 2317,
  "Silicate Glass": 3697,
  "Transmitter": 9840,
  "Water-Cooled CPU": 2328,
  "Mechanical Parts": 3689,
  "Construction Blocks": 3828,
  "Enriched Uranium": 44,
  "Consumer Electronics": 9836,
  "Miniature Electronics": 9842,
  "Nanites": 2463,
  "Biocells": 2329,
  "Microfiber Shielding": 2327,
  "Viral Agent": 3775,
  "Fertilizer": 3693,
  "Genetically Enhanced Livestock": 15317,
  "Livestock": 3725,
  "Polytextiles": 3695,
  "Test Cultures": 2319,
  "Supertensile Plastics": 2312,
  "Polyaramids": 2321,
  "Ukomi Superconductors": 17136,
  "Condensates": 2344,
  "Camera Drones": 2345,
  "Synthetic Synapses": 2346,
  "High-Tech Transmitters": 17898,
  "Gel-Matrix Biopaste": 2348,
  "Supercomputers": 2349,
  "Robotics": 9848,
  "Smartfab Units": 2351,
  "Nuclear Reactors": 2352,
  "Guidance Systems": 9834,
  "Neocoms": 2354,
  "Planetary Vehicles": 9846,
  "Biotech Research Reports": 2358,
  "Vaccines": 28974,
  "Industrial Explosives": 2360,
  "Hermetic Membranes": 2361,
  "Transcranial Microcontrollers": 12836,
  "Data Chips": 17392,
  "Hazmat Detection Systems": 2366,
  "Cryoprotectant Solution": 2367,
  "Organic Mortar Applicators": 2870,
  "Sterile Conduits": 2875,
  "Nano-Factory": 2869,
  "Self-Harmonizing Power Core": 2872,
  "Recursive Computing Module": 2871,
  "Broadcast Node": 2867,
  "Integrity Response Drones": 2868,
  "Wetware Mainframe": 2876
};

// Complete PI recipe tree, sourced from fuzzwork.co.uk/pi/ in a single fetch,
// cross-checked against every individually-verified recipe from earlier in this
// project (EVE Ref) with zero discrepancies found.
const RECIPES_P2 = {
  "Superconductors": {
    "inputs": [
      "Plasmoids",
      "Water"
    ],
    "qty": 5
  },
  "Coolant": {
    "inputs": [
      "Electrolytes",
      "Water"
    ],
    "qty": 5
  },
  "Rocket Fuel": {
    "inputs": [
      "Plasmoids",
      "Electrolytes"
    ],
    "qty": 5
  },
  "Synthetic Oil": {
    "inputs": [
      "Electrolytes",
      "Oxygen"
    ],
    "qty": 5
  },
  "Oxides": {
    "inputs": [
      "Oxidizing Compound",
      "Oxygen"
    ],
    "qty": 5
  },
  "Silicate Glass": {
    "inputs": [
      "Oxidizing Compound",
      "Silicon"
    ],
    "qty": 5
  },
  "Transmitter": {
    "inputs": [
      "Plasmoids",
      "Chiral Structures"
    ],
    "qty": 5
  },
  "Water-Cooled CPU": {
    "inputs": [
      "Reactive Metals",
      "Water"
    ],
    "qty": 5
  },
  "Mechanical Parts": {
    "inputs": [
      "Reactive Metals",
      "Precious Metals"
    ],
    "qty": 5
  },
  "Construction Blocks": {
    "inputs": [
      "Reactive Metals",
      "Toxic Metals"
    ],
    "qty": 5
  },
  "Enriched Uranium": {
    "inputs": [
      "Precious Metals",
      "Toxic Metals"
    ],
    "qty": 5
  },
  "Consumer Electronics": {
    "inputs": [
      "Toxic Metals",
      "Chiral Structures"
    ],
    "qty": 5
  },
  "Miniature Electronics": {
    "inputs": [
      "Chiral Structures",
      "Silicon"
    ],
    "qty": 5
  },
  "Nanites": {
    "inputs": [
      "Bacteria",
      "Reactive Metals"
    ],
    "qty": 5
  },
  "Biocells": {
    "inputs": [
      "Biofuels",
      "Precious Metals"
    ],
    "qty": 5
  },
  "Microfiber Shielding": {
    "inputs": [
      "Industrial Fibers",
      "Silicon"
    ],
    "qty": 5
  },
  "Viral Agent": {
    "inputs": [
      "Bacteria",
      "Biomass"
    ],
    "qty": 5
  },
  "Fertilizer": {
    "inputs": [
      "Bacteria",
      "Proteins"
    ],
    "qty": 5
  },
  "Genetically Enhanced Livestock": {
    "inputs": [
      "Proteins",
      "Biomass"
    ],
    "qty": 5
  },
  "Livestock": {
    "inputs": [
      "Proteins",
      "Biofuels"
    ],
    "qty": 5
  },
  "Polytextiles": {
    "inputs": [
      "Biofuels",
      "Industrial Fibers"
    ],
    "qty": 5
  },
  "Test Cultures": {
    "inputs": [
      "Bacteria",
      "Water"
    ],
    "qty": 5
  },
  "Supertensile Plastics": {
    "inputs": [
      "Oxygen",
      "Biomass"
    ],
    "qty": 5
  },
  "Polyaramids": {
    "inputs": [
      "Oxidizing Compound",
      "Industrial Fibers"
    ],
    "qty": 5
  }
};
const RECIPES_P3 = {
  "Ukomi Superconductors": {
    "inputs": [
      "Synthetic Oil",
      "Superconductors"
    ],
    "qty": 3
  },
  "Condensates": {
    "inputs": [
      "Oxides",
      "Coolant"
    ],
    "qty": 3
  },
  "Camera Drones": {
    "inputs": [
      "Silicate Glass",
      "Rocket Fuel"
    ],
    "qty": 3
  },
  "Synthetic Synapses": {
    "inputs": [
      "Supertensile Plastics",
      "Test Cultures"
    ],
    "qty": 3
  },
  "High-Tech Transmitters": {
    "inputs": [
      "Polyaramids",
      "Transmitter"
    ],
    "qty": 3
  },
  "Gel-Matrix Biopaste": {
    "inputs": [
      "Oxides",
      "Biocells",
      "Superconductors"
    ],
    "qty": 3
  },
  "Supercomputers": {
    "inputs": [
      "Water-Cooled CPU",
      "Coolant",
      "Consumer Electronics"
    ],
    "qty": 3
  },
  "Robotics": {
    "inputs": [
      "Mechanical Parts",
      "Consumer Electronics"
    ],
    "qty": 3
  },
  "Smartfab Units": {
    "inputs": [
      "Construction Blocks",
      "Miniature Electronics"
    ],
    "qty": 3
  },
  "Nuclear Reactors": {
    "inputs": [
      "Enriched Uranium",
      "Microfiber Shielding"
    ],
    "qty": 3
  },
  "Guidance Systems": {
    "inputs": [
      "Water-Cooled CPU",
      "Transmitter"
    ],
    "qty": 3
  },
  "Neocoms": {
    "inputs": [
      "Biocells",
      "Silicate Glass"
    ],
    "qty": 3
  },
  "Planetary Vehicles": {
    "inputs": [
      "Supertensile Plastics",
      "Mechanical Parts",
      "Miniature Electronics"
    ],
    "qty": 3
  },
  "Biotech Research Reports": {
    "inputs": [
      "Nanites",
      "Livestock",
      "Construction Blocks"
    ],
    "qty": 3
  },
  "Vaccines": {
    "inputs": [
      "Livestock",
      "Viral Agent"
    ],
    "qty": 3
  },
  "Industrial Explosives": {
    "inputs": [
      "Fertilizer",
      "Polytextiles"
    ],
    "qty": 3
  },
  "Hermetic Membranes": {
    "inputs": [
      "Polyaramids",
      "Genetically Enhanced Livestock"
    ],
    "qty": 3
  },
  "Transcranial Microcontrollers": {
    "inputs": [
      "Biocells",
      "Nanites"
    ],
    "qty": 3
  },
  "Data Chips": {
    "inputs": [
      "Supertensile Plastics",
      "Microfiber Shielding"
    ],
    "qty": 3
  },
  "Hazmat Detection Systems": {
    "inputs": [
      "Polytextiles",
      "Viral Agent",
      "Transmitter"
    ],
    "qty": 3
  },
  "Cryoprotectant Solution": {
    "inputs": [
      "Test Cultures",
      "Synthetic Oil",
      "Fertilizer"
    ],
    "qty": 3
  }
};
// All 8 P4 products, every one fully traceable to raw P1 now. planetTypes for every
// P4 product is Barren/Temperate only, confirmed identically across all 8 individual
// EVE Ref fetches this session (the High-Tech Production Plant only installs there).
const RECIPES_P4 = {
  "Organic Mortar Applicators": {
    "inputs": [
      [
        "Condensates",
        6
      ],
      [
        "Bacteria",
        40
      ],
      [
        "Robotics",
        6
      ]
    ],
    "planetTypes": [
      "Barren",
      "Temperate"
    ]
  },
  "Sterile Conduits": {
    "inputs": [
      [
        "Smartfab Units",
        6
      ],
      [
        "Water",
        40
      ],
      [
        "Vaccines",
        6
      ]
    ],
    "planetTypes": [
      "Barren",
      "Temperate"
    ]
  },
  "Nano-Factory": {
    "inputs": [
      [
        "Industrial Explosives",
        6
      ],
      [
        "Reactive Metals",
        40
      ],
      [
        "Ukomi Superconductors",
        6
      ]
    ],
    "planetTypes": [
      "Barren",
      "Temperate"
    ]
  },
  "Self-Harmonizing Power Core": {
    "inputs": [
      [
        "Camera Drones",
        6
      ],
      [
        "Nuclear Reactors",
        6
      ],
      [
        "Hermetic Membranes",
        6
      ]
    ],
    "planetTypes": [
      "Barren",
      "Temperate"
    ]
  },
  "Recursive Computing Module": {
    "inputs": [
      [
        "Synthetic Synapses",
        6
      ],
      [
        "Guidance Systems",
        6
      ],
      [
        "Transcranial Microcontrollers",
        6
      ]
    ],
    "planetTypes": [
      "Barren",
      "Temperate"
    ]
  },
  "Broadcast Node": {
    "inputs": [
      [
        "Neocoms",
        6
      ],
      [
        "Data Chips",
        6
      ],
      [
        "High-Tech Transmitters",
        6
      ]
    ],
    "planetTypes": [
      "Barren",
      "Temperate"
    ]
  },
  "Integrity Response Drones": {
    "inputs": [
      [
        "Gel-Matrix Biopaste",
        6
      ],
      [
        "Hazmat Detection Systems",
        6
      ],
      [
        "Planetary Vehicles",
        6
      ]
    ],
    "planetTypes": [
      "Barren",
      "Temperate"
    ]
  },
  "Wetware Mainframe": {
    "inputs": [
      [
        "Supercomputers",
        6
      ],
      [
        "Biotech Research Reports",
        6
      ],
      [
        "Cryoprotectant Solution",
        6
      ]
    ],
    "planetTypes": [
      "Barren",
      "Temperate"
    ]
  }
};
const JITA_REGION_ID = 10000002;
// EVE's image CDN only serves specific fixed sizes (32/64/128/256/512, etc.) —
// requesting an arbitrary size like 22 or 18 in the URL 404s silently, which
// is why icons were falling back to badges almost everywhere. The actual CDN
// request always uses a supported size (32, or 64 for anything larger); the
// requested "size" only controls the displayed width/height, exactly matching
// how the original operations console does it.
/* Every type id this tool knows, wherever it is stored.
 *
 * TYPE_IDS holds the 83 PI commodities. Composites keep theirs on the recipe
 * (COMPOSITE_RECIPES[name].typeId) and bought inputs in NON_PI_TYPE_IDS —
 * because those two groups arrived later and brought their ids with them.
 *
 * iconUrl only ever read TYPE_IDS, so all 18 of them fell through to the
 * initials badge: every fuel block, nanite paste, both deployables, and every
 * ice product and mineral in the Market Reference table. The ids were sitting
 * right there, in a map nothing asked. */
function typeIdOf(name){
  if (typeof TYPE_IDS !== 'undefined' && TYPE_IDS[name]) return TYPE_IDS[name];
  if (typeof COMPOSITE_RECIPES !== 'undefined'
      && COMPOSITE_RECIPES[name] && COMPOSITE_RECIPES[name].typeId)
    return COMPOSITE_RECIPES[name].typeId;
  if (typeof NON_PI_TYPE_IDS !== 'undefined' && NON_PI_TYPE_IDS[name])
    return NON_PI_TYPE_IDS[name];
  return null;
}

function iconUrl(name, size){
  const id = typeIdOf(name);
  if(!id) return '';
  const cdnSize = (size && size > 32) ? 64 : 32;
  return `https://images.evetech.net/types/${id}/icon?size=${cdnSize}`;
}
function iconFallbackBadge(name, size){
  const s = size||24;
  const initials = (name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  return `<span style="display:inline-flex; align-items:center; justify-content:center; width:${s}px; height:${s}px; min-width:${s}px; background:rgba(92,225,230,0.12); border:1px solid var(--cyan-dim); border-radius:3px; font-family:var(--font-mono); font-size:${Math.max(7,Math.round(s*0.35))}px; color:var(--cyan); flex-shrink:0;">${initials}</span>`;
}
function iconImg(name, size){
  const u = iconUrl(name,size); const s = size||24;
  if(!u) return iconFallbackBadge(name, s);
  const fb = iconFallbackBadge(name, s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  // alt is empty ON PURPOSE: every one of these icons sits immediately beside
  // the commodity's own name in the markup, so describing it again would make
  // a screen reader read every row twice. An empty alt marks it decorative,
  // which is the correct signal — omitting alt entirely is not, because then
  // the reader falls back to announcing the file name.
  const safeName = String(name).replace(/"/g,'&quot;');
  return `<img src="${u}" width="${s}" height="${s}" loading="eager" alt="" title="${safeName}" style="border-radius:3px;" onerror="this.outerHTML='${fb}'">`;
}

/* ===================== EVE SYSTEM DATA (live, fetched once, cached) ===================== */
let ALL_SYSTEMS = []; // [{id, name}], sorted
let systemsLoadPromise = null;
let systemsLoadFailedChunks = 0;
/* ===== ESI IDENTIFICATION =====
 * CCP asks every ESI request to identify the application so they can contact
 * the developer if it misbehaves.
 *
 * The obvious implementation is wrong. `User-Agent` is a FORBIDDEN HEADER NAME
 * in the Fetch spec, so a browser silently DROPS it — the code looks correct
 * and does nothing. CCP's own best-practices page anticipates exactly this and
 * specifies the fallback order for browser apps:
 *     User-Agent header  ->  X-User-Agent header  ->  user_agent query param
 *
 * We send both browser-legal forms. The header is preferred; the query
 * parameter survives anything that strips custom headers (proxies, some
 * CORS preflight configurations).
 */
/* CCP's documented preference, in order: an email address, an app name WITH
 * VERSION, and a source URL. All three are here.
 *
 * The version is injected at build time from the git tag rather than typed.
 * It read 1.0 while the app shipped v8.0.0 — a stale version defeats the
 * point, which is letting CCP identify and contact the source of problem
 * traffic. */
const ESI_UA = 'SolvingPI/@build:uaversion (admin@solvingpi.com; +https://github.com/LackingTallent/SolvingPI)';

/* Single wrapper for every ESI call, so identification can never be forgotten
 * at one of the eight call sites. */
/* ESI COMPATIBILITY DATE.
 *
 * ESI moved from per-route URL versions (/v3/, /latest/) to a single
 * application-wide compatibility date. From CCP's own documentation:
 *
 *   "If a request does not set a compatibility date, the OLDEST available
 *    compatibility date is used."
 *
 * This tool sent none, which is why a CCP developer observed it was "using ESI
 * things from >2 years ago". It was not calling deprecated routes so much as
 * being silently served two-year-old BEHAVIOUR of current ones — and CCP have
 * said the minimum accepted date will be raised over time, at which point an
 * app pinned to the floor simply stops working.
 *
 * PINNED, not computed from today's date. A rolling date would silently change
 * ESI's behaviour underneath us on a day nobody tested, and CCP note the API
 * rolls over at 11:00 UTC, so "today" is ambiguous for eleven hours. This is a
 * fixed date we have actually run against; bump it deliberately after reading
 * the changelog, which is exactly the workflow the date-based scheme exists to
 * enable. CCP aim to keep at least one year of backwards compatibility. */
const ESI_COMPATIBILITY_DATE = '2026-08-01';

/* Base URL with NO version segment. The /latest/ prefix is the legacy pattern;
 * unversioned paths are the current form and behaviour is selected by the
 * compatibility date instead. */
const ESI_BASE = 'https://esi.evetech.net';

function esiFetch(url, opts){
  const u = new URL(url);

  /* Both identification and versioning are sent as QUERY PARAMETERS as well as
   * headers, deliberately. A custom request header triggers a CORS preflight
   * from a browser; this tool is a single static page with no backend, so an
   * extra OPTIONS round-trip on every one of ~90 market calls is real cost for
   * no benefit. CCP explicitly support the query-parameter form for exactly
   * this case: "If applications cannot set custom headers, the
   * compatibility_date query parameter will do the same."
   *
   * The headers are set too, harmlessly, so a non-browser consumer of this
   * code still identifies correctly. */
  if(!u.searchParams.has('user_agent')) u.searchParams.set('user_agent', ESI_UA);
  if(!u.searchParams.has('compatibility_date'))
    u.searchParams.set('compatibility_date', ESI_COMPATIBILITY_DATE);

  const o = Object.assign({}, opts);
  o.headers = Object.assign({}, o.headers, {
    'X-User-Agent': ESI_UA,
    'X-Compatibility-Date': ESI_COMPATIBILITY_DATE,
  });
  return esiFetchWithBackoff(u.toString(), o);
}

/* RATE LIMITING.
 *
 * ESI uses a floating token window: a 2XX costs 2 tokens, a 3XX costs 1, and a
 * 4XX costs FIVE — failures are the most expensive outcome there is. Tokens
 * return after 15 minutes, and exceeding the bucket returns 429 with a
 * Retry-After header in seconds.
 *
 * Two consequences this code has to respect:
 *
 *  - A 429 must be waited out, not retried immediately. Hammering through one
 *    turns every rejected call into another 5 tokens and digs the hole deeper.
 *    CCP's blog names this exact behaviour as the reason rate limiting exists.
 *
 *  - Once limited, EVERY route in the group is limited. A single retry storm in
 *    the price panel would take the status panel down with it, so the wait is
 *    tracked globally rather than per call site.
 *
 * One retry only. If ESI is still saying no after honouring its own
 * Retry-After, the honest move is to surface the failure rather than queue up
 * behind it. */
let _esiBackoffUntil = 0;

/* What ESI last told us about our budget. Read from the response headers CCP
 * documents, not guessed: X-Ratelimit-Remaining / -Limit on routes under the
 * new floating-window limiter, X-ESI-Error-Limit-Remain on the older error
 * limiter. Exposed so the UI can show it rather than the tool silently
 * throttling with no explanation. */
const _esiLimit = { remaining: null, limit: null, group: null, errorsLeft: null, slowed: false };
function esiLimitState(){ return Object.assign({}, _esiLimit); }

/* CCP's guidance is explicit: "If the X-Ratelimit-Remaining is approaching
 * zero, start to slow down" and "Don't operate at the limit."
 *
 * Reacting only to a 429 is reacting after the fact — by then the request has
 * already been refused and cost tokens. Below a fifth of the window we pace
 * requests instead, which keeps a long run inside the budget rather than
 * sprinting into a wall and waiting out a Retry-After. */
function _readLimitHeaders(res){
  if(!res || !res.headers || !res.headers.get) return;
  const num = k => { const v = parseFloat(res.headers.get(k)); return isFinite(v) ? v : null; };
  const rem = num('X-Ratelimit-Remaining');
  if(rem != null) _esiLimit.remaining = rem;
  const grp = res.headers.get('X-Ratelimit-Group');
  if(grp) _esiLimit.group = grp;
  const lim = res.headers.get('X-Ratelimit-Limit');   // e.g. "150/15m"
  if(lim){
    _esiLimit.limit = lim;
    const total = parseFloat(String(lim).split('/')[0]);
    if(isFinite(total) && total > 0 && _esiLimit.remaining != null){
      _esiLimit.slowed = (_esiLimit.remaining / total) < 0.2;
    }
  }
  /* The older error limiter is mutually exclusive with the above, and is the
   * one that returns 420 across ALL routes once exhausted — worth watching
   * even though this tool makes few failing requests. */
  const errs = num('X-ESI-Error-Limit-Remain');
  if(errs != null){
    _esiLimit.errorsLeft = errs;
    if(errs < 10) _esiLimit.slowed = true;
  }
}

async function esiFetchWithBackoff(url, opts){
  const wait = _esiBackoffUntil - Date.now();
  if(wait > 0) await new Promise(r=>setTimeout(r, Math.min(wait, 60000)));

  /* Pace, rather than sprint into a 429. A refused request costs 5 tokens for
   * a 4XX; waiting a quarter second costs nothing. */
  if(_esiLimit.slowed) await new Promise(r=>setTimeout(r, 250));

  let res = await fetch(url, opts);
  _readLimitHeaders(res);
  if(res.status !== 429) return res;

  // Retry-After is in seconds. Fall back to 5s if the header is absent or junk.
  const hdr = parseFloat(res.headers && res.headers.get ? res.headers.get('Retry-After') : NaN);
  const delay = Math.min(isFinite(hdr) && hdr > 0 ? hdr * 1000 : 5000, 60000);
  _esiBackoffUntil = Date.now() + delay;
  await new Promise(r=>setTimeout(r, delay));
  const retry = await fetch(url, opts);
  _readLimitHeaders(retry);
  return retry;
}

async function loadAllSystems(){
  if(systemsLoadPromise) return systemsLoadPromise;
  systemsLoadPromise = (async ()=>{
    const idsRes = await esiFetch(`${ESI_BASE}/universe/systems/?datasource=tranquility`);
    if(!idsRes.ok) throw new Error('HTTP '+idsRes.status);
    const ids = await idsRes.json();
    const chunks = [];
    for(let i=0;i<ids.length;i+=1000) chunks.push(ids.slice(i,i+1000));
    const results = await Promise.all(chunks.map(async chunk=>{
      const r = await esiFetch(`${ESI_BASE}/universe/names/?datasource=tranquility`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(chunk)
      });
      if(!r.ok) return {failed:true, items:[]};
      return {failed:false, items: await r.json()};
    }));
    // Track partial failures honestly. A silently-dropped chunk used to remove
    // ~1000 systems from the autocomplete with no indication — a user in an
    // affected system would simply never find it and have no idea why.
    systemsLoadFailedChunks = results.filter(r=>r.failed).length;
    ALL_SYSTEMS = results.flatMap(r=>r.items).filter(x=>x.category==='solar_system').map(x=>({id:x.id, name:x.name}));
    ALL_SYSTEMS.sort((a,b)=>a.name.localeCompare(b.name));
    return ALL_SYSTEMS;
  })();
  return systemsLoadPromise;
}
loadAllSystems(); // kick off in background as soon as the page loads

/* ===================== PLANET NAME ORDERING =====================
 *
 * EVE names planets "<SYSTEM> <ROMAN>" — Jita I, Jita II … Jita X, Jita XI.
 * Sorting those as text puts Jita XI before Jita II, and Jita IX before
 * Jita V, because "X" sorts before "V" alphabetically. Even a numeric-aware
 * localeCompare does not help: there are no Arabic digits to compare.
 *
 * So the roman tail is parsed to its value and sorted on that, with the system
 * prefix compared first so planets stay grouped by system.
 */
const ROMAN_VALUES = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };

function romanToInt(s){
  if(!s) return null;
  const up = String(s).toUpperCase();
  if(!/^[IVXLCDM]+$/.test(up)) return null;
  let total = 0;
  for(let i = 0; i < up.length; i++){
    const cur = ROMAN_VALUES[up[i]], next = ROMAN_VALUES[up[i+1]];
    // Subtractive pairs: IV, IX, XL and so on.
    total += (next && cur < next) ? -cur : cur;
  }
  return total;
}

/* Split "Jita IV - Moon 4" into its sortable parts. Anything after the roman
 * numeral (moon designations, custom labels) is kept as a final tiebreaker so
 * ordering stays stable rather than arbitrary. */
function planetSortKey(name){
  const raw = String(name || '').trim();
  const m = raw.match(/^(.*?)\s+([IVXLCDM]+)\b(.*)$/i);
  if(!m) return { system: raw.toLowerCase(), num: Number.MAX_SAFE_INTEGER, rest: '' };
  const num = romanToInt(m[2]);
  return {
    system: m[1].trim().toLowerCase(),
    // A name whose "roman" part is not valid sorts last rather than at zero.
    num: num == null ? Number.MAX_SAFE_INTEGER : num,
    rest: (m[3] || '').trim().toLowerCase()
  };
}

function comparePlanetNames(a, b){
  /* An empty name sorts LAST, not first. Comparing system prefixes would put
   * '' ahead of everything, because the empty string precedes any letter — so
   * a half-typed planet would jump to the top of the list while you were still
   * naming it. sortPlanetCardsIn() worked around this by filtering unnamed
   * cards out and re-appending them, but the comparator should not need a
   * caller to compensate for it. */
  const ea = !String(a || '').trim(), eb = !String(b || '').trim();
  if(ea !== eb) return ea ? 1 : -1;
  if(ea && eb) return 0;

  const ka = planetSortKey(a), kb = planetSortKey(b);
  if(ka.system !== kb.system) return ka.system < kb.system ? -1 : 1;
  if(ka.num !== kb.num) return ka.num - kb.num;
  if(ka.rest !== kb.rest) return ka.rest < kb.rest ? -1 : 1;
  return 0;
}


/* tierUnitsFor removed with tierContractFor, its only caller.
 *
 * This walk existed six times across the project before being unified here;
 * it is now unified further, into chainDemand(), which computes mined P1,
 * factory demand and purchases in ONE traversal instead of three helpers
 * each walking the same recipes.

/* tierContractFor removed with the legacy allocator it fed.
 *
 * chainDemand() in 05-allocator.js computes factory demand as part of one
 * walk — demand.factory.p2/p3/p4 — rather than as a separate contract the
 * caller assembles. One walk, one answer.


/* ===================== SHARED PHYSICS =====================
 *
 * These live here, in the FIRST module, because both engines need them and the
 * number prefix is the load order: a const declared in a later file is in its
 * temporal dead zone when an earlier one runs.
 *
 * They were previously spread across 13-engine, 15-allocator and 19-lazy-p2 —
 * fine when nothing loaded before those, fatal once the v8 engine arrived at
 * 03. The page died with "Cannot access CYCLES_PER_WEEK before initialization".
 *
 * Every value here was verified identical between the two engines before the
 * duplicates were removed.
 */
const STORAGE_M3 = 12000;
const CYCLES_PER_WEEK = 24 * 7;          // 1-hour industry facility cycles
const P1_PER_EXTRACTION_COLONY = 53760;  // 7,680/day x 7, at 100% density (6hr program baseline)
const ADV_FACILITIES_PER_COLONY = 24;    // CCU5: 2 factories x 12 Advanced
const HITECH_FACILITIES_PER_COLONY = 16; // CCU5: 2 factories x 8 High-Tech
const P2_OUT_PER_ADV  = CYCLES_PER_WEEK * 5;   // 840
const P3_OUT_PER_ADV  = CYCLES_PER_WEEK * 3;   // 504
const P4_OUT_PER_HITECH = CYCLES_PER_WEEK * 1; // 168
const PI_DECAY_FACTOR = 0.012;
const PI_NOISE_FACTOR = 0.8;
const PI_QTY_PER_CYCLE_BASE = 13277.2694; // exact-solved; integer 13277 was 0.05% low
const PI_SUB_CYCLE_SEC = 1800; // 30-minute extractor sub-cycles
const P0_PER_DAY_BASELINE = p0PerDayForProgram(6);
const MAX_RESOURCES_PER_COLONY = 5;   // a planet carries at most 5 resources
const P1_TO_P0 = (()=>{ const m={}; Object.entries(P0_TO_P1).forEach(([p0,p1])=>{ m[p1]=p0; }); return m; })();


/* ===================== SUPPORTED SCALE =====================
 *
 * The tool supports up to 50 characters and 300 planets. Those are SUPPORT
 * ceilings, not planning assumptions: every calculation uses the user's own
 * numbers, and an operation of three characters is planned as three
 * characters, not padded toward the ceiling.
 *
 * 50 x 6 = 300 is the natural pairing — a character with Interplanetary
 * Consolidation V runs at most 6 planets, so 50 characters cannot exceed 300
 * colonies. The planet list may hold more entries than that (scanned
 * candidates you have not committed to), which is why the two limits are
 * separate rather than derived.
 *
 * Raising these is a one-line change; the allocator has no fixed-size
 * structures. They exist so the UI can warn before a paste of 4,000 planets
 * makes the page unusable, not because the maths breaks.
 */
const MAX_CHARACTERS = 50;
const MAX_PLANETS = 300;
const MAX_PLANETS_PER_CHARACTER = 6;   // Interplanetary Consolidation V

/* ===================== CUSTOMS OFFICE BASE COSTS =====================
 *
 * EVE does NOT tax planetary imports and exports on market value. It taxes a
 * fixed base cost per tier, published by CCP and unchanged by price swings.
 *
 *   Export fee = base cost x tax rate   (x1.5 if launched via Command Center)
 *   Import fee = base cost x tax rate x 0.5
 *
 * This matters more than it sounds. A Broadcast Node sells around 1.9M but its
 * base is 1.2M, so a 10% POCO overcharges by nearly 60% if you compute it from
 * the market price — which is what this tool did until now. Where market sits
 * BELOW base, the same mistake undercharges instead.
 *
 * Source: EVE University, Colony management -> Tax Rates, which gives both the
 * table and the formula:
 * https://wiki.eveuniversity.org/Colony_management#Tax_Rates
 *
 * Cross-checked against two independent player reports: exporting one Biomass
 * (P1) at 10% costs 40 ISK, and 70 Coolant (P2) at 12% cost 60,480 ISK — which
 * is 7,200 base per unit. Both agree with the table.
 */
const TIER_BASE_COSTS = { p0: 5, p1: 400, p2: 7200, p3: 60000, p4: 1200000 };

/* Import is charged at half the export rate. */
const CUSTOMS_IMPORT_MULTIPLIER = 0.5;

/* Launching from a Command Center instead of a Launchpad costs 1.5x. Not
 * applied automatically: this tool assumes a Launchpad, which is what any
 * setup past the first week uses. Exposed so a caller can opt in. */
const CUSTOMS_COMMAND_CENTER_MULTIPLIER = 1.5;

/* Base cost for anything the ledger can touch.
 *
 * Composites (fuel blocks, nanite paste) and bought inputs (ice, minerals) are
 * NOT planetary commodities — they never cross a customs office, so they have
 * no base cost and pay no POCO tax. Returning null rather than zero keeps that
 * distinction visible instead of silently treating them as free. */
function baseCostOf(name){
  const tier = (typeof tierOf === 'function') ? tierOf(name) : null;
  return tier ? (TIER_BASE_COSTS[tier] ?? null) : null;
}
