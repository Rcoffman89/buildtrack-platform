import { supabase } from "./supabaseClient.js";

// Phone photos are often 3–8 MB. Shrink images to at most 2000px on the long side as JPEG
// before upload so a quick-add from the job site uploads fast and stays readable. PDFs, and
// any image the browser can't decode (e.g. HEIC on some browsers), upload unchanged.
async function shrinkImage(file) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const max = 2000;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "invoice";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// Uploads to the private `invoices` bucket at `{org}/{project}/{uuid}-{filename}` (the path
// shape the storage policies in migration 0010 check). Returns { path } or { error }.
export async function uploadInvoiceFile(organizationId, projectId, file) {
  const prepared = await shrinkImage(file);
  const safeName = prepared.name.replace(/[^\w.-]+/g, "_");
  const path = `${organizationId}/${projectId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from("invoices").upload(path, prepared, {
    contentType: prepared.type || undefined,
  });
  if (error) return { error };
  return { path };
}

export function isPdfPath(path) {
  return /\.pdf$/i.test(path || "");
}
