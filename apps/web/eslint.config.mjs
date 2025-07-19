import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // ==========================================
      // INHERIT WORKSPACE STRICT POLICIES
      // ==========================================
      // Following root workspace TypeScript strict policies
      "@typescript-eslint/no-explicit-any": "error", // ❌ PROHIBIT explicit any
      "@typescript-eslint/ban-types": [
        "error",
        {
          "types": {
            "unknown": "❌ PROHIBITED: Use of 'unknown' type is not allowed. Define specific types instead.",
            "any": "❌ PROHIBITED: Use of 'any' type is not allowed. Define specific types instead.",
            "{}": "❌ PROHIBITED: Use of '{}' type is not allowed. Use 'Record<string, unknown>' or define specific interface."
          },
          "extendDefaults": true
        }
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "ignoreRestSiblings": true,
          "destructuredArrayIgnorePattern": "^_"
        }
      ],
      "no-unused-vars": "off",
      "no-console": "error",
      "no-redeclare": "error",
      // ==========================================
    }
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      // Test files exception following workspace policy
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off"
    }
  }
];

export default eslintConfig;
