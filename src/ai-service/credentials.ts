import { safeStorage } from "electron";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { ensure, object, string } from "../contracts/definition.js";
export class ServiceCredentials {
  constructor(
    readonly path: string,
    readonly development: boolean,
  ) {}
  read(): { url: string; token: string; development: boolean } {
    if (!existsSync(this.path))
      return { url: "", token: "", development: this.development };
    ensure(
      safeStorage.isEncryptionAvailable(),
      "AUTH_REQUIRED",
      "系统安全存储不可用",
    );
    const value = JSON.parse(
      safeStorage.decryptString(readFileSync(this.path)),
    ) as { url: string; token: string };
    return { ...value, development: this.development };
  }
  save(value: unknown): void {
    object(value);
    string(value.url);
    string(value.token);
    const url = new URL(value.url);
    ensure(
      url.protocol === "https:" ||
        (this.development &&
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname)),
      "INVALID_SERVICE_URL",
    );
    ensure(!url.username && !url.password, "INVALID_SERVICE_URL");
    ensure(
      safeStorage.isEncryptionAvailable(),
      "AUTH_REQUIRED",
      "系统安全存储不可用",
    );
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    writeFileSync(
      tmp,
      safeStorage.encryptString(
        JSON.stringify({ url: value.url, token: value.token }),
      ),
      { mode: 0o600 },
    );
    renameSync(tmp, this.path);
  }
}
