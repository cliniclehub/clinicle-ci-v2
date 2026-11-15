#!/usr/bin/env node
/**
 * Fail if es/ar translation namespace keys do not match en (source of truth).
 * Usage: node scripts/check-i18n-keys.js
 */
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..", "translations")
const LANGS = ["en", "es", "ar"]

function listKeys(obj, prefix = "") {
  const keys = []
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...listKeys(v, next))
    } else {
      keys.push(next)
    }
  }
  return keys.sort()
}

function loadLang(lang) {
  const dir = path.join(ROOT, lang)
  if (!fs.existsSync(dir)) {
    throw new Error(`Missing translations directory: ${dir}`)
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
  const merged = {}
  for (const file of files) {
    const ns = file.replace(/\.json$/, "")
    merged[ns] = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
  }
  return { files, merged }
}

const byLang = Object.fromEntries(LANGS.map((lang) => [lang, loadLang(lang)]))
const enFiles = byLang.en.files.join(",")
let failed = false

for (const lang of LANGS.slice(1)) {
  const files = byLang[lang].files.join(",")
  if (files !== enFiles) {
    console.error(`[i18n] Namespace file mismatch for ${lang}:\n  en: ${enFiles}\n  ${lang}: ${files}`)
    failed = true
  }

  const enKeys = listKeys(byLang.en.merged)
  const otherKeys = listKeys(byLang[lang].merged)
  const missing = enKeys.filter((k) => !otherKeys.includes(k))
  const extra = otherKeys.filter((k) => !enKeys.includes(k))
  if (missing.length || extra.length) {
    console.error(`[i18n] Key mismatch for ${lang}:`)
    if (missing.length) console.error(`  missing (${missing.length}): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "…" : ""}`)
    if (extra.length) console.error(`  extra (${extra.length}): ${extra.slice(0, 20).join(", ")}${extra.length > 20 ? "…" : ""}`)
    failed = true
  } else {
    console.log(`[i18n] ${lang}: OK (${enKeys.length} keys, ${byLang.en.files.length} namespaces)`)
  }
}

if (failed) {
  process.exit(1)
}

console.log(`[i18n] All locales match en (${listKeys(byLang.en.merged).length} keys)`)
