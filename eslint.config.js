// @ts-check

import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        myCustomGlobal: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    }
  }
];
