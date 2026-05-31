'use strict';

// ---------- Diskrete Farbklassen (wie in amtlichen Statistikkarten) ----------
const SEQ6 = ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'];
const DIV6 = ['#b2182b', '#ef8a62', '#fddbc7', '#d1e5f0', '#67a9cf', '#2166ac']; // Nein nach Ja
const NA_COLOR = '#e9edf2';
const DIVERGING = new Set(['ergebnis', 'ja_pct', 'nein_pct']);
const JA_BREAKS = [35, 45, 50, 55, 65];            // Klassengrenzen Ja-Anteil in %
const JA_LABELS = ['unter 35', '35 bis 45', '45 bis 50', '50 bis 55', '55 bis 65', '65 und mehr'];
const ALIGN_BREAKS = [-1.5, -0.5, 0, 0.5, 1.5];    // z-Wert mal Vorzeichen von r

// ---------- Zahlenformat ----------
const nf = (d) => (v) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtVal(v, fmt) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'k. A.';
  switch (fmt) {
    case 'pct': return nf(1)(v) + ' %';
    case 'eur': return nf(0)(v) + ' Euro';
    case 'eurm2': return nf(0)(v) + ' Euro/m²';
    case 'dec1': return nf(1)(v);
    case 'per1000': return nf(0)(v);
    case 'result': return v;
    default: return nf(0)(v);
  }
}
function classify(v, breaks) { let i = 0; while (i < breaks.length && v >= breaks[i]) i++; return i; }
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// ---------- State ----------
let META, GEO, FEATURES, geoLayer, metricKey = 'ergebnis', scatterKey = null;
let CORR = [], BBOX = null, PATHS = null;
let dualInited = false, dualLeft, dualRight, dualLayers = {}, dualMetric = null, syncLock = false;
let PARTY_METRICS = [];
const MINI_W = 216, MINI_H = 150, MINI_PAD = 6;
const byName = {};
const seqCache = {};
let activeName = null;

const $ = (id) => document.getElementById(id);

// ---------- Laden ----------
Promise.all([
  fetch('data/metadata.json').then((r) => r.json()),
  fetch('data/stadtteile.geojson').then((r) => r.json()),
]).then(([meta, geo]) => {
  META = meta; GEO = geo; FEATURES = geo.features;
  FEATURES.forEach((f) => { byName[f.properties.name] = f; });
  META.metricList = [{ key: 'ergebnis', label: 'Wahlergebnis (Ja/Nein)', unit: '%', format: 'result', group: 'Referendum' }, ...META.metrics];
  META.metricByKey = {}; META.metricList.forEach((m) => { META.metricByKey[m.key] = m; });
  if (META.has_buergerschaft) {
    META.buergerschaft.parties.forEach((pt) => { partyColor[pt.key] = pt.color; partyLabel[pt.key] = pt.label; });
    PARTY_METRICS = META.buergerschaft.parties.filter((pt) => pt.citywide >= 0.5)
      .map((pt) => ({ key: 'bw_' + pt.key, label: pt.label + ' (Bürgerschaft 2025)', format: 'pct', group: 'Bürgerschaftswahl 2025', color: pt.color }));
    PARTY_METRICS.forEach((m) => { META.metricByKey[m.key] = m; });
  }
  computeBbox();
  computeCorrelations();
  initCityStats();
  initMap(geo);
  initMetricSelect();
  initScatterSelect();
  initSearch();
  initModeSwitch();
  $('sources').innerHTML = `Quellen: ${META.source_referendum}.<br>${META.has_profile_data ? META.source_profile + '.' : 'Profildaten in Arbeit.'}`;
  update();
});

// ---------- Stadt-Kennzahlen ----------
function unitPoints() {
  const seen = new Set(), pts = [];
  FEATURES.forEach((f) => { const p = f.properties, u = p.referendum_unit || p.name; if (seen.has(u)) return; seen.add(u); pts.push(p); });
  return pts;
}
function initCityStats() {
  let ja = 0, nein = 0, ab = 0, be = 0;
  unitPoints().forEach((p) => { ja += p.ja; nein += p.nein; ab += p.abstimmende; be += p.berechtigte; });
  const jaP = (ja / (ja + nein) * 100), betP = (ab / be * 100);
  $('cityStats').innerHTML = `
    <div class="stat"><div class="stat-val ja">${nf(1)(jaP)} %</div><div class="stat-lbl">Ja gesamt</div></div>
    <div class="stat"><div class="stat-val nein">${nf(1)(100 - jaP)} %</div><div class="stat-lbl">Nein gesamt</div></div>
    <div class="stat"><div class="stat-val">${nf(1)(betP)} %</div><div class="stat-lbl">Beteiligung</div></div>`;
}

// ---------- Korrelationen ----------
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
function statOf(key) {
  const vs = FEATURES.map((f) => f.properties[key]).filter((v) => typeof v === 'number' && !Number.isNaN(v));
  const m = vs.reduce((a, b) => a + b, 0) / vs.length;
  return { mean: m, std: Math.sqrt(vs.reduce((a, b) => a + (b - m) ** 2, 0) / vs.length) || 1 };
}
function computeCorrelations() {
  const pts = unitPoints();
  CORR = META.metrics.filter((m) => m.group !== 'Referendum').map((m) => {
    const xs = [], ys = [];
    pts.forEach((p) => { const x = p[m.key], y = p.ja_pct; if (typeof x === 'number' && typeof y === 'number') { xs.push(x); ys.push(y); } });
    const r = pearson(xs, ys);
    return { ...m, r, n: xs.length, absr: Math.abs(r), sign: r >= 0 ? 1 : -1, stat: statOf(m.key) };
  }).filter((m) => !Number.isNaN(m.r)).sort((a, b) => b.absr - a.absr);
}
function corrOf(key) { return CORR.find((c) => c.key === key); }
function corrForKey(key) {
  const xs = [], ys = [];
  unitPoints().forEach((p) => { const x = p[key], y = p.ja_pct; if (typeof x === 'number' && typeof y === 'number') { xs.push(x); ys.push(y); } });
  const r = pearson(xs, ys);
  return { r, n: xs.length, absr: Math.abs(r) };
}
function strengthWord(a) { return a > 0.7 ? 'sehr starker' : a > 0.5 ? 'starker' : a > 0.3 ? 'moderater' : a > 0.15 ? 'schwacher' : 'kaum ein'; }

// ---------- Farb- und Klassenlogik ----------
function seqBreaks(key) {
  if (seqCache[key]) return seqCache[key];
  const vs = FEATURES.map((f) => f.properties[key]).filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b);
  const br = []; for (let i = 1; i < 6; i++) br.push(vs[Math.floor(i / 6 * vs.length)]);
  return (seqCache[key] = br);
}
function divergingJa(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return NA_COLOR;
  return DIV6[classify(v, JA_BREAKS)];
}
function seqColor(key, v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return NA_COLOR;
  return SEQ6[classify(v, seqBreaks(key))];
}
function colorFor(props) {
  if (DIVERGING.has(metricKey)) {
    const jv = metricKey === 'nein_pct' ? 100 - props.nein_pct : props.ja_pct;
    return divergingJa(jv);
  }
  return seqColor(metricKey, props[metricKey]);
}
function styleFor(feat) { return { fillColor: colorFor(feat.properties), weight: 1, color: '#ffffff', fillOpacity: 0.84 }; }

// ---------- Hauptkarte (Explorer) ----------
function tileLayer() {
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  });
}
function initMap(geo) {
  const map = L.map('map', { zoomControl: true }).setView([53.55, 10.0], 11);
  tileLayer().addTo(map);
  geoLayer = L.geoJSON(geo, {
    style: styleFor,
    onEachFeature: (feat, layer) => {
      layer.on({
        mouseover: () => { layer.setStyle({ weight: 2.4, color: '#1b232c' }); showInfo(feat.properties); },
        mouseout: () => { geoLayer.resetStyle(layer); if (activeName) showInfo(byName[activeName].properties); },
        click: () => { activeName = feat.properties.name; showInfo(feat.properties); map.fitBounds(layer.getBounds(), { maxZoom: 13, padding: [40, 40] }); },
      });
    },
  }).addTo(map);
  window._map = map;
}

// ---------- Metrik-Auswahl ----------
function groupedOptions(list) {
  const groups = {};
  list.forEach((m) => { (groups[m.group] = groups[m.group] || []).push(m); });
  return Object.entries(groups).map(([g, items]) =>
    `<optgroup label="${g}">${items.map((m) => `<option value="${m.key}">${m.label}</option>`).join('')}</optgroup>`).join('');
}
function initMetricSelect() {
  $('metricSelect').innerHTML = groupedOptions(META.metricList);
  $('metricSelect').value = metricKey;
  $('metricSelect').addEventListener('change', (e) => { metricKey = e.target.value; update(); });
}

// ---------- Legende (diskrete Klassen) ----------
function renderLegendInto(el, key, tints) {
  tints = tints || SEQ6;
  if (DIVERGING.has(key)) {
    el.innerHTML = '<div class="legend-steps">' +
      DIV6.map((c, i) => `<div class="legend-step"><span class="legend-swatch" style="background:${c}"></span><span>${JA_LABELS[i]} %</span></div>`).join('') +
      '</div>';
    return;
  }
  const br = seqBreaks(key), m = META.metricByKey[key], steps = [];
  for (let i = 0; i < tints.length; i++) {
    const lo = i === 0 ? null : br[i - 1], hi = i === tints.length - 1 ? null : br[i];
    const lbl = lo === null ? 'unter ' + fmtVal(hi, m.format)
      : hi === null ? fmtVal(lo, m.format) + ' und mehr'
        : fmtVal(lo, m.format) + ' bis ' + fmtVal(hi, m.format);
    steps.push(`<div class="legend-step"><span class="legend-swatch" style="background:${tints[i]}"></span><span>${lbl}</span></div>`);
  }
  steps.push(`<div class="legend-step"><span class="legend-swatch" style="background:${NA_COLOR}"></span><span>keine Angabe</span></div>`);
  el.innerHTML = '<div class="legend-steps">' + steps.join('') + '</div>';
}

// ---------- Info-Karte ----------
function showInfo(p) {
  const m = META.metricByKey[metricKey];
  const curKey = metricKey === 'ergebnis' ? null : metricKey;
  const extras = ['einkommen_je_stpfl', 'arbeitslose_pct', 'auslaender_pct', 'sozialwhg_pct'].filter((k) => META.metricByKey[k]);
  const rows = extras.map((k) => {
    const d = META.metricByKey[k], cls = k === curKey ? ' info-current' : '';
    return `<div class="k${cls}">${d.label}</div><div class="v${cls}">${fmtVal(p[k], d.format)}</div>`;
  }).join('');
  const curRow = curKey && !extras.includes(curKey)
    ? `<div class="k info-current">${m.label}</div><div class="v info-current">${fmtVal(p[curKey], m.format)}</div>` : '';
  const note = p.referendum_unit && p.referendum_unit !== p.name
    ? `<div class="info-bezirk">Wahlergebnis erfasst als: ${p.referendum_unit}</div>` : '';
  $('infoCard').innerHTML = `
    <div class="info-name">${p.name}</div>
    <div class="info-bezirk">Bezirk ${p.bezirk || 'k. A.'}</div>
    ${note}
    <div class="info-result">
      <span class="info-badge ${p.ergebnis === 'Ja' ? 'ja' : 'nein'}">${p.ergebnis}</span>
      <span style="font-size:12px;color:var(--muted)">setzt sich durch</span>
    </div>
    <div class="bars">
      ${bar('Ja', p.ja_pct, 'ja')}${bar('Nein', p.nein_pct, 'nein')}${bar('Beteiligung', p.beteiligung_pct, 'bet')}
    </div>
    <div class="info-grid">${curRow}${rows}</div>`;
}
function bar(label, val, cls) {
  return `<div class="bar-row"><span class="bar-key">${label}</span>
    <span class="bar-track"><span class="bar-fill ${cls}" style="width:${Math.min(100, val)}%"></span></span>
    <span class="bar-val">${nf(1)(val)} %</span></div>`;
}

// ---------- Scatter (Explorer) ----------
function initScatterSelect() {
  const profileMetrics = META.metrics.filter((m) => m.group !== 'Referendum');
  const sel = $('scatterSelect');
  if (!META.has_profile_data || profileMetrics.length === 0) {
    sel.innerHTML = '<option>keine Profildaten</option>'; sel.disabled = true;
    $('corrReadout').innerHTML = '<span class="hint">Die Stadtteil-Merkmale werden noch erfasst.</span>';
    return;
  }
  sel.innerHTML = groupedOptions(profileMetrics);
  scatterKey = profileMetrics.some((m) => m.key === 'einkommen_je_stpfl') ? 'einkommen_je_stpfl' : profileMetrics[0].key;
  sel.value = scatterKey;
  sel.addEventListener('change', (e) => { scatterKey = e.target.value; renderScatter(); });
}
function renderScatter() {
  if (!scatterKey) return;
  const svg = $('scatter'), W = 320, H = 240, mL = 38, mR = 10, mT = 12, mB = 30, m = META.metricByKey[scatterKey];
  const seen = new Set(), pts = [];
  FEATURES.forEach((f) => {
    const p = f.properties, u = p.referendum_unit || p.name;
    if (seen.has(u)) return; seen.add(u);
    const x = p[scatterKey], y = p.ja_pct;
    if (typeof x === 'number' && typeof y === 'number') pts.push({ x, y, name: p.name });
  });
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const xmn = Math.min(...xs), xmx = Math.max(...xs), ymn = Math.min(...ys), ymx = Math.max(...ys);
  const xpad = (xmx - xmn) * 0.05 || 1, ypad = (ymx - ymn) * 0.08 || 1;
  const x0 = xmn - xpad, x1 = xmx + xpad, y0 = ymn - ypad, y1 = ymx + ypad;
  const sx = (v) => mL + (v - x0) / (x1 - x0) * (W - mL - mR);
  const sy = (v) => H - mB - (v - y0) / (y1 - y0) * (H - mT - mB);
  const r = pearson(xs, ys);
  const n = xs.length, mxv = xs.reduce((a, b) => a + b) / n, myv = ys.reduce((a, b) => a + b) / n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mxv) ** 2; sxy += (xs[i] - mxv) * (ys[i] - myv); }
  const slope = sxy / sxx, intc = myv - slope * mxv;

  let s = '';
  if (y0 < 50 && y1 > 50) { const yy = sy(50); s += `<line class="scatter-grid" x1="${mL}" y1="${yy}" x2="${W - mR}" y2="${yy}"/><text class="scatter-lbl" x="${W - mR}" y="${yy - 2}" text-anchor="end">50 %</text>`; }
  s += `<line class="scatter-axis" x1="${mL}" y1="${mT}" x2="${mL}" y2="${H - mB}"/>`;
  s += `<line class="scatter-axis" x1="${mL}" y1="${H - mB}" x2="${W - mR}" y2="${H - mB}"/>`;
  s += `<text class="scatter-lbl" x="${mL}" y="${H - mB + 11}">${fmtVal(x0, m.format)}</text>`;
  s += `<text class="scatter-lbl" x="${W - mR}" y="${H - mB + 11}" text-anchor="end">${fmtVal(x1, m.format)}</text>`;
  s += `<text class="scatter-lbl" x="${(mL + W - mR) / 2}" y="${H - 4}" text-anchor="middle">${m.label}</text>`;
  s += `<text class="scatter-lbl" x="4" y="${mT + 4}">${nf(0)(y1)} %</text>`;
  s += `<text class="scatter-lbl" x="4" y="${H - mB}">${nf(0)(y0)} %</text>`;
  s += `<text class="scatter-lbl" transform="translate(10,${(mT + H - mB) / 2}) rotate(-90)" text-anchor="middle">Ja-Anteil</text>`;
  s += `<line class="scatter-reg" x1="${sx(x0)}" y1="${sy(slope * x0 + intc)}" x2="${sx(x1)}" y2="${sy(slope * x1 + intc)}"/>`;
  pts.forEach((p) => {
    s += `<circle class="scatter-pt" data-name="${p.name}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.4"><title>${p.name}: ${fmtVal(p.x, m.format)}, Ja ${nf(1)(p.y)} %</title></circle>`;
  });
  svg.innerHTML = s;
  svg.querySelectorAll('.scatter-pt').forEach((c) => {
    c.addEventListener('mouseenter', () => { const f = byName[c.dataset.name]; if (f) showInfo(f.properties); });
    c.addEventListener('click', () => { activeName = c.dataset.name; showInfo(byName[c.dataset.name].properties); });
  });
  const dir = r > 0 ? 'höher' : 'niedriger', color = r > 0 ? 'var(--ja)' : 'var(--nein)';
  const tagBg = Math.abs(r) > 0.5 ? 'rgba(33,102,172,.12)' : 'rgba(104,117,133,.12)';
  $('corrReadout').innerHTML = `
    <div class="corr-r" style="color:${color}">r = ${r.toFixed(2)}</div>
    <div style="margin:4px 0 8px"><span class="corr-tag" style="background:${tagBg}">${strengthWord(Math.abs(r))} Zusammenhang</span></div>
    <div>Je höher <strong>${m.label.toLowerCase()}</strong>, desto <strong>${dir}</strong> der Ja-Anteil.
    Erklärte Varianz R-Quadrat ${(r * r * 100).toFixed(0)} Prozent, ${n} Stadtteile.</div>`;
}

// ---------- Mini-Karten-Projektion (Galerie) ----------
function computeBbox() {
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
  const scan = (c) => {
    if (typeof c[0] === 'number') { if (c[0] < mnX) mnX = c[0]; if (c[0] > mxX) mxX = c[0]; if (c[1] < mnY) mnY = c[1]; if (c[1] > mxY) mxY = c[1]; }
    else c.forEach(scan);
  };
  FEATURES.forEach((f) => scan(f.geometry.coordinates));
  BBOX = { mnX, mxX, mnY, mxY };
}
function outerRings(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((poly) => poly[0]);
  return [];
}
function decimate(ring) {
  const n = ring.length; if (n <= 26) return ring;
  const step = Math.ceil(n / 26), out = [];
  for (let i = 0; i < n; i += step) out.push(ring[i]); out.push(ring[n - 1]); return out;
}
function buildPaths() {
  const kx = Math.cos(53.56 * Math.PI / 180);
  const spanX = (BBOX.mxX - BBOX.mnX) * kx, spanY = (BBOX.mxY - BBOX.mnY);
  const s = Math.min((MINI_W - 2 * MINI_PAD) / spanX, (MINI_H - 2 * MINI_PAD) / spanY);
  const offX = (MINI_W - spanX * s) / 2, offY = (MINI_H - spanY * s) / 2;
  const proj = (lon, lat) => [offX + (lon - BBOX.mnX) * kx * s, offY + (BBOX.mxY - lat) * s];
  PATHS = FEATURES.map((f) => {
    let d = '';
    for (const ring of outerRings(f.geometry)) {
      const r = decimate(ring);
      d += 'M' + r.map((p) => { const xy = proj(p[0], p[1]); return xy[0].toFixed(1) + ',' + xy[1].toFixed(1); }).join('L') + 'Z';
    }
    return d;
  });
}
function alignColor(value, stat, sign) {
  if (typeof value !== 'number' || Number.isNaN(value)) return NA_COLOR;
  return DIV6[classify((value - stat.mean) / stat.std * sign, ALIGN_BREAKS)];
}
function miniSvg(fillFn) {
  let paths = '';
  FEATURES.forEach((f, i) => { paths += `<path d="${PATHS[i]}" fill="${fillFn(f.properties)}" stroke="#fff" stroke-width="0.4"/>`; });
  return `<svg class="gcard-map" viewBox="0 0 ${MINI_W} ${MINI_H}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}
function strengthTag(a) {
  if (a > 0.7) return { txt: 'sehr stark', bg: 'rgba(33,102,172,.16)', color: '#16406e' };
  if (a > 0.5) return { txt: 'stark', bg: 'rgba(33,102,172,.10)', color: '#2166ac' };
  if (a > 0.3) return { txt: 'moderat', bg: 'rgba(104,117,133,.13)', color: '#5a6472' };
  return { txt: 'schwach', bg: 'rgba(104,117,133,.10)', color: '#8a94a1' };
}
function renderGallery() {
  if (!PATHS) buildPaths();
  const strongOnly = $('strongOnly').checked;
  const anchor = `<div class="gcard anchor">${miniSvg((p) => divergingJa(p.ja_pct))}
    <div class="gcard-foot"><div class="gcard-label">Referendum, Ja-Anteil</div>
      <div class="gcard-meta"><span class="gcard-r" style="color:var(--accent)">Referenz</span>
      <span class="gcard-r2">so stimmte Hamburg ab</span></div></div></div>`;
  const cards = CORR.filter((m) => !strongOnly || m.absr >= 0.5).map((m) => {
    const t = strengthTag(m.absr), col = m.r > 0 ? 'var(--ja)' : 'var(--nein)';
    return `<div class="gcard" data-key="${m.key}">${miniSvg((p) => alignColor(p[m.key], m.stat, m.sign))}
      <div class="gcard-foot"><div class="gcard-label">${m.label}</div>
        <div class="gcard-meta"><span class="gcard-r" style="color:${col}">r = ${m.r.toFixed(2)}</span>
          <span class="gcard-strength" style="background:${t.bg};color:${t.color}">${t.txt}</span></div>
        <div class="gcard-r2">R-Quadrat ${(m.r * m.r * 100).toFixed(0)} Prozent, ${m.n} Einheiten</div></div></div>`;
  }).join('');
  $('galleryGrid').innerHTML = anchor + cards;
  $('galleryGrid').querySelectorAll('.gcard[data-key]').forEach((el) => el.addEventListener('click', () => openDual(el.dataset.key)));
}

// ---------- Doppelkarte ----------
function makeMap(id) {
  const m = L.map(id, { zoomControl: true }).setView([53.55, 10.0], 10);
  tileLayer().addTo(m);
  return m;
}
function linkMaps(a, b) {
  const handler = (src, dst) => () => { if (syncLock) return; syncLock = true; dst.setView(src.getCenter(), src.getZoom(), { animate: false }); syncLock = false; };
  a.on('move', handler(a, b)); b.on('move', handler(b, a));
}
function dualHover(p) {
  const m = META.metricByKey[dualMetric];
  $('dualReadout').innerHTML = `<strong>${p.name}</strong><span>Ja ${nf(1)(p.ja_pct)} %</span><span>${m.label}: ${fmtVal(p[dualMetric], m.format)}</span>`;
}
function rightTints() { const m = META.metricByKey[dualMetric]; return m && m.color ? partyTints(m.color) : SEQ6; }
function dualRightColor(p) {
  const v = p[dualMetric];
  if (typeof v !== 'number' || Number.isNaN(v)) return NA_COLOR;
  return rightTints()[classify(v, seqBreaks(dualMetric))];
}
function dualRightStyle(f) { return { fillColor: dualRightColor(f.properties), weight: 1, color: '#fff', fillOpacity: 0.85 }; }
function dualSummary() {
  const c = corrForKey(dualMetric), m = META.metricByKey[dualMetric];
  const col = c.r > 0 ? 'var(--ja)' : 'var(--nein)';
  $('dualReadout').innerHTML = `<span>${m.label}</span><strong style="color:${col}">r = ${c.r.toFixed(2)}</strong><span>${strengthWord(c.absr)} Zusammenhang mit dem Ja-Anteil</span>`;
}
function initDual() {
  if (dualInited) return; dualInited = true;
  dualLeft = makeMap('mapLeft'); dualRight = makeMap('mapRight');
  const hover = (feat) => ({
    mouseover: (e) => { e.target.setStyle({ weight: 2.2, color: '#1b232c' }); dualHover(feat.properties); },
    mouseout: (e) => { e.target.setStyle({ weight: 1, color: '#fff' }); dualSummary(); },
  });
  const tipOpts = { sticky: true, className: 'dual-tip', direction: 'top', opacity: 1 };
  dualLayers.left = L.geoJSON(GEO, {
    style: (f) => ({ fillColor: divergingJa(f.properties.ja_pct), weight: 1, color: '#fff', fillOpacity: 0.85 }),
    onEachFeature: (feat, layer) => {
      layer.on(hover(feat));
      const p = feat.properties;
      layer.bindTooltip(`${p.name}<span class="tip-sub">Ja ${nf(1)(p.ja_pct)} %, Nein ${nf(1)(p.nein_pct)} %</span>`, tipOpts);
    },
  }).addTo(dualLeft);
  dualLayers.right = L.geoJSON(GEO, {
    style: dualRightStyle,
    onEachFeature: (feat, layer) => { layer.on(hover(feat)); layer.bindTooltip('', tipOpts); },
  }).addTo(dualRight);
  linkMaps(dualLeft, dualRight);
  const dualMetricList = META.metrics.filter((m) => m.group !== 'Referendum').concat(PARTY_METRICS);
  $('dualMetric').innerHTML = groupedOptions(dualMetricList);
  $('dualMetric').addEventListener('change', (e) => { dualMetric = e.target.value; refreshDualRight(); });
  renderLegendInto($('legendLeft'), 'ergebnis');
}
function refreshDualRight() {
  $('dualMetric').value = dualMetric;
  const m = META.metricByKey[dualMetric];
  dualLayers.right.setStyle(dualRightStyle);
  dualLayers.right.eachLayer((layer) => {
    const p = layer.feature.properties;
    layer.setTooltipContent(`${p.name}<span class="tip-sub">${m.label}: ${fmtVal(p[dualMetric], m.format)}</span>`);
  });
  renderLegendInto($('legendRight'), dualMetric, rightTints());
  dualSummary();
}
function openDual(key) {
  dualMetric = key;
  setMode('dual');
}

// ---------- Bürgerschaftswahl 2025 ----------
let bwInited = false, bwMap, bwLayer, bwMetric = 'winner';
const partyColor = {}, partyLabel = {};
function mixWhite(hex, t) { const c = hexToRgb(hex); return `rgb(${lerp(255, c[0], t)},${lerp(255, c[1], t)},${lerp(255, c[2], t)})`; }
function partyTints(hex) { return [0.12, 0.26, 0.42, 0.6, 0.8, 1].map((t) => mixWhite(hex, t)); }
function bwColor(p) {
  if (bwMetric === 'winner') return partyColor[p.bw_winner_key] || NA_COLOR;
  const key = 'bw_' + bwMetric, v = p[key];
  if (typeof v !== 'number' || Number.isNaN(v)) return NA_COLOR;
  return partyTints(partyColor[bwMetric])[classify(v, seqBreaks(key))];
}
function bwStyle(feat) { return { fillColor: bwColor(feat.properties), weight: 1, color: '#ffffff', fillOpacity: 0.84 }; }
function bwSharesSorted(p) {
  return META.buergerschaft.parties.map((pt) => ({ ...pt, share: p['bw_' + pt.key] }))
    .filter((pt) => typeof pt.share === 'number').sort((a, b) => b.share - a.share);
}
function showBwInfo(p) {
  const rows = bwSharesSorted(p).filter((pt) => pt.share >= 1).slice(0, 7).map((pt) =>
    `<div class="bw-row"><span class="bw-pname"><span class="bw-dot" style="background:${pt.color}"></span>${pt.label}</span>
      <span class="bw-track"><span class="bw-fill" style="width:${Math.min(100, pt.share * 2)}%;background:${pt.color}"></span></span>
      <span class="bw-val">${nf(1)(pt.share)} %</span></div>`).join('');
  const note = p.bw_unit && p.bw_unit !== p.name ? `<div class="info-bezirk">Ergebnis erfasst als: ${p.bw_unit}</div>` : '';
  $('bwInfo').innerHTML = `
    <div class="info-name">${p.name}</div>
    <div class="info-bezirk">Bezirk ${p.bezirk || 'k. A.'}</div>
    ${note}
    <div class="info-result"><span class="bw-winner" style="background:${partyColor[p.bw_winner_key]}">${p.bw_winner} ${nf(1)(p.bw_winner_pct)} %</span>
      <span style="font-size:12px;color:var(--muted)">stärkste Kraft</span></div>
    <div class="bw-shares">${rows}</div>
    <div class="info-grid" style="margin-top:10px"><div class="k">Wahlbeteiligung</div><div class="v">${nf(1)(p.bw_beteiligung_pct)} %</div></div>`;
}
function renderBwLegend() {
  const el = $('bwLegend');
  if (bwMetric === 'winner') {
    const present = {};
    const seen = new Set();
    FEATURES.forEach((f) => { const p = f.properties, u = p.bw_unit || p.name; if (seen.has(u)) return; seen.add(u); present[p.bw_winner_key] = (present[p.bw_winner_key] || 0) + 1; });
    const order = META.buergerschaft.parties.filter((pt) => present[pt.key]);
    el.innerHTML = '<div class="legend-steps">' + order.map((pt) =>
      `<div class="legend-cat"><span class="legend-swatch" style="background:${pt.color}"></span>${pt.label} <span style="color:var(--muted)">(${present[pt.key]})</span></div>`).join('') + '</div>';
    return;
  }
  const key = 'bw_' + bwMetric, br = seqBreaks(key), tints = partyTints(partyColor[bwMetric]), steps = [];
  for (let i = 0; i < tints.length; i++) {
    const lo = i === 0 ? null : br[i - 1], hi = i === tints.length - 1 ? null : br[i];
    const lbl = lo === null ? 'unter ' + nf(1)(hi) + ' %' : hi === null ? nf(1)(lo) + ' % und mehr' : nf(1)(lo) + ' bis ' + nf(1)(hi) + ' %';
    steps.push(`<div class="legend-step"><span class="legend-swatch" style="background:${tints[i]}"></span><span>${lbl}</span></div>`);
  }
  el.innerHTML = '<div class="legend-steps">' + steps.join('') + '</div>';
}
function initBw() {
  if (bwInited) return; bwInited = true;
  META.buergerschaft.parties.forEach((pt) => { partyColor[pt.key] = pt.color; partyLabel[pt.key] = pt.label; });
  $('bwSelect').innerHTML = '<option value="winner">Stärkste Kraft (Gewinnerpartei)</option>' +
    '<optgroup label="Stimmenanteil je Partei">' +
    META.buergerschaft.parties.filter((pt) => pt.citywide >= 0.5).map((pt) => `<option value="${pt.key}">${pt.label}</option>`).join('') + '</optgroup>';
  $('bwSelect').addEventListener('change', (e) => { bwMetric = e.target.value; bwLayer.setStyle(bwStyle); renderBwLegend(); });
  $('bwCitywide').innerHTML = META.buergerschaft.parties.filter((pt) => pt.citywide >= 0.5).sort((a, b) => b.citywide - a.citywide).map((pt) =>
    `<div class="bw-row"><span class="bw-pname"><span class="bw-dot" style="background:${pt.color}"></span>${pt.label}</span>
      <span class="bw-track"><span class="bw-fill" style="width:${Math.min(100, pt.citywide * 2)}%;background:${pt.color}"></span></span>
      <span class="bw-val">${nf(1)(pt.citywide)} %</span></div>`).join('');
  $('bwSources').innerHTML = `Quelle: ${META.source_buergerschaft}.`;
  bwMap = makeMap('bwMap'); bwMap.setView([53.55, 10.0], 11);
  bwLayer = L.geoJSON(GEO, {
    style: bwStyle,
    onEachFeature: (feat, layer) => layer.on({
      mouseover: () => { layer.setStyle({ weight: 2.4, color: '#1b232c' }); showBwInfo(feat.properties); },
      mouseout: () => bwLayer.resetStyle(layer),
      click: () => { showBwInfo(feat.properties); bwMap.fitBounds(layer.getBounds(), { maxZoom: 13, padding: [40, 40] }); },
    }),
  }).addTo(bwMap);
  renderBwLegend();
}

// ---------- Mode-Switch ----------
function setMode(mode) {
  $('explorerView').classList.toggle('hidden', mode !== 'explorer');
  $('galleryView').classList.toggle('hidden', mode !== 'corr');
  $('dualView').classList.toggle('hidden', mode !== 'dual');
  $('bwView').classList.toggle('hidden', mode !== 'bw');
  $('modeSwitch').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'corr') renderGallery();
  else if (mode === 'dual') {
    if (!dualMetric) dualMetric = corrOf('einkommen_je_stpfl') ? 'einkommen_je_stpfl' : CORR[0].key;
    initDual();
    refreshDualRight();
    setTimeout(() => { dualLeft.invalidateSize(); dualRight.invalidateSize(); }, 60);
  } else if (mode === 'bw') { initBw(); setTimeout(() => bwMap.invalidateSize(), 60); }
  else if (window._map) setTimeout(() => window._map.invalidateSize(), 60);
}
function initModeSwitch() {
  $('modeSwitch').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('strongOnly').addEventListener('change', renderGallery);
  if (!META.has_profile_data) {
    $('modeSwitch').querySelector('[data-mode="corr"]').disabled = true;
    $('modeSwitch').querySelector('[data-mode="dual"]').disabled = true;
  }
  if (!META.has_buergerschaft) $('modeSwitch').querySelector('[data-mode="bw"]').disabled = true;
}

// ---------- Suche ----------
function initSearch() {
  const input = $('search'), res = $('searchResults');
  const names = Object.keys(byName).sort((a, b) => a.localeCompare(b, 'de'));
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    res.innerHTML = (q ? names.filter((n) => n.toLowerCase().includes(q)) : []).slice(0, 8)
      .map((n) => `<div class="search-item" data-name="${n}">${n}</div>`).join('');
    res.querySelectorAll('.search-item').forEach((el) => el.addEventListener('click', () => {
      const f = byName[el.dataset.name]; activeName = el.dataset.name; showInfo(f.properties);
      geoLayer.eachLayer((l) => { if (l.feature.properties.name === el.dataset.name) window._map.fitBounds(l.getBounds(), { maxZoom: 13, padding: [40, 40] }); });
      input.value = ''; res.innerHTML = '';
    }));
  });
}

// ---------- Update (Explorer) ----------
function update() {
  geoLayer.setStyle(styleFor);
  renderLegendInto($('legend'), metricKey);
  renderScatter();
}
