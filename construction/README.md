# Construction Expense Dashboard

Categorises the Kotak account statement for **30 Apr 2026 – 29 Jul 2026** into a
two-level construction taxonomy (category → sub-category) and lets you re-file
anything by hand.

Open `construction_expense_dashboard.html` in any browser. No server, no
internet, no dependencies — the data is baked into the file.

## What the numbers say

| | |
|---|---|
| Transactions parsed | 355 |
| Construction spend | **₹12,02,560** |
| — vendor-identified | ₹8,99,627 (75%) |
| — still to confirm | ₹3,02,933 (25%) |
| Non-construction (excluded) | ₹7,57,000 |
| Monthly run rate | ₹4.02 L over 91 days |

Top categories: Labour & Contractors ₹8.14 L · Structural Material ₹2.14 L ·
Interior & Fit-out ₹1.00 L · Stone, Tile & Flooring ₹50k · Electrical &
Lighting ₹21k · Hardware & Consumables ₹4k.

## Tabs

- **Overview** — totals, spend by category (click a bar to drill into
  sub-categories), monthly stacked trend, top vendors.
- **Transactions** — every row with cascading Category → Sub-category dropdowns,
  a note field, filters, and tick-boxes for re-assigning many rows at once.
- **Vendors** — one row per payee. Changing a vendor's category re-files *all* of
  its transactions in one move.
- **Review queue** — the 67 unidentified payees, largest first. This is the
  fastest way to clear the ₹3.03 L of unconfirmed spend: name the trade once per
  vendor and press Confirm.
- **Categories** — add, rename, delete categories and sub-categories, or flip a
  category between "counts as construction" and "excluded". Everything else
  updates immediately.

## Saving your work

Edits save to the browser's local storage automatically, so a reload keeps them.
They are tied to that one browser, so:

- **Save backup** writes a JSON file with your categories and every edit.
- **Restore** reads that file back — use it to move to another machine.
- **Export CSV** produces a flat file for Excel/Tally with a
  "Counts as construction" column.
- **Reset** returns to the original seed categorisation.

## How the seed categorisation was made

Bank narrations truncate names at ~14 characters, so `BAROT GAUTAMBHA` and
`BAROT GAUTAMBH` are the same person. `tools/build_dashboard.py` normalises those
into canonical vendors, then labels each with a confidence:

- **confirmed** — the vendor is named and the trade is clear (Gautambhai Barot →
  Main Civil Contractor, Dalwala Jignesh → Cement, Real Bricks → Bricks & Blocks).
- **inferred** — the name implies the trade but was not stated (Shiv Traders →
  Hardware Store).
- **review** — an individual's name with no trade in the narration. Payments under
  ₹2,000 are parked in *Daily Wage / Petty Labour*, larger ones in *Unassigned
  Labour / Vendor*. **These are placeholders, not findings** — they are guesses
  based only on amount, and the Review queue exists to replace them.

Excluded from construction totals: loan EMIs (BOB, L&T, Bajaj), CRED credit-card
payments, SIP/recurring debits, investments, insurance, groceries, utilities,
medical, subscriptions, internal sweep/FD transfers, income received, and the two
payments marked as reimbursements (Sanjay Singhal ₹35,000, Bhagirath N. ₹20,000).

Note that CRED credit-card payments (₹1.22 L) are excluded because a card bill is
opaque — if construction material was bought on a card, that spend is inside this
figure and is not counted above.

## Rebuilding from a newer statement

```bash
python3 tools/build_dashboard.py path/to/statement.csv -o construction_expense_dashboard.html
```

Add new payees to `VENDOR_RULES` in that script so the next build already knows
them. A rebuild replaces the seed, so **Save backup** first if you have
categorisation work in the browser you want to keep, then **Restore** it after.

## Source files

Both uploaded statements cover the same period and the same transactions — the
CSV is used as the source because it parses cleanly; the PDF adds nothing beyond
it.
