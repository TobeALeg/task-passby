export { SqliteWorkCore } from "./work-core.js";
export * from "./types.js";

import { SqliteWorkCore } from "./work-core.js";
import type { WorkCore, WorkCoreOptions } from "./types.js";

export function createWorkCore(options: WorkCoreOptions): WorkCore {
  return new SqliteWorkCore(options);
}
