from pathlib import Path
import json

PROJECT = Path('/home/user/ml-code/progressive-commercial-auto-reserving')

# $ millions. Commercial Lines net earned premium, from Progressive annual reports.
years = [2021, 2022, 2023, 2024, 2025]
commercial_lines_npe = [6945.2, 9088.3, 9899.0, 10707.0, 10881.0]

# Commercial Lines - Liability triangle, latest incurred and IBNR from the uploaded 2025 10-K.
latest_incurred = [3566, 4875, 5487, 5551, 5631]
reported_ibnr = [19, 117, 220, 467, 1200]
book_ultimate = [i + r for i, r in zip(latest_incurred, reported_ibnr)]

# Analyst-selected expected loss-ratio ranges on liability premium.
# These incorporate the commercial-line historical ratio series, mix, and loss-cost trends.
elr_low = [0.64, 0.67, 0.72, 0.66, 0.64]
elr_base = [0.68, 0.72, 0.76, 0.70, 0.68]
elr_high = [0.72, 0.77, 0.82, 0.74, 0.72]

# 10-K does not disclose liability-only earned premium. Use 85%-95% of Commercial Lines NPE as a sensitivity range,
# with 90% as the central allocation. The liability triangle dominates Commercial Lines vehicle reserves.
premium_share_low, premium_share_base, premium_share_high = 0.85, 0.90, 0.95

rows = []
for y, p, inc, ibnr, book, lo, base, hi in zip(
    years, commercial_lines_npe, latest_incurred, reported_ibnr, book_ultimate,
    elr_low, elr_base, elr_high
):
    unreported_pct = ibnr / book
    expected_low = p * premium_share_low * lo
    expected_base = p * premium_share_base * base
    expected_high = p * premium_share_high * hi
    bf_low = inc + unreported_pct * expected_low
    bf_base = inc + unreported_pct * expected_base
    bf_high = inc + unreported_pct * expected_high
    rows.append({
        'accident_year': y,
        'commercial_lines_npe': p,
        'liability_premium_proxy_base': p * premium_share_base,
        'unreported_pct_from_10k': unreported_pct,
        'elr_range': [lo, base, hi],
        'book_ultimate': book,
        'bf_ultimate_range': [bf_low, bf_base, bf_high],
    })

result = {
    'units': '$ millions',
    'premium_allocation': {
        'low': premium_share_low,
        'base': premium_share_base,
        'high': premium_share_high,
        'note': 'Liability-only NPE is not separately disclosed in the 2025 10-K.'
    },
    'rows': rows,
}

(PROJECT / 'outputs/pgr_commercial_auto_liability_estimates.json').write_text(json.dumps(result, indent=2) + '\n')
(PROJECT / 'outputs/pgr_commercial_auto_liability_estimates.md').write_text('''# Progressive commercial auto liability reserve range\n\nUnits are $ millions.\n\nThe analysis uses a Bornhuetter-Ferguson framework:\n\n`Ultimate = latest incurred + unreported percentage × expected ultimate`\n\nExpected ultimate is based on Commercial Lines net earned premium, an 85%-95% allocation of that premium to liability, and accident-year expected loss-ratio ranges. The unreported percentages are calibrated to the latest carried IBNR divided by carried ultimate from the uploaded 2025 10-K triangle.\n\n| AY | Book ultimate | BF low | BF base | BF high |\n|---:|---:|---:|---:|---:|\n| 2021 | 3,585 | 3,586 | 3,589 | 3,591 |\n| 2022 | 4,992 | 4,996 | 5,013 | 5,031 |\n| 2023 | 5,707 | 5,721 | 5,748 | 5,784 |\n| 2024 | 6,018 | 6,017 | 6,074 | 6,135 |\n| 2025 | 6,831 | 6,671 | 6,801 | 6,938 |\n\nThese are BF ranges, not a full model-risk range. They are intentionally close to carried values for mature accident years because the 10-K shows little remaining IBNR. The 2025 range has more sensitivity because 17.6% of the carried ultimate remains unreported.\n''')
print(json.dumps(result, indent=2))
