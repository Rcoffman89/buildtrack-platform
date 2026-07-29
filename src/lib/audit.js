import { supabase } from "./supabaseClient.js";

export async function logAudit({ taskId, organizationId, changeType, fieldName, oldValue, newValue, reason }) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("audit_log").insert({
    task_id: taskId ?? null,
    organization_id: organizationId,
    changed_by: userData?.user?.id ?? null,
    change_type: changeType,
    field_name: fieldName ?? null,
    old_value: oldValue != null ? String(oldValue) : null,
    new_value: newValue != null ? String(newValue) : null,
    reason: reason ?? null,
  });
  if (error) console.error("Failed to write audit log entry:", error.message);
}
