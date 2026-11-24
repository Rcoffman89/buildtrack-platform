// QuickBooks Online "Import data > Bills" layout (Essentials, Plus or Advanced). Each expense is
// one bill with one line. QuickBooks' mapping step lets you match these headers to its fields;
// the extra columns at the end (Category, Project, Paid, Paid date) can be left unmapped.
//
// QuickBooks rules this file follows:
//   - every bill needs a vendor, so expenses with no vendor are left out and counted
//   - bills can't be negative, so refunds/credits are left out and counted (enter them in
//     QuickBooks as a vendor credit)
//   - at most 100 bills per import, so the caller warns above that
//   - dates as MM/DD/YYYY
// QuickBooks imports these as open bills. Ones marked paid here still need the payment recorded
// in QuickBooks (Pay bills).

export const QB_MAX_BILLS_PER_IMPORT = 100;

function usDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Splits invoices into what goes in the file and what QuickBooks would refuse.
export function prepareQuickbooksBills(invoices, { projectName, glMappings }) {
  const included = [];
  const noVendor = [];
  const credits = [];
  for (const inv of invoices) {
    if (!inv.vendors?.name) noVendor.push(inv);
    else if (Number(inv.amount) < 0) credits.push(inv);
    else included.push(inv);
  }

  const header = [
    "Bill No",
    "Vendor",
    "Bill Date",
    "Due Date",
    "Account",
    "Line Description",
    "Line Amount",
    "Memo",
    "Category",
    "Project",
    "Paid",
    "Paid Date",
  ];
  const rows = [header];
  for (const inv of included) {
    const trade = inv.vendors?.trade;
    const account = (trade && glMappings[trade]) || inv.category || "";
    const date = usDate(inv.invoice_date || inv.created_at?.slice(0, 10));
    rows.push([
      `BT-${inv.id.slice(0, 8)}`,
      inv.vendors.name,
      date,
      date,
      account,
      inv.description ?? "",
      Number(inv.amount).toFixed(2),
      projectName ? `BuildTrack: ${projectName}` : "BuildTrack",
      inv.category ?? "",
      projectName ?? "",
      inv.paid_date ? "Yes" : "No",
      usDate(inv.paid_date),
    ]);
  }
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  return { csv, included, noVendor, credits };
}

export function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
