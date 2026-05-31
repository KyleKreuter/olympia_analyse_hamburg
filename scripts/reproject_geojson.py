#!/usr/bin/env python3
"""Reprojiziert die Stadtteil-GeoJSON von EPSG:3857 (Web Mercator) nach EPSG:4326 (WGS84).

Behaelt nur die Geometrie + den Stadtteil-Namen ("Name"). Die eingebetteten
Statistik-Werte (Stand ~2016/17) werden verworfen, da wir die 2024er Werte aus
dem PDF verwenden.

Eingabe : stadtteile_try1.geojson  (EPSG:3857)
Ausgabe : data/stadtteile_4326.geojson
"""
import json
import math
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'raw', 'stadtteile_raw_3857.geojson')
OUT = os.path.join(BASE, 'data', 'stadtteile_4326.geojson')

R = 6378137.0
ORIGIN = math.pi * R  # 20037508.342789244


def merc_to_wgs(x, y):
    lon = (x / ORIGIN) * 180.0
    lat = (y / ORIGIN) * 180.0
    lat = 180.0 / math.pi * (2.0 * math.atan(math.exp(lat * math.pi / 180.0)) - math.pi / 2.0)
    return [round(lon, 6), round(lat, 6)]


def convert(coords):
    # Rekursiv: Punkt [x,y] oder verschachtelte Listen
    if isinstance(coords[0], (int, float)):
        return merc_to_wgs(coords[0], coords[1])
    return [convert(c) for c in coords]


def main():
    d = json.load(open(SRC, encoding='utf-8'))
    feats = []
    for ft in d['features']:
        geom = ft['geometry']
        geom['coordinates'] = convert(geom['coordinates'])
        feats.append({
            'type': 'Feature',
            'properties': {'name': ft['properties'].get('Name', '').strip()},
            'geometry': geom,
        })
    out = {'type': 'FeatureCollection', 'features': feats}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)

    # Kontrolle: Bounding-Box sollte ungefaehr Hamburg sein (lon ~9.7-10.3, lat ~53.4-53.7)
    xs, ys = [], []
    def collect(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for x in c: collect(x)
    for ft in feats:
        collect(ft['geometry']['coordinates'])
    print(f'{len(feats)} Features reprojiziert -> {OUT}')
    print(f'BBox lon [{min(xs):.3f}, {max(xs):.3f}]  lat [{min(ys):.3f}, {max(ys):.3f}]')
    print('Namen-Beispiele:', ', '.join(sorted(ft['properties']['name'] for ft in feats)[:5]))


if __name__ == '__main__':
    main()
