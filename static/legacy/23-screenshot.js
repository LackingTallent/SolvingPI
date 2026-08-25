/* EXTRACTED VERBATIM from SolvingPI v8.3 src/js/23-screenshot.js (lines 1-727).
 * No edits below this header. See REPORT.md for the dependency list. */
/* ===================== SCREENSHOT ANALYSIS PIPELINE (v2) =====================
 *
 * Reads an EVE planet survey screenshot and extracts, in priority order:
 *   1. system name   2. planet name   3. resource names   4. density bars.
 *
 * WHY THIS WAS REWRITTEN — a defect made every density reading meaningless.
 * The old code established each bar's 100% reference by scanning from the
 * right edge of the crop leftward for the first BRIGHT pixel. EVE's unfilled
 * bar track is dark, so that scan found nothing until it reached the end of
 * the FILLED portion — making the reference equal to the fill itself, so
 * every bar reported ~100%. Proven by simulation: a true 25% bar read 102%.
 *
 * The fix is architectural. The 100% reference is now the bar TRACK, found by
 * column-occupancy across all rows, with the widest filled run as a fallback.
 * Bars are sampled over multiple scanlines and reduced by MEDIAN so a single
 * noisy row cannot skew a result.
 */

/* ---------- text utilities ---------- */

function levenshtein(a, b){
  const m = a.length, n = b.length;
  const dp = Array.from({length:m+1}, (_,i)=>[i, ...Array(n).fill(0)]);
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
  return dp[m][n];
}
function normalizeForMatch(s){ return String(s||'').toLowerCase().replace(/[^a-z]/g,''); }

/* Escape untrusted text before it reaches innerHTML.
 *
 * SECURITY: the batch panel renders filenames and OCR output. Both are
 * attacker-controllable — a .zip of "PI screenshots" can carry a filename like
 * <img src=x onerror=...>.png, and OCR text comes from an arbitrary image. Both
 * were being interpolated straight into innerHTML, so importing a hostile
 * archive would execute script in the page.
 *
 * Impact is limited (no backend, no auth, no cookies to steal) but the tool is
 * distributed to strangers and invites them to import files from other people,
 * so it is worth closing properly rather than reasoning about severity. */
function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const ALL_P0_NAMES = Object.keys(P0_TO_P1);
const NORMALIZED_LOOKUP = {};
ALL_P0_NAMES.forEach(n => NORMALIZED_LOOKUP[normalizeForMatch(n)] = n);

/* Constrained vocabulary: only 15 raw resources exist, so even badly mangled
 * OCR usually resolves. Confidence is returned so the UI can warn instead of
 * silently accepting a shaky match. */
function matchResourceNameC(raw){
  const norm = normalizeForMatch(raw);
  if(!norm || norm.length < 3) return null;
  if(NORMALIZED_LOOKUP[norm]) return {name: NORMALIZED_LOOKUP[norm], confidence: 1};
  let bestKey=null, bestScore=Infinity;
  for(const key of Object.keys(NORMALIZED_LOOKUP)){
    const d = levenshtein(norm, key);
    if(d < bestScore){ bestScore = d; bestKey = key; }
  }
  if(bestKey == null) return null;
  const tol = Math.max(2, Math.floor(bestKey.length * 0.3));
  if(bestScore > tol) return null;
  return { name: NORMALIZED_LOOKUP[bestKey],
           confidence: 1 - (bestScore / Math.max(1, bestKey.length)) };
}

function matchPlanetType(foundNames){
  const found = new Set(foundNames);
  let best=null, bestOverlap=-1;
  Object.entries(PLANET_RESOURCES).forEach(([type,list])=>{
    const overlap = list.filter(r=>found.has(r)).length;
    if(overlap>bestOverlap){ bestOverlap=overlap; best=type; }
  });
  return bestOverlap >= 3 ? best : null;
}

/* ---------- image preprocessing ----------
 * Tesseract expects dark text on light paper. EVE is the inverse, at small UI
 * sizes, over a starfield. Upscaling, inverting and binarising first is the
 * single largest accuracy gain available. */

function toCanvas(img){
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/* Otsu's method — picks the threshold maximising between-class variance.
 * Deterministic and unit-testable, unlike a hardcoded brightness cutoff. */
function otsuThreshold(hist, total){
  let sum=0; for(let i=0;i<256;i++) sum += i*hist[i];
  let sumB=0, wB=0, best=0, bestVar=-1;
  for(let t=0;t<256;t++){
    wB += hist[t]; if(!wB) continue;
    const wF = total - wB; if(wF<=0) break;
    sumB += t*hist[t];
    const mB = sumB/wB, mF = (sum-sumB)/wF;
    const between = wB*wF*(mB-mF)*(mB-mF);
    if(between > bestVar){ bestVar = between; best = t; }
  }
  return best;
}

function preprocessForOCR(srcCanvas, scale){
  scale = scale || 2;
  const out = document.createElement('canvas');
  out.width = Math.round(srcCanvas.width*scale);
  out.height = Math.round(srcCanvas.height*scale);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(srcCanvas, 0, 0, out.width, out.height);

  const d = octx.getImageData(0,0,out.width,out.height);
  const p = d.data;
  const hist = new Array(256).fill(0);
  for(let i=0;i<p.length;i+=4)
    hist[(p[i]*0.299 + p[i+1]*0.587 + p[i+2]*0.114) | 0]++;
  const t = otsuThreshold(hist, p.length/4);
  for(let i=0;i<p.length;i+=4){
    const g = p[i]*0.299 + p[i+1]*0.587 + p[i+2]*0.114;
    const v = g > t ? 0 : 255;            // bright UI text -> black on white
    p[i]=p[i+1]=p[i+2]=v; p[i+3]=255;
  }
  octx.putImageData(d,0,0);
  return out;
}

/* ---------- OCR line grouping ----------
 * Group by vertical OVERLAP, not fixed bins: a fixed bin splits any line that
 * happens to straddle a boundary, which silently loses resource rows. */
function groupIntoLines(words) {
  const ws = (words || []).filter(w => w.text && w.text.trim().length)
                          .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const lines = [];
  for (const w of ws) {
    const h = Math.max(1, w.bbox.y1 - w.bbox.y0);
    const line = lines.find(L =>
      (Math.min(L.y1, w.bbox.y1) - Math.max(L.y0, w.bbox.y0)) > h * 0.45);
    if (line) {
      line.words.push(w);
      line.y0 = Math.min(line.y0, w.bbox.y0); line.y1 = Math.max(line.y1, w.bbox.y1);
      line.x0 = Math.min(line.x0, w.bbox.x0); line.x1 = Math.max(line.x1, w.bbox.x1);
    } else {
      lines.push({ words: [w], y0: w.bbox.y0, y1: w.bbox.y1, x0: w.bbox.x0, x1: w.bbox.x1 });
    }
  }
  return lines.map(L => ({
    text: L.words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(' ').trim(),
    conf: L.words.reduce((s, w) => s + (w.confidence || 0), 0) / L.words.length,
    y0: L.y0, y1: L.y1, x0: L.x0, x1: L.x1,
  }));
}

/* System + planet names.
 *
 * VERIFIED AGAINST 53 REAL SCREENSHOTS. The panel shows, top to bottom:
 *     BKG-Q2 -0.7 < 0C-PZ4      <- the player's CURRENT location + route
 *     < Branch                  <- region
 *     T-Q2DD XI                 <- the planet header: SYSTEM + roman numeral
 *
 * The earlier implementation took the FIRST system-shaped token going down the
 * page, which is the player's current location ("BKG-Q2") — not the system the
 * planet is in ("T-Q2DD"). It was wrong on every screenshot where the player
 * was not sitting in the system they were surveying.
 *
 * The correct rule: the system name is the planet header line minus its
 * trailing roman numeral. Confirmed against the filename ground truth for all
 * six systems in the sample set.
 */
const ROMAN_TAIL = /\s+([IVXLC]{1,7})\s*$/;

/* The planet header is the line that looks like "<SYSTEM> <ROMAN>". EVE system
 * names are alphanumeric with optional hyphens (Y-1918, 8-4GQM, J164710, Jita). */
function findPlanetHeaderLine(lines){
  for(const L of lines){
    const t = (L.text||'').trim();
    const m = t.match(/^([A-Za-z0-9][A-Za-z0-9\-]{1,14})\s+([IVXLC]{1,7})$/);
    if(m) return { line:L, system:m[1], numeral:m[2] };
  }
  // Fallback: a line ending in a roman numeral, with junk tolerated in front.
  for(const L of lines){
    const t = (L.text||'').trim();
    const m = t.match(ROMAN_TAIL);
    if(m && t.length < 30){
      const sys = t.slice(0, m.index).trim().split(/\s+/).pop();
      if(sys && /[A-Za-z0-9]/.test(sys)) return { line:L, system:sys, numeral:m[1] };
    }
  }
  return null;
}
function extractSystemName(lines){
  const h = findPlanetHeaderLine(lines);
  if(h) return { value:h.system, confidence:(h.line.conf||0)/100, source:'planet header' };
  return null;
}
function extractPlanetName(lines) {
  const h = findPlanetHeaderLine(lines);
  if (h) return { value: h.system + ' ' + h.numeral, confidence: (h.line.conf || 0) / 100 };
  return null;
}

/* ---------- density bars (the critical path) ---------- */

/* Median fill-end per row. Shared by the probe pass and the measured pass so
 * both see identical geometry — the probe result is what validates the
 * detected track edge, so it must not be re-derived differently. */
function scanFillEnds(lum, iw, ih, rows, thr, limitX){
  // limitX bounds every scan to the panel's own track. Without it a bright
  // planet render to the right of the panel is read as bar fill.
  const hardRight = (limitX != null) ? Math.min(iw, limitX+1) : iw;
  const gapTol = Math.max(2, Math.round(iw*0.01));
  return rows.map(r=>{
    const yTop=Math.round(r.y0), yBot=Math.round(r.y1);
    const mid=(yTop+yBot)/2, half=Math.max(1,(yBot-yTop)/2);
    const scan=[];
    for(let k=-2;k<=2;k++){
      const y = Math.round(mid + (half*0.5)*(k/2));
      if(y<0||y>=ih) continue;
      let last=-1, gap=0, started=false;
      for(let x=Math.round(r.barLeft); x<hardRight; x++){
        if(lum(x,y) > thr){ last=x; gap=0; started=true; }
        else if(started){ gap++; if(gap>gapTol) break; }
        else if(x - r.barLeft > iw*0.25) break;
      }
      if(last>=0) scan.push(last);
    }
    scan.sort((a,b)=>a-b);
    return { row:r, fillEnd: scan.length ? scan[Math.floor(scan.length/2)] : null,
             samples: scan.length };
  });
}
function measureBars(lum, iw, ih, rows, opts) {
  opts = opts || {};
  const trackRight = opts.trackRight;
  const limit = (trackRight != null) ? trackRight : iw - 1;

  // Otsu over the BAR REGION ONLY — the starfield and planet render would
  // pull a whole-image threshold to the wrong place.
  const hist = new Array(256).fill(0); let n = 0;
  for (const r of rows) {
    for (let y = Math.round(r.y0); y <= Math.round(r.y1); y++)
      for (let x = Math.round(r.barLeft); x <= limit; x++) { hist[lum(x, y) | 0]++; n++; }
  }
  const thr = n ? Math.max(60, otsuThreshold(hist, n)) : 140;

  const perRow = scanFillEnds(lum, iw, ih, rows, thr, limit);
  const ends = perRow.map(p => p.fillEnd).filter(v => v != null);
  if (!ends.length) return rows.map(r => ({ name: r.name, pct: null, reason: 'no bar detected' }));

  const lefts = rows.map(r => r.barLeft).sort((a, b) => a - b);
  const medLeft = lefts[Math.floor(lefts.length / 2)];
  const ref = (trackRight != null) ? trackRight : Math.max(...ends);
  const span = Math.max(1, ref - medLeft);

  return perRow.map(p => {
    if (p.fillEnd == null) return { name: p.row.name, pct: 0, samples: 0 };
    const fill = Math.max(0, p.fillEnd - medLeft);
    return { name: p.row.name,
             pct: Math.max(0, Math.min(100, Math.round((fill / span) * 100))),
             samples: p.samples };
  });
}

/* Per-row track end.
 *
 * VERIFIED AGAINST REAL SCREENSHOTS — this replaces a scan that ran to the
 * full image width. On an uncropped 1920x1080 screenshot the planet render
 * sits to the right of the panel and is BRIGHT, so the old scan sailed past
 * the panel and returned x=1251 when the real track ended at x=430. Every
 * density was then divided by a track ~9x too wide.
 *
 * The track is a contiguous run of above-background pixels. It ends at the
 * first SUSTAINED gap of background — everything beyond that (starfield,
 * planet, ship UI) is not part of the bar and must never be scanned.
 */
function rowTrackEnd(lum, y, x0, iw, bgFloor, gapNeeded){
  gapNeeded = gapNeeded || Math.max(10, Math.round(iw*0.007));
  let gap = 0, last = x0;
  for(let x = x0; x < iw; x++){
    if(lum(x,y) > bgFloor){ last = x; gap = 0; }
    else if(++gap >= gapNeeded) break;
  }
  return last;
}

/* Shared 100% reference for the whole panel.
 *
 * MEASURED AGAINST 53 REAL SCREENSHOTS. Two strategies, best-first:
 *
 *  1. EDGE VOTING (primary). The track's right edge is a sharp luminance drop
 *     occurring at the SAME column in every row. Scoring columns by how many
 *     rows share a drop there is robust against a planet render — or its ring
 *     system — bleeding into individual rows.
 *  2. GAP SCAN (fallback). Per-row scan to the first sustained background gap,
 *     reduced by median across rows.
 *
 * Track-span variance across the sample set:
 *     original (scan to image width) : 1042 px   <- unusable
 *     gap scan + median              :   88 px
 *     edge voting                    :   11 px   <- current
 */
/* Build the luminance accessor ONCE, from a single getImageData.
 *
 * PORTED FROM v8. Previously detectTrackRight and measureBars each called
 * ctx.getImageData() and built their own closure — two full pixel copies of
 * every screenshot, per scan, for identical data. On a batch of 20 images that
 * is 40 needless copies of several megabytes each.
 *
 * Passing the accessor also makes these functions pure: they take pixels, not
 * a canvas, so they can be tested without a DOM. */
function makeLum(imageData) {
  const { width: iw, height: ih, data } = imageData;
  return function lum(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || x >= iw || y < 0 || y >= ih) return 0;
    const i = (y * iw + x) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  };
}

function detectTrackRight(lum, iw, ih, rows) {
  const ends = [];
  for (const r of rows) {
    const y = Math.round((r.y0 + r.y1) / 2);
    let bg = 0, n = 0;
    for (let x = iw - 1; x > iw - 1 - Math.max(6, iw * 0.03); x--) { bg += lum(x, y); n++; }
    bg = n ? bg / n : 0;
    ends.push(rowTrackEnd(lum, y, Math.round(r.barLeft), iw, Math.max(28, bg + 12)));
  }
  const cluster = ends.length ? reduceTrackEnds(ends, rows.map(r => r.barLeft)) : null;

  const votes = new Map();
  for (const r of rows) {
    const y = Math.round((r.y0 + r.y1) / 2);
    const bl = Math.round(r.barLeft);
    const far = Math.min(iw - 3, bl + Math.max(200, Math.round(iw * 0.25)));
    for (let x = bl + 20; x < far; x++) {
      const here = lum(x, y), after = lum(x + 2, y);
      if (here - after > 18 && here > 30 && after < here * 0.6)
        votes.set(x, (votes.get(x) || 0) + 1);
    }
  }
  let edge = null;
  if (votes.size) {
    let best = 0; votes.forEach(v => { if (v > best) best = v; });
    if (best >= Math.max(2, rows.length - 1)) {
      let e = -1; votes.forEach((v, x) => { if (v === best && x > e) e = x; });
      if (e > 0) edge = e;
    }
  }

  if (edge == null) return cluster;
  if (cluster == null) return edge;
  return (edge > cluster * 1.15) ? Math.min(edge, cluster) : edge;
}

/* Reduce per-row track ends to one reference.
 *
 * A VISIBLE track makes most rows terminate at the same column, so the ends
 * form a tight cluster — take its median, which survives one row contaminated
 * by a planet render. If no majority cluster exists the track was never found
 * and each row stopped at its own FILL, in which case the longest bar is the
 * only defensible full-scale reference.
 *
 * Both branches are covered by tools/test-ocr-bars.js. */
function reduceTrackEnds(ends, barLefts){
  const s = ends.slice().sort((a,b)=>a-b);
  const n = s.length;
  const span = Math.max(1, s[n-1] - Math.min(...barLefts));
  const tol = Math.max(3, span*0.03);
  let best=null, bestCount=0;
  for(let i=0;i<n;i++){
    const grp = s.filter(v=>Math.abs(v-s[i])<=tol);
    if(grp.length>bestCount){ bestCount=grp.length; best=grp; }
  }
  if(bestCount >= Math.max(2, Math.ceil(n*0.6)))
    return best[Math.floor(best.length/2)];
  return s[n-1];
}

/* ---------- timestamp ---------- */
function fileTimestamp(file){
  const ms = (file && file.lastModified) ? file.lastModified : Date.now();
  const d = new Date(ms), pad = v=>String(v).padStart(2,'0');
  return { ms, iso:d.toISOString(),
    label:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    fromFileMtime: !!(file && file.lastModified) };
}

/* ---------- ZIP (no dependencies) ----------
 * Parses the central directory and inflates with the platform's own
 * DecompressionStream rather than bundling a ZIP library. */
async function readZipImages(file){
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd=-1;
  for(let i=buf.length-22; i>=0 && i>buf.length-22-65536; i--)
    if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; }
  if(eocd<0) throw new Error('not a valid zip archive');
  const count = dv.getUint16(eocd+10,true);
  let ptr = dv.getUint32(eocd+16,true);
  const out=[];
  for(let i=0;i<count;i++){
    if(dv.getUint32(ptr,true)!==0x02014b50) break;
    const method=dv.getUint16(ptr+10,true);
    const mTime=dv.getUint16(ptr+12,true), mDate=dv.getUint16(ptr+14,true);
    const compSize=dv.getUint32(ptr+20,true);
    const nameLen=dv.getUint16(ptr+28,true), extraLen=dv.getUint16(ptr+30,true);
    const cmtLen=dv.getUint16(ptr+32,true), lho=dv.getUint32(ptr+42,true);
    const name=new TextDecoder().decode(buf.subarray(ptr+46, ptr+46+nameLen));
    ptr += 46+nameLen+extraLen+cmtLen;
    if(/\/$/.test(name) || /^__MACOSX/.test(name)) continue;
    if(!/\.(png|jpg|jpeg|webp|bmp)$/i.test(name)) continue;
    const lnLen=dv.getUint16(lho+26,true), leLen=dv.getUint16(lho+28,true);
    const start=lho+30+lnLen+leLen;
    const raw=buf.subarray(start, start+compSize);
    let bytes;
    if(method===0) bytes=raw;
    else if(method===8){
      if(typeof DecompressionStream === 'undefined')
        throw new Error('this browser cannot unzip — upload the images directly');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else continue;
    const dosMs = new Date(1980+((mDate>>9)&0x7f), ((mDate>>5)&0x0f)-1, mDate&0x1f,
                           (mTime>>11)&0x1f, (mTime>>5)&0x3f, (mTime&0x1f)*2).getTime();
    out.push(new File([new Blob([bytes])], name.split('/').pop(), {lastModified:dosMs}));
  }
  return out;
}

/* ---------- main entry ---------- */

function loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('could not decode image')); };
    img.src=url;
  });
}

/* ===== OCR WORD EXTRACTION =====
 *
 * ROOT CAUSE OF TOTAL OCR FAILURE (fixed here).
 * The previous code called `Tesseract.recognize(img,'eng')` and then read
 * `res.data.words`. Per Tesseract.js's own API docs, `output` defaults to
 * TEXT ONLY — `blocks` must be requested explicitly, and the flat `data.words`
 * array does not exist in v4+. So `data.words` was always `undefined`,
 * groupIntoLines() received an empty array, no resource names ever matched,
 * and EVERY screenshot returned "No resource names recognised". The bar
 * measurement was never even reached. The pipeline failed 100% of the time.
 *
 * Two further problems fixed at the same time:
 *  - `Tesseract.recognize()` is deprecated and creates, loads and DESTROYS a
 *    whole worker on every call. A 20-image batch span up 20 workers, each
 *    downloading language data. One worker is now reused for the batch.
 *  - Word geometry is nested (blocks > paragraphs > lines > words), so it is
 *    flattened here. Both the nested and legacy flat shapes are handled, so
 *    this keeps working if the CDN serves a different major version. */

let _ocrWorker = null;
async function getOcrWorker(){
  if(_ocrWorker) return _ocrWorker;
  if(typeof Tesseract === 'undefined')
    throw new Error('OCR library failed to load — check your connection and reload');
  // createWorker is async in v4+.
  _ocrWorker = await Tesseract.createWorker('eng');
  return _ocrWorker;
}
async function releaseOcrWorker(){
  if(!_ocrWorker) return;
  try { await _ocrWorker.terminate(); } catch { /* already gone */ }
  _ocrWorker = null;
}

/* Flatten whatever shape this version returns into {text, bbox, confidence}. */
function flattenWords(data){
  if(!data) return [];
  if(Array.isArray(data.words) && data.words.length) return data.words;   // legacy flat
  const out = [];
  for(const block of (data.blocks || [])){
    for(const para of (block.paragraphs || [])){
      for(const line of (para.lines || [])){
        for(const w of (line.words || [])) out.push(w);
      }
    }
  }
  return out;
}

async function ocrWords(canvas){
  const worker = await getOcrWorker();
  // `blocks: true` is the fix. Without it Tesseract returns text only and
  // there is no word geometry at all, which is what broke the whole pipeline.
  const res = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const words = flattenWords(res && res.data);
  if(!words.length && res && res.data && res.data.text && res.data.text.trim()){
    // Text came back but geometry did not — a version whose output shape we
    // do not recognise. Fail loudly rather than silently reporting "no
    // resources found", which is what made the original bug so hard to spot.
    throw new Error('OCR returned text but no word positions — unsupported Tesseract version');
  }
  return words;
}

async function analyzePlanetScreenshot(file){
  const img = await loadImageFromFile(file);
  const full = toCanvas(img);
  const stamp = fileTimestamp(file);

  // ONE OCR pass over a preprocessed copy (the old code ran Tesseract twice).
  const pre = preprocessForOCR(full, img.width < 1400 ? 2 : 1.5);
  const sc = pre.width / full.width;
  const words = await ocrWords(pre);
  const lines = groupIntoLines(words);

  const system = extractSystemName(lines);
  const planet = extractPlanetName(lines);

  const matched = [];
  for(const L of lines){
    const m = matchResourceNameC(L.text);
    if(m) matched.push({ name:m.name, confidence:m.confidence,
                         y0:L.y0/sc, y1:L.y1/sc, labelRight:L.x1/sc, conf:L.conf });
  }
  const byName = new Map();
  for(const r of matched){
    const prev = byName.get(r.name);
    if(!prev || r.confidence > prev.confidence) byName.set(r.name, r);
  }
  const rows = [...byName.values()].sort((a,b)=>a.y0-b.y0)
    .map(r=>({...r, barLeft: r.labelRight + Math.max(4, full.width*0.004)}));

  if(!rows.length){
    return { readings:[], system, planet, stamp, warnings:[],
             error:'No resource names recognised — crop tighter to the resource panel and retry.' };
  }

  const ctx = full.getContext('2d');
  // One getImageData for the whole scan, shared by both passes.
  const lum = makeLum(ctx.getImageData(0, 0, full.width, full.height));
  const trackRight = detectTrackRight(lum, full.width, full.height, rows);
  const readings = measureBars(lum, full.width, full.height, rows, {trackRight});

  const lowConf = rows.filter(r=>r.confidence < 0.8).map(r=>r.name);
  const allMax = readings.length > 1 && readings.every(r=>r.pct === 100);
  return {
    readings, system, planet, stamp,
    cropWidth: full.width, cropHeight: full.height,
    warnings: [
      lowConf.length ? `low-confidence name match: ${lowConf.join(', ')}` : null,
      allMax ? 'every bar read 100% — bar track may not have been detected; verify manually' : null,
      trackRight==null ? 'bar track edge not detected; scale inferred from the widest bar' : null
    ].filter(Boolean)
  };
}

/* ---------- batch ---------- */

const BATCH_LIMIT = 20;

async function expandBatchFiles(fileList){
  const files=[];
  for(const f of Array.from(fileList||[])){
    if(/\.zip$/i.test(f.name) || f.type==='application/zip'){
      files.push(...await readZipImages(f));
    } else if(/^image\//.test(f.type||'') || /\.(png|jpg|jpeg|webp|bmp)$/i.test(f.name)){
      files.push(f);
    }
  }
  files.sort((a,b)=>(a.lastModified||0)-(b.lastModified||0)); // capture order
  return files;
}

async function analyzeBatch(fileList, onProgress){
  const files = await expandBatchFiles(fileList);
  if(!files.length) throw new Error('no images found in that selection');
  const capped = files.slice(0, BATCH_LIMIT);
  const results=[];
  for(let i=0;i<capped.length;i++){
    if(onProgress) onProgress(i, capped.length, capped[i].name);
    try {
      const r = await analyzePlanetScreenshot(capped[i]);
      results.push({ file:capped[i].name, ok:!r.error, ...r });
    } catch(e){
      results.push({ file:capped[i].name, ok:false, error:e.message, readings:[], warnings:[] });
    }
  }
  await releaseOcrWorker();   // one worker per batch, not per image
  return { results, skipped: Math.max(0, files.length-capped.length), total: files.length };
}

/* ---------- batch UI wiring ---------- */
(function initBatchImport(){
  const input  = document.getElementById('batchInput');
  const status = document.getElementById('batchStatus');
  const out    = document.getElementById('batchResults');
  const clear  = document.getElementById('batchClearBtn');
  if(!input || !status || !out) return;

  clear && clear.addEventListener('click', ()=>{
    out.innerHTML=''; status.textContent=''; status.className='batch-status'; input.value='';
  });

  input.addEventListener('change', async (e)=>{
    const files = e.target.files;
    if(!files || !files.length) return;
    out.innerHTML='';
    status.className='batch-status busy';
    status.textContent='Expanding selection…';
    try {
      const batch = await analyzeBatch(files, (i,total,name)=>{
        status.textContent = `Reading ${i+1} of ${total}: ${name}`;
      });

      // Group by detected system so planets land under the right card.
      const bySystem = new Map();
      for(const r of batch.results){
        const sys = (r.system && r.system.value) || 'Unknown system';
        if(!bySystem.has(sys)) bySystem.set(sys, []);
        bySystem.get(sys).push(r);
      }

      /* v9 change: delivery goes through the bridge instead of the v8 planet
       * DOM (addSystem/addPlanet no longer exist). OCR output is unchanged:
       * densities are integer percent; the v9 side converts % -> raw w. */
      let created = 0, failed = 0;
      const deliver = [];
      for(const [sysName, list] of bySystem){
        for(const r of list){
          if(!r.ok || !r.readings.length){ failed++; continue; }
          const type = matchPlanetType(r.readings.map(x=>x.name));
          const densities = {};
          r.readings.forEach(x=>{ if(x.pct!=null) densities[x.name]=x.pct; });
          const pname = (r.planet && r.planet.value) || r.file.replace(/\.[a-z]+$/i,'');
          deliver.push({ system: sysName, name: pname, type, densities, capturedAt: r.stamp ? r.stamp.iso : null });
          created++;
        }
      }
      if (window.__v9 && typeof window.__v9.deliverBatch === 'function') {
        const res = window.__v9.deliverBatch(deliver);
        if (res && typeof res.rejected === 'number' && res.rejected > 0) {
          failed += res.rejected; created -= res.rejected;
        }
      } else {
        failed += created; created = 0;
      }
      // Reveal the planets section — it starts collapsed, so imported planets
      // would otherwise land invisibly behind a closed header.
      if(typeof setCollapsed === 'function')
        setCollapsed(document.getElementById('sec1'), false);

      out.innerHTML = batch.results.map(r=>{
        const bad = !r.ok || !r.readings.length;
        // Every interpolated value below is untrusted: filenames come from the
        // uploaded archive, system/planet names come from OCR of an arbitrary
        // image. All of it is escaped.
        const dens = (r.readings||[]).map(x=>`${escapeHtml(x.name)} ${x.pct}%`).join(', ');
        return `<div class="batch-item${bad?' bad':''}">
          <div>
            <div class="bi-name">${escapeHtml(r.file)}</div>
            <div class="bi-meta">${
              bad ? '' :
              `${escapeHtml((r.system&&r.system.value)||'system ?')} &middot; ${escapeHtml((r.planet&&r.planet.value)||'planet ?')}<br>${dens}`
            }</div>
            ${r.error?`<div class="bi-err">${escapeHtml(r.error)}</div>`:''}
            ${(r.warnings||[]).map(w=>`<div class="bi-warn">&#9888; ${escapeHtml(w)}</div>`).join('')}
          </div>
          <div class="bi-time">${escapeHtml(r.stamp?r.stamp.label:'')}</div>
        </div>`;
      }).join('');

      status.className = failed ? 'batch-status err' : 'batch-status ok';
      status.textContent =
        `${created} planet(s) imported, ${failed} failed` +
        (batch.skipped ? ` — ${batch.skipped} beyond the ${BATCH_LIMIT}-image limit were skipped` : '') +
        `. Check every density against the screenshot before calculating.`;
      if(typeof refreshProgressiveUI==='function') refreshProgressiveUI();
    } catch(err){
      status.className='batch-status err';
      status.textContent = 'Batch import failed: '+err.message;
    }
  });
})();

/* Find an existing system card by name, or create one. Keeps batch imports
 * from scattering planets across duplicate cards. */
/* findOrCreateSystemCard removed in v9 — delivery goes through window.__v9.deliverBatch. */
