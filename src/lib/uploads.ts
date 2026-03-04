// src/lib/uploads.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function extFromMime(mime: string): string {
  const m = (mime || "").toLowerCase().trim();
  if (m === "image/jpeg" || m === "image/jpg") return ".jpg";
  if (m === "image/png") return ".png";
  if (m === "image/webp") return ".webp";
  if (m === "image/gif") return ".gif";
  if (m === "image/heic") return ".heic";
  return "";
}

function safeFileId(id: string) {
  // allow only [a-zA-Z0-9._-] to prevent path traversal
  const clean = id.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!clean || clean !== id) throw new Error("invalid_file_id");
  return clean;
}

export async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function saveImageUpload(file: File): Promise<{
  fileId: string;
  filename: string;
  mime: string;
  bytes: number;
}> {
  const mime = String(file.type || "").toLowerCase();
  if (!mime.startsWith("image/")) {
    throw new Error("only_images_supported");
  }

  // 10MB guardrail (can be adjusted)
  const bytes = Number((file as any).size ?? 0);
  if (Number.isFinite(bytes) && bytes > 10 * 1024 * 1024) {
    throw new Error("image_too_large");
  }

  await ensureUploadDir();

  const id = crypto.randomUUID();
  const ext = extFromMime(mime) || path.extname(file.name || "").slice(0, 10) || ".bin";
  const filename = `${id}${ext}`;
  const fileId = safeFileId(filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(UPLOAD_DIR, fileId), buf);
  return { fileId, filename, mime, bytes: buf.length };
}

export async function readUpload(fileId: string) {
  const safe = safeFileId(fileId);
  const full = path.join(UPLOAD_DIR, safe);
  const data = await fs.readFile(full);
  const ext = path.extname(safe).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".heic"
              ? "image/heic"
              : "application/octet-stream";
  return { data, mime };
}
