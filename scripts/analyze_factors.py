#!/usr/bin/env python3
"""Reproduziert die statistische Kernanalyse des Reports (siehe README.md).

Berechnet auf den 90 Abstimmungs-Einheiten (data/analysis_units.csv):
  1. univariate Pearson-Korrelationen aller Merkmale mit dem Ja-Anteil,
  2. die Multikollinearität der sozioökonomischen Merkmale,
  3. eine standardisierte OLS-Regression (numpy, ohne scipy/sklearn),
  4. den inkrementellen Erklärungsgewinn der Parteivariablen,
  5. die größten Residuen-Abweichler.
"""
import csv
import json
import os
import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(BASE, 'data', 'analysis_units.csv')
META = os.path.join(BASE, 'app', 'data', 'metadata.json')


def load():
    rows = list(csv.DictReader(open(CSV, encoding='utf-8')))
    meta = json.load(open(META, encoding='utf-8'))
    labels = {m['key']: m['label'] for m in meta['metrics']}
    for p in meta['buergerschaft']['parties']:
        labels['bw_' + p['key']] = 'BW ' + p['label']
    return rows, labels


def col(rows, key):
    return np.array([float(r[key]) if r[key] not in ('', 'None') else np.nan for r in rows])


def pearson_pair(x, y):
    m = ~(np.isnan(x) | np.isnan(y))
    return np.corrcoef(x[m], y[m])[0, 1], int(m.sum())


def ols(X, y):
    """OLS mit Interzept. Liefert Beta, R2, Standardfehler, t-Werte."""
    n, k = X.shape
    Xi = np.column_stack([np.ones(n), X])
    beta, *_ = np.linalg.lstsq(Xi, y, rcond=None)
    resid = y - Xi @ beta
    dof = n - Xi.shape[1]
    sigma2 = resid @ resid / dof
    cov = sigma2 * np.linalg.inv(Xi.T @ Xi)
    se = np.sqrt(np.diag(cov))
    r2 = 1 - (resid @ resid) / ((y - y.mean()) @ (y - y.mean()))
    return beta, r2, se, beta / se, resid


def main():
    rows, labels = load()
    ja = col(rows, 'ja_pct')
    keys = [k for k in rows[0] if k not in ('unit', 'bezirk', 'ergebnis', 'bw_winner', 'bw_winner_key', 'ja_pct', 'nein_pct')]

    print('=== 1. Univariate Korrelationen mit ja_pct (Top 12 nach |r|) ===')
    cors = []
    for k in keys:
        r, n = pearson_pair(col(rows, k), ja)
        if not np.isnan(r):
            cors.append((k, r, n))
    for k, r, n in sorted(cors, key=lambda t: -abs(t[1]))[:12]:
        print(f'  {labels.get(k, k):42s} r={r:+.2f}  R2={r*r*100:4.0f}%  (n={n})')

    print('\n=== 2. Multikollinearität der Sozialmerkmale ===')
    soc = ['einkommen_je_stpfl', 'arbeitslose_pct', 'alleinerz_pct', 'schueler_gymnasium_pct', 'sgb2_pct']
    M = np.array([col(rows, k) for k in soc])
    mask = ~np.any(np.isnan(M), axis=0)
    C = np.corrcoef(M[:, mask])
    print('   ' + ' '.join(f'{k[:10]:>11s}' for k in soc))
    for i, k in enumerate(soc):
        print(f'{k[:10]:>11s} ' + ' '.join(f'{C[i, j]:+11.2f}' for j in range(len(soc))))

    print('\n=== 3. Standardisierte OLS (z-Scores) ===')
    preds = ['einkommen_je_stpfl', 'ue65_pct', 'auslaender_pct', 'whg_ein_zweifam_pct', 'private_pkw_je_1000']
    M = np.array([col(rows, k) for k in preds]).T
    m = ~np.any(np.isnan(M), axis=1) & ~np.isnan(ja)
    Xz = (M[m] - M[m].mean(0)) / M[m].std(0)
    yz = (ja[m] - ja[m].mean()) / ja[m].std()
    beta, r2, se, t, _ = ols(Xz, yz)
    print(f'   R2={r2:.3f}  (n={m.sum()})')
    for i, k in enumerate(preds):
        print(f'   {labels.get(k, k):42s} beta={beta[i+1]:+.2f}  t={t[i+1]:+.1f}')

    print('\n=== 4. Inkrementeller R2-Gewinn durch Parteivariablen ===')
    base = ['einkommen_je_stpfl', 'arbeitslose_pct', 'alleinerz_pct', 'schueler_gymnasium_pct']
    def r2_for(cols):
        M = np.array([col(rows, k) for k in cols]).T
        mm = ~np.any(np.isnan(M), axis=1) & ~np.isnan(ja)
        return ols(M[mm], ja[mm])[1], int(mm.sum())
    b, n = r2_for(base)
    print(f'   Sozial-Basis: R2={b:.3f} (n={n})')
    for p in ['bw_cdu', 'bw_linke', 'bw_gruene', 'bw_afd']:
        r, n = r2_for(base + [p])
        print(f'   + {labels.get(p, p):20s} R2={r:.3f}  dR2={r-b:+.3f}')

    print('\n=== 5. Größte Residuen-Abweichler (Sozial-Modell) ===')
    M = np.array([col(rows, k) for k in base]).T
    mm = ~np.any(np.isnan(M), axis=1) & ~np.isnan(ja)
    beta, r2, *_ = ols(M[mm], ja[mm])
    pred = np.column_stack([np.ones(mm.sum()), M[mm]]) @ beta
    resid = ja[mm] - pred
    names = [r['unit'] for i, r in enumerate(rows) if mm[i]]
    order = np.argsort(resid)
    print('   Überraschungs-Nein (negativste Residuen):')
    for i in order[:6]:
        print(f'     {names[i]:42s} ja={ja[mm][i]:5.1f}  erwartet={pred[i]:5.1f}  resid={resid[i]:+5.1f}')
    print('   Überraschungs-Ja (positivste Residuen):')
    for i in order[::-1][:6]:
        print(f'     {names[i]:42s} ja={ja[mm][i]:5.1f}  erwartet={pred[i]:5.1f}  resid={resid[i]:+5.1f}')


if __name__ == '__main__':
    main()
