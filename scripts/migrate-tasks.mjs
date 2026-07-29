import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reuses the same Supabase project's service_role key already configured for the (retired)
// webhook-service — one-off migration script, not part of the platform app itself.
dotenv.config({ path: path.join(__dirname, "../../webhook-service/.env") });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const seedPath = path.join(__dirname, "../../data/montego-venue-tasks.json");
const seedTasks = JSON.parse(readFileSync(seedPath, "utf8"));

async function main() {
  const { count: existing } = await client.from("tasks").select("*", { count: "exact", head: true });
  if (existing > 0) {
    console.error(`tasks table already has ${existing} row(s) — refusing to double-migrate. Truncate it first if you want to re-run this.`);
    process.exit(1);
  }

  const titleToId = new Map();

  // Pass 1: insert every task, no predecessor links yet (their IDs don't exist until this pass finishes).
  for (const t of seedTasks) {
    const { data, error } = await client
      .from("tasks")
      .insert({
        title: t.Title,
        category: t.Category,
        status: t.Status,
        milestone: t.Milestone,
        percent_complete: t.PercentComplete,
        notes: t.Notes || null,
        assigned_to: t.AssignedTo || null,
        start_date: t.StartDate,
        due_date: t.DueDate,
        actual_finish_date: t.Status === "Complete" ? t.DueDate : null,
      })
      .select("id")
      .single();

    if (error) {
      console.error(`Failed to insert "${t.Title}":`, error.message);
      process.exit(1);
    }

    titleToId.set(t.Title, data.id);
    console.log(`Inserted "${t.Title}" (${data.id})`);
  }

  // Pass 2: wire up predecessor links now that every task has an ID.
  for (const t of seedTasks) {
    if (!t.Predecessors || t.Predecessors.length === 0) continue;

    const taskId = titleToId.get(t.Title);
    const rows = t.Predecessors.map((predTitle) => {
      const predecessorId = titleToId.get(predTitle);
      if (!predecessorId) {
        throw new Error(`"${t.Title}" lists predecessor "${predTitle}" which wasn't found among migrated tasks.`);
      }
      return { task_id: taskId, predecessor_id: predecessorId };
    });

    const { error } = await client.from("task_predecessors").insert(rows);
    if (error) {
      console.error(`Failed to link predecessors for "${t.Title}":`, error.message);
      process.exit(1);
    }
    console.log(`Linked ${rows.length} predecessor(s) for "${t.Title}"`);
  }

  console.log(`\nDone. Migrated ${seedTasks.length} tasks.`);
}

main();
