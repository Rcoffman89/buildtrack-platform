import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TRADE_OPTIONS } from "./Vendors.jsx";

const STATUS_CLASS = {
  Draft: "pill-none",
  Open: "pill-pending",
  Awarded: "pill-done",
  Cancelled: "pill-blocked",
};

export default function Rfps() {
  const { projectId } = useParams();
  const { organizationId } = useAuth();
  const [rfps, setRfps] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [scopeDescription, setScopeDescription] = useState("");
  const [taskId, setTaskId] = useState("");
  const [trade, setTrade] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    load();
  }, [projectId]);

  async function load() {
    const { data, error } = await supabase
      .from("rfps")
      .select("*, tasks(title), rfp_bids(id)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setRfps(data);

    const { data: taskData } = await supabase.from("tasks").select("id,title").eq("project_id", projectId).order("title");
    setTasks(taskData ?? []);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const { data: created, error: createError } = await supabase
      .from("rfps")
      .insert({
        organization_id: organizationId,
        project_id: projectId,
        task_id: taskId || null,
        title,
        scope_description: scopeDescription || null,
        trade: trade || null,
        due_date: dueDate || null,
      })
      .select("id")
      .single();

    if (createError) {
      setSubmitting(false);
      setError(createError.message);
      return;
    }

    for (const file of files) {
      const path = `${organizationId}/${created.id}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("rfp-files").upload(path, file);
      if (uploadError) {
        setError(`RFP created, but "${file.name}" failed to upload: ${uploadError.message}`);
        continue;
      }
      await supabase.from("rfp_documents").insert({ rfp_id: created.id, file_path: path, file_name: file.name });
    }

    setSubmitting(false);
    setTitle("");
    setScopeDescription("");
    setTaskId("");
    setTrade("");
    setDueDate("");
    setFiles([]);
    load();
  }

  return (
    <div>
      <h1>RFPs</h1>

      <form onSubmit={handleCreate} className="task-form" style={{ marginBottom: 28 }}>
        <label htmlFor="rfp-title">Title</label>
        <input id="rfp-title" required value={title} onChange={(e) => setTitle(e.target.value)} />

        <label htmlFor="rfp-scope">Scope description</label>
        <textarea id="rfp-scope" rows={4} value={scopeDescription} onChange={(e) => setScopeDescription(e.target.value)} />

        <label htmlFor="rfp-task">Related task (optional)</label>
        <select id="rfp-task" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          <option value="">— None —</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>

        <label htmlFor="rfp-trade">Trade (optional)</label>
        <select id="rfp-trade" value={trade} onChange={(e) => setTrade(e.target.value)}>
          <option value="">— None —</option>
          {TRADE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label htmlFor="rfp-due">Bid due date</label>
        <input id="rfp-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />

        <label htmlFor="rfp-files">Plans / scope docs (optional, multiple allowed)</label>
        <input
          id="rfp-files"
          type="file"
          multiple
          accept="application/pdf,image/*"
          onChange={(e) => setFiles([...e.target.files])}
        />

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create RFP"}
        </button>
      </form>

      {!rfps && !error && <p>Loading…</p>}
      {rfps && rfps.length === 0 && <p className="task-meta">No RFPs yet — create one above.</p>}

      {rfps && rfps.length > 0 && (
        <table className="task-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Task</th>
              <th>Trade</th>
              <th>Due</th>
              <th>Status</th>
              <th>Bids</th>
            </tr>
          </thead>
          <tbody>
            {rfps.map((r) => (
              <tr key={r.id}>
                <td data-label="Title">
                  <Link to={`/projects/${projectId}/rfps/${r.id}`}>{r.title}</Link>
                </td>
                <td data-label="Task">{r.tasks?.title ?? "—"}</td>
                <td data-label="Trade">{r.trade ?? "—"}</td>
                <td data-label="Due">{r.due_date ?? "—"}</td>
                <td data-label="Status">
                  <span className={`pill ${STATUS_CLASS[r.status] || "pill-none"}`}>{r.status}</span>
                </td>
                <td data-label="Bids">{r.rfp_bids?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
