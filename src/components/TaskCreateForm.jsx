import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

export default function TaskCreateForm({ projectId, existingTasks, onCreated, onCancel }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [vendors, setVendors] = useState([]);
  const [estimatedCost, setEstimatedCost] = useState("");
  const [predIds, setPredIds] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("vendors")
      .select("id,name,trade")
      .order("name")
      .then(({ data }) => setVendors(data ?? []));
  }, []);

  function togglePred(taskId) {
    setPredIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const { data: created, error: createError } = await supabase
      .from("tasks")
      .insert({
        project_id: projectId,
        title,
        category: category || null,
        start_date: startDate || null,
        due_date: dueDate || null,
        vendor_id: vendorId || null,
        estimated_cost: estimatedCost || null,
      })
      .select("id")
      .single();

    if (createError) {
      setSubmitting(false);
      setError(createError.message);
      return;
    }

    if (predIds.size > 0) {
      await supabase
        .from("task_predecessors")
        .insert([...predIds].map((pid) => ({ task_id: created.id, predecessor_id: pid })));
    }

    setSubmitting(false);
    setTitle("");
    setCategory("");
    setStartDate("");
    setDueDate("");
    setVendorId("");
    setEstimatedCost("");
    setPredIds(new Set());
    onCreated();
  }

  return (
    <form onSubmit={handleCreate} className="task-form" style={{ marginBottom: 20 }}>
      <label htmlFor="title">Task title</label>
      <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />

      <label htmlFor="category">Category</label>
      <input id="category" value={category} onChange={(e) => setCategory(e.target.value)} />

      <label htmlFor="start">Start date</label>
      <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />

      <label htmlFor="due">Due date</label>
      <input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />

      <label htmlFor="vendor">Vendor</label>
      <select id="vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
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
        value={estimatedCost}
        onChange={(e) => setEstimatedCost(e.target.value)}
      />

      {existingTasks && existingTasks.length > 0 && (
        <>
          <label>Predecessors</label>
          <div className="predecessor-picker">
            {existingTasks.map((t) => (
              <label key={t.id} className="predecessor-option">
                <input type="checkbox" checked={predIds.has(t.id)} onChange={() => togglePred(t.id)} />
                {t.title}
              </label>
            ))}
          </div>
        </>
      )}

      {error && <p className="auth-error">{error}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create task"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{ background: "none", border: "1px solid var(--line)", color: "var(--ink)" }}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
