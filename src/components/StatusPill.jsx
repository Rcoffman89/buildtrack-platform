const STATUS_CLASS = {
  "Not Started": "pill-none",
  "In Progress": "pill-pending",
  "Complete": "pill-done",
  "Blocked": "pill-blocked",
};

export default function StatusPill({ status }) {
  const cls = STATUS_CLASS[status] || "pill-none";
  return <span className={`pill ${cls}`}>{status}</span>;
}
