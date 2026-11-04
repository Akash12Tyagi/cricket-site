import { config } from "dotenv";
import { defineConfig } from "vitest/config";

const env = config({ path: "../../.env", quiet: true }).parsed ?? {};
export default defineConfig({ test: { env: { ...env, ...process.env, NODE_ENV: "test" }, fileParallelism: false } });
