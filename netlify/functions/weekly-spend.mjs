import { createClient } from "@supabase/supabase-js";

// Monday-morning spend update: for each active project, total spend so far and spend by budget
// category, plus what was spent in the past week (expenses dated in the 7 days before the send,
// i.e. last Monday through Sunday). No budget or target numbers (Ryan's call). Sent with the same Resend setup the RFP
// invites use.
//
// Netlify environment variables:
//   WEEKLY_SPEND_RECIPIENTS  required, comma-separated email addresses
//   WEEKLY_SPEND_ORG_ID      optional, only report this organization's projects
//   RESEND_API_KEY / RESEND_FROM_ADDRESS / VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//                            already used by the other functions
//
// Schedule: 11:00 UTC Mondays = 6 AM Eastern in winter, 7 AM in summer. Netlify can also run it
// on demand from the Functions page ("Run now") to test.

const CATEGORY_ORDER = [
  "Design",
  "Approvals/Permits",
  "Sitework",
  "Foundation",
  "Structural",
  "MEP",
  "Interior Finishes",
  "FF&E",
  "Long-lead Equipment",
  "Closeout",
  "Contingency",
  "Other",
];

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const cell = 'style="padding:4px 10px;border-bottom:1px solid #e3e6ea;text-align:left"';
const cellR = 'style="padding:4px 10px;border-bottom:1px solid #e3e6ea;text-align:right"';

// Eastern-time calendar date (YYYY-MM-DD), shifted by `days`.
function easternDate(days = 0) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function projectSection(project, invoices, siteUrl, weekStart, weekEnd) {
  const byCat = {};
  const weekByCat = {};
  for (const inv of invoices) {
    const cat = inv.category || "Uncategorized";
    byCat[cat] = (byCat[cat] || 0) + Number(inv.amount);
    if (inv.invoice_date && inv.invoice_date >= weekStart && inv.invoice_date <= weekEnd) {
      weekByCat[cat] = (weekByCat[cat] || 0) + Number(inv.amount);
    }
  }
  const totalSpent = invoices.reduce((s, i) => s + Number(i.amount), 0);
  const weekSpent = Object.values(weekByCat).reduce((s, v) => s + v, 0);
  const cats = [...CATEGORY_ORDER, "Uncategorized"].filter((c) => byCat[c] || weekByCat[c]);
  const catRows = cats
    .map(
      (c) =>
        `<tr><td ${cell}>${esc(c)}</td><td ${cellR}>${weekByCat[c] ? money(weekByCat[c]) : "&ndash;"}</td><td ${cellR}>${money(byCat[c])}</td></tr>`
    )
    .join("");

  const link = `${siteUrl}/projects/${project.id}`;
  return `
  <h2 style="margin:24px 0 4px">${esc(project.name)}</h2>
  <p style="margin:0 0 4px;font-size:16px">Spent this past week: <strong>${money(weekSpent)}</strong></p>
  <p style="margin:0 0 12px;font-size:16px">Total spent so far: <strong>${money(totalSpent)}</strong></p>
  <table style="border-collapse:collapse;font-size:14px;margin-bottom:12px">
    <tr><th ${cell}>Category</th><th ${cellR}>Past week</th><th ${cellR}>Total spent</th></tr>
    ${catRows}</table>
  <p style="margin:0"><a href="${esc(link)}">Open ${esc(project.name)} in BuildTrack</a></p>`;
}

export default async () => {
  const recipients = (process.env.WEEKLY_SPEND_RECIPIENTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!recipients.length) {
    console.log("weekly-spend: WEEKLY_SPEND_RECIPIENTS not set, nothing sent");
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    console.log("weekly-spend: RESEND_API_KEY not set, nothing sent");
    return;
  }

  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const siteUrl = process.env.URL || "https://buildtrack-montego-platform.netlify.app";

  let projectQuery = admin.from("projects").select("id,name,status,organization_id").neq("status", "Complete").order("name");
  if (process.env.WEEKLY_SPEND_ORG_ID) projectQuery = projectQuery.eq("organization_id", process.env.WEEKLY_SPEND_ORG_ID);
  const { data: projects, error: projErr } = await projectQuery;
  if (projErr) {
    console.error("weekly-spend: projects query failed", projErr.message);
    return;
  }

  // Past week = the 7 days before today (Eastern): last Monday through Sunday on a Monday send.
  const weekStart = easternDate(-7);
  const weekEnd = easternDate(-1);

  const sections = [];
  for (const project of projects ?? []) {
    const { data: invoices } = await admin.from("invoices").select("amount,category,invoice_date").eq("project_id", project.id);
    // Skip projects with no spend yet: nothing to report.
    if (!(invoices ?? []).length) continue;
    sections.push(projectSection(project, invoices, siteUrl, weekStart, weekEnd));
  }
  if (!sections.length) {
    console.log("weekly-spend: no projects with spend yet, nothing sent");
    return;
  }

  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#16232f;max-width:720px">
  <h1 style="font-size:20px;margin:0">Weekly spend update, ${esc(today)}</h1>
  ${sections.join("")}
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_ADDRESS || "BuildTrack <onboarding@resend.dev>",
      to: recipients,
      subject: `BuildTrack weekly spend, ${today}`,
      html,
    }),
  });
  if (!res.ok) console.error("weekly-spend: send failed", res.status, await res.text());
  else console.log(`weekly-spend: sent to ${recipients.length} recipient(s)`);
};

export const config = {
  schedule: "0 11 * * 1",
};
