/* EXTRACTED VERBATIM from SolvingPI v8.3 src/js/22-panels.js:457-540 (initStatus).
 * Depends on jumpToSection dispatching "section:expanded" (22-panels.js:22-37, copied into shell.js). */
/* ===================== SYSTEM STATUS ===================== */
(function initStatus(){
  const sec = document.getElementById('secStatus');
  const grid = document.getElementById('statusGrid');
  if(!sec || !grid) return;
  let loaded = false;

  function card(label, state, detail){
    return `<div class="stat-card ${state}">
      <div class="stat-dot"></div>
      <div><div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-detail">${detail}</div></div>
    </div>`;
  }

  async function load(){
    grid.innerHTML = card('Checking…','pending','Contacting ESI');
    let eve = card('EVE Tranquility','bad','Unreachable');
    let esi = card('ESI API','bad','No response — the tool cannot fetch prices or system data right now');
    try {
      const t0 = Date.now();
      const r = await esiFetch(`${ESI_BASE}/status/?datasource=tranquility`);
      const ms = Date.now() - t0;
      if(r.ok){
        const d = await r.json();
        const since = d.start_time ? new Date(d.start_time) : null;
        const up = since ? Math.max(0, Math.round((Date.now()-since.getTime())/3600000)) : null;
        eve = card('EVE Tranquility','good',
          `${(d.players||0).toLocaleString()} pilots online`
          + (d.server_version ? ` &middot; build ${escapeHtml(String(d.server_version))}` : '')
          + (up!=null ? ` &middot; up ${up}h` : '')
          + (d.vip ? ' &middot; <b>VIP mode</b>' : ''));
        esi = card('ESI API','good', `Responding in ${ms} ms`);
      } else if(r.status===503){
        eve = card('EVE Tranquility','bad','Offline — likely downtime or an extended patch');
        esi = card('ESI API','warn','Reachable but reporting the server as down');
      } else {
        esi = card('ESI API','warn', `HTTP ${r.status} — degraded`);
      }
    } catch(e){ /* both already default to bad */ }

    /* What ESI last told us about our own request budget.
     *
     * CCP publish these headers precisely so applications can see where the
     * line is; showing the figure means a throttled run explains itself
     * instead of just feeling slow. Omitted entirely when ESI has not sent
     * the headers — inventing a number here would be worse than silence. */
    let budget = '';
    if(typeof esiLimitState === 'function'){
      const s = esiLimitState();
      if(s.remaining != null || s.errorsLeft != null){
        const parts = [];
        if(s.remaining != null && s.limit)
          parts.push(`${s.remaining} of ${escapeHtml(String(s.limit))} tokens left`
            + (s.group ? ` in <b>${escapeHtml(s.group)}</b>` : ''));
        else if(s.remaining != null) parts.push(`${s.remaining} tokens left`);
        if(s.errorsLeft != null) parts.push(`${s.errorsLeft} errors before a 420`);
        budget = card('Your ESI budget', s.slowed ? 'warn' : 'good',
          parts.join(' &middot; ')
          + (s.slowed ? ' &middot; <b>pacing requests to stay inside it</b>'
                      : ' &middot; well inside the limit'));
      }
    }

    /* The tool's own status. It has no backend to be down: everything runs in
     * this page, so the only honest answer is "as well as ESI is". The light
     * flickers because the hero has always claimed it works MOST of the time,
     * and it would be a poor joke to then claim perfect uptime. */
    const self = `<div class="stat-card self">
      <div class="stat-dot flicker"></div>
      <div><div class="stat-label">Solving PI</div>
        <div class="stat-detail">Running entirely in your browser. No backend, no accounts,
          nothing to go down — so it works exactly as well as ESI does, plus or minus my bugs.</div></div>
    </div>`;

    grid.innerHTML = eve + esi + budget + self;
    loaded = true;
  }

  sec.addEventListener('section:expanded', ()=> load());
  sec.querySelector('.collapse-btn')?.addEventListener('click', ()=>{
    if(!sec.classList.contains('collapsed')) load();
  });
})();
