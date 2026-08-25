/* EXTRACTED VERBATIM from SolvingPI v8.3 src/js/22-panels.js.
 * Blocks: initPriceHistory (22-panels.js:39-197), initDepthChart (22-panels.js:199-264),
 * initPriceTabs (22-panels.js:542-558). No edits inside the blocks. */
/* ===================== PRICE HISTORY ===================== */
(function initPriceHistory(){
  const sec = document.getElementById('secPrices');
  const svg = document.getElementById('phChart');
  const legendEl = document.getElementById('phLegend');
  const statusEl = document.getElementById('phStatus');
  if(!sec || !svg || !legendEl) return;

  const TIER_COLOR = { p0:'#8b949e', p1:'#22e8ff', p2:'#3fb950', p3:'#ffc233', p4:'#ff93e0' };
  let series = null;            // name -> [{date, avg, high, low}]
  let hidden = new Set();
  let loading = false, loaded = false;

  const say = (m, cls)=>{ if(statusEl){ statusEl.textContent = m;
    statusEl.className = 'chart-status' + (cls?' '+cls:''); } };

  async function loadHistory(){
    if(loading || loaded) return;
    loading = true;
    /* The full priceable set: 83 PI plus the 7 built from it and the 11
     * non-PI inputs. This offered only the 83, so a fuel block — which the
     * planner will happily plan for you — had no history to look at. */
    const names = priceableNames();
    say(`Loading price history for ${names.length} items…`);
    series = {};
    let done = 0, failed = 0;
    // Sequential batches rather than 83 parallel requests: ESI rate-limits,
    // and hammering it is both rude and likely to get several calls rejected.
    const BATCH = 8;
    for(let i=0; i<names.length; i+=BATCH){
      await Promise.all(names.slice(i, i+BATCH).map(async name=>{
        try {
          const r = await esiFetch(`${ESI_BASE}/markets/${JITA_REGION_ID}/history/?datasource=tranquility&type_id=${priceableTypeId(name)}`);
          if(!r.ok) throw new Error('http '+r.status);
          const rows = await r.json();
          if(Array.isArray(rows) && rows.length){
            series[name] = rows.slice(-90).map(d=>({
              date:d.date, avg:d.average, high:d.highest, low:d.lowest, vol:d.volume }));
          }
        } catch { failed++; }
        done++;
      }));
      say(`Loading price history… ${done}/${names.length}`);
    }
    loaded = true; loading = false;
    const got = Object.keys(series).length;
    say(got
      ? `${got} commodities loaded from ESI market history (last 90 days).`
        + (failed ? `  ${failed} had no history or failed to load.` : '')
      : 'No price history returned — ESI may be unavailable. Check the System Status panel.',
      got ? 'ok' : 'err');
    buildLegend();
    draw();
  }

  function buildLegend(){
    const names = Object.keys(series||{}).sort((a,b)=>{
      const t=['p0','p1','p2','p3','p4'];
      return t.indexOf(ALL_COMMODITY_TIERS[a]) - t.indexOf(ALL_COMMODITY_TIERS[b])
          || a.localeCompare(b);
    });
    legendEl.innerHTML = names.map(n=>{
      const tier = ALL_COMMODITY_TIERS[n] || 'p1';
      return `<button type="button" class="lg-item${hidden.has(n)?' off':''}" data-name="${escapeHtml(n)}">
        <span class="lg-swatch" style="background:${TIER_COLOR[tier]};"></span>
        <span class="lg-name">${escapeHtml(n)}</span></button>`;
    }).join('');
    legendEl.querySelectorAll('.lg-item').forEach(b=>{
      b.addEventListener('click', ()=>{
        const n = b.dataset.name;
        if(hidden.has(n)) hidden.delete(n); else hidden.add(n);
        b.classList.toggle('off', hidden.has(n));
        draw();
      });
    });
  }

  function draw(){
    if(!series) return;
    const W=900, H=400, L=74, R=14, T=14, B=34;
    const visible = Object.keys(series).filter(n=>!hidden.has(n) && series[n].length);
    if(!visible.length){
      svg.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="var(--text-faint)"
        font-family="var(--font-mono)" font-size="18">No commodities selected — pick some from the legend.</text>`;
      return;
    }
    const useLog = (document.getElementById('phLogScale')||{}).checked !== false;
    let lo=Infinity, hi=-Infinity, maxLen=0;
    visible.forEach(n=> series[n].forEach(d=>{
      if(d.low>0 && d.low<lo) lo=d.low;
      if(d.high>hi) hi=d.high;
      maxLen=Math.max(maxLen, series[n].length);
    }));
    if(!isFinite(lo) || !isFinite(hi) || hi<=0){ svg.innerHTML=''; return; }
    if(lo<=0) lo = hi/1e6;

    const sy = v =>{
      if(useLog){
        const a=Math.log10(Math.max(v,lo)), l=Math.log10(lo), h=Math.log10(hi);
        return T + (H-T-B) * (1 - (a-l)/Math.max(h-l,1e-9));
      }
      return T + (H-T-B) * (1 - (v-lo)/Math.max(hi-lo,1e-9));
    };
    const sx = i => L + (W-L-R) * (i/Math.max(maxLen-1,1));

    // Axis ticks
    let ticks='';
    const N=5;
    for(let k=0;k<=N;k++){
      const frac=k/N;
      const v = useLog ? Math.pow(10, Math.log10(lo)+frac*(Math.log10(hi)-Math.log10(lo)))
                       : lo+frac*(hi-lo);
      const y = sy(v);
      ticks += `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W-R}" y2="${y.toFixed(1)}"
        stroke="var(--panel-border)" stroke-width="1"/>
        <text x="${L-8}" y="${(y+5).toFixed(1)}" text-anchor="end" fill="var(--text-faint)"
        font-family="var(--font-mono)" font-size="15">${fmtIsk(v)}</text>`;
    }

    const paths = visible.map(n=>{
      const tier = ALL_COMMODITY_TIERS[n] || 'p1';
      const d = series[n].map((pt,i)=> (i?'L':'M')+sx(i).toFixed(1)+' '+sy(pt.avg).toFixed(1)).join(' ');
      return `<path d="${d}" fill="none" stroke="${TIER_COLOR[tier]}" stroke-width="1.4"
        opacity="0.82"><title>${escapeHtml(n)}</title></path>`;
    }).join('');

    svg.innerHTML = ticks + paths
      + `<text x="${L}" y="${H-10}" fill="var(--text-faint)" font-family="var(--font-mono)"
         font-size="15">${maxLen} days ago</text>`
      + `<text x="${W-R}" y="${H-10}" text-anchor="end" fill="var(--text-faint)"
         font-family="var(--font-mono)" font-size="15">today</text>`;
  }

  function fmtIsk(v){
    if(v>=1e9) return (v/1e9).toFixed(1)+'b';
    if(v>=1e6) return (v/1e6).toFixed(1)+'m';
    if(v>=1e3) return (v/1e3).toFixed(1)+'k';
    return v.toFixed(0);
  }

  document.getElementById('phAll')?.addEventListener('click', ()=>{
    hidden.clear(); buildLegend(); draw(); });
  document.getElementById('phNone')?.addEventListener('click', ()=>{
    hidden = new Set(Object.keys(series||{})); buildLegend(); draw(); });
  document.getElementById('phLogScale')?.addEventListener('change', draw);
  document.querySelectorAll('.tier-filter').forEach(b=>{
    b.addEventListener('click', ()=>{
      const tier=b.dataset.tier;
      hidden = new Set(Object.keys(series||{}).filter(n=>ALL_COMMODITY_TIERS[n]!==tier));
      buildLegend(); draw();
    });
  });

  sec.addEventListener('section:expanded', loadHistory);
  /* v9 (audit #7): the direct collapse-btn backup listener is gone — it ran
   * before the shims' class toggle, so it observed the WRONG state; expansion
   * always announces 'section:expanded' now (00-shims setCollapsed). */
})();

/* ===================== SUPPLY / DEMAND DEPTH ===================== */
(function initDepthChart(){
  const sel = document.getElementById('depthSelect');
  const btn = document.getElementById('depthLoad');
  const svg = document.getElementById('depthChart');
  const statusEl = document.getElementById('depthStatus');
  if(!sel || !btn || !svg) return;

  sel.innerHTML = priceableNames()
    .sort()
    .map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

  const say = (m, cls)=>{ if(statusEl){ statusEl.textContent=m;
    statusEl.className='chart-status'+(cls?' '+cls:''); } };

  btn.addEventListener('click', async ()=>{
    const name = sel.value;
    const id = priceableTypeId(name);
    if(!id){ say('No type id for that commodity.', 'err'); return; }
    say(`Loading the Jita order book for ${name}…`);
    try {
      const r = await esiFetch(`${ESI_BASE}/markets/${JITA_REGION_ID}/orders/?datasource=tranquility&order_type=all&type_id=${id}`);
      if(!r.ok) throw new Error('http '+r.status);
      const orders = await r.json();
      const jita = orders.filter(o=>o.system_id===30000142);
      const buys = jita.filter(o=>o.is_buy_order).sort((a,b)=>b.price-a.price);
      const sells = jita.filter(o=>!o.is_buy_order).sort((a,b)=>a.price-b.price);
      if(!buys.length && !sells.length){ say('No live orders in Jita for that item.', 'warn'); svg.innerHTML=''; return; }
      drawDepth(buys, sells, name);
      const spread = (sells[0]&&buys[0]) ? ((sells[0].price-buys[0].price)/sells[0].price*100) : null;
      say(`${buys.length} buy and ${sells.length} sell orders in Jita.`
        + (spread!=null ? `  Spread ${spread.toFixed(1)}% — best buy ${buys[0].price.toLocaleString()} / best sell ${sells[0].price.toLocaleString()} ISK.` : ''), 'ok');
    } catch(e){
      say('Could not load the order book: '+e.message+'. Check the System Status panel.', 'err');
      svg.innerHTML='';
    }
  });

  function drawDepth(buys, sells, name){
    const W=900,H=400,L=78,R=14,T=14,B=36;
    // Cumulative volume walking outward from the spread — this is what a bulk
    // sale actually eats through, which a single headline price cannot show.
    const cum = (arr)=>{ let t=0; return arr.map(o=>({price:o.price, vol:(t+=o.volume_remain)})); };
    const b=cum(buys), s=cum(sells);
    const prices=[...b,...s].map(p=>p.price).filter(p=>p>0);
    const vols=[...b,...s].map(p=>p.vol);
    if(!prices.length){ svg.innerHTML=''; return; }
    const pLo=Math.min(...prices), pHi=Math.max(...prices), vHi=Math.max(...vols);
    const sx = p => L + (W-L-R)*((p-pLo)/Math.max(pHi-pLo,1e-9));
    const sy = v => T + (H-T-B)*(1 - v/Math.max(vHi,1));
    const path = (arr,color)=> arr.length
      ? `<path d="${arr.map((p,i)=>(i?'L':'M')+sx(p.price).toFixed(1)+' '+sy(p.vol).toFixed(1)).join(' ')}"
          fill="none" stroke="${color}" stroke-width="2.2"/>` : '';
    let grid='';
    for(let k=0;k<=4;k++){
      const y=T+(H-T-B)*(k/4), v=vHi*(1-k/4);
      grid+=`<line x1="${L}" y1="${y.toFixed(1)}" x2="${W-R}" y2="${y.toFixed(1)}"
        stroke="var(--panel-border)"/><text x="${L-8}" y="${(y+5).toFixed(1)}" text-anchor="end"
        fill="var(--text-faint)" font-family="var(--font-mono)" font-size="15">${Math.round(v).toLocaleString()}</text>`;
    }
    svg.innerHTML = grid
      + path(b, 'var(--green)') + path(s, 'var(--red)')
      + `<text x="${L}" y="${H-10}" fill="var(--green)" font-family="var(--font-mono)" font-size="16">demand (buy orders)</text>`
      + `<text x="${W-R}" y="${H-10}" text-anchor="end" fill="var(--red)" font-family="var(--font-mono)" font-size="16">supply (sell orders)</text>`;
  }
})();

/* Tab switching for the price panel. */
(function initPriceTabs(){
  const btns = [...document.querySelectorAll('[data-ptab]')];
  const panels = [...document.querySelectorAll('[data-ptab-panel]')];
  if(!btns.length || !panels.length) return;
  btns.forEach(b=>{
    b.addEventListener('click', ()=>{
      const key = b.dataset.ptab;
      btns.forEach(x=> x.classList.toggle('active', x===b));
      panels.forEach(p=>{
        const on = p.dataset.ptabPanel === key;
        p.hidden = !on;
        p.style.display = on ? '' : 'none';
      });
    });
  });
})();
