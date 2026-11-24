import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

function shortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Paid / due and exported-to-QuickBooks status for one expense, with the actions to change them.
export default function InvoiceStatus({ invoice, onChanged, onError }) {
  const [picking, setPicking] = useState(false);
  const [paidDate, setPaidDate] = useState(todayLocal());

  async function update(fields) {
    const { error } = await supabase.from("invoices").update(fields).eq("id", invoice.id);
    if (error) {
      onError(error.message);
      return;
    }
    setPicking(false);
    onChanged();
  }

  function unmarkExported() {
    if (!window.confirm("Unmark this as exported? It will be included in the next QuickBooks export.")) return;
    update({ qb_exported_at: null });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      {invoice.paid_date ? (
        <span>
          <span className="pill pill-done">Paid {shortDate(invoice.paid_date)}</span>{" "}
          <button className="link-btn" onClick={() => update({ paid_date: null })}>
            Undo
          </button>
        </span>
      ) : picking ? (
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} aria-label="Paid date" />
          <button onClick={() => paidDate && update({ paid_date: paidDate })}>Save</button>
          <button className="link-btn" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <span>
          <span className="pill pill-pending">Due</span>{" "}
          <button className="link-btn" onClick={() => setPicking(true)}>
            Mark paid
          </button>
        </span>
      )}
      {invoice.qb_exported_at && (
        <span>
          <span className="pill pill-none">In QuickBooks</span>{" "}
          <button className="link-btn" onClick={unmarkExported}>
            Unmark
          </button>
        </span>
      )}
    </div>
  );
}
