/**
 * Server-side image upload.
 *
 * Uploads used to happen straight from the browser under the anon key, which
 * meant the four buckets accepted files from anyone holding the key that ships
 * in the bundle. Routing them through the edge functions puts the write behind
 * the same identity check as everything else — an admin session for shop
 * images, verified Telegram initData for customer photos — and lets the
 * service_role key be the only thing storage policies have to trust.
 *
 * Two details are deliberate:
 *
 *   * The stored path is generated here, never taken from the caller. The old
 *     client code built it from `file.name`, so the extension came from the
 *     uploader and a name could carry `../` or an unexpected suffix.
 *   * The extension comes from the declared MIME type, which is checked against
 *     an allowlist first. A `.png` holding something else is stored as whatever
 *     its content type says it is, or refused.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

/** Matches the file_size_limit configured on every bucket. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type UploadBucket =
  | "product-images"
  | "banner-images"
  | "review-photos"
  | "return-photos";

export interface UploadRequest {
  bucket: UploadBucket;
  /** Base64 of the file's bytes, without a data: prefix. */
  content_base64: string;
  content_type: string;
  /** Folder inside the bucket, e.g. "reviews". Optional. */
  prefix?: string;
}

export interface UploadResult {
  ok: boolean;
  /** Путь внутри бакета — именно он хранится в базе. */
  path?: string;
  /** Ссылка для показа: постоянная у открытых бакетов, временная у закрытых. */
  url?: string;
  error?: string;
  status?: number;
}

/**
 * Закрытые бакеты: фото возвратов и отзывов присылают покупатели, и лежат они
 * не для публичного доступа по прямой ссылке. Читать их можно только по
 * подписанной ссылке, которую выдаёт edge-функция после проверки вызывающего.
 */
export const PRIVATE_BUCKETS: readonly UploadBucket[] = ["review-photos", "return-photos"];

/** Сколько живёт подписанная ссылка. Час с запасом хватает на просмотр страницы. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Превращает сохранённые пути в ссылки, пригодные для показа.
 *
 * Значения, которые уже выглядят как ссылка (http…), возвращаются как есть:
 * так строки, записанные до перехода на закрытые бакеты, не ломают страницу.
 */
export async function signPaths(
  supabase: ReturnType<typeof createClient>,
  bucket: UploadBucket,
  paths: unknown,
): Promise<string[]> {
  if (!Array.isArray(paths)) return [];
  const values = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (values.length === 0) return [];

  const toSign = values.filter((p) => !p.startsWith("http"));
  if (toSign.length === 0) return values;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(toSign, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error(`[signPaths] ${bucket}: ${error.message}`);
    return values.filter((p) => p.startsWith("http"));
  }

  const signed = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  return values.map((p) => (p.startsWith("http") ? p : signed.get(p) ?? "")).filter(Boolean);
}

function decodeBase64(input: string): Uint8Array | null {
  try {
    // A data: URL prefix is tolerated so a caller that forgot to strip it does
    // not silently store the prefix as part of the image.
    const cleaned = input.includes(",") ? input.slice(input.indexOf(",") + 1) : input;
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function uploadImage(
  supabase: ReturnType<typeof createClient>,
  req: UploadRequest,
  allowedBuckets: readonly UploadBucket[],
): Promise<UploadResult> {
  if (!allowedBuckets.includes(req.bucket)) {
    return { ok: false, status: 403, error: `Bucket "${req.bucket}" is not allowed here` };
  }

  const extension = EXTENSION_BY_MIME[req.content_type];
  if (!extension) {
    return {
      ok: false,
      status: 415,
      error: `Unsupported type "${req.content_type}". Allowed: ${Object.keys(EXTENSION_BY_MIME).join(", ")}`,
    };
  }

  if (typeof req.content_base64 !== "string" || req.content_base64.length === 0) {
    return { ok: false, status: 400, error: "File content is missing" };
  }

  const bytes = decodeBase64(req.content_base64);
  if (!bytes) return { ok: false, status: 400, error: "File content is not valid base64" };
  if (bytes.length === 0) return { ok: false, status: 400, error: "File is empty" };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `File is ${(bytes.length / 1024 / 1024).toFixed(1)} MB, limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
    };
  }

  // Only [a-z0-9-] survives, so a prefix can never climb out of the bucket.
  const prefix = (req.prefix ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const path = `${prefix ? `${prefix}/` : ""}${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(req.bucket).upload(path, bytes, {
    contentType: req.content_type,
    upsert: false,
  });
  if (error) {
    console.error(`[uploadImage] ${req.bucket}/${path} failed:`, error.message);
    return { ok: false, status: 500, error: "Upload failed" };
  }

  // У закрытого бакета постоянной ссылки не существует — отдаём временную,
  // только чтобы форма показала предпросмотр. В базу пишется `path`.
  if (PRIVATE_BUCKETS.includes(req.bucket)) {
    const { data, error: signError } = await supabase.storage
      .from(req.bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError) {
      console.error(`[uploadImage] подпись ${req.bucket}/${path}: ${signError.message}`);
      return { ok: true, path };
    }
    return { ok: true, path, url: data?.signedUrl };
  }

  const { data } = supabase.storage.from(req.bucket).getPublicUrl(path);
  return { ok: true, path, url: data.publicUrl };
}
