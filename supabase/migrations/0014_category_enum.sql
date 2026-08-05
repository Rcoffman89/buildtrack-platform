-- Standard, fixed construction budget categories. Replaces free-text categories on tasks and
-- invoices, and the ad-hoc "add category budget" flow, with a pre-loaded fixed list — so the
-- budget-by-category breakdown always shows every category, not just whichever ones someone
-- happened to type in.

create type budget_category as enum (
  'Design',
  'Approvals/Permits',
  'Sitework',
  'Foundation',
  'Structural',
  'MEP',
  'Interior Finishes',
  'FF&E',
  'Long-lead Equipment',
  'Closeout',
  'Contingency',
  'Other'
);

-- Map existing free-text task categories onto the new fixed list before converting the column
-- type. 'Design' and 'Closeout' already match exactly. Four tasks were tagged the coarse
-- "Construction" bucket, which has no equivalent in the finer list — split by best judgment,
-- flagged here for Ryan to double-check after deploy:
--   Site work & spread footings pour   -> Foundation (the footings pour is the concrete
--                                          deliverable this task tracks; could arguably be
--                                          Sitework instead — worth a second look)
--   Structural framing & envelope      -> Structural (clean fit)
--   MEP rough-in & elevator install    -> MEP (clean fit)
--   Interior finishes & FF&E install   -> Interior Finishes (the actual FF&E procurement
--                                          already happens via separate tasks — "Furniture
--                                          procurement...", "Plating kitchen equipment
--                                          procurement..." — this task is the install/finish
--                                          labor, so Interior Finishes fits better than FF&E)
update tasks set category = 'Approvals/Permits' where category = 'Approvals';
update tasks set category = 'Long-lead Equipment' where category = 'Long-lead procurement';
update tasks set category = 'Foundation' where title = 'Site work & spread footings pour';
update tasks set category = 'Structural' where title = 'Structural framing & envelope';
update tasks set category = 'MEP' where title = 'MEP rough-in & elevator install';
update tasks set category = 'Interior Finishes' where title = 'Interior finishes & FF&E install';

alter table tasks alter column category type budget_category using category::budget_category;
alter table invoices alter column category type budget_category using category::budget_category;
alter table project_category_budgets alter column category type budget_category using category::budget_category;
