#!/usr/bin/env python3
"""Aggregiert die Bürgerschaftswahl 2025 (Landesstimmen) pro Stadtteil.

Eingabe : raw/buergerschaft_land_raw.csv (Semikolon, je Stimmbezirk eine Zeile)
Ausgabe : data/buergerschaft_stadtteile.json

Die Spalten F1..F16 sind die Gesamtstimmen je Landesliste (Partei). Die Zuordnung
wurde aus Landesliste_F_Feldbezeichner.xlsx abgeleitet und über die Kandidatenzahl
je Liste gegengeprüft.
"""
import csv
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'raw', 'buergerschaft_land_raw.csv')
OUT = os.path.join(BASE, 'data', 'buergerschaft_stadtteile.json')

# Fn -> (Kurzschluessel, Anzeigename)
PARTIES = [
    ('F1', 'spd', 'SPD'),
    ('F2', 'cdu', 'CDU'),
    ('F3', 'fdp', 'FDP'),
    ('F4', 'gruene', 'GRÜNE'),
    ('F5', 'volt', 'Volt'),
    ('F6', 'linke', 'Die Linke'),
    ('F7', 'afd', 'AfD'),
    ('F8', 'diewahl', 'DieWahl'),
    ('F9', 'dava', 'DAVA'),
    ('F10', 'fw', 'FREIE WÄHLER'),
    ('F11', 'partei', 'Die PARTEI'),
    ('F12', 'oedp', 'ÖDP'),
    ('F13', 'tier', 'Tierschutzpartei'),
    ('F14', 'buendnis', 'Bündnis Deutschland'),
    ('F15', 'bsw', 'BSW'),
    ('F16', 'npd', 'NPD'),
]


def to_int(s):
    s = (s or '').strip().replace('.', '').replace(' ', '')
    return int(s) if s and s.lstrip('-').isdigit() else 0


def main():
    agg = {}
    with open(SRC, encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            st = (row['Stadtteil'] or '').strip()
            if not st:
                continue
            # Stadtteile, die nach Wahlkreis gesplittet sind, zusammenfassen
            # (z.B. "Eimsbüttel WK5" + "Eimsbüttel WK6" -> "Eimsbüttel")
            st = re.sub(r'\s*WK\s*\d+$', '', st).strip()
            a = agg.setdefault(st, {
                'stadtteil': st,
                'bezirk': (row['Bezirk'] or '').strip().replace('Bezirk ', ''),
                'berechtigte': 0, 'waehler': 0, 'gueltige_stimmen': 0,
                'votes': {k: 0 for _, k, _ in PARTIES},
            })
            a['berechtigte'] += to_int(row['Wahlberechtigte gesamt (A)'])
            a['waehler'] += to_int(row['Waehler gesamt (B)'])
            a['gueltige_stimmen'] += to_int(row['Stimmen gueltige (F)'])
            for fcode, key, _ in PARTIES:
                a['votes'][key] += to_int(row[fcode])

    out = {}
    for st, a in agg.items():
        total = a['gueltige_stimmen'] or 1
        a['shares'] = {k: round(v / total * 100, 1) for k, v in a['votes'].items()}
        a['beteiligung_pct'] = round(a['waehler'] / (a['berechtigte'] or 1) * 100, 1)
        winner = max(PARTIES, key=lambda p: a['votes'][p[1]])
        a['winner'] = winner[2]
        a['winner_key'] = winner[1]
        a['winner_pct'] = a['shares'][winner[1]]
        out[st] = a

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # Kontrolle: stadtweite Anteile
    tv = {k: sum(a['votes'][k] for a in out.values()) for _, k, _ in PARTIES}
    tot = sum(tv.values()) or 1
    print(f'{len(out)} Stadtteile aggregiert -> {OUT}')
    print('Stadtweite Anteile (gueltige Landesstimmen):')
    for _, k, name in PARTIES:
        if tv[k] / tot * 100 >= 0.5:
            print(f'  {name:18s}: {tv[k] / tot * 100:4.1f} %')
    wins = {}
    for a in out.values():
        wins[a['winner']] = wins.get(a['winner'], 0) + 1
    print('Stadtteile je Gewinnerpartei:', wins)


if __name__ == '__main__':
    main()
