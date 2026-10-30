import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeAiEnvironment } from "./aiConfig.js";

// npm workspaces normally run with server/ as cwd, while direct invocations
// may run from the repository root. Docker injects variables and has no .env.
const candidates = [
  process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : null,
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
].filter((path): path is string => Boolean(path));

for (const path of [...new Set(candidates)]) {
  if (!existsSync(path)) continue;
  process.loadEnvFile(path);
  break;
}

normalizeAiEnvironment();
