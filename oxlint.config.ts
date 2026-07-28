import { defineConfig } from "oxlint";

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: true,
  },
  categories: {
    correctness: "error",
    suspicious: "warn",
    pedantic: "warn",
  },
  plugins: ["typescript", "unicorn", "oxc"],
  rules: {
    "typescript/no-explicit-any": "error",
    "typescript/prefer-readonly-parameter-types": "off",
    "typescript/strict-boolean-expressions": "off",
    "typescript/no-unsafe-type-assertion": "off",

    // this rule is marked "Pedantic" in official Oxc doc
    "max-lines-per-function": "off",
  },
  ignorePatterns: ["scripts/**/*"],
  overrides: [
    {
      files: ["scripts/**/*.ts"],
      rules: {
        "typescript/no-explicit-any": "warn",
      },
    },
  ],
});
