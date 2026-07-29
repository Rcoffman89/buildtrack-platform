import { supabase } from "./supabaseClient.js";
import { logAudit } from "./audit.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(dateStr, days) {
  if (!dateStr) return null; // undated task — nothing to compute forward from
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / DAY_MS);
}

/**
 * Real forward-pass critical-path scheduling — replaces the old "only ever push a dependent
 * later, don't wait for every predecessor" simplification. For every task (in topological
 * order), its earliest possible start is the MAX finish date across ALL of its predecessors
 * (using actual_finish_date for Complete predecessors, planned due_date otherwise). This can
 * pull a task's dates EARLIER than previously planned if predecessors finish ahead of
 * schedule, same as real project-management critical-path math.
 *
 * Complete tasks are frozen — their dates are historical fact and never recomputed, though
 * they still anchor their own dependents via actual_finish_date.
 *
 * directlyEditedTaskId is skipped in the recompute (the user's just-typed values for that one
 * task are authoritative, not to be silently overwritten a moment after they entered them) —
 * but its new values still feed forward into everything downstream.
 *
 * Every task that ends up moved as a *side effect* gets an audit_log entry and a notification
 * — cascading never silently overwrites a date with no trace.
 */
export async function recomputeProjectSchedule(projectId, organizationId, directlyEditedTaskId = null) {
  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,status,start_date,due_date,actual_finish_date")
    .eq("project_id", projectId);
  if (taskError) throw taskError;

  const taskIds = tasks.map((t) => t.id);
  const { data: edges, error: edgeError } = await supabase
    .from("task_predecessors")
    .select("task_id,predecessor_id")
    .in("task_id", taskIds);
  if (edgeError) throw edgeError;

  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  const predecessorsOf = new Map(tasks.map((t) => [t.id, []]));
  const dependentsOf = new Map(tasks.map((t) => [t.id, []]));
  const inDegree = new Map(tasks.map((t) => [t.id, 0]));

  for (const e of edges) {
    predecessorsOf.get(e.task_id).push(e.predecessor_id);
    dependentsOf.get(e.predecessor_id).push(e.task_id);
    inDegree.set(e.task_id, inDegree.get(e.task_id) + 1);
  }

  // Kahn's algorithm — also doubles as cycle detection: any task left with remaining
  // in-degree > 0 after the queue drains is part of a cycle and gets skipped, not crashed on.
  const queue = tasks.filter((t) => inDegree.get(t.id) === 0).map((t) => t.id);
  const order = [];
  const remaining = new Map(inDegree);
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const dep of dependentsOf.get(id)) {
      remaining.set(dep, remaining.get(dep) - 1);
      if (remaining.get(dep) === 0) queue.push(dep);
    }
  }
  if (order.length !== tasks.length) {
    console.error("Predecessor cycle detected in this project — tasks in the cycle were skipped during rescheduling.");
  }

  const changes = [];

  for (const id of order) {
    const task = byId.get(id);
    if (task.status === "Complete") continue;
    if (id === directlyEditedTaskId) continue;

    const preds = predecessorsOf.get(id);
    if (preds.length === 0) continue;

    let anchor = null;
    for (const predId of preds) {
      const pred = byId.get(predId);
      if (!pred) continue;
      const predFinish = pred.status === "Complete" ? pred.actual_finish_date || pred.due_date : pred.due_date;
      if (!predFinish) continue;
      if (anchor === null || predFinish > anchor) anchor = predFinish;
    }
    if (anchor === null || !task.start_date || !task.due_date) continue;

    const duration = daysBetween(task.start_date, task.due_date);
    const newStart = anchor;
    const newDue = addDays(newStart, duration);

    if (newStart !== task.start_date || newDue !== task.due_date) {
      changes.push({
        id,
        title: task.title,
        oldStart: task.start_date,
        oldDue: task.due_date,
        newStart,
        newDue,
      });
      task.start_date = newStart;
      task.due_date = newDue;
    }
  }

  for (const change of changes) {
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ start_date: change.newStart, due_date: change.newDue })
      .eq("id", change.id);
    if (updateError) {
      console.error(`Failed to apply cascade shift to "${change.title}":`, updateError.message);
      continue;
    }

    await logAudit({
      taskId: change.id,
      organizationId,
      changeType: "cascade_shift",
      fieldName: "start_date / due_date",
      oldValue: `${change.oldStart} → ${change.oldDue}`,
      newValue: `${change.newStart} → ${change.newDue}`,
      reason: "Automatically rescheduled because an upstream task's dates changed",
    });

    await supabase.from("notifications").insert({
      organization_id: organizationId,
      project_id: projectId,
      task_id: change.id,
      message: `"${change.title}" was automatically rescheduled to ${change.newStart} → ${change.newDue} because an earlier task's dates changed.`,
    });
  }

  return changes;
}

/**
 * Full forward + backward critical-path pass, read-only (never writes to the database — this
 * is purely for display, called every time a risk view loads).
 *
 * Forward pass gives each task its earliest start/finish (ES/EF), same math as the cascade
 * above. Backward pass walks the graph in reverse from the project's overall finish date,
 * giving each task its latest start/finish (LS/LF) — the latest it could start without
 * pushing the project finish date out. float = LS - ES: zero (or negative) means the task is
 * on the critical path, i.e. it has no slack and any delay to it delays the whole project.
 *
 * "At Risk" = on the critical path AND currently behind schedule (overdue and not Complete,
 * or explicitly marked Blocked). A late task with slack to absorb it doesn't get flagged —
 * that's the point of doing this with real critical-path data instead of a flat overdue check.
 */
export async function computeProjectRisk(projectId) {
  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,status,start_date,due_date,actual_finish_date")
    .eq("project_id", projectId);
  if (taskError) throw taskError;
  if (tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id);
  const { data: edges, error: edgeError } = await supabase
    .from("task_predecessors")
    .select("task_id,predecessor_id")
    .in("task_id", taskIds);
  if (edgeError) throw edgeError;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const predecessorsOf = new Map(tasks.map((t) => [t.id, []]));
  const dependentsOf = new Map(tasks.map((t) => [t.id, []]));
  const inDegree = new Map(tasks.map((t) => [t.id, 0]));

  for (const e of edges) {
    predecessorsOf.get(e.task_id).push(e.predecessor_id);
    dependentsOf.get(e.predecessor_id).push(e.task_id);
    inDegree.set(e.task_id, inDegree.get(e.task_id) + 1);
  }

  const queue = tasks.filter((t) => inDegree.get(t.id) === 0).map((t) => t.id);
  const order = [];
  const remaining = new Map(inDegree);
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const dep of dependentsOf.get(id)) {
      remaining.set(dep, remaining.get(dep) - 1);
      if (remaining.get(dep) === 0) queue.push(dep);
    }
  }
  // Tasks left out of `order` sit in a predecessor cycle — excluded from risk results rather
  // than crashing on them.

  const ES = new Map();
  const EF = new Map();
  const duration = new Map();

  for (const id of order) {
    const task = byId.get(id);
    const dur = task.start_date && task.due_date ? daysBetween(task.start_date, task.due_date) : 0;
    duration.set(id, dur);

    if (task.status === "Complete") {
      const finish = task.actual_finish_date || task.due_date;
      ES.set(id, finish ? addDays(finish, -dur) : null);
      EF.set(id, finish ?? null);
      continue;
    }

    // A task with no dates of its own and no scheduled predecessor to inherit from is
    // "unscheduled" — it can't meaningfully participate in critical-path math, so it's left
    // out of ES/EF entirely rather than propagating a null through the date arithmetic below.
    let earliestStart = task.start_date ?? null;
    for (const predId of predecessorsOf.get(id)) {
      const predFinish = EF.get(predId);
      if (predFinish && (!earliestStart || predFinish > earliestStart)) earliestStart = predFinish;
    }
    ES.set(id, earliestStart);
    EF.set(id, earliestStart ? addDays(earliestStart, dur) : null);
  }

  const projectFinish = order.reduce((max, id) => {
    const ef = EF.get(id);
    return ef && (max === null || ef > max) ? ef : max;
  }, null);

  const LS = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const deps = dependentsOf.get(id);
    let latestFinish = deps.reduce((min, depId) => {
      const depLS = LS.get(depId);
      return depLS && (min === null || depLS < min) ? depLS : min;
    }, null);
    if (latestFinish === null) latestFinish = projectFinish;
    LS.set(id, latestFinish ? addDays(latestFinish, -duration.get(id)) : null);
  }

  const today = new Date().toISOString().slice(0, 10);

  return order.map((id) => {
    const task = byId.get(id);
    const es = ES.get(id);
    const ls = LS.get(id);
    const float = task.status === "Complete" || !es || !ls ? null : daysBetween(es, ls);
    const isCritical = float !== null && float <= 0;
    const isBehind = task.status !== "Complete" && (task.status === "Blocked" || (task.due_date && task.due_date < today));
    return {
      id,
      title: task.title,
      status: task.status,
      due_date: task.due_date,
      float,
      isCritical,
      isAtRisk: isCritical && isBehind,
    };
  });
}
