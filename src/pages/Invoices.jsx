import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { CATEGORY_OPTIONS } from "../lib/categories.js";
import {
  attachInvoicePhotos,
  discardUploadedFiles,
  extraPhotoPaths,
  isMissingTableError,
  uploadInvoiceFiles,
} from "../lib/invoicePhoto.js";
import { PhotoPicker, PhotoTile } from "../components/PhotoPicker.jsx";
import QuickbooksExport from "../components/QuickbooksExport.jsx";
import InvoiceStatus from "../components/InvoiceStatus.jsx";

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

  // "" all, "due", "paid", "not_exported", "exported". Needs migration 0018's columns.
  const [statusFilter, setStatusFilter] = useState("");

  const [taskId, setTaskId] = useState(preselectedTaskId);
  const [vendorId, setVendorId] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(preselectedCategory);
  const [categoryFilter, setCategoryFilter] = useState(initialFilter);
  // Photos picked for the new expense, in order: { id, file, url } where url is a local preview.
  const [photos, setPhotos] = useState([]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [editing, setEditing] = useState({});
  const [justSaved, setJustSaved] = useState(null);
  const [notice, setNotice] = useState("");
  // Extra photos per invoice (beyond file_path), and whether the extra-photos table exists yet.
  const [extraCounts, setExtraCounts] = useState({});
  const [extraPhotosReady, setExtraPhotosReady] = useState(true);

  useEffect(() => {
    load();
  }, [projectId]);

  // Free the local previews when leaving the page.
  useEffect(() => () => photosRef.current.forEach((p) => p.url && URL.revokeObjectURL(p.url)), []);

  function addPhotos(files) {
    const added = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      url: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    }));
    setPhotos((current) => [...current, ...added]);
  }

  function dropPhoto(id) {
    setPhotos((current) => {
      const gone = current.find((p) => p.id === id);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return current.filter((p) => p.id !== id);
    });
  }

  function clearPhotos() {
    photos.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    setPhotos([]);
  }

  async function load() {
    const { data, error } = await supabase
      .from("invoices")
      .select("*, tasks(title,category), vendors(name,trade)")
      .eq("project_id", projectId)
      .order("invoice_date", { ascending: false });
    if (error) setError(error.message);
    else setInvoices(data);

    // Count each invoice's extra photos. If the table isn't there yet (database script not run),
    // invoices just show their one photo as before.
    const { data: extraData, error: extraError } = await supabase
      .from("invoice_attachments")
      .select("invoice_id")
      .in("invoice_id", (data ?? []).map((inv) => inv.id));
    setExtraPhotosReady(!(extraError && isMissingTableError(extraError)));
    const counts = {};
    for (const row of extraError ? [] : extraData ?? []) counts[row.invoice_id] = (counts[row.invoice_id] ?? 0) + 1;
    setExtraCounts(counts);

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
    setNotice("");

    const { paths, error: uploadError } = await uploadInvoiceFiles(
      organizationId,
      projectId,
      photos.map((p) => p.file),
      (n, total) => setProgress(total > 1 ? `Uploading photo ${n} of ${total}…` : "Uploading photo…")
    );
    setProgress("");
    if (uploadError) {
      await discardUploadedFiles(paths);
      setSubmitting(false);
      setError(uploadError.message);
      return;
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
      file_path: paths[0] ?? null,
    }).select("id,amount,category,file_path").single();

    if (insertError) {
      await discardUploadedFiles(paths);
      setSubmitting(false);
      setError(insertError.message);
      return;
    }

    // First photo is on the invoice itself; any more go in invoice_attachments.
    if (paths.length > 1) {
      const result = await attachInvoicePhotos(organizationId, inserted, paths.slice(1));
      if (result.unavailable) {
        setNotice(
          "Saved with the first photo only. More than one photo per expense needs the database script " +
            "supabase/migrations/0017_invoice_attachments.sql run once in the Supabase SQL editor."
        );
      } else if (result.error) {
        setNotice(`Saved, but the extra photos didn't attach: ${result.error.message}. Open the expense to add them again.`);
      }
    }
    setSubmitting(false);
    setTaskId("");
    setVendorId("");
    setAmount("");
    setInvoiceDate("");
    setDescription("");
    setCategory(preselectedCategory);
    clearPhotos();
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

  async function handleDelete(invoice) {
    if (!window.confirm(`Delete this ${invoice.amount ? `$${invoice.amount} ` : ""}invoice? This can't be undone.`)) return;
    // Note every photo first (the extra-photo rows go with the invoice), delete the invoice, then
    // its files, so a failed delete never leaves an invoice pointing at missing photos.
    const extras = await extraPhotoPaths([invoice.id]);
    const filePaths = [invoice.file_path, ...extras.map((x) => x.file_path)].filter(Boolean);
    const { error } = await supabase.from("invoices").delete().eq("id", invoice.id);
    if (error) {
      setError(error.message);
      return;
    }
    await discardUploadedFiles(filePaths);
    load();
  }

  // One photo opens straight away; several open the expense page, which shows them all.
  function renderFileCell(inv) {
    const count = (inv.file_path ? 1 : 0) + (extraCounts[inv.id] ?? 0);
    if (count === 0) return "—";
    if (count === 1 && inv.file_path) {
      return (
        <button className="link-btn" onClick={() => handleView(inv)}>
          View
        </button>
      );
    }
    return <Link to={`/projects/${projectId}/invoices/${inv.id}`}>View {count} photos</Link>;
  }

  // Paid and exported status only shows once migration 0018 has added its columns.
  const statusReady = Boolean(invoices?.length) && "paid_date" in invoices[0];

  const visibleInvoices = (invoices ?? []).filter((inv) => {
    if (categoryFilter === "__none__" && inv.category) return false;
    if (categoryFilter && categoryFilter !== "__none__" && inv.category !== categoryFilter) return false;
    if (statusReady) {
      if (statusFilter === "due" && inv.paid_date) return false;
      if (statusFilter === "paid" && !inv.paid_date) return false;
      if (statusFilter === "not_exported" && inv.qb_exported_at) return false;
      if (statusFilter === "exported" && !inv.qb_exported_at) return false;
    }
    return true;
  });
  const visibleTotal = visibleInvoices.reduce((sum, inv) => sum + Number(inv.amount), 0);
  const visibleDue = visibleInvoices.filter((inv) => !inv.paid_date).reduce((sum, inv) => sum + Number(inv.amount), 0);

  return (
    <div>
      <h1>Invoices</h1>

      <form onSubmit={handleCreate} className="task-form quick-add" style={{ marginBottom: 28 }}>
        <h3 style={{ margin: "0 0 4px" }}>Add an expense</h3>
        <p className="task-meta" style={{ margin: "0 0 8px" }}>
          Snap the invoice, enter the total, pick a category. Line items can be added later.
        </p>

        <PhotoPicker onPick={addPhotos} hasPhotos={photos.length > 0} disabled={submitting} />
        {photos.length > 0 && (
          <>
            <div className="photo-thumbs">
              {photos.map((p, i) => (
                <PhotoTile
                  key={p.id}
                  src={p.url}
                  label={`photo ${i + 1}`}
                  isPdf={p.file.type === "application/pdf"}
                  onRemove={submitting ? undefined : () => dropPhoto(p.id)}
                />
              ))}
            </div>
            <p className="task-meta photo-picked">
              {photos.length} {photos.length === 1 ? "photo" : "photos"} attached.
              {photos.length > 1 && !extraPhotosReady
                ? " Only the first will be saved until the photo database script is run."
                : ""}
            </p>
          </>
        )}

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
          {submitting ? progress || "Saving…" : "Save expense"}
        </button>
        {notice && <p className="auth-error">{notice}</p>}

        {justSaved && (
          <p className="task-meta" style={{ margin: "8px 0 0" }}>
            Saved ${Number(justSaved.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            {justSaved.category ? ` to ${justSaved.category}` : ""}.{" "}
            <Link to={`/projects/${projectId}/invoices/${justSaved.id}`}>Open it to add line items</Link>
          </p>
        )}
      </form>

      {invoices && invoices.length > 0 && (
        <QuickbooksExport
          invoices={invoices}
          projectName={projectName}
          glMappings={glMappings}
          statusReady={statusReady}
          onChanged={load}
          onError={setError}
        />
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
          {statusReady && (
            <select aria-label="Paid or exported" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Paid and due</option>
              <option value="due">Due only</option>
              <option value="paid">Paid only</option>
              <option value="not_exported">Not in QuickBooks yet</option>
              <option value="exported">In QuickBooks</option>
            </select>
          )}
          <span className="task-meta">
            {visibleInvoices.length} invoice{visibleInvoices.length === 1 ? "" : "s"}, $
            {visibleTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            {statusReady &&
              `, $${visibleDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} due`}
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
              {statusReady && <th>Status</th>}
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
                      {renderFileCell(inv)}
                    </td>
                    {statusReady && (
                      <td data-label="Status">
                        <InvoiceStatus invoice={inv} onChanged={load} onError={setError} />
                      </td>
                    )}
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
                    {renderFileCell(inv)}
                  </td>
                  {statusReady && (
                    <td data-label="Status">
                      <InvoiceStatus invoice={inv} onChanged={load} onError={setError} />
                    </td>
                  )}
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
