import { defineConfig } from "oxfmt";

export default defineConfig({
  sortImports: true,
  arrowParens: "avoid",
  jsdoc: true,
  ignorePatterns: ["worker-configuration.d.ts"],
  overrides: [
    {
      files: ["**/*.jsonc"],
      options: {
        trailingComma: "none",
      },
    },
    {
      files: ["**/*.md"],
      options: {
        proseWrap: "never",
      },
    },
  ],
});
