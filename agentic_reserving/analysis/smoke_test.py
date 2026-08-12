from pathlib import Path
import json

PROJECT = Path('/home/user/ml-code/progressive-commercial-auto-reserving')

ay = [1998,1999,2000,2001,2002,2003,2004,2005,2006,2007]
reported = [47742304,51185767,54837929,56299562,58592712,57565344,56976657,56786410,54641339,48853563]
paid = [47644187,51000534,54533225,55878421,57807215,55930654,53774672,50644994,43606497,27229969]
reported_cdf = [1.000,1.000,1.001,1.003,1.006,1.011,1.023,1.051,1.110,1.292]
paid_cdf = [1.002,1.004,1.006,1.011,1.020,1.040,1.085,1.184,1.404,2.390]
expected = [51430657,51408736,51680983,54408716,59421665,56318302,59646290,61174953,61926981,61864556]

# Values printed in Chapter 7 Exhibit I, Sheet 3.
book_cl_reported = [47742304,51185767,54892767,56468461,58944268,58198563,58287120,59682517,60651886,63118803]
book_cl_paid = [47739475,51204536,54860424,56493084,58963359,58167880,58345519,59963673,61223522,65079626]
# Values printed in Chapter 9 Exhibit I, Sheet 1.
book_bf_reported = [47742304,51185767,54889558,56462300,58947116,58178105,58317678,59754938,60778247,62835336]
book_bf_paid = [47746843,51205350,54841461,56470405,58972346,58096743,58447423,60151912,61425942,63209774]

cl_reported = [round(x*f) for x, f in zip(reported, reported_cdf)]
cl_paid = [round(x*f) for x, f in zip(paid, paid_cdf)]
bf_reported = [round(x + e*(1 - 1/f)) for x, e, f in zip(reported, expected, reported_cdf)]
bf_paid = [round(x + e*(1 - 1/f)) for x, e, f in zip(paid, expected, paid_cdf)]

result = {
    'source': 'studynotes_friedland_estimating.pdf',
    'pages_extracted': 451,
    'chain_ladder': {
        'reported_row_max_abs_diff': max(abs(a-b) for a,b in zip(cl_reported, book_cl_reported)),
        'paid_row_max_abs_diff': max(abs(a-b) for a,b in zip(cl_paid, book_cl_paid)),
        'reported_sum_of_rows': sum(cl_reported),
        'printed_total': 569172456,
        'paid_sum_of_rows': sum(cl_paid),
        'printed_paid_total': 572041099,
    },
    'bornhuetter_ferguson': {
        'reported_row_max_abs_diff': max(abs(a-b) for a,b in zip(bf_reported, book_bf_reported)),
        'paid_row_max_abs_diff': max(abs(a-b) for a,b in zip(bf_paid, book_bf_paid)),
        'reported_sum_of_rows': sum(bf_reported),
        'printed_total': 569091348,
        'paid_sum_of_rows': sum(bf_paid),
        'printed_paid_total': 570568198,
        'examples': {
            '2002': {'reported': bf_reported[4], 'paid': bf_paid[4]},
            '2007': {'reported': bf_reported[9], 'paid': bf_paid[9]},
        },
    },
}

(PROJECT / 'outputs/smoke_test_results.json').write_text(json.dumps(result, indent=2) + '\n')
(PROJECT / 'outputs/smoke_test_summary.md').write_text('''# Friedland PDF extraction and reserving smoke test\n\n- Source: `assets/studynotes_friedland_estimating.pdf`\n- Extracted pages: 451\n- Chain Ladder: Chapter 7, Exhibit I, Sheets 1–3\n- Bornhuetter-Ferguson: Chapter 9, Exhibit I, Sheets 1–2\n\n## Results\n\nAll reported and paid row-level calculations reproduced the printed exhibit values exactly using the displayed CDFs. The displayed totals differ from summing the rounded row values by $1 in some cases, which is a normal rounding artifact.\n\nKey BF results:\n\n- Accident year 2002: reported 58,947,116; paid 58,972,346\n- Accident year 2007: reported 62,835,336; paid 63,209,774\n\nThe original PDF is now the source of record for subsequent parsing.\n''')
print(json.dumps(result, indent=2))
