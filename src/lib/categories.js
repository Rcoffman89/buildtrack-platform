// Fixed standard construction budget categories — mirrors the budget_category enum in
// migration 0014. Shared across task creation/detail, invoices, and the budget-by-category
// breakdown so every part of the app offers the same list in the same order.
export const CATEGORY_OPTIONS = [
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
