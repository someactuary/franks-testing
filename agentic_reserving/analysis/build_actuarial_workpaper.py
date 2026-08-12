from pathlib import Path
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.formatting.rule import CellIsRule

PROJECT = Path('/home/user/ml-code/progressive-commercial-auto-reserving')
OUT = PROJECT / 'outputs/progressive_commercial_auto_liability_workpaper.xlsx'

# Source data: $ millions unless noted.
years = [2021, 2022, 2023, 2024, 2025]
ages = [12, 24, 36, 48, 60]
incurred = {
    2021: [3447, 3527, 3574, 3581, 3566],
    2022: [4526, 4835, 4862, 4875, None],
    2023: [5456, 5502, 5487, None, None],
    2024: [5552, 5551, None, None, None],
    2025: [5631, None, None, None, None],
}
paid = {
    2021: [574, 1546, 2414, 2990, 3316],
    2022: [749, 2086, 3232, 3976, None],
    2023: [848, 2307, 3474, None, None],
    2024: [853, 2150, None, None, None],
    2025: [784, None, None, None, None],
}
ibnr = {2021: 19, 2022: 117, 2023: 220, 2024: 467, 2025: 1200}
npe = {2021: 6945.2, 2022: 9088.3, 2023: 9899.0, 2024: 10707.0, 2025: 10881.0}
elr_low = {2021: .64, 2022: .67, 2023: .72, 2024: .66, 2025: .64}
elr_base = {2021: .68, 2022: .72, 2023: .76, 2024: .70, 2025: .68}
elr_high = {2021: .72, 2022: .77, 2023: .82, 2024: .74, 2025: .72}

# Colors
navy = '1F4E78'
blue_fill = PatternFill('solid', fgColor='D9EAF7')
input_fill = PatternFill('solid', fgColor='FFF2CC')
formula_fill = PatternFill('solid', fgColor='E2F0D9')
check_fill = PatternFill('solid', fgColor='C6EFCE')
warning_fill = PatternFill('solid', fgColor='FCE4D6')
white_font = Font(color='FFFFFF', bold=True)
header_font = Font(bold=True, color='FFFFFF')
small_italic = Font(italic=True, color='666666', size=9)
thin_gray = Side(style='thin', color='D9E1F2')

wb = Workbook()
wb.remove(wb.active)
wb.calculation.fullCalcOnLoad = True
wb.calculation.forceFullCalc = True
wb.calculation.calcMode = 'auto'


def setup_sheet(ws, title, subtitle=None):
    ws.sheet_view.showGridLines = False
    ws['A1'] = title
    ws['A1'].font = Font(size=14, bold=True, color=navy)
    if subtitle:
        ws['A2'] = subtitle
        ws['A2'].font = small_italic
    ws.freeze_panes = 'A5'


def style_header(row_cells):
    for c in row_cells:
        c.fill = PatternFill('solid', fgColor=navy)
        c.font = header_font
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        c.border = Border(bottom=Side(style='thin', color='FFFFFF'))


def format_range(ws, min_row, max_row, min_col, max_col, fmt='#,##0.0'):
    for row in ws.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
        for c in row:
            c.number_format = fmt

# README / instructions
ws = wb.create_sheet('README')
setup_sheet(ws, 'Progressive Commercial Auto Liability Reserving Workpaper', 'Prepared August 6, 2026 | Units are $ millions unless otherwise noted')
readme = [
    ('Purpose', 'Credentialed-actuary workpaper supporting the initial commercial auto liability reserve range analysis.'),
    ('Source data', 'Progressive 2025 Form 10-K: Commercial Lines – Liability triangles and reserve disclosures, printed pages 105 and 146-147; Commercial Lines premium data, printed page 136. Prior Progressive annual reports provide 2021-2022 Commercial Lines NPE and historical ratios.'),
    ('Scope', 'Commercial Lines liability triangle. The 10-K discusses commercial auto liability reserves including TNC; core commercial auto trend disclosures exclude TNC and Fleet & Specialty, so this distinction is material.'),
    ('Method', 'Bornhuetter-Ferguson using latest incurred, 10-K implied unreported percentages, a liability premium allocation assumption, and selected expected loss ratios.'),
    ('Premium limitation', 'Liability-only earned premium is not separately disclosed. The workpaper uses 85%-95% of Commercial Lines NPE as a sensitivity range, with 90% central.'),
    ('ELR limitation', 'The selected ELRs are analyst assumptions informed by Progressive historical Commercial Lines loss ratios and disclosed severity/frequency/rate trends. They are not company guidance.'),
    ('Color convention', 'Yellow = hardcoded input/assumption; green = formula/output; blue = section header.'),
]
for r, (label, text) in enumerate(readme, start=4):
    ws.cell(r, 1, label).font = Font(bold=True, color=navy)
    ws.cell(r, 2, text).alignment = Alignment(wrap_text=True, vertical='top')
    ws.row_dimensions[r].height = 42 if label not in ('Purpose', 'Scope') else 30
ws.column_dimensions['A'].width = 24
ws.column_dimensions['B'].width = 115

# Source data sheet
ws = wb.create_sheet('Source_Data')
setup_sheet(ws, 'Source Data and Assumptions', 'Hardcoded source values and analyst assumptions')
headers = ['Accident Year', 'Commercial Lines NPE', 'Latest Incurred', '10-K IBNR', 'Book Ultimate', 'Unreported %', 'ELR Low', 'ELR Base', 'ELR High', 'Premium Share Low', 'Premium Share Base', 'Premium Share High', 'Source / Comment']
for col, h in enumerate(headers, 1): ws.cell(4, col, h)
style_header(ws[4])
for r, y in enumerate(years, 5):
    latest_inc = next(v for v in reversed(incurred[y]) if v is not None)
    vals = [y, npe[y], latest_inc, ibnr[y], f'=C{r}+D{r}', f'=D{r}/E{r}', elr_low[y], elr_base[y], elr_high[y], .85, .90, .95, '10-K triangle / analyst assumption']
    for c, v in enumerate(vals, 1):
        cell = ws.cell(r, c, v)
        cell.fill = input_fill if c in [1,2,3,4,7,8,9,10,11,12,13] else formula_fill
        if c == 13: cell.alignment = Alignment(wrap_text=True)
for c in range(2, 6): format_range(ws, 5, 9, c, c, '#,##0.0')
for c in range(6, 13): format_range(ws, 5, 9, c, c, '0.0%')
ws.auto_filter.ref = 'A4:M9'
for col, width in {'A':14,'B':18,'C':17,'D':12,'E':15,'F':14,'G':11,'H':11,'I':11,'J':15,'K':17,'L':16,'M':32}.items(): ws.column_dimensions[col].width = width

# Triangle sheets
for sheet_name, title, data in [('Incurred_Triangle', 'Commercial Lines Liability - Incurred Triangle', incurred), ('Paid_Triangle', 'Commercial Lines Liability - Paid Triangle', paid)]:
    ws = wb.create_sheet(sheet_name)
    setup_sheet(ws, title, 'Net of reinsurance | Source: Progressive 2025 Form 10-K, printed page 105')
    hdr = ['Accident Year'] + [f'{a} months' for a in ages] + ['Latest Value', 'Latest Age']
    for c,h in enumerate(hdr,1): ws.cell(4,c,h)
    style_header(ws[4])
    for r,y in enumerate(years,5):
        ws.cell(r,1,y).fill = input_fill
        for c,v in enumerate(data[y],2):
            cell=ws.cell(r,c,v)
            cell.fill = input_fill
            cell.number_format = '#,##0.0'
        latest_col = max(c for c,v in enumerate(data[y],2) if v is not None)
        ws.cell(r,7, f'=INDEX(B{r}:F{r},1,COUNT(B{r}:F{r}))').fill = formula_fill
        ws.cell(r,8, f'=LOOKUP(2,1/(B{r}:F{r}<>""),B$4:F$4)').fill = formula_fill
        ws.cell(r,7).number_format = '#,##0.0'
    ws['A11'] = 'Total'
    ws['A11'].font = Font(bold=True)
    for c in range(2,8):
        ws.cell(11,c, f'=SUM({get_column_letter(c)}5:{get_column_letter(c)}9)')
        ws.cell(11,c).fill = formula_fill
        ws.cell(11,c).number_format = '#,##0.0'
    for col,width in {'A':15,'B':14,'C':14,'D':14,'E':14,'F':14,'G':15,'H':12}.items(): ws.column_dimensions[col].width=width

# Development factors
ws = wb.create_sheet('Development_Factors')
setup_sheet(ws, 'Development Factor Workpaper', 'Observed age-to-age factors, volume-weighted selections, and 10-K implied tail diagnostics')
ws['A4'] = 'Incurred Development Factors'; ws['A4'].font = Font(bold=True, color=navy)
headers = ['Age-to-Age'] + [str(y) for y in years] + ['Volume-Weighted Selected']
for c,h in enumerate(headers,1): ws.cell(5,c,h)
style_header(ws[5])
for r, (from_age, to_age) in enumerate(zip(ages[:-1], ages[1:]), 6):
    ws.cell(r,1,f'{from_age}-{to_age}')
    from_col = 2 + ages.index(from_age)
    to_col = 2 + ages.index(to_age)
    for idx,y in enumerate(years,2):
        src_row = 5 + years.index(y)
        if incurred[y][ages.index(from_age)] is not None and incurred[y][ages.index(to_age)] is not None:
            ws.cell(r,idx, f'=IFERROR({get_column_letter(to_col)}{src_row}/{get_column_letter(from_col)}{src_row},"")')
        ws.cell(r,idx).number_format='0.0000'
    # weighted selected = sum next diagonal / sum current diagonal over available rows
    nums = [incurred[y][ages.index(to_age)] for y in years if incurred[y][ages.index(from_age)] is not None and incurred[y][ages.index(to_age)] is not None]
    dens = [incurred[y][ages.index(from_age)] for y in years if incurred[y][ages.index(from_age)] is not None and incurred[y][ages.index(to_age)] is not None]
    ws.cell(r,7, f'=SUM({get_column_letter(to_col)}5:{get_column_letter(to_col)}{4+len(years)})/SUM({get_column_letter(from_col)}5:{get_column_letter(from_col)}{4+len(years)})')
    ws.cell(r,7).number_format='0.0000'
    for c in range(2,8): ws.cell(r,c).fill = formula_fill

base = 10
ws.cell(base,1,'Incurred cumulative factor to 60 months').font=Font(bold=True)
for c,a in enumerate(ages,2):
    if a == 60: ws.cell(base,c,1)
    else:
        factors = [f'G{6+i}' for i in range(ages.index(a),4)]
        ws.cell(base,c,'='.join([''] + factors) if False else '=PRODUCT(' + ','.join(factors) + ')')
    ws.cell(base,c).number_format='0.0000'; ws.cell(base,c).fill=formula_fill

# Paid section
start=13
ws.cell(start,1,'Paid Development Factors'); ws.cell(start,1).font=Font(bold=True,color=navy)
for c,h in enumerate(headers,1): ws.cell(start+1,c,h)
style_header(ws[start+1])
for r, (from_age, to_age) in enumerate(zip(ages[:-1], ages[1:]), start+2):
    ws.cell(r,1,f'{from_age}-{to_age}')
    from_col=2+ages.index(from_age); to_col=2+ages.index(to_age)
    for idx,y in enumerate(years,2):
        src_row=5+years.index(y)
        if paid[y][ages.index(from_age)] is not None and paid[y][ages.index(to_age)] is not None:
            ws.cell(r,idx,f'=IFERROR({get_column_letter(to_col)}{src_row}/{get_column_letter(from_col)}{src_row},"")')
        ws.cell(r,idx).number_format='0.0000'
    ws.cell(r,7, f'=SUM({get_column_letter(to_col)}5:{get_column_letter(to_col)}9)/SUM({get_column_letter(from_col)}5:{get_column_letter(from_col)}9)')
    ws.cell(r,7).number_format='0.0000'
    for c in range(2,8): ws.cell(r,c).fill=formula_fill
ws.cell(18,1,'Paid cumulative factor to 60 months').font=Font(bold=True)
for c,a in enumerate(ages,2):
    if a == 60: ws.cell(18,c,1)
    else:
        factors=[f'G{15+i}' for i in range(ages.index(a),4)]
        ws.cell(18,c,'=PRODUCT(' + ','.join(factors) + ')')
    ws.cell(18,c).number_format='0.0000'; ws.cell(18,c).fill=formula_fill

ws['A21']='10-K implied incurred CDF to ultimate'; ws['A21'].font=Font(bold=True,color=navy)
for c,h in enumerate(['Accident Year','Latest Incurred','10-K IBNR','Book Ultimate','Implied CDF','Implied Unreported %'],1): ws.cell(22,c,h)
style_header(ws[22])
for r,y in enumerate(years,23):
    src=5+years.index(y)
    vals=[y,f'=Source_Data!C{src}',f'=Source_Data!D{src}',f'=Source_Data!E{src}',f'=D{r}/B{r}',f'=C{r}/D{r}']
    for c,v in enumerate(vals,1):
        ws.cell(r,c,v); ws.cell(r,c).fill=formula_fill; ws.cell(r,c).number_format='0.0000' if c>=5 else '#,##0.0'
for col,width in {'A':26,'B':14,'C':14,'D':15,'E':15,'F':19,'G':22}.items(): ws.column_dimensions[col].width=width

# BF workpaper
ws = wb.create_sheet('BF_Workpaper')
setup_sheet(ws, 'Bornhuetter-Ferguson Workpaper', 'Expected loss ratio method underlies the BF expected ultimate')
headers=['AY','Commercial Lines NPE','Premium Share Low','Premium Share Base','Premium Share High','Liability NPE Low','Liability NPE Base','Liability NPE High','ELR Low','ELR Base','ELR High','Expected Ult Low','Expected Ult Base','Expected Ult High','Latest Incurred','Unreported %','BF Ult Low','BF Ult Base','BF Ult High']
for c,h in enumerate(headers,1): ws.cell(4,c,h)
style_header(ws[4])
for r,y in enumerate(years,5):
    sr=5+years.index(y)
    vals=[y,f'=Source_Data!B{sr}',f'=Source_Data!J{sr}',f'=Source_Data!K{sr}',f'=Source_Data!L{sr}',f'=B{r}*C{r}',f'=B{r}*D{r}',f'=B{r}*E{r}',f'=Source_Data!G{sr}',f'=Source_Data!H{sr}',f'=Source_Data!I{sr}',f'=F{r}*I{r}',f'=G{r}*J{r}',f'=H{r}*K{r}',f'=Source_Data!C{sr}',f'=Source_Data!F{sr}',f'=O{r}+P{r}*L{r}',f'=O{r}+P{r}*M{r}',f'=O{r}+P{r}*N{r}']
    for c,v in enumerate(vals,1):
        ws.cell(r,c,v); ws.cell(r,c).fill=formula_fill if c not in [1] else input_fill
        ws.cell(r,c).number_format='0.0%' if c in [3,4,5,9,10,11,16] else '#,##0.0'
ws['A12']='Total / Weighted'; ws['A12'].font=Font(bold=True)
for c in [2,6,7,8,12,13,14,15,17,18,19]:
    ws.cell(12,c,f'=SUM({get_column_letter(c)}5:{get_column_letter(c)}9)'); ws.cell(12,c).fill=formula_fill; ws.cell(12,c).number_format='#,##0.0'
ws['P12']='=' + 'SUMPRODUCT(P5:P9,O5:O9)/SUM(O5:O9)'; ws['P12'].number_format='0.0%'; ws['P12'].fill=formula_fill
ws['A15']='Formula notes'; ws['A15'].font=Font(bold=True,color=navy)
notes=[
    'Expected ultimate = liability premium proxy × selected expected loss ratio.',
    'BF ultimate = latest incurred + implied unreported % × expected ultimate.',
    'Implied unreported % = 10-K IBNR / 10-K carried ultimate.',
    'Premium allocation sensitivity is 85%-95%; central assumption is 90%.',
]
for r,n in enumerate(notes,16): ws.cell(r,1,n).alignment=Alignment(wrap_text=True); ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=8)
for c in range(1,20): ws.column_dimensions[get_column_letter(c)].width=14
ws.column_dimensions['A'].width=10

# Summary
ws = wb.create_sheet('Reserve_Summary')
setup_sheet(ws, 'Reserve Summary and Reconciliation', 'BF range compared with the 10-K carried ultimate')
headers=['AY','Book Latest Incurred','Book IBNR','Book Ultimate','BF Low','BF Base','BF High','BF Base vs Book','Book IBNR %']
for c,h in enumerate(headers,1): ws.cell(4,c,h)
style_header(ws[4])
for r,y in enumerate(years,5):
    sr=5+years.index(y); br=5+years.index(y)
    vals=[y,f'=Source_Data!C{sr}',f'=Source_Data!D{sr}',f'=Source_Data!E{sr}',f'=BF_Workpaper!Q{br}',f'=BF_Workpaper!R{br}',f'=BF_Workpaper!S{br}',f'=F{r}-D{r}',f'=C{r}/D{r}']
    for c,v in enumerate(vals,1):
        ws.cell(r,c,v); ws.cell(r,c).fill=formula_fill; ws.cell(r,c).number_format='0.0%' if c==9 else '#,##0.0'
ws['A12']='Key interpretation'; ws['A12'].font=Font(bold=True,color=navy)
ws['A13']='BF ranges remain close to carried values for mature accident years because the 10-K implied unreported percentages are small. AY2025 is more sensitive because 17.6% of carried ultimate remains unreported.'
ws.merge_cells('A13:I14'); ws['A13'].alignment=Alignment(wrap_text=True, vertical='top'); ws['A13'].fill=warning_fill
for col,width in {'A':10,'B':18,'C':12,'D':14,'E':12,'F':12,'G':12,'H':16,'I':14}.items(): ws.column_dimensions[col].width=width

# QC checks
ws = wb.create_sheet('QC_Checks')
setup_sheet(ws, 'Quality Control Checks', 'All checks should show PASS after opening in Excel or Google Sheets')
headers=['Check','Formula / Basis','Result','Status']
for c,h in enumerate(headers,1): ws.cell(4,c,h)
style_header(ws[4])
checks=[
    ('Book ultimate arithmetic', 'Latest incurred + 10-K IBNR = book ultimate', '=SUMPRODUCT(Source_Data!C5:C9,Source_Data!D5:D9*0+1)+SUM(Source_Data!D5:D9)-SUM(Source_Data!E5:E9)', '=IF(C5=0,"PASS","CHECK")'),
    ('BF low ≤ base ≤ high', 'Each accident year', '=SUMPRODUCT(--(BF_Workpaper!Q5:Q9<=BF_Workpaper!R5:R9),--(BF_Workpaper!R5:R9<=BF_Workpaper!S5:S9))', '=IF(C6=5,"PASS","CHECK")'),
    ('Premium share ordered', '85% ≤ 90% ≤ 95%', '=IF(AND(Source_Data!J5<=Source_Data!K5,Source_Data!K5<=Source_Data!L5),1,0)', '=IF(C7=1,"PASS","CHECK")'),
    ('ELR ordered', 'Low ≤ Base ≤ High for each AY', '=SUMPRODUCT(--(Source_Data!G5:G9<=Source_Data!H5:H9),--(Source_Data!H5:H9<=Source_Data!I5:I9))', '=IF(C8=5,"PASS","CHECK")'),
    ('BF base vs book total', 'Diagnostic only; not expected to equal zero', '=SUM(BF_Workpaper!R5:R9)-SUM(Source_Data!E5:E9)', 'INFO'),
]
for r,(name,basis,formula,status) in enumerate(checks,5):
    ws.cell(r,1,name); ws.cell(r,2,basis); ws.cell(r,3,formula); ws.cell(r,4,status)
    for c in range(1,5): ws.cell(r,c).alignment=Alignment(wrap_text=True, vertical='top')
    ws.cell(r,3).fill=formula_fill; ws.cell(r,4).fill=check_fill if r<9 else warning_fill
ws.column_dimensions['A'].width=28; ws.column_dimensions['B'].width=45; ws.column_dimensions['C'].width=18; ws.column_dimensions['D'].width=14

# Add consistent borders and tab colors
for ws in wb.worksheets:
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.tabColor = navy
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is not None and cell.row >= 4:
                cell.border = Border(bottom=thin_gray)

# Make input cells visually distinct on source and triangle sheets.
for sheet in ['Source_Data','Incurred_Triangle','Paid_Triangle']:
    for row in wb[sheet].iter_rows():
        for cell in row:
            if cell.value is not None and cell.row >= 5 and cell.fill == PatternFill():
                cell.fill = input_fill

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)

# Reopen to verify workbook integrity and expected sheets.
check = load_workbook(OUT, data_only=False)
print('saved', OUT)
print('sheets', check.sheetnames)
print('size_bytes', OUT.stat().st_size)
