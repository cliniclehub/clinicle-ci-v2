import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    ignores: [
      ".next/**",
      "node_modules/**",
      "_archive_fe/**",
      "coverage/**",
      "dist/**",
      "next-env.d.ts",
    ],
    rules: {
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "import/no-anonymous-default-export": "warn",
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "prefer-const": "warn",
      "react/display-name": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]
