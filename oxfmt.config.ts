import { defineConfig } from "oxfmt";

export default defineConfig({
  sortImports: true,
  arrowParens: "avoid",
  jsdoc: true,
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
