#!/usr/bin/env python3
"""Fuehrt Geometrie + Referendum + Stadtteil-Profile (PDF 2024) zur App-GeoJSON zusammen.

Ausgaben:
  app/data/stadtteile.geojson  - 99 Features mit Wahlergebnis + 68 Profil-Attributen
  app/data/metadata.json       - Attribut-Definitionen (Label, Einheit, Format, Gruppe)

Granularitaet:
  - Geometrie & Profil-Attribute: 99 Stadtteile (volle Aufloesung).
  - Wahlergebnis: 90 Abstimmungs-Einheiten; zusammengefasste Einheiten geben ihr
    Ergebnis an alle Konstituenten weiter (Feld referendum_unit dokumentiert das).
"""
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(BASE, 'data', 'stadtteile_4326.geojson')
REF = os.path.join(BASE, 'data', 'referendum_stadtteile.json')
PROF = os.path.join(BASE, 'data', 'stadtteilprofile_2024.json')
BW = os.path.join(BASE, 'data', 'buergerschaft_stadtteile.json')
OUT_GEO = os.path.join(BASE, 'app', 'data', 'stadtteile.geojson')
OUT_META = os.path.join(BASE, 'app', 'data', 'metadata.json')

# GeoJSON-Stadtteil -> Referendums-Einheit (nur abweichende Faelle; Rest matcht via norm())
REF_MAP = {
    'Hamburg-Altstadt': 'Hamburg-Altstadt/Neuwerk',
    'Billbrook': 'Billbrook/Rothenburgsort',
    'Rothenburgsort': 'Billbrook/Rothenburgsort',
    'Veddel': 'Veddel/Kleiner Grasbrook/Steinwerder',
    'Kleiner Grasbrook und Steinwerder': 'Veddel/Kleiner Grasbrook/Steinwerder',
    'Waltershof und Finkenwerder': 'Waltershof/Finkenwerder',
    'Moorburg und Altenwerder': 'Moorburg/Altenwerder/Francop',
    'Francop': 'Moorburg/Altenwerder/Francop',
    'Neuenfelde': 'Neuenfelde/Cranz',
    'Cranz': 'Neuenfelde/Cranz',
    'Neuland und Gut Moor': 'Neuland/Gut Moor',
    'Reitbrook': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Allermöhe': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Billwerder': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Moorfleet': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Tatenberg': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Spadenland': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
}

# GeoJSON-Stadtteil -> Buergerschafts-Einheit (nur abweichende Faelle)
BW_MAP = {
    'Hamburg-Altstadt': 'Hamburg-Altstadt/Neuwerk',
    'Billbrook': 'Billbrook/Rothenburgsort',
    'Rothenburgsort': 'Billbrook/Rothenburgsort',
    'Kleiner Grasbrook und Steinwerder': 'Kleiner Grasbrook/Steinwerder',
    'Waltershof und Finkenwerder': 'Waltershof/Finkenwerder',
    'Moorburg und Altenwerder': 'Moorburg/Altenwerder/Francop/Neuenfelde/Cranz',
    'Francop': 'Moorburg/Altenwerder/Francop/Neuenfelde/Cranz',
    'Neuenfelde': 'Moorburg/Altenwerder/Francop/Neuenfelde/Cranz',
    'Cranz': 'Moorburg/Altenwerder/Francop/Neuenfelde/Cranz',
    'Neuland und Gut Moor': 'Neuland/Gut Moor',
    'Reitbrook': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Allermöhe': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Billwerder': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Moorfleet': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Tatenberg': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
    'Spadenland': 'Reitbrook/Allermöhe/Billwerder/Moorfleet/Tatenberg/Spadenland',
}

# Parteien (Anzeige-Reihenfolge): key -> (Label, Farbe)
BW_PARTIES = [
    ('spd', 'SPD', '#e3000f'),
    ('gruene', 'GRÜNE', '#46962b'),
    ('cdu', 'CDU', '#222222'),
    ('linke', 'Die Linke', '#be3075'),
    ('afd', 'AfD', '#009ee0'),
    ('fdp', 'FDP', '#ffcc00'),
    ('volt', 'Volt', '#502379'),
    ('bsw', 'BSW', '#c0398f'),
    ('partei', 'Die PARTEI', '#b5152b'),
    ('fw', 'FREIE WÄHLER', '#fe7a00'),
    ('dava', 'DAVA', '#5a8f3a'),
    ('tier', 'Tierschutzpartei', '#00a76d'),
    ('oedp', 'ÖDP', '#ff6400'),
    ('buendnis', 'Bündnis Deutschland', '#f59a00'),
    ('diewahl', 'DieWahl', '#7a7f87'),
    ('npd', 'NPD', '#8b5a2b'),
]

# Attribut-Definitionen: key -> (Anzeige-Label, Einheit, Format, Gruppe)
# Format: int | dec1 | pct | eur | eurm2 | per1000
ATTR_DEFS = [
    ('bevoelkerung', 'Bevölkerung', 'Personen', 'int', 'Bevölkerung'),
    ('u18_pct', 'Unter 18-Jährige', '%', 'pct', 'Bevölkerung'),
    ('ue65_pct', '65-Jährige und Ältere', '%', 'pct', 'Bevölkerung'),
    ('auslaender_pct', 'Ausländer:innen', '%', 'pct', 'Bevölkerung'),
    ('migra_pct', 'Migrationshintergrund', '%', 'pct', 'Bevölkerung'),
    ('u18_migra_pct', 'Unter 18 mit Migrationshintergrund', '%', 'pct', 'Bevölkerung'),
    ('pers_je_hh', 'Personen je Haushalt', '', 'dec1', 'Haushalte'),
    ('einpers_hh_pct', 'Einpersonenhaushalte', '%', 'pct', 'Haushalte'),
    ('hh_kinder_pct', 'Haushalte mit Kindern', '%', 'pct', 'Haushalte'),
    ('alleinerz_pct', 'Alleinerziehende (Anteil HH mit Kindern)', '%', 'pct', 'Haushalte'),
    ('ew_je_km2', 'Bevölkerungsdichte', 'Einw./km²', 'int', 'Haushalte'),
    ('wanderungssaldo', 'Wanderungssaldo', 'Personen', 'int', 'Bevölkerungsbewegung'),
    ('svb_pct', 'Sozialversicherungspflichtig Beschäftigte', '%', 'pct', 'Sozialstruktur'),
    ('arbeitslose_pct', 'Arbeitslose', '%', 'pct', 'Sozialstruktur'),
    ('jueng_arbeitslose_pct', 'Jüngere Arbeitslose (15 bis 25 J.)', '%', 'pct', 'Sozialstruktur'),
    ('aelt_arbeitslose_pct', 'Ältere Arbeitslose (55 bis 65 J.)', '%', 'pct', 'Sozialstruktur'),
    ('sgb2_pct', 'SGB-II-Leistungsempfänger:innen', '%', 'pct', 'Sozialstruktur'),
    ('u15_mindestsich_pct', 'Unter 15 in Mindestsicherung', '%', 'pct', 'Sozialstruktur'),
    ('grundsich_alter_pct', 'Grundsicherung im Alter', '%', 'pct', 'Sozialstruktur'),
    ('einkommen_je_stpfl', 'Einkommen je Steuerpflichtigen (2021)', 'EUR', 'eur', 'Sozialstruktur'),
    ('whg_ein_zweifam_pct', 'Wohnungen in Ein-/Zweifamilienhäusern', '%', 'pct', 'Wohnen'),
    ('dschn_whg_groesse_m2', 'Durchschnittliche Wohnungsgröße', 'm²', 'dec1', 'Wohnen'),
    ('wohnflaeche_je_ew_m2', 'Wohnfläche je Einwohner:in', 'm²', 'dec1', 'Wohnen'),
    ('sozialwhg_pct', 'Sozialwohnungen', '%', 'pct', 'Wohnen'),
    ('immo_grundstueck_eur_m2', 'Immobilienpreis Grundstücke', 'EUR/m²', 'eurm2', 'Wohnen'),
    ('immo_ein_zweifam_eur_m2', 'Immobilienpreis Ein-/Zweifamilienhäuser', 'EUR/m²', 'eurm2', 'Wohnen'),
    ('immo_eigentumswhg_eur_m2', 'Immobilienpreis Eigentumswohnungen', 'EUR/m²', 'eurm2', 'Wohnen'),
    ('schueler_stadtteilschule_pct', 'Sek-I-Schüler:innen in Stadtteilschulen', '%', 'pct', 'Infrastruktur'),
    ('schueler_gymnasium_pct', 'Sek-I-Schüler:innen in Gymnasien', '%', 'pct', 'Infrastruktur'),
    ('private_pkw_je_1000', 'Private PKW je 1 000 Einw.', '', 'per1000', 'Infrastruktur'),
]

# Referendums-Kennzahlen (immer verfuegbar)
REF_DEFS = [
    ('ja_pct', 'Ja-Anteil (Olympia)', '%', 'pct', 'Referendum'),
    ('nein_pct', 'Nein-Anteil (Olympia)', '%', 'pct', 'Referendum'),
    ('beteiligung_pct', 'Wahlbeteiligung', '%', 'pct', 'Referendum'),
]


def norm(s):
    s = s.lower().strip()
    for a, b in [('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss')]:
        s = s.replace(a, b)
    return re.sub(r'[^a-z0-9]', '', s)


def main():
    geo = json.load(open(GEO, encoding='utf-8'))
    ref = json.load(open(REF, encoding='utf-8'))
    ref_by_norm = {norm(k): v for k, v in ref.items()}

    prof = {}
    have_prof = os.path.exists(PROF)
    if have_prof:
        pj = json.load(open(PROF, encoding='utf-8'))
        prof = {norm(k): v for k, v in pj.get('data', pj).items()}
        print(f'Profil-Daten geladen: {len(prof)} Stadtteile')
    else:
        print('WARNUNG: Profil-Daten (PDF) noch nicht vorhanden, baue nur mit Referendum.')

    bw = {}
    have_bw = os.path.exists(BW)
    if have_bw:
        bj = json.load(open(BW, encoding='utf-8'))
        bw = {k: v for k, v in bj.items()}
        bw_by_norm = {norm(k): v for k, v in bj.items()}
        print(f'Buergerschaftswahl-Daten geladen: {len(bw)} Einheiten')

    matched_ref = matched_prof = 0
    for ft in geo['features']:
        name = ft['properties']['name']
        nn = norm(name)
        p = {'name': name}

        # Referendum zuordnen
        ru = REF_MAP.get(name)
        rec = ref.get(ru) if ru else ref_by_norm.get(nn)
        if rec:
            matched_ref += 1
            p['referendum_unit'] = rec['stadtteil']
            p['bezirk'] = rec['bezirk']
            for k in ('ja', 'nein', 'gueltig', 'berechtigte', 'abstimmende',
                      'ja_pct', 'nein_pct', 'beteiligung_pct', 'ergebnis'):
                p[k] = rec[k]
        else:
            print(f'  ! kein Referendum-Match: {name}')

        # Profil-Attribute zuordnen
        pr = prof.get(nn)
        if pr:
            matched_prof += 1
            vals = pr.get('values', pr)
            for key, *_ in ATTR_DEFS:
                v = vals.get(key)
                # Marker-Strings (-, ., x) -> null
                p[key] = v if isinstance(v, (int, float)) else None
        elif have_prof:
            print(f'  ! kein Profil-Match: {name}')

        # Buergerschaftswahl 2025 zuordnen
        if have_bw:
            bu = BW_MAP.get(name)
            brec = bw.get(bu) if bu else bw_by_norm.get(nn)
            if brec:
                p['bw_winner'] = brec['winner']
                p['bw_winner_key'] = brec['winner_key']
                p['bw_winner_pct'] = brec['winner_pct']
                p['bw_beteiligung_pct'] = brec['beteiligung_pct']
                p['bw_unit'] = brec['stadtteil']
                for key, *_ in BW_PARTIES:
                    p['bw_' + key] = brec['shares'].get(key)
            else:
                print(f'  ! kein Buergerschafts-Match: {name}')

        ft['properties'] = p

    os.makedirs(os.path.dirname(OUT_GEO), exist_ok=True)
    json.dump(geo, open(OUT_GEO, 'w', encoding='utf-8'), ensure_ascii=False)

    metrics = [{'key': k, 'label': l, 'unit': u, 'format': f, 'group': g}
               for (k, l, u, f, g) in REF_DEFS + (ATTR_DEFS if have_prof else [])]
    meta = {
        'metrics': metrics,
        'default_metric': 'ergebnis',
        'has_profile_data': have_prof,
        'has_buergerschaft': have_bw,
        'source_profile': 'Statistikamt Nord, Hamburger Stadtteil-Profile, Berichtsjahr 2024',
        'source_referendum': 'Statistikamt Nord, Olympia-Referendum 2026',
        'source_buergerschaft': 'Statistikamt Nord, Bürgerschaftswahl 2025 (Landesstimmen)',
    }
    if have_bw:
        tv = {k: sum(b['votes'][k] for b in bw.values()) for k, *_ in BW_PARTIES}
        tot = sum(tv.values()) or 1
        meta['buergerschaft'] = {
            'parties': [{'key': k, 'label': l, 'color': c, 'citywide': round(tv[k] / tot * 100, 1)}
                        for (k, l, c) in BW_PARTIES],
        }
    json.dump(meta, open(OUT_META, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    print(f'-> {OUT_GEO}  ({len(geo["features"])} Features, '
          f'Referendum-Match {matched_ref}, Profil-Match {matched_prof})')
    print(f'-> {OUT_META}  ({len(metrics)} Metriken, Buergerschaft: {have_bw})')


if __name__ == '__main__':
    main()
