import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  lstatSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ensure, LIMITS } from "../contracts/definition.js";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function hash(value: unknown): string {
  return createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : canonical(value),
    )
    .digest("hex");
}
export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export type Material = {
  id: string;
  path: string;
  originalPath: string;
  hash: string;
  size: number;
  role: string;
};
export class MaterialStore {
  constructor(readonly directory: string) {}
  read(path: string, max = LIMITS.maxMaterialBytes): Buffer {
    const stat = lstatSync(path);
    ensure(stat.isFile() && !stat.isSymbolicLink(), "UNSUPPORTED_FILE");
    ensure(stat.size <= max, "INPUT_TOO_LARGE");
    return readFileSync(path);
  }
  copy(path: string, role: string): Material {
    const bytes = this.read(path);
    const digest = hash(bytes);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, digest);
    if (!existsSync(target)) {
      const temporary = `${target}.${randomUUID()}.tmp`;
      writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
      ensure(hash(readFileSync(temporary)) === digest, "SOURCE_CHANGED");
      renameSync(temporary, target);
    }
    ensure(hash(this.read(path)) === digest, "SOURCE_CHANGED");
    return {
      id: digest,
      path: target,
      originalPath: path,
      hash: digest,
      size: bytes.length,
      role,
    };
  }
  verify(material: Material): void {
    ensure(
      existsSync(material.path) &&
        hash(this.read(material.path)) === material.hash,
      "MATERIAL_MISSING",
      "固定资料副本缺失或校验不符",
    );
  }
  remove(material: Material): void {
    if (existsSync(material.path)) unlinkSync(material.path);
  }
}
