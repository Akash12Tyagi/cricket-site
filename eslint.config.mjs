import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/drizzle/**", "**/next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Plan §5.5: nothing is printed to the console. Server code logs through pino; browser code reports to monitoring.
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Load-test and ops tooling (k6 scripts, CLI bots, probes) runs outside the app: k6 globals, console output is intended.
    files: ["loadtest/**", "scripts/**"],
    languageOptions: { globals: { __ENV: "readonly", __VU: "readonly", __ITER: "readonly" } },
    rules: { "no-console": "off" },
  },
);
