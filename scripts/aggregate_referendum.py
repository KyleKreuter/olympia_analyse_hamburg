#!/usr/bin/env python3
"""Aggregiert die Olympia-Referendum-Rohdaten (Abstimmbezirke) pro Stadtteil.

Eingabe : referendum_raw.csv  (Semikolon-getrennt, Spalten siehe Kopfzeile)
Ausgabe : data/referendum_stadtteile.json

Beteiligung = Abstimmende (B) / Abstimmungsberechtigte (A) * 100
  - A steht nur in den Praesenz-Abstimmbezirken (Briefabstimmbezirk hat A=0)
  - B, gueltige (D), JA, NEIN werden ueber ALLE Zeilen (inkl. Brief) summiert
Ja-/Nein-Anteil = JA bzw. NEIN / gueltige Stimmen * 100
"""
import csv
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'raw', 'referendum_raw.csv')
OUT = os.path.join(BASE, 'data', 'referendum_stadtteile.json')


def to_int(s):
    s = (s or '').strip().replace('.', '').replace(' ', '')
    return int(s) if s else 0


def main():
    agg = {}
    with open(SRC, encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            st = (row['Stadtteil'] or '').strip()
            if not st:
                continue
            bezirk = (row['Bezirk'] or '').strip().replace('Bezirk ', '')
            a = agg.setdefault(st, {
                'stadtteil': st, 'bezirk': bezirk,
                'berechtigte': 0, 'abstimmende': 0, 'gueltig': 0,
                'ungueltig': 0, 'ja': 0, 'nein': 0,
            })
            a['berechtigte'] += to_int(row['Abstimmungsberechtigte (A)'])
            a['abstimmende'] += to_int(row['Abstimmende (B)'])
            a['ungueltig'] += to_int(row['Ungültige Stimmzettel (C)'])
            a['gueltig'] += to_int(row['Gültige Stimmzettel (D)'])
            a['ja'] += to_int(row['D-JA'])
            a['nein'] += to_int(row['D-NEIN'])

    out = {}
    for st, a in agg.items():
        gueltig = a['gueltig'] or 1
        berechtigte = a['berechtigte'] or 1
        a['beteiligung_pct'] = round(a['abstimmende'] / berechtigte * 100, 1)
        a['ja_pct'] = round(a['ja'] / gueltig * 100, 1)
        a['nein_pct'] = round(a['nein'] / gueltig * 100, 1)
        a['ergebnis'] = 'Ja' if a['ja'] > a['nein'] else 'Nein'
        out[st] = a

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # Kontrolle: Gesamtsummen
    tot_ja = sum(a['ja'] for a in out.values())
    tot_nein = sum(a['nein'] for a in out.values())
    tot_b = sum(a['abstimmende'] for a in out.values())
    tot_a = sum(a['berechtigte'] for a in out.values())
    print(f'{len(out)} Stadtteile aggregiert -> {OUT}')
    print(f'Gesamt JA={tot_ja} ({tot_ja/(tot_ja+tot_nein)*100:.1f}%)  '
          f'NEIN={tot_nein} ({tot_nein/(tot_ja+tot_nein)*100:.1f}%)  '
          f'Beteiligung={tot_b/tot_a*100:.1f}%')


if __name__ == '__main__':
    main()
