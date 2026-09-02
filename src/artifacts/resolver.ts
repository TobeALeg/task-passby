import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { ArtifactRef, ArtifactRefInput } from "../core/types.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export async function resolveArtifact(path: string, role = "INPUT"): Promise<ArtifactRefInput> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("不是普通文件");
    return {
      path,
      role,
      filename: basename(path),
      mimeType: MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? null,
      size: info.size,
      sha256: await sha256(path),
      lastModifiedAt: info.mtime.toISOString(),
      availability: "AVAILABLE"
    };
  } catch {
    return {
      path,
      role,
      filename: basename(path),
      mimeType: MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? null,
      size: 0,
      sha256: "",
      lastModifiedAt: new Date(0).toISOString(),
      availability: "MISSING"
    };
  }
}

export async function verifyArtifact(reference: ArtifactRef): Promise<ArtifactRefInput> {
  const current = await resolveArtifact(reference.path, reference.role);
  if (current.availability === "AVAILABLE" && current.sha256 !== reference.sha256) {
    return { ...current, availability: "CHANGED" };
  }
  if (current.availability === "AVAILABLE" && reference.availability === "CHANGED") {
    return { ...current, availability: "CHANGED" };
  }
  return current;
}
