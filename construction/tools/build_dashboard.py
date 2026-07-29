#!/usr/bin/env python3
"""Build the construction expense dashboard from a Kotak account-statement CSV.

    python3 tools/build_dashboard.py statement.csv -o construction_expense_dashboard.html

Re-run it whenever a new statement arrives. Categorisation done inside the
dashboard lives in the browser, so export a backup first and restore it after
rebuilding, or extend VENDOR_RULES below so the new seed already knows the vendor.
"""
import argparse, csv, json, re, sys
from collections import defaultdict
from pathlib import Path


# ---------------------------------------------------------------- parse

def parse(csv_path):
    rows = list(csv.reader(open(csv_path, encoding='utf-8-sig')))
    hdr = next(i for i, r in enumerate(rows) if r and r[0] == 'Sl. No.')
    out = []
    for r in rows[hdr + 1:]:
        if not (r and r[0].strip().isdigit()):
            continue
        sl, tdate, vdate, desc, ref, amt, drcr, bal, bdr = r[:9]
        amount = float(amt.replace(',', ''))
        if drcr.strip().upper() == 'DR':
            amount = -amount
        dd, mm, yy = vdate.strip().split('-')
        out.append({
            'sl': int(sl),
            'date': f'{yy}-{mm}-{dd}',
            'raw': desc.strip(),
            'ref': ref.strip(),
            'amount': round(amount, 2),
        })
    return out


# ------------------------------------------------- counterparty extraction

def counterparty(raw):
    """Pull the human/merchant name out of a bank narration."""
    if raw.startswith('REV-UPI/'):
        return 'Reversal: ' + raw.split('/')[1].strip()
    if raw.startswith('UPI/'):
        parts = raw.split('/')
        return re.sub(r'\s+', ' ', parts[1]).strip()
    if raw.startswith('Sweep Trf From:'):
        return 'Sweep Transfer (in)'
    if raw.startswith('SWEEP TRANSFER TO'):
        return 'Sweep Transfer (out)'
    if raw.startswith('FD PREMAT PROCEEDS'):
        return 'FD Premature Proceeds'
    if raw.startswith('Int.Pd'):
        return 'Bank Interest Paid'
    if 'BOB LOAN COLLECTION' in raw:
        return 'Bank of Baroda (Loan EMI)'
    if 'L&TFINANCELTD' in raw:
        return 'L&T Finance (Loan EMI)'
    if 'BAJAJ FINANCE' in raw:
        return 'Bajaj Finance (Loan EMI)'
    if 'VELOCIFY DIGITAL' in raw:
        return 'Velocify Digital Solutions LLP'
    if 'RAISE SECURITIES' in raw:
        return 'Raise Securities'
    if raw.startswith('MB:SENT NEFT NILESH SAHU'):
        return 'Self Transfer (Nilesh Sahu)'
    return re.sub(r'\s+', ' ', raw)[:40].strip()


# Aliases -> canonical vendor name. Bank narrations truncate at ~14 chars, so the
# same person shows up under several spellings.
ALIASES = {
    'BAROT GAUTAMBHA': 'Gautambhai Barot',
    'BAROT GAUTAMBH': 'Gautambhai Barot',
    'RAJPUROHIT GAU': 'Rajpurohit (Granite)',
    'RAJPUROHIT MAH': 'Rajpurohit (Granite)',
    'PATEL JAY MAHE': 'Patel Jay Mahendrabhai',
    'PATEL JAY MAHEN': 'Patel Jay Mahendrabhai',
    'JAY MAHENDRABH': 'Patel Jay Mahendrabhai',
    'Dalwala Jignash': 'Dalwala Jignesh',
    'Dalwala Jignas': 'Dalwala Jignesh',
    'VANDAN NARESHBH': 'Patel Vandan',
    'Patel Vandan': 'Patel Vandan',
    'ARUNKUMAR RAMS': 'Arunkumar Ramshankar',
    'ARUNKUMAR RAMSH': 'Arunkumar Ramshankar',
    'BAROT VIJAY MA': 'Barot Vijay',
    'BAROT VIJAY MAT': 'Barot Vijay',
    'PATEL SMIT': 'Patel Smit',
    'Patel Smit': 'Patel Smit',
    'SMIT HIMANSHUBH': 'Smit Himanshubhai',
    'Akshar Gruh Ud': 'Akshar Gruh Udhyog',
    'Akshar Gruh Udh': 'Akshar Gruh Udhyog',
    'SHAILENDRAKUMA': 'Shailendrakumar',
    'SHAILENDRAKUMAR': 'Shailendrakumar',
    'Kiran Devi': 'Kiran Devi',
    'Indian Clearin': 'Indian Clearing Corp (SIP)',
    'Indian Clearing': 'Indian Clearing Corp (SIP)',
    'CRED Club': 'CRED (Credit Card)',
    'CRED': 'CRED (Credit Card)',
    'CRED Store': 'CRED (Credit Card)',
    'Kachhad Jitubh': 'Kachhad Jitubhai',
    'SHAIKH MOHAMME': 'Shaikh Mohammed',
    'MAYA LED LIGHT': 'Maya LED Light',
    'REAL BRICKS': 'Real Bricks',
    'DEVASHREE STEEL': 'Devashree Steel',
    'SHREE MOMAI CE': 'Shree Momai Cement',
    'SATGURU STONE': 'Satguru Stone',
    'Shyam Hardware': 'Shyam Hardware',
    'dumAniya Hardi': 'Dumaniya Hardware',
    'Shiv Traders 2': 'Shiv Traders',
    'Vardhman Selec': 'Vardhman Selection',
    'PHULWARIA NAND': 'Phulwaria Nand',
    'MOMIN ATHARALI': 'Momin Atharali',
    'CHAUHAN PINTA': 'Chauhan Pinta',
    'CHAUHAN SUMIT': 'Chauhan Sumit',
    'Mahendra Singh': 'Mahendra Singh',
    'Jethu Lal': 'Jethu Lal',
    'LILESH ISHWARBH': 'Lilesh Ishwarbhai',
    'PATEL KASMIRAB': 'Patel Kasmiraben',
    'Krishana Kumar': 'Krishana Kumar',
    'SORAV RAJENDRA': 'Sorav Rajendra',
    'Patni Ajaybhai': 'Patni Ajaybhai',
    'DHANLAXMI SALE': 'Dhanlaxmi Sales',
    'KAMAL FRUIT CEN': 'Kamal Fruit Centre',
    'HP Gas Cylinde': 'HP Gas',
    'APPLE MEDIA SER': 'Apple Media Services',
    'Astha Medicines': 'Astha Medicines',
    'Suruchi Foods': 'Suruchi Foods',
    'Airtel': 'Airtel',
    'Jio': 'Jio',
    'Raise Securitie': 'Raise Securities',
    'SHAH KENIL NITI': 'Shah Kenil (MIP)',
    'Sanjay Singhal': 'Sanjay Singhal',
    'BHAGIRATH N FA': 'Bhagirath N.',
    'MUKESH BHARATBH': 'Mukesh Bharatbhai',
    'GOVIND MAFATLAL': 'Govind Mafatlal',
    'ASHOK PARMANAN': 'Ashok Parmanand',
    'AVANIBEN THOMA': 'Avaniben Thomas',
    'MUNDHAVA VIJAY': 'Mundhava Vijay',
    'MANUBHAI RAYABH': 'Manubhai Rayabhai',
    'MR NASIT BHIKHU': 'Nasit Bhikhubhai',
    'Bharat Singh': 'Bharat Singh',
    'BHIKHUBHAI VITH': 'Bhikhubhai Vitthal',
    'Mr BABULAL PUNM': 'Babulal Punmaram',
    'Mr HARI SHANKAR': 'Hari Shankar',
    'Mr KAUSHIK DEV': 'Kaushik Dev',
    'RANJITBHAI CHA': 'Ranjitbhai Chauhan',
    'DILIPKUMAR MAHE': 'Dilipkumar Mahendra',
    'NANJI RAM': 'Nanji Ram',
    'Nadiya Dhaval': 'Nadiya Dhaval',
    'SANJAY THAKOR': 'Sanjay Thakor',
    'PATEL HELLYBEN': 'Patel Hellyben',
    'Himanshu Prata': 'Himanshu Pratap',
    'RAJPUT SURJITS': 'Rajput Surjitsingh',
    'DESAI MOHAN KO': 'Desai Mohan',
    'Nitaben Bhikhab': 'Nitaben Bhikhabhai',
    'PASVAN PRADIP': 'Pasvan Pradip',
    'PATEL RAMILABEN': 'Patel Ramilaben',
    'GAMI NAYAN GIR': 'Gami Nayan Giri',
    'DALPATBHAI DOM': 'Dalpatbhai Dom',
    'KAVISH RAJENDR': 'Kavish Rajendra',
    'Mrs NANHI KUMA': 'Nanhi Kumari',
    'BHARATBHAI KALI': 'Bharatbhai Kali',
    'SATISHKUMAR NA': 'Satishkumar N.',
    'SHUBHAM CHAURA': 'Shubham Chaurasia',
    'DivineCast': 'DivineCast',
}


def canonical(name):
    key = re.sub(r'\s+', ' ', name).strip()
    if key in ALIASES:
        return ALIASES[key]
    # title-case fallback for ALL-CAPS bank names
    if key.isupper() and len(key) > 3:
        return key.title()
    return key


# ------------------------------------------------------------- taxonomy
# category -> {sub: kind}  where kind is construction | excluded
TAXONOMY = {
    'Labour & Contractors': [
        'Main Civil Contractor', 'Masonry & RCC Labour', 'Painting Contractor',
        'False Ceiling Contractor', 'Electrical Labour', 'Plumbing Labour',
        'Carpentry Labour', 'Tiling & Flooring Labour', 'Daily Wage / Petty Labour',
        'Unassigned Labour / Vendor',
    ],
    'Structural Material': [
        'Cement', 'Steel / TMT Bars', 'Bricks & Blocks', 'Sand & Aggregate',
        'RMC / Concrete', 'Waterproofing',
    ],
    'Stone, Tile & Flooring': [
        'Granite & Marble', 'Tiles', 'Kota / Stone Slabs', 'Adhesives & Grout',
    ],
    'Electrical & Lighting': [
        'Switches & Panels', 'Lighting & Fixtures', 'Wiring & Cables', 'Fans & Appliances',
    ],
    'Plumbing & Sanitary': [
        'Pipes & Fittings', 'Sanitaryware', 'CP Fittings & Taps', 'Water Tank & Pump',
    ],
    'Interior & Fit-out': [
        'Furniture & Carpentry', 'Modular Kitchen', 'Wardrobes & Storage',
        'False Ceiling Material', 'Glass & Aluminium', 'Doors & Windows',
    ],
    'Finishes': [
        'Paint & Primer', 'Putty & Plaster', 'Polish & Coatings',
    ],
    'Hardware & Consumables': [
        'Hardware Store', 'Tools & Equipment', 'Fasteners & Misc',
    ],
    'Site & Overheads': [
        'Transport & Freight', 'Site Utilities', 'Municipal / Approvals',
        'Tea, Food & Site Misc',
    ],
    # ---- non-construction buckets ----
    'Finance & Debt': [
        'Home / Term Loan EMI', 'Credit Card Payment', 'SIP / Recurring Investment',
        'Investment Transfer', 'Insurance / MIP', 'Bank Charges',
    ],
    'Household & Personal': [
        'Groceries & Food', 'Utilities & Recharge', 'Medical', 'Subscriptions',
        'Donation & Religious', 'Personal Transfer',
    ],
    'Transfers & Income': [
        'Internal Sweep / FD', 'Income Received', 'Interest Earned',
        'Reimbursement Paid', 'Refund / Reversal', 'Self Transfer',
    ],
    'Unclassified': ['Needs Review'],
}

EXCLUDED_CATS = {'Finance & Debt', 'Household & Personal', 'Transfers & Income'}

# vendor -> (category, sub, confidence)
# confidence: confirmed = named/behaviour makes the trade clear
#             inferred  = strong pattern, worth a glance
#             review    = you must tell the dashboard what this is
VENDOR_RULES = {
    'Gautambhai Barot':      ('Labour & Contractors', 'Main Civil Contractor', 'confirmed'),
    'Kiran Devi':            ('Labour & Contractors', 'Painting Contractor', 'confirmed'),
    'Arunkumar Ramshankar':  ('Labour & Contractors', 'False Ceiling Contractor', 'confirmed'),
    'Barot Vijay':           ('Labour & Contractors', 'Electrical Labour', 'confirmed'),
    'Kachhad Jitubhai':      ('Interior & Fit-out', 'Furniture & Carpentry', 'confirmed'),
    'Dalwala Jignesh':       ('Structural Material', 'Cement', 'confirmed'),
    'Smit Himanshubhai':     ('Structural Material', 'Cement', 'confirmed'),
    'Shree Momai Cement':    ('Structural Material', 'Cement', 'confirmed'),
    'Patel Vandan':          ('Structural Material', 'Steel / TMT Bars', 'confirmed'),
    'Devashree Steel':       ('Structural Material', 'Steel / TMT Bars', 'confirmed'),
    'Real Bricks':           ('Structural Material', 'Bricks & Blocks', 'confirmed'),
    'Rajpurohit (Granite)':  ('Stone, Tile & Flooring', 'Granite & Marble', 'confirmed'),
    'Patel Jay Mahendrabhai':('Stone, Tile & Flooring', 'Granite & Marble', 'confirmed'),
    'Satguru Stone':         ('Stone, Tile & Flooring', 'Kota / Stone Slabs', 'confirmed'),
    'Shaikh Mohammed':       ('Electrical & Lighting', 'Switches & Panels', 'confirmed'),
    'Maya LED Light':        ('Electrical & Lighting', 'Lighting & Fixtures', 'confirmed'),
    'Shyam Hardware':        ('Hardware & Consumables', 'Hardware Store', 'confirmed'),
    'Dumaniya Hardware':     ('Hardware & Consumables', 'Hardware Store', 'confirmed'),
    'Shiv Traders':          ('Hardware & Consumables', 'Hardware Store', 'inferred'),
    'Vardhman Selection':    ('Hardware & Consumables', 'Fasteners & Misc', 'inferred'),
    'Akshar Gruh Udhyog':    ('Hardware & Consumables', 'Fasteners & Misc', 'inferred'),
    'Phulwaria Nand':        ('Labour & Contractors', 'Unassigned Labour / Vendor', 'review'),

    # --- non-construction ---
    'Bank of Baroda (Loan EMI)': ('Finance & Debt', 'Home / Term Loan EMI', 'confirmed'),
    'L&T Finance (Loan EMI)':    ('Finance & Debt', 'Home / Term Loan EMI', 'confirmed'),
    'Bajaj Finance (Loan EMI)':  ('Finance & Debt', 'Home / Term Loan EMI', 'confirmed'),
    'CRED (Credit Card)':        ('Finance & Debt', 'Credit Card Payment', 'confirmed'),
    'Indian Clearing Corp (SIP)':('Finance & Debt', 'SIP / Recurring Investment', 'confirmed'),
    'Raise Securities':          ('Finance & Debt', 'Investment Transfer', 'confirmed'),
    'Shah Kenil (MIP)':          ('Finance & Debt', 'Insurance / MIP', 'confirmed'),
    'Kamal Fruit Centre':        ('Household & Personal', 'Groceries & Food', 'confirmed'),
    'Suruchi Foods':             ('Household & Personal', 'Groceries & Food', 'confirmed'),
    'Jio':                       ('Household & Personal', 'Utilities & Recharge', 'confirmed'),
    'Airtel':                    ('Household & Personal', 'Utilities & Recharge', 'confirmed'),
    'HP Gas':                    ('Household & Personal', 'Utilities & Recharge', 'confirmed'),
    'Astha Medicines':           ('Household & Personal', 'Medical', 'confirmed'),
    'Apple Media Services':      ('Household & Personal', 'Subscriptions', 'confirmed'),
    'DivineCast':                ('Household & Personal', 'Donation & Religious', 'inferred'),
    'Sweep Transfer (in)':       ('Transfers & Income', 'Internal Sweep / FD', 'confirmed'),
    'Sweep Transfer (out)':      ('Transfers & Income', 'Internal Sweep / FD', 'confirmed'),
    'FD Premature Proceeds':     ('Transfers & Income', 'Internal Sweep / FD', 'confirmed'),
    'Bank Interest Paid':        ('Transfers & Income', 'Interest Earned', 'confirmed'),
    'Velocify Digital Solutions LLP': ('Transfers & Income', 'Income Received', 'confirmed'),
    'Self Transfer (Nilesh Sahu)':    ('Transfers & Income', 'Self Transfer', 'confirmed'),
    'Sanjay Singhal':            ('Transfers & Income', 'Reimbursement Paid', 'review'),
    'Bhagirath N.':              ('Transfers & Income', 'Reimbursement Paid', 'review'),
}

PETTY_LIMIT = 2000   # below this, an unknown individual reads as daily wage / site misc


def classify(vendor, amount, raw):
    if vendor in VENDOR_RULES:
        return VENDOR_RULES[vendor]
    if raw.startswith('REV-UPI/'):
        return ('Transfers & Income', 'Refund / Reversal', 'confirmed')
    if amount > 0:
        return ('Transfers & Income', 'Income Received', 'review')
    spend = -amount
    if spend < PETTY_LIMIT:
        return ('Labour & Contractors', 'Daily Wage / Petty Labour', 'review')
    return ('Labour & Contractors', 'Unassigned Labour / Vendor', 'review')



# ------------------------------------------------------------------ build

def build(csv_path):
    txns = parse(csv_path)
    out = []
    for i, t in enumerate(txns):
        vendor = canonical(counterparty(t['raw']))
        cat, sub, conf = classify(vendor, t['amount'], t['raw'])
        out.append({'id': i, 'date': t['date'], 'vendor': vendor, 'raw': t['raw'],
                    'ref': t['ref'], 'amount': t['amount'],
                    'cat': cat, 'sub': sub, 'conf': conf, 'note': ''})
    dates = sorted(t['date'] for t in out)

    def pretty(d):
        y, m, dd = d.split('-')
        return f"{dd} {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][int(m)-1]} {y}"

    return {
        'meta': {
            'account': '1614263140 \u00b7 Kotak Mahindra Bank \u00b7 Ahmedabad-Odhav',
            'holder': 'Nilesh Shivkumar Sahu',
            'period': f'{pretty(dates[0])} \u2013 {pretty(dates[-1])}' if dates else '',
            'source': Path(csv_path).name,
        },
        'taxonomy': TAXONOMY,
        'excludedCats': sorted(EXCLUDED_CATS),
        'txns': out,
    }


def summarise(payload):
    by, tally = defaultdict(float), defaultdict(float)
    for t in payload['txns']:
        if t['cat'] in EXCLUDED_CATS:
            continue
        v = -t['amount'] if t['amount'] < 0 else 0
        by[(t['cat'], t['sub'])] += v
        tally[t['conf']] += v
    total = sum(by.values())
    print(f"transactions : {len(payload['txns'])}")
    print(f"construction : Rs {total:,.0f}")
    for k in ('confirmed', 'inferred', 'review'):
        if tally[k]:
            print(f"  {k:<10} Rs {tally[k]:>12,.0f}")
    cats = defaultdict(float)
    for (c, _), v in by.items():
        cats[c] += v
    print()
    for c, v in sorted(cats.items(), key=lambda x: -x[1]):
        print(f'{v:>12,.0f}  {c}')
        for (cc, s), vv in sorted(by.items(), key=lambda x: -x[1]):
            if cc == c:
                print(f'{vv:>12,.0f}      - {s}')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('csv', help='Kotak account-statement CSV')
    ap.add_argument('-o', '--out', default='construction_expense_dashboard.html')
    ap.add_argument('-t', '--template', default=str(Path(__file__).with_name('template.html')))
    args = ap.parse_args()

    payload = build(args.csv)
    tpl = Path(args.template).read_text(encoding='utf-8')
    if '/*__SEED__*/' not in tpl:
        sys.exit(f'{args.template}: missing the /*__SEED__*/ placeholder')
    blob = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    Path(args.out).write_text(tpl.replace('/*__SEED__*/', blob), encoding='utf-8')

    summarise(payload)
    print(f'\nwrote {args.out}')


if __name__ == '__main__':
    main()
