import { readFileSync } from "node:fs";
import { createAIService } from "./service.mjs";
import { ModelProvider } from "./workflow.mjs";
const mode =
  process.env.NODE_ENV === "production" ? "production" : "development";
const provider = new ModelProvider({
  baseUrl: process.env.WORKET_PROVIDER_URL,
  apiKey: process.env.WORKET_PROVIDER_KEY,
  model: process.env.WORKET_PROVIDER_MODEL,
});
if (mode === "production" && !process.env.WORKET_AUTH_PUBLIC_KEY_FILE)
  throw new Error("生产身份未配置");
const service = createAIService({
  mode,
  databasePath:
    process.env.WORKET_AI_METADATA_DB ?? "worket-ai-metadata.sqlite",
  devSecret: process.env.WORKET_DEV_AUTH_SECRET,
  publicKey: process.env.WORKET_AUTH_PUBLIC_KEY_FILE
    ? readFileSync(process.env.WORKET_AUTH_PUBLIC_KEY_FILE, "utf8")
    : undefined,
  issuer: process.env.WORKET_AUTH_ISSUER ?? "worket-local",
  audience: process.env.WORKET_AUTH_AUDIENCE ?? "worket-ai",
  provider,
  providerName: process.env.WORKET_PROVIDER_NAME,
  providerPolicyUrl: process.env.WORKET_PROVIDER_POLICY_URL,
});
service.server.listen(Number(process.env.PORT ?? 8788), "127.0.0.1", () =>
  console.log(
    "Worket AI Service listening on loopback; TLS terminates at configured proxy.",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void service.close().then(() => process.exit()));
