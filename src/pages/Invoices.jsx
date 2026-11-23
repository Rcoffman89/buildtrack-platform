import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { CATEGORY_OPTIONS } from "../lib/categories.js";
import { uploadInvoiceFile } from "../lib/invoicePhoto.js";

export default function Invoices() {
  const { projectId } = useParams();
  const { organizationId } = useAuth();
  const [searchParams] = useSearchParams();
  const preselectedTaskId = searchParams.get("task") || "";
  // Arriving from a category on the Dashboard (?category=MEP) preselects that category on the
  // new-invoice form and filters the list to it. "__none__" filters to uncategorized invoices.
  const categoryParam = searchParams.get("category") || "";
  const preselectedCategory = CATEGORY_OPTIONS.includes(categoryParam) ? categoryParam : "";
  const initialFilter = preselectedCategory || (categoryParam === "__none__" ? "__none__" : "");

  const [invoices, setInvoices] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [glMappings, setGlMappings] = useState({});
  const [error, setError] = useState("");

  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");

  const [taskId, setTaskId] = useState(preselectedTaskId);
  const [vendorId, setVendorId] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(preselectedCategory);
  const [categoryFilter, setCategoryFilter] = useState(initialFilter);
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState({});
  const [justSaved, setJustSaved] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  useEffect(() => {
    load();
  }, [projectId]);

  async function load() {
    const { data, error } = await supabase
      .from("invoices")
      .select("*, tasks(title,category), vendors(name,trade)")
      .eq("project_id", projectId)
      .order("invoice_date", { ascending: false });
    if (error) setError(error.message);
    else setInvoices(data);

    const { data: taskData } = await supabase.from("tasks").select("id,title,category").eq("project_id", projectId).order("title");
    setTasks(taskData ?? []);

    const { data: vendorData } = await supabase.from("vendors").select("id,name,trade").order("name");
    setVendors(vendorData ?? []);

    const { data: projectData } = await supabase.from("projects").select("name").eq("id", projectId).single();
    setProjectName(projectData?.name ?? "");

    const { data: glData } = await supabase.from("gl_mappings").select("vendor_trade,gl_code");
    setGlMappings(Object.fromEntries((glData ?? []).map((g) => [g.vendor_trade, g.gl_code])));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setJustSaved(null);

    let filePath = null;
    if (file) {
      const { path, error: uploadError } = await uploadInvoiceFile(organizationId, projectId, file);
      if (uploadError) {
        setSubmitting(false);
        setError(uploadError.message);
        return;
      }
      filePath = path;
    }

    const { data: inserted, error: insertError } = await supabase.from("invoices").insert({
      organization_id: organizationId,
      project_id: projectId,
      task_id: taskId || null,
      vendor_id: vendorId || null,
      amount,
      invoice_date: invoiceDate || null,
      description: description || null,
      category: category || null,
      file_path: filePath,
    }).select("id,amount,category").single();

    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setTaskId("");
    setVendorId("");
    setAmount("");
    setInvoiceDate("");
    setDescription("");
    setCategory(preselectedCategory);
    setFile(null);
    setFileInputKey((k) => k + 1);
    setJustSaved(inserted);
    load();
  }

  function handleTaskChange(newTaskId) {
    setTaskId(newTaskId);
    // Auto-fill category from the selected task as a convenience default — it's copied onto
    // the invoice as its own independent value, not derived live, so editing the task's
    // category later never rewrites this invoice's recorded category.
    const task = tasks.find((t) => t.id === newTaskId);
    setCategory(task?.category ?? "");
  }

  async function handleView(invoice) {
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(invoice.file_path, 60);
    if (error) {
      setError(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function startEdit(invoice) {
    setEditing({
      ...editing,
      [invoice.id]: {
        task_id: invoice.task_id || "",
        vendor_id: invoice.vendor_id || "",
        amount: invoice.amount,
        invoice_date: invoice.invoice_date || "",
        description: invoice.description || "",
        category: invoice.category || "",
      },
    });
  }

  function cancelEdit(id) {
    const next = { ...editing };
    delete next[id];
    setEditing(next);
  }

  function updateEditField(id, field, value) {
    setEditing({ ...editing, [id]: { ...editing[id], [field]: value } });
  }

  async function saveEdit(id) {
    const draft = editing[id];
    const { error } = await supabase
      .from("invoices")
      .update({
        task_id: draft.task_id || null,
        vendor_id: draft.vendor_id || null,
        amount: draft.amount,
        invoice_date: draft.invoice_date || null,
        description: draft.description || null,
        category: draft.category || null,
      })
      .eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    cancelEdit(id);
    load();
  }

  function csvEscape(value) {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  }

  function handleExport() {
    const filtered = invoices.filter((inv) => {
      if (exportStart && (!inv.invoice_date || inv.invoice_date < exportStart)) return false;
      if (exportEnd && (!inv.invoice_date || inv.invoice_date > exportEnd)) return false;
      return true;
    });

    const rows = [["Date", "Project", "Vendor", "Category", "GL Code", "Description", "Amount"]];
    for (const inv of filtered) {
      const trade = inv.vendors?.trade;
      rows.push([
        inv.invoice_date ?? "",
        projectName,
        inv.vendors?.name ?? "",
        inv.category ?? "",
        (trade && glMappings[trade]) || "",
        inv.description ?? "",
        Number(inv.amount).toFixed(2),
      ]);
    }

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const rangeLabel = exportStart || exportEnd ? `_${exportStart || "start"}_to_${exportEnd || "end"}` : "";
    link.href = url;
    link.download = `invoices-${projectName || "export"}${rangeLabel}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(invoice) {
    if (!window.confirm(`Delete this ${invoice.amount ? `$${invoice.amount} ` : ""}invoice? This can't be undone.`)) return;
    if (invoice.file_path) {
      await supabase.storage.from("invoices").remove([invoice.file_path]);
    }
    const { error } = await supabase.from("invoices").delete().eq("id", invoice.id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  const visibleInvoices = (invoices ?? []).filter((inv) => {
    if (!categoryFilter) return true;
    if (categoryFilter === "__none__") return !inv.category;
    return inv.category === categoryFilter;
  });
  const visibleTotal = visibleInvoices.reduce((sum, inv) => sum + Number(inv.amount), 0);

  return (
    <div>
      <h1>Invoices</h1>

      <form onSubmit={handleCreate} className="task-form quick-add" style={{ marginBottom: 28 }}>
        <h3 style={{ margin: "0 0 4px" }}>Add an expense</h3>
        <p className="task-meta" style={{ margin: "0 0 8px" }}>
          Snap the invoice, enter the total, pick a category. Line items can be added later.
        </p>

        <label className="camera-btn">
          {file ? `Photo: ${file.name}` : "Take photo of invoice"}
          <input
            key={fileInputKey}
            id="inv-file"
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            onChange={(e) => setFile(e.target.files[0] ?? null)}
          />
        </label>

        <label htmlFor="inv-amount">Total ($)</label>
        <input
          id="inv-amount"
          type="number"
          inputMode="decimal"
          required
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <label htmlFor="inv-category">Category</label>
        <select id="inv-category" required value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">— Pick a category —</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <details className="more-details">
          <summary>More details (optional)</summary>

          <label htmlFor="inv-vendor">Vendor</label>
          <select id="inv-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">— None —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.trade})
              </option>
            ))}
          </select>

          <label htmlFor="inv-date">Invoice date</label>
          <input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />

          <label htmlFor="inv-task">Task</label>
          <select id="inv-task" value={taskId} onChange={(e) => handleTaskChange(e.target.value)}>
            <option value="">— Project-level, no specific task —</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>

          <label htmlFor="inv-desc">Description</label>
          <input id="inv-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </details>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save expense"}
        </button>

        {justSaved && (
          <p className="task-meta" style={{ margin: "8px 0 0" }}>
            Saved ${Number(justSaved.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {justSaved.category ? ` to ${justSaved.category}` : ""}.{" "}
            <Link to={`/projects/${projectId}/invoices/${justSaved.id}`}>Open it to add line items</Link>
          </p>
        )}
      </form>

      {invoices && invoices.length > 0 && (
        <div className="budget-card" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label htmlFor="export-start" style={{ margin: "0 0 4px" }}>
              From
            </label>
            <input id="export-start" type="date" value={exportStart} onChange={(e) => setExportStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="export-end" style={{ margin: "0 0 4px" }}>
              To
            </label>
            <input id="export-end" type="date" value={exportEnd} onChange={(e) => setExportEnd(e.target.value)} />
          </div>
          <button type="button" onClick={handleExport}>
            Export CSV for accounting
          </button>
        </div>
      )}

      {invoices && invoices.length > 0 && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "0 0 12px" }}>
          <label htmlFor="inv-filter" style={{ margin: 0 }}>
            Show
          </label>
          <select id="inv-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__none__">Uncategorized</option>
          </select>
          <span className="task-meta">
            {visibleInvoices.length} invoice{visibleInvoices.length === 1 ? "" : "s"}, $
            {visibleTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      {!invoices && !error && <p>Loading…</p>}
      {invoices && invoices.length === 0 && <p className="task-meta">No invoices yet — add one above.</p>}

      {invoices && invoices.length > 0 && (
        <table className="task-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Vendor</th>
              <th>Task</th>
              <th>Category</th>
              <th>Description</th>
              <th>File</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleInvoices.map((inv) => {
              const draft = editing[inv.id];
              if (draft) {
                return (
                  <tr key={inv.id}>
                    <td data-label="Date">
                      <input
                        type="date"
                        value={draft.invoice_date}
                        onChange={(e) => updateEditField(inv.id, "invoice_date", e.target.value)}
                      />
                    </td>
                    <td data-label="Amount">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.amount}
                        onChange={(e) => updateEditField(inv.id, "amount", e.target.value)}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td data-label="Vendor">
                      <select value={draft.vendor_id} onChange={(e) => updateEditField(inv.id, "vendor_id", e.target.value)}>
                        <option value="">— None —</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Task">
                      <select value={draft.task_id} onChange={(e) => updateEditField(inv.id, "task_id", e.target.value)}>
                        <option value="">— None —</option>
                        {tasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Category">
                      <select value={draft.category} onChange={(e) => updateEditField(inv.id, "category", e.target.value)}>
                        <option value="">— None —</option>
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Description">
                      <input
                        value={draft.description}
                        onChange={(e) => updateEditField(inv.id, "description", e.target.value)}
                      />
                    </td>
                    <td data-label="File">
                      {inv.file_path ? (
                        <button className="link-btn" onClick={() => handleView(inv)}>
                          View
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button onClick={() => saveEdit(inv.id)}>Save</button>
                      <button onClick={() => cancelEdit(inv.id)} style={{ marginLeft: 6 }}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={inv.id}>
                  <td data-label="Date">{inv.invoice_date}</td>
                  <td data-label="Amount">${Number(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td data-label="Vendor">{inv.vendors?.name ?? "—"}</td>
                  <td data-label="Task">{inv.tasks?.title ?? "—"}</td>
                  <td data-label="Category">{inv.category ?? "—"}</td>
                  <td data-label="Description">{inv.description}</td>
                  <td data-label="File">
                    {inv.file_path ? (
                      <button className="link-btn" onClick={() => handleView(inv)}>
                        View
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link to={`/projects/${projectId}/invoices/${inv.id}`} style={{ marginRight: 8 }}>
                      Open
                    </Link>
                    <button onClick={() => startEdit(inv)}>Edit</button>
                    <button onClick={() => handleDelete(inv)} style={{ marginLeft: 6 }}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
