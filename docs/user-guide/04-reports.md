# 4 — Reports

This section covers everything under the **Reports** area: running and reading the
company's reports, looking up a tire, and printing bin and tire labels. Most of these
screens are used by managers and office staff who run numbers, and by warehouse staff
who print labels. You don't need any technical background — every task here is point,
click, and (sometimes) print.

## In this section

- [The Reports hub](#the-reports-hub) — finding and opening a report
- [The kinds of reports](#the-kinds-of-reports) — what each one tells you
- [Reading a report](#reading-a-report) — filtering, the Financial Snapshot, exporting
- [Uploading data](#uploading-data) 🔒 — feeding in the daily and inventory files
- [Tire search](#tire-search) — looking up a tire by size or part number
- [Tire labels](#tire-labels) — printing replacement labels for tires
- [Bin labels](#bin-labels) — printing barcode labels for warehouse bins
- [Printing tips](#printing-tips) — pop-ups, PDFs, and getting the size right

---

## The Reports hub

Open **Reports** from the sidebar. You land on a **hub** — a page of cards, one per
report, grouped into sections:

| Group | What's in it |
|---|---|
| **HR & Hiring** | Personnel, applications, hiring analytics, the Review Tracker, turnover, and similar people reports |
| **Operations** | Attendance, equipment, weekly activity, website messages |
| **Inventory** | Inventory Report and the Controller Inventory Report (CIR) |
| **Sales & Finance** | Sales Dashboard, Sales by Day & Location, Sales History, and the Custom Report builder |
| **Vendor Reports** | WTD Commission, Dunlop Sellout Reporter, Dealer Rebates |
| **Saved Configurations** | Custom reports you (or a teammate) have saved to re-run later |
| **Administration** | Restricted admin-only reports |

To open a report:

1. Open **Reports** from the sidebar.
2. Find the card you want, or type in the **Search reports…** box at the top to filter
   the cards by name.
3. Click the card. The report opens. Use the **back arrow** (top-left) to return to the
   hub.

> 🔒 **Manager / Admin only** — many cards (most HR reports, the Administration group,
> and some others) only appear if you have access. If a report you expect isn't on your
> hub, you probably don't have permission to it — ask your manager or an administrator.

---

## The kinds of reports

You don't need to know how the data gets in (that happens automatically — see
[Uploading data](#uploading-data)). Here's what each main report **tells you**:

### Inventory

- **Inventory Report** — current stock on hand. Shows every item by **warehouse**,
  **brand**, and **product type**, with quantities (on hand, committed, available) and
  costs/values. This is the report to use when you want to know "what do we have, and
  where?"
- **Controller Inventory Report (CIR)** — a printable PDF inventory list filtered to a
  single **location** and a chosen set of **brands**. Built for retail-store reviews.

### Sales & Finance

- **Sales Dashboard** — tires sold by location with week-over-week, month-over-month,
  and year-to-date comparison pills, plus monthly and weekly trend charts.
- **Sales by Day & Location** — daily, weekly, or monthly sales by store, shown in
  **Dollars** or **Tires**, with line, area, and bar charts.
- **Sales History** — monthly sales broken down by item, with brand, model, and
  warehouse filtering.
- **Custom Report** — build your own report: pick which data to include, which columns
  to show, and a date range. You can **save** a custom report so you (or a teammate) can
  re-run it later — saved ones show up under **Saved Configurations**.

### Vendor Reports

- **WTD Commission** — daily commission reports for wholesale-tire-dealer (WTD)
  customers. Pick a month to view; export to PDF or Excel.
- **Dunlop Sellout Reporter** — the monthly "sellout" report sent automatically to
  Dunlop/SRNA. Mostly runs on its own; the screen shows run history and status.
- **Dealer Rebates** — tracks Falken Fanatic and Milestar Momentum rebate activity and
  produces the submission files for those programs.

### HR & Operations

These reports (Personnel, Applications, Hiring Analytics, Review Tracker, Turnover,
Attendance, Equipment, Weekly Overview, Website Messages, and others) summarize people
and day-to-day operations. Most are **manager/admin only**.

---

## Reading a report

Reports differ, but the common controls work the same way:

1. **Filter by period.** Where a report covers time, pick the **month** or date range
   from the picker at the top. For commission and vendor reports this is usually a
   **month** dropdown.
2. **Filter by category.** Most data reports have dropdowns such as **All Warehouses**,
   **All Brands**, and **All Product Types**, plus a search box. Pick a value to narrow
   the list; leave it on "All…" to see everything. A **Clear filters** option resets
   them.
3. **Read the results** in the table or chart. Many tables let you click a column to
   sort.

### The Financial Snapshot on the home dashboard

The home dashboard shows a **Financial Snapshot** widget. It always headlines the
**latest complete month** — for example, in mid-June it shows **May** — so you're never
comparing a half-finished month against a full one. The month it's using is printed in
the widget's header (e.g. "May 2026"), so you always know which period you're looking at.

### Exporting and printing

- Data reports such as the **Inventory Report** have **CSV** and **Excel** buttons in
  the top-right — click one to download the current (filtered) list to your computer.
- The **Controller Inventory Report (CIR)** produces a **PDF** you can save or print.
- **WTD Commission** offers **PDF** and **Excel** export.

> **Tip:** filters apply to your export. If you filter the Inventory Report to one
> warehouse and one brand, the CSV or Excel file contains exactly that — not the whole
> catalog.

---

## Uploading data

> 🔒 **Manager / Admin only** — this screen (**Upload** under Reports) only appears if
> you have upload access.

**Most of the time you do not need to do anything here.** The daily sales and inventory
files now feed into IE Central **automatically** every hour, so reports stay current on
their own. The upload screen is a manual backup for when you have a file in hand and want
it in right away.

If you do need to upload:

1. Open **Reports** from the sidebar, then open **Upload**.
2. Choose the **report type**:
   - **OEA07V — Daily Sales** — the daily sales/returns file (powers WTD Commission,
     Dunlop, dealer rebates, and the sales reports).
   - **OEAVAL 77 — Inventory Snapshot** — the inventory file (quantities, costs, and
     pricing by warehouse).
3. **Drag and drop** your file onto the upload area, or click to browse and select it.
   The screen accepts the matching file type for the report you picked.
4. The file is **validated** (checked that it's the right kind of file) and then
   uploaded. When it finishes, you'll see a confirmation — the data is **available in
   reports immediately**.

> **Tip:** if validation says the file doesn't look right (for example, "this doesn't
> look like an OEA07V export"), you've probably picked the wrong report type or the wrong
> file. Double-check both and try again.

---

## Tire search

When you need to find a tire — its part number, where it sits in inventory, or just to
fill out a label — use search instead of hunting through lists.

**Search by size is flexible.** You don't have to type the slashes or the "R". All of
these find the same tire:

- `2056016`
- `20560R16`
- `205/60R16`

Even a partial size (like `26560`) will pull up matches.

**On the Inventory Report**, type a size, part number, brand, model, or description into
the search box to narrow the table — and the results show stock **across all locations**,
so you can see who has it.

**On the Tire Label printer**, the **Find tire** box (labeled *"no tag? search by brand,
size, or model"*) lets you type something like `245/40R18 Falken Ziex` and pick the
matching tire from the dropdown — it fills in the brand, model, size, and part number for
you. See [Tire labels](#tire-labels) below.

---

## Tire labels

Use the **Tire Label** printer to make a replacement label for a tire that's missing one.
Tire labels print as **4" × 6"** shipping labels.

To get there: open **Bin Labels** from the sidebar, then use the **Bin Labels / Tire
Labels** toggle at the top-right and switch to **Tire Labels**.

### Print a tire label

1. Add a tire to the list. You have three ways to fill in a tire:
   - **Find tire** — type the brand, size, or model (e.g. `245/40R18 Falken Ziex`) and
     pick it from the dropdown. This is best for an untagged tire.
   - **Item ID + Look up** — type the item's ID and click **Look up**. IE Central fills
     in the brand, model, size, and part number for you. (If it says *"Not found — enter
     manually below,"* just fill in the fields yourself.)
   - **Manual** — type the **Brand**, **Model**, and **Size / Description** directly.
2. Set the **Qty** for each tire — that's how many copies of *that* label to print. You
   can list several different tires with different quantities (say, 4 of one and 1 of
   another).
3. Check the preview, then click **Print Labels**.

### The barcode options

The label's barcode is what a scanner reads back in the warehouse, so getting it exactly
right matters.

- **MPN (prints as barcode)** — the part number printed as the barcode. Search and
  **Look up** fill this in automatically; you can edit it. If it's left blank, the label
  uses the **Item ID** instead.
- **D-Class (barcode suffix)** — a single symbol added to the end of the barcode so it
  **matches the item in inventory exactly**. The scanner does an exact match, so a tire
  that's really `AB1234[` won't be found by a plain `AB1234` barcode — the **D-Class**
  adds that `[`. Options are: **None**, **Dot `.`**, **Caret `^`**, **Bracket `[`**,
  **Colon `:`**, **Dash `-`**, **Tilde `~`**, **Star `*`**, **Hash `#`**, and
  **Bang `!`**.
  - **Auto-detected:** when you fill a tire by search or **Look up**, IE Central reads
    the D-Class from the part number and selects it for you automatically. You can change
    it if needed. A small line under the dropdown shows the exact **Barcode** value that
    will print, so you can confirm it before printing.
- **Add Item ID barcode** — an optional checkbox (off by default) at the top of the form.
  When on, the label prints a **second** barcode of the raw Item ID underneath the first.
  The two are labeled **MPN** (the main one) and **ITEM ID** (the second). Turn this on
  when you want both numbers scannable on one label.

### Save a batch for later (Work Orders)

If you're printing the same set of tires repeatedly, type a name in the **Work order
name** box and click **Save as Work Order**. Saved work orders list below, and you can
re-load one to reprint the exact same labels (with the right part numbers and D-Class
preserved), mark it printed, or delete it.

---

## Bin labels

Use **Bin Labels** to print barcode labels for warehouse bins and shelf locations. Bin
labels print as **6" × 2"** thermal labels.

Open **Bin Labels** from the sidebar (make sure the toggle at the top-right is on **Bin
Labels**, not Tire Labels).

1. In each row, enter:
   - **Location ID (Barcode Value)** — the code that becomes the scannable barcode
     (e.g. `A01-B02-C03`).
   - **Location Name (Human Readable)** — the friendly name printed beside the barcode
     (e.g. `Aisle 1, Bay 2, Shelf 3`).
2. Set **Copies per label** if you want more than one of each.
3. Click **Add Label** to add more bins to the same batch.
4. Check the preview (it shows the real label at actual size), then click **Print
   Labels**.

Use **Clear All** to start over.

---

## Printing tips

Both tire and bin labels print as an **exact-size PDF**, which is then sent to your
printer. This keeps every label the right size on any label printer. A few things to know:

- **Allow pop-ups for IE Central.** Printing opens the label as a PDF. If nothing
  happens when you click **Print Labels**, your browser may be blocking it — allow
  pop-ups for the site and try again. (This is most common in Chrome.)
- **In the print dialog**, the hover **? (Print Setup Tips)** button next to **Print
  Labels** reminds you to:
  1. Select your label printer.
  2. Set paper size to **4" × 6"** for tire labels, or **6" × 2"** for bin labels.
  3. Set margins to **None**.
  4. Disable headers/footers.
  5. Set scale to **100%**.
- **Check the preview first.** The on-screen preview shows each label at its true size
  and tells you how many labels will print, so you can catch a typo before you use a
  sheet of stock.
