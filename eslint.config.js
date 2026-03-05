// eslint.config.js
import js from "@eslint/js";
import node from "eslint-plugin-node";
import prettier from "eslint-plugin-prettier";

export default [
  js.configs.recommended,
  {
    plugins: {
      node,
      prettier,
    },
    languageOptions: {
      globals: {
        console: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      // Prettier formatting rules
      quotes: "off",
      "prettier/prettier": ["error", { singleQuote: false }],

      // Your custom rules
      "no-console": "warn",
      "prefer-destructuring": ["warn", { object: true, array: false }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "req|res|next|val" }],

      // Your disabled rules
      "spaced-comment": "off",
      "consistent-return": "off",
      "func-names": "off",
      "object-shorthand": "off",
      "no-process-exit": "off",
      "no-param-reassign": "off",
      "no-return-await": "off",
      "no-underscore-dangle": "off",
      "class-methods-use-this": "off",
    },
  },
];
