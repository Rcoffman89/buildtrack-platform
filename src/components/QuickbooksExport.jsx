import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { prepareQuickbooksBills, downloadCsv, QB_MAX_BILLS_PER_IMPORT } from "../lib/quickbooksExport.js";

// Export panel on the Invoices page. Downloads a QuickBooks Online bills file, then asks whether
// the import worked before stamping anything as exported, so a failed import never hides expenses
// from the next export.
export default function QuickbooksExport({ invoices, projectName, glMappings, statusReady, onChanged, onError }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [includeExported, setIncludeExported] = useState(false);
  const [lastExport, setLastExport] = useState(null);
  const [marking, setMarking] = useState(false);

  const inRange = invoices.filter((inv) => {
    if (start && (!inv.invoice_date || inv.invoice_date < start)) return false;
    if (end && (!inv.invoice_date || inv.invoice_date > end)) return false;
    return true;
  });
  const candidates = inRange.filter((inv) => includeExported || !inv.qb_exported_at);
  const alreadyExported = inRange.length - candidates.length;

  function handleExport() {
    const { csv, included, noVendor, credits } = prepareQuickbooksBills(candidates, { projectName, glMappings });
    if (!included.length) {
      onError("Nothing to export for these dates. Already-exported expenses are left out unless you tick the box.");
      setLastExport(null);
      return;
    }
    const rangeLabel = start || end ? `_${start || "start"}_to_${end || "end"}` : "";
    downloadCsv(csv, `quickbooks-bills-${projectName || "export"}${rangeLabel}.csv`);
    setLastExport({ ids: included.map((i) => i.id), noVendor: noVendor.length, credits: credits.length });
  }

  async function markExported() {
    setMarking(true);
    const { error } = await supabase
      .from("invoices")
      .update({ qb_exported_at: new Date().toISOString() })
      .in("id", lastExport.ids);
    setMarking(false);
    if (error) {
      onError(error.message);
      return;
    }
    setLastExport(null);
    onChanged();
  }

  return (
    <div className="budget-card">
      <div className="export-range" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label htmlFor="export-start" style={{ margin: "0 0 4px" }}>
            From
          </label>
          <input id="export-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label htmlFor="export-end" style={{ margin: "0 0 4px" }}>
            To
          </label>
          <input id="export-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <button type="button" onClick={handleExport}>
          Export for QuickBooks
        </button>
      </div>

      {statusReady && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", margin: "10px 0 0", fontWeight: "normal" }}>
          <input type="checkbox" checked={includeExported} onChange={(e) => setIncludeExported(e.target.checked)} />
          Include expenses already exported{alreadyExported ? ` (${alreadyExported} in these dates)` : ""}
        </label>
      )}

      <p className="task-meta" style={{ margin: "8px 0 0" }}>
        In QuickBooks Online: Settings, Import data, Bills. Up to {QB_MAX_BILLS_PER_IMPORT} bills per import.
      </p>

      {lastExport && (
        <div style={{ marginTop: 10 }}>
          <p className="task-meta" style={{ margin: "0 0 6px" }}>
            Downloaded {lastExport.ids.length} bill{lastExport.ids.length === 1 ? "" : "s"}.
            {lastExport.ids.length > QB_MAX_BILLS_PER_IMPORT &&
              ` QuickBooks takes ${QB_MAX_BILLS_PER_IMPORT} at a time, so narrow the dates and export in parts.`}
            {lastExport.noVendor > 0 &&
              ` ${lastExport.noVendor} left out with no vendor; QuickBooks needs one, so add a vendor first.`}
            {lastExport.credits > 0 &&
              ` ${lastExport.credits} refund${lastExport.credits === 1 ? "" : "s"} left out; enter as a vendor credit in QuickBooks.`}
          </p>
          {statusReady ? (
            <button type="button" onClick={markExported} disabled={marking}>
              {marking ? "Marking…" : "Imported OK, mark these as exported"}
            </button>
          ) : (
            <p className="task-meta" style={{ margin: 0 }}>
              Marking as exported needs the database script 0018_invoice_paid_exported.sql run once.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
