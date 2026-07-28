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
    "typescript/no-unsafe-assignment": "off",
    "typescript/no-unsafe-member-access": "off",
    "typescript/no-unsafe-call": "off",
    "typescript/no-unsafe-return": "off",

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
