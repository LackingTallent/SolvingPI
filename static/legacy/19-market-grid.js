/* EXTRACTED VERBATIM from SolvingPI v8.3 src/js/19-market-grid.js (lines 1-246).
 * No edits below this header. See REPORT.md for the dependency list. */
/* ===================== FULL P0-P4 MARKET REFERENCE GRID ===================== */
const COMMODITY_LEGEND = { p0:[], p1:[], p2:[], p3:[], p4:[] };
Object.entries(P0_TO_P1).forEach(([p0,p1])=>{
  COMMODITY_LEGEND.p0.push([p0, TYPE_IDS[p0]]);
  COMMODITY_LEGEND.p1.push([p1, TYPE_IDS[p1]]);
});
Object.keys(RECIPES_P2).forEach(name=> COMMODITY_LEGEND.p2.push([name, TYPE_IDS[name]]));
Object.keys(RECIPES_P3).forEach(name=> COMMODITY_LEGEND.p3.push([name, TYPE_IDS[name]]));
Object.keys(RECIPES_P4).forEach(name=> COMMODITY_LEGEND.p4.push([name, TYPE_IDS[name]]));
const TIER_LABEL = {p0:'P0 · Raw', p1:'P1 · Basic', p2:'P2 · Refined', p3:'P3 · Specialized', p4:'P4 · Advanced'};
const ALL_COMMODITY_TIERS = {};
Object.entries(COMMODITY_LEGEND).forEach(([tier,list])=>list.forEach(([name])=>ALL_COMMODITY_TIERS[name]=tier));

/* Two further columns the table used to omit.
 *
 * The planner prices these and charges freight on them, but they were absent
 * from the one screen that claims to show what is tracked — so the tool was
 * quietly costing a fuel block run against 990 units of ice the user could not
 * look up anywhere.
 *
 * Kept OUT of ALL_COMMODITY_TIERS deliberately. That map defines what counts as
 * a PI commodity, and the allocator, the tier walk and every fixture read it.
 * These are displayed alongside PI, not reclassified as PI. */
const EXTRA_LEGEND = {
  composite: Object.entries(COMPOSITE_RECIPES).map(([name, r]) => [name, r.typeId]),
  bought:    Object.entries(NON_PI_TYPE_IDS),
};
const EXTRA_LABEL = {
  composite: 'Built from PI',
  bought:    'Bought inputs',
};

/* Everything with a live Jita price, PI or not.
 *
 * ALL_COMMODITY_TIERS holds only the 83 PI commodities — deliberately, since
 * it defines what counts as PI. But the Market Reference, the price history
 * chart and the depth chart all want the FULL priceable set: PI plus the seven
 * things built from it and the eleven non-PI inputs those need.
 *
 * Each panel used to derive its own list, and they drifted: the reference
 * table rendered all 101 while only requesting 83, and both charts offered
 * only the 83. Deriving them from one place is what stops that recurring. */
function priceableNames(){
  const out = Object.keys(ALL_COMMODITY_TIERS).filter(n => TYPE_IDS[n]);
  Object.values(EXTRA_LEGEND).forEach(list => list.forEach(([name]) => {
    if (!out.includes(name)) out.push(name);
  }));
  return out;
}
/* Type id for anything in that set, wherever it is stored. */
function priceableTypeId(name){
  if (TYPE_IDS[name]) return TYPE_IDS[name];
  let found = null;
  Object.values(EXTRA_LEGEND).forEach(list => list.forEach(([n, id]) => {
    if (n === name) found = id;
  }));
  return found;
}

const legendGrid = document.getElementById('legendGrid');

/* One row builder for every column.
 *
 * The composite and bought-input columns were originally a second copy of this
 * markup, which meant two copies of the trend-id template — enough for the
 * duplicate-id build check to flag it, correctly in spirit: two copies of the
 * same markup is two places for it to drift. One function, called by both.
 *
 * volBadge differs by column. PI tiers share a per-tier volume and mark
 * individually-confirmed items with a tick; composites and bought inputs have
 * per-item volumes, every one individually verified — the fuel block figure in
 * particular was wrong by 100x and understated freight on a 40-block run by
 * 241x, so these are never presented as tier-inferred. */
function legendRow(name, id, tier, volBadge){
  return `
      <button class="selector-item" data-name="${escapeHtml(name)}" data-tier="${tier}" data-id="${id}">
        ${iconImg(name, 22)}
        <span class="selector-item-body">
          <span>${escapeHtml(name)} ${volBadge}</span>
          <span class="price-trend loading" id="trend-${id}">
            <span class="pt-cell">24H <b>···</b></span><span class="pt-cell">7D <b>···</b></span><span class="pt-cell">30D <b>···</b></span>
          </span>
        </span>
      </button>`;
}

Object.entries(COMMODITY_LEGEND).forEach(([tier, items])=>{
  const col = document.createElement('div');
  col.className = 'legend-col';
  col.innerHTML = `<div class="legend-head tier-text-${tier}">${TIER_LABEL[tier]}</div>` +
    items.map(([name,id])=>{
      const isVerified = INDIVIDUALLY_VERIFIED_VOLUME.has(name);
      const volBadge = isVerified
        ? `<span style="color:var(--text-faint); font-family:var(--font-mono); font-size:18.6px;">(${TIER_VOLUMES[tier]} m³ ✓)</span>`
        : `<span style="color:var(--amber); font-family:var(--font-mono); font-size:18.6px;" title="Volume matches this tier's confirmed items, but this specific commodity wasn't individually checked against EVE's SDE.">(${TIER_VOLUMES[tier]} m³ *)</span>`;
      return legendRow(name, id, tier, volBadge);
    }).join('');
  legendGrid.appendChild(col);
});

Object.entries(EXTRA_LEGEND).forEach(([kind, items]) => {
  if (!items.length) return;
  const col = document.createElement('div');
  col.className = 'legend-col';
  col.innerHTML = `<div class="legend-head tier-text-${kind}">${EXTRA_LABEL[kind]}</div>` +
    items.map(([name, id]) => {
      const vol = (typeof volumeOf === 'function') ? volumeOf(name) : null;
      const volBadge = vol != null
        ? `<span style="color:var(--text-faint); font-family:var(--font-mono); font-size:18.6px;">(${vol} m³ ✓)</span>`
        : '';
      return legendRow(name, id, kind, volBadge);
    }).join('');
  legendGrid.appendChild(col);
});

async function fetchHistory(typeId){
  const res = await esiFetch(`${ESI_BASE}/markets/${JITA_REGION_ID}/history/?datasource=tranquility&type_id=${typeId}`);
  if(!res.ok) throw new Error('HTTP '+res.status);
  return (await res.json()).sort((a,b)=>a.date.localeCompare(b.date));
}
function computeTrends(hist){
  // Hardened: ESI history can be empty (never-traded item) or contain a zero
  // average (thinly-traded day). Previously an empty array THREW, killing the
  // whole trend load, and a zero past-average produced Infinity/NaN which
  // rendered literally as "Infinity%" in the market chart.
  if(!Array.isArray(hist) || !hist.length){
    return ['24H','7D','30D'].map(label=>({label, pct:null}));
  }
  const latest = hist[hist.length-1];
  const byOffset = (daysAgo)=> hist[Math.max(0, hist.length-1-daysAgo)];
  return ['24H','7D','30D'].map((label,i)=>{
    const past = byOffset([1,7,30][i]);
    if(!latest || !past || !isFinite(past.average) || past.average <= 0) return {label, pct:null};
    const pct = ((latest.average - past.average)/past.average)*100;
    return {label, pct: isFinite(pct) ? pct : null};
  });
}
async function loadAllPriceTrends(){
  const all = [];
  Object.values(COMMODITY_LEGEND).forEach(list=>list.forEach(([name,id])=>all.push(id)));
  /* The two extra columns were RENDERED but never requested.
   *
   * EXTRA_LEGEND supplies the "Built from PI" and "Bought inputs" columns —
   * fuel blocks, nanite paste, deployables, ice products, minerals — and each
   * row has a real type id and a trend element waiting for it. This loop only
   * walked COMMODITY_LEGEND, so 18 of the 101 rows sat on their placeholder
   * dots forever while the other 83 filled in.
   *
   * They are ordinary market items: the same history endpoint, the same
   * region, nothing special about them beyond living in a different map. */
  Object.values(EXTRA_LEGEND).forEach(list=>list.forEach(([name,id])=>all.push(id)));
  // Fire all requests but don't block the page on 101 sequential round-trips.
  await Promise.all(all.map(async tid=>{
    const el = document.getElementById('trend-'+tid);
    if(!el) return;
    try {
      const hist = await fetchHistory(tid);
      if(hist.length < 2) throw new Error('no history');
      const trends = computeTrends(hist);
      el.classList.remove('loading');
      const cells = el.querySelectorAll('.pt-cell');
      trends.forEach((t,i)=>{
        if(!cells[i]) return;
        // pct is null when there's no usable history (never traded, or a zero
        // past average). Show an honest "no data" dash rather than "NaN%".
        if(t.pct == null){
          cells[i].classList.add('flat');
          cells[i].innerHTML = `${t.label} <b title="No usable price history for this period">— n/a</b>`;
          return;
        }
        cells[i].classList.add(t.pct>0.05?'up':t.pct<-0.05?'down':'flat');
        const arrow = t.pct>0.05?'▲':t.pct<-0.05?'▼':'—';
        cells[i].innerHTML = `${t.label} <b>${arrow} ${Math.abs(t.pct).toFixed(1)}%</b>`;
      });
    } catch(err){
      el.classList.remove('loading');
      el.innerHTML = `<span class="pt-cell" style="color:var(--text-faint);">Unavailable</span>`;
    }
  }));
}
/* v9 change (was: unconditional loadAllPriceTrends() here): ~101 parallel ESI
 * history calls no longer fire on page load — trends load the first time the
 * Market Reference section is expanded. */
(function lazyLoadPriceTrends(){
  let loaded = false;
  const go = () => { if (loaded) return; loaded = true; loadAllPriceTrends(); };
  const sec = document.getElementById('secMarket');
  if (!sec) return;
  if (!sec.classList.contains('collapsed')) go();
  sec.addEventListener('section:expanded', go);
})();

/* ===== Hover-to-highlight: shows which of YOUR planets touch a commodity,
   built from your own current data — not a fixed character list. ===== */
let lockedSelector = null;
const selectorPopup = document.getElementById('selectorPopup');

/* The old generated console rendered .gen-cell tiles carrying a data-touches
 * list, and this feature highlighted them. That console is gone — replaced by
 * the judged plan dashboard — so the highlight half of this feature had
 * nothing left to highlight and is removed rather than left as a no-op.
 *
 * The popup survives, because it always had a second branch that reads the
 * planet list directly. That branch is now the only one. */
function findCommodityInCurrentPlanets(resourceName){
  const rows = [];
  readPlanets().forEach(pl=>{
    const p0s = Object.keys(pl.densities);
    if(p0s.includes(resourceName)){
      rows.push({planet: pl.name, system: pl.system, dir:'extracts (raw)'});
    } else if(p0s.some(k=>P0_TO_P1[k]===resourceName)){
      rows.push({planet: pl.name, system: pl.system, dir:'refines to P1'});
    }
  });
  return rows;
}
document.querySelectorAll('.selector-item').forEach(btn=>{
  const name = btn.dataset.name;
  btn.addEventListener('mouseenter', (e)=>{
    const rows = findCommodityInCurrentPlanets(name);
    const iconEl = btn.querySelector('img');
    // Same reasoning as iconImg(): the commodity name is adjacent in the DOM,
    // so the icon is decorative and gets an empty alt rather than no alt.
    const iconHtml = iconEl
      ? `<img src="${iconEl.src}" width="20" height="20" alt="" title="${String(name).replace(/"/g,'&quot;')}">`
      : iconFallbackBadge(name, 20);
    const tier = (ALL_COMMODITY_TIERS[name]||'').toUpperCase();
    const volTxt = volumeOf(name) != null ? `${volumeOf(name)} m³ each` : '';
    /* The empty state says WHY, not just "nothing found". A raw material you
     * cannot extract and a refined product you simply have not chosen to make
     * are different situations needing different actions. */
    const emptyMsg = (tier === 'P0' || tier === 'P1')
      ? `No planet you have entered extracts this. Add a planet that has it, or buy it in (section 4).`
      : `Your planets do not extract the raw materials for this. It is made from P0/P1 inputs — check those first.`;
    selectorPopup.innerHTML = `<div class="sp-title">${iconHtml}${name}${tier?` <span style="color:var(--text-faint); font-size:18.4px;">${tier}${volTxt?' · '+volTxt:''}</span>`:''}</div>` +
      (rows.length ? rows.map(r=>`<div class="sp-row"><span style="color:var(--amber);">${r.system}</span><span>${r.planet} · ${r.dir}</span></div>`).join('')
                    : `<div class="sp-row" style="color:var(--text-dim);">${emptyMsg}</div>`) +
      `<div class="sp-count">${rows.length ? `${rows.length} planet(s) in your plan handle this · click to pin` : 'Hover another commodity to explore the chain'}</div>`;
    selectorPopup.style.display='block';
  });
  btn.addEventListener('mousemove', (e)=>{
    selectorPopup.style.left = Math.min(e.clientX+18, window.innerWidth-340)+'px';
    selectorPopup.style.top = Math.min(e.clientY+18, window.innerHeight-360)+'px';
  });
  btn.addEventListener('mouseleave', ()=>{
    selectorPopup.style.display='none';
  });
  btn.addEventListener('click', ()=>{
    /* Pinning keeps the popup's commodity selected so it can be read without
     * holding the cursor still. */
    document.querySelectorAll('.selector-item').forEach(s=>s.classList.remove('locked'));
    if(lockedSelector===name){ lockedSelector=null; return; }
    lockedSelector = name; btn.classList.add('locked');
  });
});
