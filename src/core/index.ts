export { SqliteWorkCore } from "./work-core.ts";
export * from "./types.ts";

import { SqliteWorkCore } from "./work-core.ts";
import type { WorkCore, WorkCoreOptions } from "./types.ts";

export function createWorkCore(options: WorkCoreOptions): WorkCore {
  return new SqliteWorkCore(options);
}
