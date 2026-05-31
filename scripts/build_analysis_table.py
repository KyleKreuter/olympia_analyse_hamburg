#!/usr/bin/env python3
"""Baut eine saubere Analysetabelle auf Ebene der 90 Abstimmungs-Einheiten.

Aggregiert die 99 Stadtteil-Features zu den 90 Referendums-Einheiten
(group by referendum_unit). Absolutwerte (Bevoelkerung) werden summiert,
alle Quoten/Anteile bevoelkerungsgewichtet gemittelt. ja_pct/nein_pct/
beteiligung sind je Einheit identisch und bleiben damit exakt.

Ausgabe: data/analysis_units.csv  (eine Zeile je Abstimmungs-Einheit)
"""
import json
import os
import csv

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(BASE, 'app', 'data', 'stadtteile.geojson')
META = os.path.join(BASE, 'app', 'data', 'metadata.json')
OUT = os.path.join(BASE, 'data', 'analysis_units.csv')

meta = json.load(open(META, encoding='utf-8'))
PROFILE = [m['key'] for m in meta['metrics'] if m['group'] != 'Referendum']
PARTIES = [p['key'] for p in meta['buergerschaft']['parties']]
BW_KEYS = ['bw_' + k for k in PARTIES] + ['bw_beteiligung_pct']
WEIGHTED = PROFILE + BW_KEYS  # bevoelkerungsgewichtet zu mitteln


def main():
    geo = json.load(open(GEO, encoding='utf-8'))
    groups = {}
    for f in geo['features']:
        p = f['properties']
        groups.setdefault(p['referendum_unit'], []).append(p)

    rows = []
    for unit, feats in groups.items():
        f0 = feats[0]
        rec = {
            'unit': unit,
            'bezirk': f0.get('bezirk', ''),
            'bevoelkerung': sum((x.get('bevoelkerung') or 0) for x in feats),
            'ja_pct': f0['ja_pct'], 'nein_pct': f0['nein_pct'],
            'beteiligung_pct': f0['beteiligung_pct'], 'ergebnis': f0['ergebnis'],
        }
        for key in WEIGHTED:
            num = den = 0.0
            for x in feats:
                v, w = x.get(key), (x.get('bevoelkerung') or 0)
                if isinstance(v, (int, float)) and w > 0:
                    num += v * w
                    den += w
            rec[key] = round(num / den, 2) if den else ''
        # Gewinnerpartei aus gewichteten Anteilen
        shares = {k: rec['bw_' + k] for k in PARTIES if isinstance(rec['bw_' + k], (int, float))}
        if shares:
            wk = max(shares, key=shares.get)
            rec['bw_winner'] = next(p['label'] for p in meta['buergerschaft']['parties'] if p['key'] == wk)
            rec['bw_winner_key'] = wk
        rows.append(rec)

    cols = (['unit', 'bezirk', 'bevoelkerung', 'ja_pct', 'nein_pct', 'beteiligung_pct', 'ergebnis']
            + PROFILE + BW_KEYS + ['bw_winner', 'bw_winner_key'])
    with open(OUT, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f'{len(rows)} Einheiten -> {OUT}')
    print('Spalten:', len(cols))


if __name__ == '__main__':
    main()
