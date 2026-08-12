// Creates (once) or resets (every run) the BuildTrack demo environment: a permanent
// "BuildTrack Demo" organization + permanent demo login, isolated from every real client's
// data by the exact same RLS pattern used everywhere else in the app — no separate
// infrastructure. Safe to re-run any time before a demo: it always wipes and reseeds the
// project-level data under this one org, but never touches the org or login account itself,
// and never touches any other organization.
//
// Usage: npm run seed-demo
//
// SAFETY: this script only ever operates on the organization named exactly "BuildTrack Demo".
// It looks that org up by name and refuses to run if it can't find or safely create it. It
// should never be pointed at a real client org.

import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DEMO_ORG_NAME = "BuildTrack Demo";
const DEMO_EMAIL = "demo@buildtrack.local";
const DEMO_PASSWORD = "BuildTrackDemo!2026";

const CATEGORY_OPTIONS = [
  "Design", "Approvals/Permits", "Sitework", "Foundation", "Structural", "MEP",
  "Interior Finishes", "FF&E", "Long-lead Equipment", "Closeout", "Contingency", "Other",
];

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function ensureOrgAndLogin() {
  let { data: org } = await admin.from("organizations").select("id,name").eq("name", DEMO_ORG_NAME).maybeSingle();
  if (!org) {
    const { data: created, error } = await admin.from("organizations").insert({ name: DEMO_ORG_NAME }).select().single();
    if (error) throw error;
    org = created;
    console.log("Created demo organization:", org.id);
  } else {
    console.log("Reusing existing demo organization:", org.id);
  }

  let { data: profile } = await admin.from("profiles").select("id,email").eq("email", DEMO_EMAIL).maybeSingle();
  if (!profile) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    await admin.from("profiles").update({ organization_id: org.id, role: "admin" }).eq("id", created.user.id);
    console.log("Created demo login:", DEMO_EMAIL);
  } else {
    // Keep it pinned to the demo org and admin role in case either ever drifted.
    await admin.from("profiles").update({ organization_id: org.id, role: "admin" }).eq("id", profile.id);
    console.log("Reusing existing demo login:", DEMO_EMAIL);
  }

  return org.id;
}

async function wipeOrgData(orgId) {
  // Deleting projects cascades away tasks, task_predecessors, invoices, rfps (and rfp_documents/
  // rfp_bids/rfp_invitations under them), and project_category_budgets automatically. Vendors
  // and gl_mappings are org-scoped, not project-scoped, so they're cleared separately.
  const { data: projects } = await admin.from("projects").select("id").eq("organization_id", orgId);
  if (projects?.length) {
    await admin.from("projects").delete().eq("organization_id", orgId);
  }
  await admin.from("vendors").delete().eq("organization_id", orgId);
  await admin.from("gl_mappings").delete().eq("organization_id", orgId);
  await admin.from("audit_log").delete().eq("organization_id", orgId);
  await admin.from("notifications").delete().eq("organization_id", orgId);
  console.log("Wiped existing demo project/vendor/GL/audit/notification data.");
}

async function seed(orgId) {
  // --- Vendors ---
  const vendorRows = [
    { name: "Summit Construction Group", trade: "General Contractor", contact_email: "bids@summitconstruction.example", contact_phone: "555-0101" },
    { name: "Coastal Builders LLC", trade: "General Contractor", contact_email: "info@coastalbuilders.example", contact_phone: "555-0102" },
    { name: "Bright Spark Electric", trade: "Electrical", contact_email: "office@brightsparkelectric.example", contact_phone: "555-0103" },
    { name: "FlowRight Plumbing", trade: "Plumbing", contact_email: "service@flowrightplumbing.example", contact_phone: "555-0104" },
    { name: "Climate Pro HVAC", trade: "HVAC", contact_email: "hello@climateprohvac.example", contact_phone: "555-0105" },
    { name: "Precision Framing Co.", trade: "Structural/Steel", contact_email: "quotes@precisionframing.example", contact_phone: "555-0106" },
  ];
  const { data: vendors, error: vendorErr } = await admin
    .from("vendors")
    .insert(vendorRows.map((v) => ({ ...v, organization_id: orgId })))
    .select();
  if (vendorErr) throw vendorErr;
  const vendorByName = Object.fromEntries(vendors.map((v) => [v.name, v]));
  console.log(`Seeded ${vendors.length} vendors.`);

  // --- GL codes ---
  await admin.from("gl_mappings").insert([
    { organization_id: orgId, vendor_trade: "General Contractor", gl_code: "5000" },
    { organization_id: orgId, vendor_trade: "Electrical", gl_code: "5010" },
    { organization_id: orgId, vendor_trade: "Plumbing", gl_code: "5020" },
    { organization_id: orgId, vendor_trade: "HVAC", gl_code: "5030" },
  ]);
  console.log("Seeded GL codes.");

  // --- Project 1: the main, richly-populated demo project ---
  const { data: project1, error: p1Err } = await admin
    .from("projects")
    .insert({
      organization_id: orgId,
      name: "Example Boutique Hotel — Full Renovation",
      client_name: "Example Hospitality Group",
      status: "On Track",
      target_date: daysFromNow(215),
    })
    .select()
    .single();
  if (p1Err) throw p1Err;
  console.log("Created project:", project1.name);

  const taskDefs = [
    { title: "Site survey & feasibility study", category: "Design", status: "Complete", start: -120, due: -100, finish: -100 },
    { title: "Architect selected — Meridian Design Group", category: "Design", status: "Complete", start: -100, due: -70, finish: -70 },
    { title: "Schematic design approved", category: "Design", status: "Complete", start: -70, due: -50, finish: -50 },
    { title: "Full construction documents", category: "Design", status: "In Progress", start: -50, due: 10, cost: 45000 },
    { title: "Zoning & variance approval", category: "Approvals/Permits", status: "In Progress", start: -60, due: 5 },
    { title: "Building permit application", category: "Approvals/Permits", status: "Not Started", start: 10, due: 45, preds: ["Full construction documents", "Zoning & variance approval"] },
    { title: "Site work & grading", category: "Sitework", status: "Not Started", start: 45, due: 65, preds: ["Building permit application"] },
    { title: "Foundation & footings pour", category: "Foundation", status: "Not Started", start: 65, due: 85, preds: ["Site work & grading"], vendor: "Summit Construction Group", cost: 82000 },
    { title: "Structural framing & envelope", category: "Structural", status: "Not Started", start: 85, due: 130, preds: ["Foundation & footings pour"], vendor: "Precision Framing Co.", cost: 255000 },
    { title: "MEP rough-in", category: "MEP", status: "Blocked", start: 130, due: 160, preds: ["Structural framing & envelope"], cost: 170000, notes: "Waiting on updated electrical panel spec from Bright Spark before rough-in can start." },
    { title: "Interior finishes & fixtures", category: "Interior Finishes", status: "Not Started", start: 160, due: 190, preds: ["MEP rough-in"], cost: 305000 },
    { title: "Punch list & certificate of occupancy", category: "Closeout", status: "Not Started", start: 190, due: 210, preds: ["Interior finishes & fixtures"] },
    { title: "Grand opening", category: "Closeout", status: "Not Started", start: 215, due: 215, preds: ["Punch list & certificate of occupancy"], milestone: true },
  ];

  const insertedTasks = {};
  for (const t of taskDefs) {
    const { data: task, error } = await admin
      .from("tasks")
      .insert({
        project_id: project1.id,
        title: t.title,
        category: t.category,
        status: t.status,
        percent_complete: t.status === "Complete" ? 100 : t.status === "In Progress" ? 40 : 0,
        start_date: daysFromNow(t.start),
        due_date: daysFromNow(t.due),
        actual_finish_date: t.finish !== undefined ? daysFromNow(t.finish) : null,
        milestone: !!t.milestone,
        vendor_id: t.vendor ? vendorByName[t.vendor].id : null,
        estimated_cost: t.cost ?? null,
        notes: t.notes ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    insertedTasks[t.title] = task;
  }
  console.log(`Seeded ${taskDefs.length} tasks on "${project1.name}".`);

  const predEdges = [];
  for (const t of taskDefs) {
    if (!t.preds) continue;
    for (const predTitle of t.preds) {
      predEdges.push({ task_id: insertedTasks[t.title].id, predecessor_id: insertedTasks[predTitle].id });
    }
  }
  if (predEdges.length) {
    const { error } = await admin.from("task_predecessors").insert(predEdges);
    if (error) throw error;
  }
  console.log(`Seeded ${predEdges.length} predecessor relationships.`);

  // --- Category budgets (target_budget is now a computed rollup of these, not set directly) ---
  await admin.from("project_category_budgets").insert([
    { project_id: project1.id, category: "Design", target_amount: 45000 },
    { project_id: project1.id, category: "Foundation", target_amount: 85000 },
    { project_id: project1.id, category: "Structural", target_amount: 260000 },
    { project_id: project1.id, category: "MEP", target_amount: 175000 },
    { project_id: project1.id, category: "Interior Finishes", target_amount: 310000 },
  ]);
  console.log("Seeded category budget targets.");

  // --- Invoices (one deliberately over its category target, to show that state too) ---
  await admin.from("invoices").insert([
    {
      organization_id: orgId,
      project_id: project1.id,
      task_id: insertedTasks["Full construction documents"].id,
      vendor_id: null,
      category: "Design",
      amount: 52000,
      invoice_date: daysFromNow(-15),
      description: "Meridian Design Group — CD progress billing",
    },
    {
      organization_id: orgId,
      project_id: project1.id,
      task_id: null,
      vendor_id: null,
      category: "Sitework",
      amount: 6500,
      invoice_date: daysFromNow(-5),
      description: "Erosion control & silt fencing — project-level, no specific task",
    },
  ]);
  console.log("Seeded invoices.");

  // --- RFP with a comparison of bids and one Awarded ---
  const { data: rfp, error: rfpErr } = await admin
    .from("rfps")
    .insert({
      organization_id: orgId,
      project_id: project1.id,
      title: "General Contractor — Full Buildout Bid Package",
      scope_description: "Full GC scope: site work through structural framing and envelope enclosure.",
      trade: "General Contractor",
      due_date: daysFromNow(-25),
      status: "Awarded",
    })
    .select()
    .single();
  if (rfpErr) throw rfpErr;

  await admin.from("rfp_bids").insert([
    {
      rfp_id: rfp.id,
      vendor_id: vendorByName["Summit Construction Group"].id,
      amount: 410000,
      notes: "Strong references, available to mobilize immediately.",
      status: "Awarded",
      submitted_at: daysFromNow(-30),
    },
    {
      rfp_id: rfp.id,
      vendor_id: vendorByName["Coastal Builders LLC"].id,
      amount: 455000,
      notes: "Higher bid, six-week-later mobilization.",
      status: "Rejected",
      submitted_at: daysFromNow(-28),
    },
  ]);
  console.log("Seeded RFP with bid comparison.");

  // --- Project 2: a lighter second project, just to populate the portfolio view ---
  const { data: project2, error: p2Err } = await admin
    .from("projects")
    .insert({
      organization_id: orgId,
      name: "Sample Restaurant Buildout",
      client_name: "Sample Hospitality Co.",
      status: "On Track",
      target_date: daysFromNow(150),
    })
    .select()
    .single();
  if (p2Err) throw p2Err;

  const p2Tasks = [
    { title: "Lease signed", category: "Approvals/Permits", status: "Complete", start: -60, due: -50, finish: -50 },
    { title: "Design & layout finalized", category: "Design", status: "In Progress", start: -50, due: 15 },
    { title: "Kitchen equipment procurement", category: "Long-lead Equipment", status: "Not Started", start: 15, due: 75 },
    { title: "Buildout construction", category: "Structural", status: "Not Started", start: 20, due: 110 },
    { title: "Opening prep", category: "Closeout", status: "Not Started", start: 110, due: 150, milestone: true },
  ];
  for (const t of p2Tasks) {
    await admin.from("tasks").insert({
      project_id: project2.id,
      title: t.title,
      category: t.category,
      status: t.status,
      percent_complete: t.status === "Complete" ? 100 : t.status === "In Progress" ? 30 : 0,
      start_date: daysFromNow(t.start),
      due_date: daysFromNow(t.due),
      actual_finish_date: t.finish !== undefined ? daysFromNow(t.finish) : null,
      milestone: !!t.milestone,
    });
  }
  console.log(`Created second project "${project2.name}" with ${p2Tasks.length} tasks.`);
}

async function main() {
  const orgId = await ensureOrgAndLogin();
  await wipeOrgData(orgId);
  await seed(orgId);
  console.log("\nDone. Demo login:", DEMO_EMAIL, "/", DEMO_PASSWORD);
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
