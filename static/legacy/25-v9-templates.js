/* ============================================================================
 * v9 template bridge — one-click template per PLANNED COLONY.
 *
 * For each colony in the v9 plan dashboard, pick the template in this order:
 *   1. LIBRARY: an exact community template from the 1-click import table
 *      (IMPORTED_TEMPLATES, 199 real files) matching this colony's planet
 *      type and product — copied BYTE-FOR-BYTE, never re-serialized.
 *   2. GENERATED: the same builders the Templates section uses
 *      (buildMinerTemplate / buildConsolidatedFactoryTemplate /
 *      buildFactoryTemplate), serialized with eveSerialize. Everything on
 *      this path is flagged ⚠ needs-verifying by the caller — generated
 *      layouts are defensible extrapolations, not byte-verified files.
 *
 * Honesty rules: every difference between the template and the plan (facility
 * count, command-center level, encoded planet type) is returned as a named
 * caution — nothing is silently "close enough".
 *
 * Exposed as window.__v9tpl.forColony(spec):
 *   spec = { planetType, ccLevel, role: 'extract'|'refine'|'advanced'|'ht',
 *            p0?, p1?, schematics: [{name, count}] }
 *   → { ok:true, source:'library'|'generated', name, credit?, label?,
 *       json, cautions: [string] }
 *     | { ok:false, why }
 * ========================================================================== */
'use strict';

(function () {
  const PLN_ID = { Barren: 2016, Gas: 13, Ice: 12, Lava: 2015, Oceanic: 2014, Plasma: 2063, Storm: 2017, Temperate: 11 };
  const PLN_NAME = {}; Object.keys(PLN_ID).forEach((k) => { PLN_NAME[PLN_ID[k]] = k; });

  function rowTemplate(row) {
    try { return JSON.parse(row[4]); } catch (e) { return null; }
  }
  function subCount(sub) {
    const m = /^(\d+)\s+factories/.exec(sub || '');
    return m ? Number(m[1]) : null;
  }

  /* ---- 1. library match: exact community file for this planet + product ---- */
  function libraryMatch(spec) {
    const typeId = PLN_ID[spec.planetType];
    const planCount = spec.role === 'extract'
      ? (spec.schematics[0] ? spec.schematics[0].count : 0)
      : spec.schematics.reduce((a, s) => a + s.count, 0);
    const cands = [];
    IMPORTED_TEMPLATES.forEach((row) => {
      const group = row[0], sub = row[1], name = row[2];
      let hit = false;
      if (spec.role === 'extract' && group === 'Extractor (P0 to P1)' && name === spec.p1) hit = true;
      else if (spec.role === 'advanced' && spec.schematics.length === 1) {
        const s = spec.schematics[0].name;
        if (group === 'Factory (P1 to P2)' && name === s) hit = true;
        else if (group === 'P3 factory' && name.indexOf(s) !== -1) hit = true;
      }
      if (!hit) return;
      const t = rowTemplate(row);
      if (!t || t.Pln !== typeId) return; // a template imports onto ITS planet type
      cands.push({ row, t, sub, name, n: subCount(sub) });
    });
    if (cands.length === 0) return null;
    // Prefer the plain per-planet-type extractor rows, then the facility
    // count closest to the plan's.
    cands.sort((a, b) => {
      const plainA = / planets$/.test(a.sub) ? 0 : 1;
      const plainB = / planets$/.test(b.sub) ? 0 : 1;
      if (plainA !== plainB) return plainA - plainB;
      const dA = a.n === null ? 0.5 : Math.abs(a.n - planCount);
      const dB = b.n === null ? 0.5 : Math.abs(b.n - planCount);
      return dA - dB;
    });
    const best = cands[0];
    const cautions = [];
    if (best.n !== null && best.n !== planCount) {
      cautions.push('template lays out ' + best.n + ' facilities; this plan calls for ' + planCount + ' — add/remove in game');
    }
    if (typeof best.t.CmdCtrLv === 'number' && best.t.CmdCtrLv > spec.ccLevel) {
      cautions.push('template is built for command center L' + best.t.CmdCtrLv + '; this colony plans L' + spec.ccLevel);
    }
    return {
      ok: true, source: 'library',
      name: best.name + ' (' + best.sub + ')',
      credit: best.row[3],
      json: best.row[4], // EXACT community bytes — never re-serialized
      cautions: cautions,
    };
  }

  /* ---- 2. generated fallback: the Templates section's own builders ---- */
  function generate(spec) {
    const cautions = [];
    let t = null, label = '';
    if (spec.role === 'extract') {
      t = buildMinerTemplate(spec.p0, spec.p1);
      if (!t) return { ok: false, why: 'no miner layout data exists for ' + spec.p1 };
      label = 'generated from the verified miner layout';
      const tplType = PLN_NAME[t.Pln];
      if (tplType !== spec.planetType) {
        cautions.push('layout encodes ' + tplType + '; importing on ' + spec.planetType + ' relies on the game’s building auto-convert — check every building after import');
      }
    } else if (spec.role === 'advanced') {
      t = buildConsolidatedFactoryTemplate(spec.planetType, spec.schematics.map((s) => ({ name: s.name, share: s.count })));
      if (!t) return { ok: false, why: 'no defensible layout for this job mix (3-input P3s cannot share a mixed layout)' };
      label = spec.schematics.length === 1 ? 'generated from the verified factory skeleton' : 'generated multi-schematic layout';
      const tplType = PLN_NAME[t.Pln];
      if (tplType !== spec.planetType) {
        cautions.push('layout encodes ' + tplType + '; importing on ' + spec.planetType + ' relies on the game’s building auto-convert — check every building after import');
      }
      const laidOut = t.P.filter((p) => p.S !== null && p.S !== undefined).length;
      const planned = spec.schematics.reduce((a, s) => a + s.count, 0);
      if (laidOut !== planned) {
        cautions.push('layout places ' + laidOut + ' facilities; this plan calls for ' + planned + ' — add/remove in game');
      }
    } else if (spec.role === 'ht') {
      const type = (spec.planetType === 'Barren' || spec.planetType === 'Temperate') ? spec.planetType : 'Barren';
      const product = spec.schematics.length > 0 ? spec.schematics[0].name : null;
      if (product === null) return { ok: false, why: 'high-tech colony has no schematic' };
      t = buildFactoryTemplate(product, type);
      if (!t) return { ok: false, why: 'no P4 layout data for ' + product };
      label = 'generated from the decoded P4 layout schema';
      if (type !== spec.planetType) cautions.push('P4 layouts exist only for Barren/Temperate; encoded as ' + type);
      cautions.push('this layout builds the P4 chain locally from bought P1/P2 — the plan imports P3s instead; treat it as a starting shell and re-route in game');
    } else if (spec.role === 'refine') {
      return { ok: false, why: 'no community or generated template covers a refinery colony — build it by hand: the basic industry facilities listed above, one launchpad, one storage, ore routed from the launchpad' };
    } else {
      return { ok: false, why: 'no template mapping for this colony shape' };
    }
    if (typeof t.CmdCtrLv === 'number' && t.CmdCtrLv > spec.ccLevel) {
      cautions.push('template is built for command center L' + t.CmdCtrLv + '; this colony plans L' + spec.ccLevel);
    }
    return { ok: true, source: 'generated', name: t.Cmt || 'generated template', label: label, json: eveSerialize(t), cautions: cautions };
  }

  function forColony(spec) {
    try {
      const lib = libraryMatch(spec);
      if (lib) return lib;
      return generate(spec);
    } catch (e) {
      return { ok: false, why: 'template lookup failed: ' + e.message };
    }
  }

  window.__v9tpl = { forColony: forColony };
})();
