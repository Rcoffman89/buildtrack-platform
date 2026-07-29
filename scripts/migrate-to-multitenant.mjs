import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: existingOrgs } = await admin.from("organizations").select("id,name");
  if (existingOrgs && existingOrgs.length > 0) {
    console.error("organizations table already has rows — refusing to double-migrate:", existingOrgs);
    process.exit(1);
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: "Hospitality Ops 360" })
    .select("id")
    .single();
  if (orgError) throw orgError;
  console.log("Created organization:", org.id);

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      organization_id: org.id,
      name: "Montego Venue",
      client_name: "Hospitality Ops 360",
      status: "On Track",
    })
    .select("id")
    .single();
  if (projectError) throw projectError;
  console.log("Created project:", project.id);

  const { error: profileError, count: profileCount } = await admin
    .from("profiles")
    .update({ organization_id: org.id })
    .is("organization_id", null)
    .select("id", { count: "exact" });
  if (profileError) throw profileError;
  console.log(`Backfilled organization_id on ${profileCount} profile(s).`);

  const { error: taskError, count: taskCount } = await admin
    .from("tasks")
    .update({ project_id: project.id })
    .is("project_id", null)
    .select("id", { count: "exact" });
  if (taskError) throw taskError;
  console.log(`Backfilled project_id on ${taskCount} task(s).`);

  console.log("\nDone.");
}

main();
