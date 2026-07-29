import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { computeProjectRisk } from "../lib/scheduling.js";
import StatusPill from "../components/StatusPill.jsx";

const CATEGORIES = [
  { key: "dueThisWeek", label: "Due this week" },
  { key: "overdue", label: "Overdue" },
  { key: "completedRecently", label: "Completed since last week" },
  { key: "milestones", label: "Upcoming milestones" },
  { key: "atRisk", label: "At risk (on the critical path & behind)" },
];

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function WeeklyBriefing() {
  const { projectId } = useParams(); // undefined on the portfolio-wide /briefing route
  const [tasks, setTasks] = useState(null);
  const [atRiskTasks, setAtRiskTasks] = useState(null);
  const [error, setError] = useState("");
  const [riskError, setRiskError] = useState("");
  const [enabled, setEnabled] = useState(Object.fromEntries(CATEGORIES.map((c) => [c.key, true])));

  useEffect(() => {
    load();
  }, [projectId]);

  async function load() {
    let query = supabase
      .from("tasks")
      .select("id,title,status,due_date,status_changed_date,actual_finish_date,milestone,project_id,projects(name)");
    if (projectId) query = query.eq("project_id", projectId);

    const { data, error } = await query;
    if (error) {
      setError(error.message);
      return;
    }
    setTasks(data);

    // Critical-path float is inherently per-project (can't compare slack across unrelated
    // projects), so in portfolio mode this runs once per project and the results get merged.
    const projectIds = projectId ? [projectId] : [...new Set(data.map((t) => t.project_id))];
    const nameById = Object.fromEntries(data.map((t) => [t.project_id, t.projects?.name]));

    try {
      const riskLists = await Promise.all(projectIds.map((pid) => computeProjectRisk(pid)));
      const merged = riskLists.flatMap((list, i) =>
        list.filter((r) => r.isAtRisk).map((r) => ({ ...r, project_id: projectIds[i], projectName: nameById[projectIds[i]] }))
      );
      setAtRiskTasks(merged);
    } catch (riskError) {
      // Don't let a risk-calc failure hang the whole page on "Loading" forever — show
      // everything else and just leave the At Risk section visibly empty with an error noted.
      console.error("Failed to compute at-risk tasks:", riskError);
      setAtRiskTasks([]);
      setRiskError(riskError.message);
    }
  }

  if (error) return <p className="auth-error">{error}</p>;
  if (!tasks || !atRiskTasks) return <p>Loading…</p>;

  const today = isoDaysFromNow(0);
  const weekOut = isoDaysFromNow(7);
  const weekAgo = isoDaysFromNow(-7);

  const buckets = {
    dueThisWeek: tasks.filter((t) => t.status !== "Complete" && t.due_date >= today && t.due_date <= weekOut),
    overdue: tasks.filter((t) => t.status !== "Complete" && t.due_date < today),
    completedRecently: tasks.filter(
      (t) => t.status === "Complete" && (t.actual_finish_date ?? t.status_changed_date) >= weekAgo
    ),
    milestones: tasks.filter((t) => t.milestone && t.due_date >= today && t.due_date <= weekOut),
    atRisk: atRiskTasks,
  };

  function toggle(key) {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const taskLink = (t) => `/projects/${t.project_id}/tasks/${t.id}`;

  return (
    <div>
      <h1>Weekly Briefing</h1>
      <p className="task-meta">
        {projectId ? "This project" : "All projects"} — next 7 days ({today} → {weekOut})
      </p>

      <div className="briefing-filters">
        {CATEGORIES.map((c) => (
          <label key={c.key} className="briefing-toggle">
            <input type="checkbox" checked={!!enabled[c.key]} onChange={() => toggle(c.key)} />
            {c.label}
          </label>
        ))}
      </div>

      {CATEGORIES.filter((c) => enabled[c.key]).map((c) => (
        <div className="briefing-section" key={c.key}>
          <h2>{c.label}</h2>
          {c.key === "atRisk" && riskError && <p className="auth-error">Couldn't compute at-risk tasks: {riskError}</p>}
          {buckets[c.key].length === 0 && !(c.key === "atRisk" && riskError) && <p className="task-meta">Nothing here.</p>}
          {buckets[c.key].length > 0 && (
            <ul className="briefing-list">
              {buckets[c.key].map((t) => (
                <li key={t.id}>
                  <Link to={taskLink(t)}>
                    {t.milestone && <span className="milestone-flag">◆ </span>}
                    {t.title}
                  </Link>
                  {!projectId && (t.projects?.name ?? t.projectName) && (
                    <span className="briefing-project"> · {t.projects?.name ?? t.projectName}</span>
                  )}
                  <StatusPill status={t.status} />
                  <span className="task-meta">{t.due_date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
