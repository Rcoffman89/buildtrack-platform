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

// True when a Supabase error means a table hasn't been created yet (a database script that
// hasn't been run).
export function isMissingTableError(error) {
  const msg = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42P01|PGRST205|does not exist|Could not find the table/i.test(msg);
}

// Uploads several files one after another (gentler on a phone connection than all at once).
// onProgress(n, total) is called before each file. Returns { paths } or { paths, error }, where
// paths are the ones that did upload before the error.
export async function uploadInvoiceFiles(organizationId, projectId, files, onProgress) {
  const paths = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i + 1, files.length);
    const { path, error } = await uploadInvoiceFile(organizationId, projectId, files[i]);
    if (error) return { paths, error };
    paths.push(path);
  }
  return { paths };
}

// Deletes uploaded files that ended up not attached to anything (a failed save).
export async function discardUploadedFiles(paths) {
  if (paths.length > 0) await supabase.storage.from("invoices").remove(paths);
}

// How photos are stored: invoices.file_path is the invoice's FIRST photo (as it always has
// been), and every further photo is a row in invoice_attachments (migration 0017). That way
// existing invoices need no data moved, and one-photo invoices work even before 0017 is run.
//
// Attaches already-uploaded paths to an invoice: fills file_path first if it's empty, the rest
// go to invoice_attachments. Returns {} on success, { error } on failure, or
// { unavailable: true } when the extra-photos table isn't set up yet — then the extra uploads
// are deleted again and only the first photo is kept.
export async function attachInvoicePhotos(organizationId, invoice, paths) {
  let rest = paths;
  if (!invoice.file_path && rest.length > 0) {
    const { error } = await supabase.from("invoices").update({ file_path: rest[0] }).eq("id", invoice.id);
    if (error) {
      await discardUploadedFiles(rest);
      return { error };
    }
    rest = rest.slice(1);
  }
  if (rest.length === 0) return {};

  const { error } = await supabase.from("invoice_attachments").insert(
    rest.map((path, i) => ({
      organization_id: organizationId,
      invoice_id: invoice.id,
      file_path: path,
      sort_order: i,
    }))
  );
  if (error) {
    await discardUploadedFiles(rest);
    return isMissingTableError(error) ? { unavailable: true } : { error };
  }
  return {};
}

// Every photo on an invoice, first one first, each with a signed URL to show it.
// Returns { photos: [{ id, file_path, url }], unavailable } — id is null for the first photo
// (it lives on the invoice row itself); unavailable means 0017 hasn't been run yet.
export async function loadInvoicePhotos(invoice) {
  const photos = [];
  if (invoice.file_path) photos.push({ id: null, file_path: invoice.file_path, url: "" });

  let unavailable = false;
  let loadError = null;
  const { data, error } = await supabase
    .from("invoice_attachments")
    .select("id,file_path")
    .eq("invoice_id", invoice.id)
    .order("created_at")
    .order("sort_order");
  if (error) {
    if (isMissingTableError(error)) unavailable = true;
    else loadError = error;
  }
  for (const a of data ?? []) {
    if (a.file_path !== invoice.file_path) photos.push({ id: a.id, file_path: a.file_path, url: "" });
  }

  if (photos.length > 0) {
    const { data: signed } = await supabase.storage
      .from("invoices")
      .createSignedUrls(
        photos.map((p) => p.file_path),
        3600
      );
    const byPath = Object.fromEntries((signed ?? []).map((s) => [s.path, s.signedUrl]));
    for (const p of photos) p.url = byPath[p.file_path] ?? "";
  }
  return loadError ? { photos, unavailable, error: loadError } : { photos, unavailable };
}

// Removes one photo from an invoice (and its file). Removing the first photo moves the next
// one up into its place, so file_path is set whenever the invoice has any photo at all.
export async function removeInvoicePhoto(invoice, photo, photos) {
  if (photo.id) {
    const { error } = await supabase.from("invoice_attachments").delete().eq("id", photo.id);
    if (error) return { error };
  } else {
    const next = photos.find((p) => p.id);
    const { error } = await supabase
      .from("invoices")
      .update({ file_path: next ? next.file_path : null })
      .eq("id", invoice.id);
    if (error) return { error };
    if (next) await supabase.from("invoice_attachments").delete().eq("id", next.id);
  }
  await supabase.storage.from("invoices").remove([photo.file_path]);
  return {};
}

// File paths of an invoice's extra photos (empty if there are none, or 0017 isn't run yet).
export async function extraPhotoPaths(invoiceIds) {
  if (invoiceIds.length === 0) return [];
  const { data, error } = await supabase
    .from("invoice_attachments")
    .select("invoice_id,file_path")
    .in("invoice_id", invoiceIds);
  if (error) return [];
  return data ?? [];
}
