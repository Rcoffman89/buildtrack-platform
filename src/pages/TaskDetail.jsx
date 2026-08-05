import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { logAudit } from "../lib/audit.js";
import { recomputeProjectSchedule } from "../lib/scheduling.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { CATEGORY_OPTIONS } from "../lib/categories.js";

const STATUS_OPTIONS = ["Not Started", "In Progress", "Complete", "Blocked"];

export default function TaskDetail() {
  const { projectId, id } = useParams();
  const navigate = useNavigate();
  const { organizationId } = useAuth();
  const [task, setTask] = useState(null);
  const [predecessors, setPredecessors] = useState([]);
  const [dependents, setDependents] = useState([]);
  const [otherTasks, setOtherTasks] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedPredIds, setSelectedPredIds] = useState(new Set());
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingPreds, setSavingPreds] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    const { data: taskData, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (taskError) {
      setError(taskError.message);
      return;
    }
    setTask(taskData);
    setForm(taskData);

    const { data: predData } = await supabase
      .from("task_predecessors")
      .select("predecessor_id, tasks!task_predecessors_predecessor_id_fkey(id,title,status)")
      .eq("task_id", id);
    const preds = predData?.map((p) => p.tasks) ?? [];
    setPredecessors(preds);
    setSelectedPredIds(new Set(preds.map((p) => p.id)));

    // The inverse: tasks that list this one as a predecessor — i.e. what's waiting on this
    // task to finish. Most useful to see when a task is Blocked. Also excluded from the
    // predecessor picker below — picking a direct dependent as a predecessor would create an
    // immediate cycle.
    const { data: depData } = await supabase
      .from("task_predecessors")
      .select("task_id, tasks!task_predecessors_task_id_fkey(id,title,status)")
      .eq("predecessor_id", id);
    const deps = depData?.map((d) => d.tasks) ?? [];
    setDependents(deps);

    const { data: allTasks } = await supabase
      .from("tasks")
      .select("id,title")
      .eq("project_id", projectId)
      .neq("id", id)
      .order("title");
    const dependentIds = new Set(deps.map((d) => d.id));
    setOtherTasks((allTasks ?? []).filter((t) => !dependentIds.has(t.id)));

    const { data: vendorData } = await supabase.from("vendors").select("id,name,trade").order("name");
    setVendors(vendorData ?? []);

    const { data: invoiceData } = await supabase
      .from("invoices")
      .select("id,amount,invoice_date,description,vendors(name)")
      .eq("task_id", id)
      .order("invoice_date", { ascending: false });
    setInvoices(invoiceData ?? []);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const changedFields = Object.keys(form).filter((k) => form[k] !== task[k]);

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        status: form.status,
        percent_complete: form.percent_complete,
        assigned_to: form.assigned_to,
        vendor_id: form.vendor_id,
        estimated_cost: form.estimated_cost,
        category: form.category,
        notes: form.notes,
        start_date: form.start_date,
        due_date: form.due_date,
      })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    for (const field of changedFields) {
      if (
        [
          "status",
          "percent_complete",
          "assigned_to",
          "vendor_id",
          "estimated_cost",
          "category",
          "notes",
          "start_date",
          "due_date",
        ].includes(field)
      ) {
        await logAudit({
          taskId: id,
          organizationId,
          changeType: "field_update",
          fieldName: field,
          oldValue: task[field],
          newValue: form[field],
        });
      }
    }

    // Cascade re-triggers on either a completion or a manual date edit — both can move
    // downstream tasks. This task's own just-saved values are authoritative and are never
    // recomputed; only its actual downstream descendants are eligible to move, seeded from
    // its direct dependents. Nothing outside that chain is touched.
    const shouldReschedule =
      changedFields.includes("start_date") ||
      changedFields.includes("due_date") ||
      (changedFields.includes("status") && form.status === "Complete");

    if (shouldReschedule && dependents.length > 0) {
      await recomputeProjectSchedule(
        projectId,
        organizationId,
        dependents.map((d) => d.id)
      );
    }

    setSaving(false);
    load();
  }

  async function handleSavePredecessors() {
    setSavingPreds(true);
    setError("");

    const originalIds = new Set(predecessors.map((p) => p.id));
    const toAdd = [...selectedPredIds].filter((pid) => !originalIds.has(pid));
    const toRemove = [...originalIds].filter((pid) => !selectedPredIds.has(pid));

    if (toRemove.length > 0) {
      const { error: delError } = await supabase
        .from("task_predecessors")
        .delete()
        .eq("task_id", id)
        .in("predecessor_id", toRemove);
      if (delError) {
        setError(delError.message);
        setSavingPreds(false);
        return;
      }
    }

    if (toAdd.length > 0) {
      const { error: insError } = await supabase
        .from("task_predecessors")
        .insert(toAdd.map((pid) => ({ task_id: id, predecessor_id: pid })));
      if (insError) {
        setError(insError.message);
        setSavingPreds(false);
        return;
      }
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      const titleById = new Map(otherTasks.map((t) => [t.id, t.title]));
      await logAudit({
        taskId: id,
        organizationId,
        changeType: "predecessors_changed",
        fieldName: "predecessors",
        oldValue: predecessors.map((p) => p.title).join(", ") || "(none)",
        newValue:
          [...selectedPredIds].map((pid) => titleById.get(pid) ?? predecessors.find((p) => p.id === pid)?.title).join(", ") ||
          "(none)",
        reason: "Predecessors edited on task detail page",
      });
      // Changing this task's own predecessor set can change ITS anchor, so recompute starts
      // at this task itself and flows only to its actual downstream descendants.
      await recomputeProjectSchedule(projectId, organizationId, [id]);
    }

    setSavingPreds(false);
    load();
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    setDeleting(true);
    // .select() here isn't just for display — without it, a delete blocked by RLS (0 rows
    // matched) reports no error at all, since "deleted zero rows" is valid REST behavior, not
    // a failure. Checking the actually-returned rows is the only reliable way to know it worked.
    const { error: delError, data: deletedRows } = await supabase.from("tasks").delete().eq("id", id).select("id");
    if (delError) {
      setError(delError.message);
      setDeleting(false);
      return;
    }
    if (!deletedRows || deletedRows.length === 0) {
      setError("Delete didn't go through — the task is still there. This usually means a permissions issue; try again or contact an admin.");
      setDeleting(false);
      return;
    }
    // `dependents` was captured on page load, before this delete — the task_predecessors rows
    // pointing at this task are gone the instant it's deleted, so this is the only chance to
    // know who was actually depending on it.
    if (dependents.length > 0) {
      await recomputeProjectSchedule(
        projectId,
        organizationId,
        dependents.map((d) => d.id)
      );
    }
    navigate(`/projects/${projectId}`);
  }

  function togglePred(taskId) {
    setSelectedPredIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  if (error && !task) return <p className="auth-error">{error}</p>;
  if (!task || !form) return <p>Loading…</p>;

  return (
    <div className="task-detail">
      <Link to={`/projects/${projectId}`} className="back-link">
        ← Back to dashboard
      </Link>

      <div className="task-detail-header">
        <h1>
          {task.milestone && <span className="milestone-flag">◆ </span>}
          {task.title}
        </h1>
        <StatusPill status={task.status} />
      </div>

      <p className="task-meta">{task.category}</p>

      {dependents.length > 0 && (
        <div className="predecessors">
          <h3>Blocks / Depends on This</h3>
          <ul>
            {dependents.map((d) => (
              <li key={d.id}>
                <Link to={`/projects/${projectId}/tasks/${d.id}`}>{d.title}</Link> — <StatusPill status={d.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="predecessors">
        <h3>Invoices</h3>
        {invoices.length === 0 && <p className="task-meta">No invoices linked to this task yet.</p>}
        {invoices.length > 0 && (
          <ul>
            {invoices.map((inv) => (
              <li key={inv.id}>
                ${Number(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                {inv.vendors?.name ? ` — ${inv.vendors.name}` : ""}
                {inv.invoice_date ? ` — ${inv.invoice_date}` : ""}
                {inv.description ? ` — ${inv.description}` : ""}
              </li>
            ))}
          </ul>
        )}
        <Link to={`/projects/${projectId}/invoices?task=${id}`} className="link-btn">
          + Add invoice for this task
        </Link>
      </div>

      <div className="predecessors">
        <h3>Predecessors</h3>
        {otherTasks.length === 0 && <p className="task-meta">No other tasks in this project to depend on.</p>}
        {otherTasks.length > 0 && (
          <div className="predecessor-picker">
            {otherTasks.map((t) => (
              <label key={t.id} className="predecessor-option">
                <input
                  type="checkbox"
                  checked={selectedPredIds.has(t.id)}
                  onChange={() => togglePred(t.id)}
                />
                {t.title}
              </label>
            ))}
          </div>
        )}
        <button onClick={handleSavePredecessors} disabled={savingPreds} style={{ marginTop: 12 }}>
          {savingPreds ? "Saving…" : "Save predecessors"}
        </button>
      </div>

      <form onSubmit={handleSave} className="task-form">
        <label htmlFor="status">Status</label>
        <select id="status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label htmlFor="percent">% Complete</label>
        <input
          id="percent"
          type="number"
          min="0"
          max="100"
          value={form.percent_complete}
          onChange={(e) => setForm({ ...form, percent_complete: Number(e.target.value) })}
        />

        <label htmlFor="assigned">Assigned to</label>
        <input
          id="assigned"
          type="text"
          value={form.assigned_to || ""}
          onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
        />

        <label htmlFor="task-category">Category</label>
        <select
          id="task-category"
          value={form.category || ""}
          onChange={(e) => setForm({ ...form, category: e.target.value || null })}
        >
          <option value="">— None —</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label htmlFor="vendor">Vendor</label>
        <select
          id="vendor"
          value={form.vendor_id || ""}
          onChange={(e) => setForm({ ...form, vendor_id: e.target.value || null })}
        >
          <option value="">— None —</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.trade})
            </option>
          ))}
        </select>

        <label htmlFor="estimated-cost">Estimated cost ($)</label>
        <input
          id="estimated-cost"
          type="number"
          min="0"
          step="0.01"
          value={form.estimated_cost ?? ""}
          onChange={(e) => setForm({ ...form, estimated_cost: e.target.value || null })}
        />

        <label htmlFor="start">Start date</label>
        <input
          id="start"
          type="date"
          value={form.start_date || ""}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
        />

        <label htmlFor="due">Due date</label>
        <input
          id="due"
          type="date"
          value={form.due_date || ""}
          onChange={(e) => setForm({ ...form, due_date: e.target.value })}
        />

        <label htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          rows={4}
          value={form.notes || ""}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        {task.actual_finish_date && (
          <p className="task-meta">Actually finished: {task.actual_finish_date}</p>
        )}

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>

      <button className="delete-task-btn" onClick={handleDelete} disabled={deleting}>
        {deleting ? "Deleting…" : "Delete task"}
      </button>
    </div>
  );
}
