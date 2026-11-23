import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { CATEGORY_OPTIONS } from "../lib/categories.js";
import { isPdfPath, uploadInvoiceFile } from "../lib/invoicePhoto.js";

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isMissingTable(error) {
  const msg = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42P01|PGRST205|does not exist|Could not find the table/i.test(msg);
}

const EMPTY_LINE = { description: "", quantity: "", unit_price: "", amount: "" };

export default function InvoiceDetail() {
  const { projectId, invoiceId } = useParams();
  const { organizationId } = useAuth();

  const [invoice, setInvoice] = useState(null);
  const [fileUrl, setFileUrl] = useState("");
  const [lines, setLines] = useState([]);
  const [linesUnavailable, setLinesUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [newLine, setNewLine] = useState(EMPTY_LINE);
  const [savingLine, setSavingLine] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("");

  useEffect(() => {
    load();
  }, [invoiceId]);

  async function load() {
    setError("");
    const { data, error } = await supabase
      .from("invoices")
      .select("*, tasks(title), vendors(name)")
      .eq("id", invoiceId)
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    setInvoice(data);
    setCategory(data.category ?? "");

    if (data.file_path) {
      const { data: signed } = await supabase.storage.from("invoices").createSignedUrl(data.file_path, 3600);
      setFileUrl(signed?.signedUrl ?? "");
    } else {
      setFileUrl("");
    }

    const { data: lineData, error: lineError } = await supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("sort_order")
      .order("created_at");
    if (lineError) {
      if (isMissingTable(lineError)) setLinesUnavailable(true);
      else setError(lineError.message);
      setLines([]);
    } else {
      setLinesUnavailable(false);
      setLines(lineData ?? []);
    }
  }

  async function handleAddPhoto(file) {
    if (!file) return;
    setUploading(true);
    setError("");
    const { path, error: uploadError } = await uploadInvoiceFile(organizationId, projectId, file);
    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }
    const { error: updateError } = await supabase.from("invoices").update({ file_path: path }).eq("id", invoiceId);
    setUploading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    load();
  }

  async function handleCategoryChange(value) {
    setCategory(value);
    const { error } = await supabase.from("invoices").update({ category: value || null }).eq("id", invoiceId);
    if (error) setError(error.message);
  }

  // Amount defaults to quantity × unit price when both are given; a typed amount wins.
  function lineAmount(line) {
    if (line.amount !== "" && line.amount != null) return line.amount;
    if (line.quantity !== "" && line.unit_price !== "") return (Number(line.quantity) * Number(line.unit_price)).toFixed(2);
    return "";
  }

  async function handleAddLine(e) {
    e.preventDefault();
    const amount = lineAmount(newLine);
    if (!newLine.description.trim() || amount === "") {
      setError("A line item needs a description and an amount (or quantity and unit price).");
      return;
    }
    setSavingLine(true);
    setError("");
    const { error } = await supabase.from("invoice_line_items").insert({
      organization_id: organizationId,
      invoice_id: invoiceId,
      description: newLine.description.trim(),
      quantity: newLine.quantity === "" ? null : newLine.quantity,
      unit_price: newLine.unit_price === "" ? null : newLine.unit_price,
      amount,
      sort_order: lines.length,
    });
    setSavingLine(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewLine(EMPTY_LINE);
    load();
  }

  async function handleDeleteLine(line) {
    if (!window.confirm(`Remove the line "${line.description}"?`)) return;
    const { error } = await supabase.from("invoice_line_items").delete().eq("id", line.id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  if (error && !invoice) return <p className="auth-error">{error}</p>;
  if (!invoice) return <p>Loading…</p>;

  const linesTotal = lines.reduce((sum, l) => sum + Number(l.amount), 0);
  const gap = Number(invoice.amount) - linesTotal;

  return (
    <div>
      <Link to={`/projects/${projectId}/invoices`} className="back-link">
        ← All invoices
      </Link>

      <div className="invoice-detail-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>{money(invoice.amount)}</h1>
          <p className="task-meta" style={{ margin: 0 }}>
            {[invoice.vendors?.name, invoice.invoice_date, invoice.tasks?.title].filter(Boolean).join(" · ") ||
              "No vendor or date yet"}
          </p>
          {invoice.description && <p style={{ margin: "6px 0 0" }}>{invoice.description}</p>}
        </div>
        <div>
          <label htmlFor="detail-category" style={{ margin: "0 0 4px" }}>
            Category
          </label>
          <select id="detail-category" value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
            <option value="">— None —</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="budget-card invoice-photo">
        {fileUrl ? (
          isPdfPath(invoice.file_path) ? (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              Open invoice PDF
            </a>
          ) : (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" title="Open full size">
              <img src={fileUrl} alt="Invoice" />
            </a>
          )
        ) : (
          <>
            <p className="task-meta" style={{ marginTop: 0 }}>
              No photo attached.
            </p>
            <label className="camera-btn">
              {uploading ? "Uploading…" : "Take or add photo"}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                disabled={uploading}
                onChange={(e) => handleAddPhoto(e.target.files[0] ?? null)}
              />
            </label>
          </>
        )}
      </div>

      <h3 style={{ margin: "20px 0 8px" }}>Line items</h3>

      {linesUnavailable ? (
        <p className="task-meta">
          Line items aren't switched on yet. They need the database script
          supabase/migrations/0016_invoice_line_items.sql run once in the Supabase SQL editor.
        </p>
      ) : (
        <>
          {lines.length === 0 ? (
            <p className="task-meta">No line items yet. Add them below from the photo.</p>
          ) : (
            <table className="task-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Item">{l.description}</td>
                    <td data-label="Qty">{l.quantity ?? "—"}</td>
                    <td data-label="Unit price">{l.unit_price != null ? money(l.unit_price) : "—"}</td>
                    <td data-label="Amount">{money(l.amount)}</td>
                    <td>
                      <button className="link-btn" onClick={() => handleDeleteLine(l)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {lines.length > 0 && (
            <p className="task-meta">
              Lines total {money(linesTotal)} of {money(invoice.amount)} invoice total
              {Math.abs(gap) >= 0.01 && ` (${gap > 0 ? `${money(gap)} not itemized` : `${money(-gap)} over the total`})`}.
            </p>
          )}

          <form onSubmit={handleAddLine} className="line-item-form">
            <input
              placeholder="Item (e.g. Elevator cab panels)"
              value={newLine.description}
              onChange={(e) => setNewLine({ ...newLine, description: e.target.value })}
            />
            <input
              type="number"
              step="any"
              min="0"
              placeholder="Qty"
              value={newLine.quantity}
              onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Unit $"
              value={newLine.unit_price}
              onChange={(e) => setNewLine({ ...newLine, unit_price: e.target.value })}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Amount $"
              value={newLine.amount}
              onChange={(e) => setNewLine({ ...newLine, amount: e.target.value })}
            />
            <button type="submit" disabled={savingLine}>
              {savingLine ? "Adding…" : "Add line"}
            </button>
          </form>
        </>
      )}

      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
