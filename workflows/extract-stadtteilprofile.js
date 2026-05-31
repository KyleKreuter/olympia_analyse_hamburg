export const meta = {
  name: 'extract-stadtteilprofile-2024',
  description: 'Extrahiert die 68 Kennzahlen je Hamburger Stadtteil aus dem Statistik-Nord-PDF 2024 mit unabhaengiger Doppel-Lesung und Arbiter-Schleife bis zur Uebereinstimmung',
  phases: [
    { title: 'Hamburg-Basiswerte', detail: 'Referenzspalte Hamburg gesamt doppelt erfassen' },
    { title: 'Extraktion & Verifikation', detail: '99 Stadtteile: Doppel-Lesung + Arbiter-Schleife je Zelle' },
  ],
}

// ------------------------------------------------------------------
// Konfiguration
// ------------------------------------------------------------------
const PDF = '/Users/kylekreuter/IdeaProjects/Privat/olypia_analyse/raw/Stadtteil-Profile-2024.pdf'
const MAX_ARBITER_ROUNDS = 2            // zusaetzliche fokussierte Lesungen je strittiger Zelle
const NUM_TOLERANCE = 0.05              // Zahlen gelten als gleich, wenn |a-b| < 0.05

// 68 Kennzahlen in exakter Reihenfolge (Abschnitt | Label | Einheit)
const ATTRS = [
  { key: 'bevoelkerung', section: 'Bevoelkerung und Haushalte', label: 'Bevoelkerung', unit: 'Anzahl' },
  { key: 'u18_anz', section: 'Bevoelkerung und Haushalte', label: 'Unter 18-Jaehrige', unit: 'Anzahl' },
  { key: 'u18_pct', section: 'Bevoelkerung und Haushalte', label: 'Unter 18-Jaehrige in % der Bevoelkerung', unit: '%' },
  { key: 'ue65_anz', section: 'Bevoelkerung und Haushalte', label: '65-Jaehrige und Aeltere', unit: 'Anzahl' },
  { key: 'ue65_pct', section: 'Bevoelkerung und Haushalte', label: '65-Jaehrige und Aeltere in % der Bevoelkerung', unit: '%' },
  { key: 'auslaender_anz', section: 'Bevoelkerung und Haushalte', label: 'Auslaender:innen', unit: 'Anzahl' },
  { key: 'auslaender_pct', section: 'Bevoelkerung und Haushalte', label: 'Auslaender:innen in % der Bevoelkerung', unit: '%' },
  { key: 'migra_anz', section: 'Bevoelkerung und Haushalte', label: 'Bevoelkerung mit Migrationshintergrund', unit: 'Anzahl' },
  { key: 'migra_pct', section: 'Bevoelkerung und Haushalte', label: 'Migrationshintergrund in % der Bevoelkerung', unit: '%' },
  { key: 'u18_migra_anz', section: 'Bevoelkerung und Haushalte', label: 'Unter 18-Jaehrige mit Migrationshintergrund', unit: 'Anzahl' },
  { key: 'u18_migra_pct', section: 'Bevoelkerung und Haushalte', label: 'Unter 18 mit Migrationshintergrund in % der unter 18-Jaehrigen', unit: '%' },
  { key: 'haushalte', section: 'Bevoelkerung und Haushalte', label: 'Haushalte', unit: 'Anzahl' },
  { key: 'pers_je_hh', section: 'Bevoelkerung und Haushalte', label: 'Personen je Haushalt', unit: 'Dezimalzahl' },
  { key: 'einpers_hh_anz', section: 'Bevoelkerung und Haushalte', label: 'Einpersonenhaushalte', unit: 'Anzahl' },
  { key: 'einpers_hh_pct', section: 'Bevoelkerung und Haushalte', label: 'Einpersonenhaushalte in % der Haushalte', unit: '%' },
  { key: 'hh_kinder_anz', section: 'Bevoelkerung und Haushalte', label: 'Haushalte mit Kindern', unit: 'Anzahl' },
  { key: 'hh_kinder_pct', section: 'Bevoelkerung und Haushalte', label: 'Haushalte mit Kindern in % der Haushalte', unit: '%' },
  { key: 'alleinerz_anz', section: 'Bevoelkerung und Haushalte', label: 'Alleinerziehende', unit: 'Anzahl' },
  { key: 'alleinerz_pct', section: 'Bevoelkerung und Haushalte', label: 'Alleinerziehende in % der Haushalte mit Kindern', unit: '%' },
  { key: 'flaeche_km2', section: 'Bevoelkerung und Haushalte', label: 'Flaeche in km2', unit: 'km2' },
  { key: 'ew_je_km2', section: 'Bevoelkerung und Haushalte', label: 'Einwohner:innen je km2', unit: 'Anzahl' },
  { key: 'geburten', section: 'Bevoelkerungsbewegung', label: 'Geburten', unit: 'Anzahl' },
  { key: 'sterbefaelle', section: 'Bevoelkerungsbewegung', label: 'Sterbefaelle', unit: 'Anzahl' },
  { key: 'zuzuege', section: 'Bevoelkerungsbewegung', label: 'Zuzuege', unit: 'Anzahl' },
  { key: 'fortzuege', section: 'Bevoelkerungsbewegung', label: 'Fortzuege', unit: 'Anzahl' },
  { key: 'wanderungssaldo', section: 'Bevoelkerungsbewegung', label: 'Wanderungssaldo (kann negativ sein)', unit: 'Anzahl' },
  { key: 'svb_anz', section: 'Sozialstruktur', label: 'Sozialversicherungspflichtig Beschaeftigte (Wohnort)', unit: 'Anzahl' },
  { key: 'svb_pct', section: 'Sozialstruktur', label: 'SV-Beschaeftigte in % der 15- bis unter 65-Jaehrigen', unit: '%' },
  { key: 'arbeitslose_anz', section: 'Sozialstruktur', label: 'Arbeitslose', unit: 'Anzahl' },
  { key: 'arbeitslose_pct', section: 'Sozialstruktur', label: 'Arbeitslose in % der 15- bis unter 65-Jaehrigen', unit: '%' },
  { key: 'jueng_arbeitslose_anz', section: 'Sozialstruktur', label: 'Juengere Arbeitslose', unit: 'Anzahl' },
  { key: 'jueng_arbeitslose_pct', section: 'Sozialstruktur', label: 'Juengere Arbeitslose in % der 15- bis unter 25-Jaehrigen', unit: '%' },
  { key: 'aelt_arbeitslose_anz', section: 'Sozialstruktur', label: 'Aeltere Arbeitslose', unit: 'Anzahl' },
  { key: 'aelt_arbeitslose_pct', section: 'Sozialstruktur', label: 'Aeltere Arbeitslose in % der 55- bis unter 65-Jaehrigen', unit: '%' },
  { key: 'sgb2_anz', section: 'Sozialstruktur', label: 'Leistungsempfaenger:innen nach SGB II', unit: 'Anzahl' },
  { key: 'sgb2_pct', section: 'Sozialstruktur', label: 'SGB-II-Leistungsempfaenger:innen in % der Bevoelkerung', unit: '%' },
  { key: 'u15_mindestsich_anz', section: 'Sozialstruktur', label: 'Unter 15-Jaehrige in Mindestsicherung', unit: 'Anzahl' },
  { key: 'u15_mindestsich_pct', section: 'Sozialstruktur', label: 'Unter 15 in Mindestsicherung in % der unter 15-Jaehrigen', unit: '%' },
  { key: 'bedarfsgem_anz', section: 'Sozialstruktur', label: 'Bedarfsgemeinschaften nach SGB II', unit: 'Anzahl' },
  { key: 'grundsich_alter_anz', section: 'Sozialstruktur', label: 'Empfaenger:innen von Grundsicherung im Alter', unit: 'Anzahl' },
  { key: 'grundsich_alter_pct', section: 'Sozialstruktur', label: 'Grundsicherung im Alter in % der 65-Jaehrigen und Aelteren', unit: '%' },
  { key: 'einkommen_je_stpfl', section: 'Sozialstruktur', label: 'Einkommen je Steuerpflichtigen in Euro (2021)', unit: 'EUR' },
  { key: 'wohngebaeude', section: 'Wohnen', label: 'Wohngebaeude', unit: 'Anzahl' },
  { key: 'wohnungen', section: 'Wohnen', label: 'Wohnungen', unit: 'Anzahl' },
  { key: 'bezugsfertige_whg', section: 'Wohnen', label: 'darunter bezugsfertige Wohnungen', unit: 'Anzahl' },
  { key: 'whg_ein_zweifam_anz', section: 'Wohnen', label: 'Wohnungen in Ein- und Zweifamilienhaeusern', unit: 'Anzahl' },
  { key: 'whg_ein_zweifam_pct', section: 'Wohnen', label: 'Ein-/Zweifamilien-Wohnungen in % der Wohnungen insgesamt', unit: '%' },
  { key: 'dschn_whg_groesse_m2', section: 'Wohnen', label: 'Durchschnittliche Wohnungsgroesse in m2', unit: 'm2' },
  { key: 'wohnflaeche_je_ew_m2', section: 'Wohnen', label: 'Wohnflaeche je Einwohner:in in m2', unit: 'm2' },
  { key: 'sozialwhg_anz', section: 'Wohnen', label: 'Sozialwohnungen', unit: 'Anzahl' },
  { key: 'sozialwhg_pct', section: 'Wohnen', label: 'Sozialwohnungen in % der Wohnungen insgesamt', unit: '%' },
  { key: 'sozialwhg_bindung_anz', section: 'Wohnen', label: 'Sozialwohnungen mit Bindungsauslauf bis 2030', unit: 'Anzahl' },
  { key: 'sozialwhg_bindung_pct', section: 'Wohnen', label: 'Bindungsauslauf bis 2030 in % der Sozialwohnungen', unit: '%' },
  { key: 'immo_grundstueck_eur_m2', section: 'Wohnen', label: 'Immobilienpreise in Euro je m2 fuer Grundstuecke', unit: 'EUR/m2' },
  { key: 'immo_ein_zweifam_eur_m2', section: 'Wohnen', label: 'Immobilienpreise in Euro je m2 fuer Ein- und Zweifamilienhaeuser', unit: 'EUR/m2' },
  { key: 'immo_eigentumswhg_eur_m2', section: 'Wohnen', label: 'Immobilienpreise in Euro je m2 fuer Eigentumswohnungen', unit: 'EUR/m2' },
  { key: 'kitas', section: 'Infrastruktur und Verkehr', label: 'Kindertageseinrichtungen (2025)', unit: 'Anzahl' },
  { key: 'grundschulen', section: 'Infrastruktur und Verkehr', label: 'Grundschulen', unit: 'Anzahl' },
  { key: 'schueler_sek1_anz', section: 'Infrastruktur und Verkehr', label: 'Schueler:innen der Sekundarstufe I (Wohnort)', unit: 'Anzahl' },
  { key: 'schueler_stadtteilschule_pct', section: 'Infrastruktur und Verkehr', label: 'Sek-I-Schueler:innen in Stadtteilschulen in %', unit: '%' },
  { key: 'schueler_gymnasium_pct', section: 'Infrastruktur und Verkehr', label: 'Sek-I-Schueler:innen in Gymnasien in %', unit: '%' },
  { key: 'aerzte_anz', section: 'Infrastruktur und Verkehr', label: 'Niedergelassene Aerztinnen/Aerzte', unit: 'Anzahl' },
  { key: 'allgemeinaerzte_anz', section: 'Infrastruktur und Verkehr', label: 'darunter Allgemeinaerztinnen/-aerzte', unit: 'Anzahl' },
  { key: 'zahnaerzte_anz', section: 'Infrastruktur und Verkehr', label: 'Zahnaerztinnen/-aerzte', unit: 'Anzahl' },
  { key: 'apotheken', section: 'Infrastruktur und Verkehr', label: 'Apotheken', unit: 'Anzahl' },
  { key: 'private_pkw_anz', section: 'Infrastruktur und Verkehr', label: 'Private PKW', unit: 'Anzahl' },
  { key: 'private_pkw_je_1000', section: 'Infrastruktur und Verkehr', label: 'Private PKW je 1 000 der Bevoelkerung', unit: 'je 1000 Einw.' },
  { key: 'elektro_pkw_anz', section: 'Infrastruktur und Verkehr', label: 'Elektro-PKW', unit: 'Anzahl' },
]

// 99 Stadtteile in PDF-Reihenfolge; PDF-Seiten = [4+2i, 5+2i]
const NAMES = [
  ['Hamburg-Altstadt', 'Hamburg-Mitte'], ['HafenCity', 'Hamburg-Mitte'], ['Neustadt', 'Hamburg-Mitte'],
  ['St. Pauli', 'Hamburg-Mitte'], ['St. Georg', 'Hamburg-Mitte'], ['Hammerbrook', 'Hamburg-Mitte'],
  ['Borgfelde', 'Hamburg-Mitte'], ['Hamm', 'Hamburg-Mitte'], ['Horn', 'Hamburg-Mitte'],
  ['Billstedt', 'Hamburg-Mitte'], ['Billbrook', 'Hamburg-Mitte'], ['Rothenburgsort', 'Hamburg-Mitte'],
  ['Veddel', 'Hamburg-Mitte'], ['Wilhelmsburg', 'Hamburg-Mitte'], ['Kleiner Grasbrook und Steinwerder', 'Hamburg-Mitte'],
  ['Waltershof und Finkenwerder', 'Hamburg-Mitte'],
  ['Altona-Altstadt', 'Altona'], ['Sternschanze', 'Altona'], ['Altona-Nord', 'Altona'], ['Ottensen', 'Altona'],
  ['Bahrenfeld', 'Altona'], ['Gross Flottbek', 'Altona'], ['Othmarschen', 'Altona'], ['Lurup', 'Altona'],
  ['Osdorf', 'Altona'], ['Nienstedten', 'Altona'], ['Blankenese', 'Altona'], ['Iserbrook', 'Altona'],
  ['Suelldorf', 'Altona'], ['Rissen', 'Altona'],
  ['Eimsbuettel', 'Eimsbuettel'], ['Rotherbaum', 'Eimsbuettel'], ['Harvestehude', 'Eimsbuettel'],
  ['Hoheluft-West', 'Eimsbuettel'], ['Lokstedt', 'Eimsbuettel'], ['Niendorf', 'Eimsbuettel'],
  ['Schnelsen', 'Eimsbuettel'], ['Eidelstedt', 'Eimsbuettel'], ['Stellingen', 'Eimsbuettel'],
  ['Hoheluft-Ost', 'Hamburg-Nord'], ['Eppendorf', 'Hamburg-Nord'], ['Gross Borstel', 'Hamburg-Nord'],
  ['Alsterdorf', 'Hamburg-Nord'], ['Winterhude', 'Hamburg-Nord'], ['Uhlenhorst', 'Hamburg-Nord'],
  ['Hohenfelde', 'Hamburg-Nord'], ['Barmbek-Sued', 'Hamburg-Nord'], ['Dulsberg', 'Hamburg-Nord'],
  ['Barmbek-Nord', 'Hamburg-Nord'], ['Ohlsdorf', 'Hamburg-Nord'], ['Fuhlsbuettel', 'Hamburg-Nord'],
  ['Langenhorn', 'Hamburg-Nord'],
  ['Eilbek', 'Wandsbek'], ['Wandsbek', 'Wandsbek'], ['Marienthal', 'Wandsbek'], ['Jenfeld', 'Wandsbek'],
  ['Tonndorf', 'Wandsbek'], ['Farmsen-Berne', 'Wandsbek'], ['Bramfeld', 'Wandsbek'], ['Steilshoop', 'Wandsbek'],
  ['Wellingsbuettel', 'Wandsbek'], ['Sasel', 'Wandsbek'], ['Poppenbuettel', 'Wandsbek'], ['Hummelsbuettel', 'Wandsbek'],
  ['Lemsahl-Mellingstedt', 'Wandsbek'], ['Duvenstedt', 'Wandsbek'], ['Wohldorf-Ohlstedt', 'Wandsbek'],
  ['Bergstedt', 'Wandsbek'], ['Volksdorf', 'Wandsbek'], ['Rahlstedt', 'Wandsbek'],
  ['Lohbruegge', 'Bergedorf'], ['Bergedorf', 'Bergedorf'], ['Curslack', 'Bergedorf'], ['Altengamme', 'Bergedorf'],
  ['Neuengamme', 'Bergedorf'], ['Kirchwerder', 'Bergedorf'], ['Ochsenwerder', 'Bergedorf'], ['Reitbrook', 'Bergedorf'],
  ['Allermoehe', 'Bergedorf'], ['Billwerder', 'Bergedorf'], ['Moorfleet', 'Bergedorf'], ['Tatenberg', 'Bergedorf'],
  ['Spadenland', 'Bergedorf'], ['Neuallermoehe', 'Bergedorf'],
  ['Harburg', 'Harburg'], ['Neuland und Gut Moor', 'Harburg'], ['Wilstorf', 'Harburg'], ['Roenneburg', 'Harburg'],
  ['Langenbek', 'Harburg'], ['Sinstorf', 'Harburg'], ['Marmstorf', 'Harburg'], ['Eissendorf', 'Harburg'],
  ['Heimfeld', 'Harburg'], ['Moorburg und Altenwerder', 'Harburg'], ['Hausbruch', 'Harburg'],
  ['Neugraben-Fischbek', 'Harburg'], ['Francop', 'Harburg'], ['Neuenfelde', 'Harburg'], ['Cranz', 'Harburg'],
]

// ------------------------------------------------------------------
// Hilfsfunktionen
// ------------------------------------------------------------------
function pagesFor(index) {
  const p1 = 4 + 2 * index
  return [p1, p1 + 1]
}

function attrListText() {
  let out = ''
  let lastSection = ''
  ATTRS.forEach((a, i) => {
    if (a.section !== lastSection) { out += `\n  [Abschnitt: ${a.section}]\n`; lastSection = a.section }
    out += `  ${i + 1}. key="${a.key}"  →  ${a.label}  (Einheit: ${a.unit})\n`
  })
  return out
}

// Zwei Zellwerte gleich?
function cellEq(a, b) {
  if (a === undefined || b === undefined) return false
  if (typeof a === 'string' || typeof b === 'string') return a === b
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < NUM_TOLERANCE
}

// Normalisierter Gruppenschluessel fuer Konsens
function normKey(v) {
  if (typeof v === 'string') return 's:' + v
  if (v === null) return 'null'
  return 'n:' + Math.round(v * 100) / 100
}

// Konsens ueber mehrere Lesungen einer Zelle. Liefert {value, count}.
function consensus(values) {
  const present = values.filter((v) => v !== undefined && v !== null)
  if (present.length === 0) return { value: null, count: 0 }
  const buckets = {}
  for (const v of present) {
    const k = normKey(v)
    if (!buckets[k]) buckets[k] = { value: v, count: 0 }
    buckets[k].count++
  }
  let best = { value: null, count: 0 }
  for (const k in buckets) if (buckets[k].count > best.count) best = buckets[k]
  return best
}

// JSON-Schema fuer eine vollstaendige Profil-Erfassung
function buildExtractSchema() {
  const props = {}
  for (const a of ATTRS) {
    props[a.key] = {
      anyOf: [{ type: 'number' }, { type: 'string', enum: ['-', '.', 'x'] }],
      description: `${a.label} (${a.unit})`,
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'values'],
    properties: {
      name: { type: 'string' },
      values: { type: 'object', additionalProperties: false, required: ATTRS.map((a) => a.key), properties: props },
    },
  }
}

// JSON-Schema fuer eine fokussierte Arbiter-Erfassung (nur strittige keys)
function buildArbiterSchema(keys) {
  const props = {}
  for (const k of keys) props[k] = { anyOf: [{ type: 'number' }, { type: 'string', enum: ['-', '.', 'x'] }] }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['values'],
    properties: { values: { type: 'object', additionalProperties: false, required: keys, properties: props } },
  }
}

const RULES = `Erfassungsregeln (zwingend):
- Erfasse NUR die erste Wertspalte = der Stadtteil selbst. NICHT die Spalten "Bezirk ..." oder "Hamburg".
- Tausendertrennzeichen ist ein Leerzeichen: "1 973 896" -> gib 1973896. Dezimaltrennzeichen ist Komma: "16,7" -> gib 16.7.
- Gib reine JSON-Zahlen zurueck, ohne Trennzeichen, ohne Einheiten, ohne Anfuehrungszeichen.
- Fehlende Werte als exakten String uebernehmen: "-" = nichts vorhanden/genau null, "." = unbekannt/geheim, "x" = Aussage nicht sinnvoll.
- Der Wanderungssaldo kann negativ sein.
- Bei den drei Immobilienpreis-Zeilen kann die Stadtteil-Spalte einen Wert oder "." enthalten.
- Manche Labels wiederholen sich ("in % der ..."). Ordne strikt nach Position innerhalb des Abschnitts zu, nicht nach Labeltext allein.
- Die zweite PDF-Seite beginnt mit dem Kopf "noch: Sozialstruktur" ab "Leistungsempfaenger:innen nach SGB II".
- Rate niemals. Lies den tatsaechlichen Zellinhalt. Wenn unleserlich, gib den am besten lesbaren Zellinhalt wieder.`

const EXTRACT_SCHEMA = buildExtractSchema()
const ATTR_TEXT = attrListText()

// ------------------------------------------------------------------
// Phase 1: Hamburg-Basiswerte (Referenzspalte, doppelt)
// ------------------------------------------------------------------
phase('Hamburg-Basiswerte')

function hamburgPrompt(variant) {
  return `${variant} der Spalte "Hamburg" (gesamte Stadt) aus dem Stadtteil-Profile-PDF.
Lies mit dem Read-Tool die Seiten 4 und 5 der Datei ${PDF} (pages:"4-5"). Dort ist das Profil "Hamburg-Altstadt"; die Tabelle hat drei Wertspalten: Stadtteil | Bezirk Hamburg-Mitte | Hamburg.
Erfasse AUSSCHLIESSLICH die letzte Spalte "Hamburg" (Gesamtstadt) fuer alle 68 Kennzahlen.
${RULES}

Die 68 Kennzahlen in exakter Reihenfolge:
${ATTR_TEXT}
Gib das Ergebnis ueber das StructuredOutput-Tool zurueck (Feld name="Hamburg").`
}

const hhReadings = (await parallel([
  () => agent(hamburgPrompt('Ersterfassung'), { label: 'hamburg:read1', phase: 'Hamburg-Basiswerte', schema: EXTRACT_SCHEMA, model: 'sonnet' }),
  () => agent(hamburgPrompt('Unabhaengige Zweiterfassung'), { label: 'hamburg:read2', phase: 'Hamburg-Basiswerte', schema: EXTRACT_SCHEMA, model: 'sonnet' }),
])).filter(Boolean)

const hamburg = {}
for (const a of ATTRS) {
  const vals = hhReadings.map((r) => r.values[a.key])
  hamburg[a.key] = consensus(vals).value
}
log(`Hamburg-Basiswerte erfasst (${hhReadings.length} Lesungen)`)

// ------------------------------------------------------------------
// Phase 2: Extraktion + Verifikation je Stadtteil (Pipeline)
// ------------------------------------------------------------------
phase('Extraktion & Verifikation')

function extractPrompt(name, bezirk, p1, p2, variant) {
  return `${variant} eines Hamburger Stadtteil-Profils.
Lies mit dem Read-Tool die Seiten ${p1} und ${p2} der Datei ${PDF} (pages:"${p1}-${p2}"). Dort steht das Profil des Stadtteils "${name}".
Die Tabelle hat drei Wertspalten: [Stadtteil = ${name}] | [Bezirk ${bezirk}] | [Hamburg]. Erfasse NUR die erste Spalte (${name}).
${RULES}

Die 68 Kennzahlen in exakter Reihenfolge:
${ATTR_TEXT}
Gib das Ergebnis ueber das StructuredOutput-Tool zurueck (Feld name="${name}").`
}

function arbiterPrompt(name, bezirk, p1, p2, disputes) {
  const lines = disputes.map((d) => {
    const a = ATTRS.find((x) => x.key === d.key)
    const cand = d.readings.map((v) => JSON.stringify(v)).join(' vs ')
    return `  key="${d.key}"  (${a.label}, ${a.unit})  — bisherige widerspruechliche Lesungen: ${cand}`
  }).join('\n')
  return `Du bist Schiedsrichter (Arbiter) fuer strittige Zellen eines Stadtteil-Profils.
Lies mit dem Read-Tool die Seiten ${p1} und ${p2} der Datei ${PDF} (pages:"${p1}-${p2}") — Profil "${name}", Spalte ${name} (erste Wertspalte, nicht Bezirk/Hamburg).
Pruefe AUSSCHLIESSLICH diese strittigen Kennzahlen und lies jede Zelle besonders sorgfaeltig. Lass dich von den Kandidaten nicht voreingenommen machen — lies den echten Wert:
${lines}

${RULES}
Gib ueber das StructuredOutput-Tool fuer GENAU diese keys den korrekten Wert zurueck.`
}

const result = await pipeline(
  NAMES.map(([name, bezirk], i) => ({ name, bezirk, index: i })),
  // Stufe 1: Doppel-Lesung (zwei unabhaengige Erfassungen parallel)
  async (st) => {
    const [p1, p2] = pagesFor(st.index)
    const reads = (await parallel([
      () => agent(extractPrompt(st.name, st.bezirk, p1, p2, 'Ersterfassung'), { label: `read1:${st.name}`, phase: 'Extraktion & Verifikation', schema: EXTRACT_SCHEMA, model: 'sonnet' }),
      () => agent(extractPrompt(st.name, st.bezirk, p1, p2, 'Unabhaengige Zweiterfassung'), { label: `read2:${st.name}`, phase: 'Extraktion & Verifikation', schema: EXTRACT_SCHEMA, model: 'sonnet' }),
    ])).filter(Boolean)
    return { st, p1, p2, readings: reads.map((r) => r.values) }
  },
  // Stufe 2: Arbiter-Schleife je strittiger Zelle bis Konsens (zwei uebereinstimmende Lesungen)
  async (prev) => {
    if (!prev || prev.readings.length < 2) {
      // Lesung fehlgeschlagen -> als ungeloest markieren
      return { name: prev?.st?.name, bezirk: prev?.st?.bezirk, values: {}, qa: { ok: false, reason: 'Lesung fehlgeschlagen', rounds: 0, unresolved: ATTRS.map((a) => a.key) } }
    }
    const { st, p1, p2 } = prev
    const readings = prev.readings.slice()
    let round = 0
    let disputes = []
    while (true) {
      disputes = ATTRS
        .map((a) => ({ key: a.key, readings: readings.map((r) => r[a.key]).filter((v) => v !== undefined) }))
        .filter((d) => consensus(d.readings).count < 2)
      if (disputes.length === 0 || round >= MAX_ARBITER_ROUNDS) break
      const arb = await agent(arbiterPrompt(st.name, st.bezirk, p1, p2, disputes), {
        label: `arbiter${round + 1}:${st.name} (${disputes.length})`, phase: 'Extraktion & Verifikation',
        schema: buildArbiterSchema(disputes.map((d) => d.key)),
      })
      if (arb && arb.values) readings.push(arb.values)
      round++
    }
    const values = {}
    const unresolved = []
    for (const a of ATTRS) {
      const c = consensus(readings.map((r) => r[a.key]).filter((v) => v !== undefined))
      values[a.key] = c.value
      if (c.count < 2) unresolved.push({ key: a.key, readings: readings.map((r) => r[a.key]) })
    }
    return {
      name: st.name, bezirk: st.bezirk, values,
      qa: { ok: unresolved.length === 0, rounds: round, totalReadings: readings.length, unresolved },
    }
  },
)

// ------------------------------------------------------------------
// Aggregation des Ergebnisses
// ------------------------------------------------------------------
const records = result.filter(Boolean)
const data = {}
const qa = {}
let unresolvedCells = 0
let arbiterStadtteile = 0
for (const r of records) {
  data[r.name] = r.values
  qa[r.name] = r.qa
  if (r.qa && r.qa.unresolved) unresolvedCells += r.qa.unresolved.length
  if (r.qa && r.qa.rounds > 0) arbiterStadtteile++
}

log(`Fertig: ${records.length}/99 Stadtteile, ${arbiterStadtteile} mit Arbiter-Runden, ${unresolvedCells} ungeloeste Zellen`)

return {
  meta: { stadtteile: records.length, attribute: ATTRS.length, arbiterStadtteile, unresolvedCells },
  attrs: ATTRS,
  hamburg,
  data,
  qa,
}
