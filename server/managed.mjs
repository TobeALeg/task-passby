import { join } from "node:path";
import { ImprovementStore } from "./improvement.mjs";
import { AdminStore } from "./admin/store.mjs";
import { createAdminHandler, runtimeConfig } from "./admin/http.mjs";
import { createAIService } from "./service.mjs";
export function createManagedService({ directory, providerFactory } = {}) {
  if (!directory) throw new Error("SERVER_DATA_DIR_REQUIRED");
  const store = new AdminStore(directory);
  const improvement = new ImprovementStore(join(directory, "improvement.sqlite"));
  let runtime;
  const adminHandler = createAdminHandler({
    store,
    improvement,
    getRuntime: () => runtime,
    providerFactory,
  });
  runtime = createAIService({
    ...store.identity(),
    ...runtimeConfig(store, providerFactory),
    databasePath: join(directory, "metadata.sqlite"),
    adminHandler,
    improvement,
    isAdminBusy: adminHandler.isTesting,
  });
  return { store, ...runtime };
}
