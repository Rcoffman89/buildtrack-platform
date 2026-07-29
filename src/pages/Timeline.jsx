import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import StatusPill from "../components/StatusPill.jsx";
import TaskCreateForm from "../components/TaskCreateForm.jsx";

const STATUS_COLOR_CLASS = {
  "Not Started": "bar-none",
  "In Progress": "bar-pending",
  Complete: "bar-done",
  Blocked: "bar-blocked",
};

const LEGEND_ITEMS = ["Not Started", "In Progress", "Complete", "Blocked"];
const MIN_PX_PER_MONTH = 90; // enough room for a "Sep 2026"-style label without colliding with its neighbor

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24);
}

function formatShort(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function monthTicks(rangeStart, rangeEnd, totalDays) {
  const ticks = [];
  const cursor = new Date(rangeStart + "T00:00:00");
  cursor.setDate(1); // snap to the 1st so ticks land on clean month boundaries
  const end = new Date(rangeEnd + "T00:00:00");

  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    const offset = (daysBetween(rangeStart, iso) / totalDays) * 100;
    if (offset >= 0) {
      ticks.push({
        label: cursor.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
        offset,
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

export default function Timeline() {
  const { projectId } = useParams();
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
  }, [projectId]);

  async function load() {
    const { data, error } = await supabase
      .from("tasks")
      .select("id,title,category,status,start_date,due_date,milestone")
      .eq("project_id", projectId)
      .order("start_date", { ascending: true });
    if (error) setError(error.message);
    else setTasks(data);
  }

  if (error) return <p className="auth-error">{error}</p>;
  if (!tasks) return <p>Loading…</p>;

  if (tasks.length === 0) {
    return (
      <div>
        <div className="dash-header">
          <h1>Timeline</h1>
          <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New Task"}</button>
        </div>
        {showForm && (
          <TaskCreateForm
            projectId={projectId}
            existingTasks={tasks}
            onCreated={() => {
              setShowForm(false);
              load();
            }}
          />
        )}
        {!showForm && <p className="task-meta">No tasks yet — add one to start the timeline.</p>}
      </div>
    );
  }

  const rangeStart = tasks.reduce((min, t) => (t.start_date < min ? t.start_date : min), tasks[0].start_date);
  const rangeEnd = tasks.reduce((max, t) => (t.due_date > max ? t.due_date : max), tasks[0].due_date);
  const totalDays = daysBetween(rangeStart, rangeEnd) || 1;
  const todayOffset = (daysBetween(rangeStart, new Date().toISOString().slice(0, 10)) / totalDays) * 100;
  const showToday = todayOffset >= 0 && todayOffset <= 100;
  const ticks = monthTicks(rangeStart, rangeEnd, totalDays);
  // Scale the canvas to the actual number of months in range, not a flat width — a fixed
  // width was cramming ~20 month labels into 640px (32px each), which is what caused them to
  // overlap into unreadable smashed text. Relying on the already-working horizontal scroll to
  // hold the extra width keeps every label legible regardless of how long the project runs.
  const chartMinWidth = Math.max(640, ticks.length * MIN_PX_PER_MONTH);

  return (
    <div>
      <div className="dash-header">
        <h1>Timeline</h1>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New Task"}</button>
      </div>
      <p className="task-meta">
        {rangeStart} → {rangeEnd}
      </p>

      {showForm && (
        <TaskCreateForm
          projectId={projectId}
          existingTasks={tasks}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="gantt-legend">
        {LEGEND_ITEMS.map((s) => (
          <StatusPill status={s} key={s} />
        ))}
        <span className="gantt-legend-item">
          <span className="legend-swatch legend-milestone" /> Milestone
        </span>
        <span className="gantt-legend-item">
          <span className="legend-swatch legend-today" /> Today
        </span>
      </div>

      <div className="gantt">
        <div className="gantt-sidebar">
          <div className="gantt-sidebar-row gantt-axis-spacer" />
          {tasks.map((t) => (
            <div className="gantt-sidebar-row" key={t.id}>
              <Link to={`/projects/${projectId}/tasks/${t.id}`} className="gantt-label" title={t.title}>
                {t.milestone && <span className="milestone-flag">◆ </span>}
                {t.title}
              </Link>
              <span className="gantt-category">{t.category}</span>
            </div>
          ))}
        </div>

        <div className="gantt-chart-scroll">
          <div className="gantt-chart-inner" style={{ minWidth: chartMinWidth }}>
            {showToday && <div className="gantt-today" style={{ left: `${todayOffset}%` }} title="Today" />}

            <div className="gantt-axis">
              {ticks.map((tick) => (
                <span className="gantt-axis-tick" style={{ left: `${tick.offset}%` }} key={tick.label}>
                  {tick.label}
                </span>
              ))}
            </div>

            {tasks.map((t) => {
              const left = (daysBetween(rangeStart, t.start_date) / totalDays) * 100;
              const width = Math.max((daysBetween(t.start_date, t.due_date) / totalDays) * 100, 0.6);
              const colorClass = STATUS_COLOR_CLASS[t.status] || "bar-none";
              const dateLabel = t.milestone
                ? formatShort(t.due_date)
                : `${formatShort(t.start_date)} – ${formatShort(t.due_date)}`;
              const labelOnRight = left + width < 65;

              return (
                <div className="gantt-chart-row" key={t.id}>
                  <div className="gantt-track">
                    {t.milestone ? (
                      <div
                        className="gantt-milestone"
                        style={{ left: `${left}%` }}
                        title={`${t.title} — ${t.due_date}`}
                      />
                    ) : (
                      <div
                        className={`gantt-bar ${colorClass}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${t.title}: ${t.start_date} → ${t.due_date}`}
                      />
                    )}
                    <span
                      className={`gantt-date-label ${labelOnRight ? "label-right" : "label-left"}`}
                      style={
                        labelOnRight
                          ? { left: `calc(${left}% + ${width}% + 8px)` }
                          : { right: `calc(100% - ${left}% + 8px)` }
                      }
                    >
                      {dateLabel}
                    </span>
                  </div>
                  <StatusPill status={t.status} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
