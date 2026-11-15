/**
 * Continent → UN-style pricing subregion → countries.
 * Uses the same labels as country-territories.ts / country_territories.py.
 */

import {
  COUNTRY_TO_PRICING_TERRITORY,
  PRICING_TERRITORIES,
  type PricingTerritory,
} from "@/lib/constants/country-territories"
import { COUNTRIES_SORTED, type CountryRecord } from "@/lib/constants/countries"

export type GeoContinent =
  | "Africa"
  | "Americas"
  | "Asia"
  | "Europe"
  | "Oceania"
  | "Antarctica"

/** Top-level areas, left-to-right order in the explorer */
export const GEO_CONTINENT_ORDER: readonly GeoContinent[] = [
  "Africa",
  "Americas",
  "Asia",
  "Europe",
  "Oceania",
  "Antarctica",
] as const

/**
 * First column of the territory explorer: Americas shown as North America and South America.
 * (Data model still uses GeoContinent "Americas" for territory groupings.)
 */
export type ExplorerContinentRow =
  | Exclude<GeoContinent, "Americas">
  | "North America"
  | "South America"

export const EXPLORER_CONTINENT_ORDER: readonly ExplorerContinentRow[] = [
  "Africa",
  "North America",
  "South America",
  "Asia",
  "Europe",
  "Oceania",
  "Antarctica",
] as const

/** Subregions shown when a first-column continent row is selected */
export function getSubregionsForExplorerContinent(
  row: ExplorerContinentRow
): PricingTerritory[] {
  if (row === "North America") {
    return getSubregionsForContinent("Americas").filter((t) => t !== "South America")
  }
  if (row === "South America") {
    return ["South America"]
  }
  return getSubregionsForContinent(row)
}

/** Every pricing subregion maps to exactly one continent */
export const TERRITORY_TO_CONTINENT: Record<PricingTerritory, GeoContinent> = {
  Antarctica: "Antarctica",
  "Australia and New Zealand": "Oceania",
  Caribbean: "Americas",
  "Central America": "Americas",
  "Central Asia": "Asia",
  "Eastern Africa": "Africa",
  "Eastern Asia": "Asia",
  "Eastern Europe": "Europe",
  Melanesia: "Oceania",
  Micronesia: "Oceania",
  "Middle Africa": "Africa",
  "Northern Africa": "Africa",
  "Northern America": "Americas",
  "Northern Europe": "Europe",
  Polynesia: "Oceania",
  "South America": "Americas",
  "South-eastern Asia": "Asia",
  "Southern Africa": "Africa",
  "Southern Asia": "Asia",
  "Southern Europe": "Europe",
  "Western Africa": "Africa",
  "Western Asia": "Asia",
  "Western Europe": "Europe",
}

export function getSubregionsForContinent(continent: GeoContinent): PricingTerritory[] {
  return [...PRICING_TERRITORIES]
    .filter((t) => TERRITORY_TO_CONTINENT[t] === continent)
    .sort((a, b) => a.localeCompare(b))
}

export function getCountriesForTerritory(territory: PricingTerritory): CountryRecord[] {
  return COUNTRIES_SORTED.filter(
    (c) => COUNTRY_TO_PRICING_TERRITORY[c.code] === territory
  )
}

/** First-column explorer row for an ISO country (Americas split into North / South). */
export function getExplorerContinentRowForCountry(iso2: string): ExplorerContinentRow | null {
  const u = iso2.trim().toUpperCase()
  if (u.length !== 2) return null
  const terr = COUNTRY_TO_PRICING_TERRITORY[u]
  if (!terr) return null
  const geo = TERRITORY_TO_CONTINENT[terr]
  if (geo === "Americas") {
    return terr === "South America" ? "South America" : "North America"
  }
  return geo
}

/** Explorer row for a pricing subregion label (same Americas split). */
export function getExplorerContinentRowForTerritory(
  territory: PricingTerritory
): ExplorerContinentRow | null {
  const geo = TERRITORY_TO_CONTINENT[territory]
  if (!geo) return null
  if (geo === "Americas") {
    return territory === "South America" ? "South America" : "North America"
  }
  return geo
}

/**
 * MaxMind continent codes used by regional pricing "continent" overrides,
 * grouped by the macro continent shown in the hierarchy UI.
 */
export const MAXMIND_CODES_BY_GEO_CONTINENT: Record<GeoContinent, readonly string[]> = {
  Africa: ["AF"],
  Americas: ["NA", "SA"],
  Asia: ["AS"],
  Europe: ["EU"],
  Oceania: ["OC"],
  Antarctica: ["AN"],
}

/** MaxMind continent override row(s) for the selected explorer continent row */
export function getMaxMindCodesForExplorerContinent(
  row: ExplorerContinentRow
): readonly string[] {
  if (row === "North America") return ["NA"]
  if (row === "South America") return ["SA"]
  return MAXMIND_CODES_BY_GEO_CONTINENT[row]
}

/** Display names for continent price scopes (stored as MaxMind codes in the API). */
export const MAXMIND_CONTINENT_LABEL: Record<string, string> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
}

/** MaxMind continent code for GeoIP-style resolution (matches backend continent overrides). */
export function getMaxMindContinentCodeForCountry(iso2: string): string | null {
  const terr = COUNTRY_TO_PRICING_TERRITORY[iso2]
  if (!terr) return null
  const geo = TERRITORY_TO_CONTINENT[terr]
  if (geo === "Antarctica") return "AN"
  if (geo === "Africa") return "AF"
  if (geo === "Asia") return "AS"
  if (geo === "Europe") return "EU"
  if (geo === "Oceania") return "OC"
  if (geo === "Americas") {
    return terr === "South America" ? "SA" : "NA"
  }
  return null
}

export function getMaxMindContinentCodeForTerritory(t: PricingTerritory): string | null {
  const sample = COUNTRIES_SORTED.find((c) => COUNTRY_TO_PRICING_TERRITORY[c.code] === t)
  return sample ? getMaxMindContinentCodeForCountry(sample.code) : null
}

export interface RegionalOverrideMaps {
  countryCents: Map<string, number>
  regionCents: Map<string, number>
  continentCents: Map<string, number>
}

/** Build lookup maps from API override rows (scope codes already canonical). */
export function buildRegionalOverrideMaps(
  overrides: readonly { scopeType: string; scopeCode: string; priceCents: number }[]
): RegionalOverrideMaps {
  const countryCents = new Map<string, number>()
  const regionCents = new Map<string, number>()
  const continentCents = new Map<string, number>()
  for (const o of overrides) {
    const code = o.scopeCode.trim()
    if (o.scopeType === "country") {
      countryCents.set(code.toUpperCase(), o.priceCents)
    } else if (o.scopeType === "region") {
      regionCents.set(code, o.priceCents)
    } else if (o.scopeType === "continent") {
      continentCents.set(code.toUpperCase(), o.priceCents)
    }
  }
  return { countryCents, regionCents, continentCents }
}

/** Resolved cents for a country ISO2: country → region → continent → default (excludes no overrides). */
export function getResolvedPriceCentsForCountryIso(
  iso2: string,
  defaultCents: number,
  maps: RegionalOverrideMaps
): number {
  const u = iso2.trim().toUpperCase()
  const cty = maps.countryCents.get(u)
  if (cty !== undefined) return cty
  const terr = COUNTRY_TO_PRICING_TERRITORY[u]
  if (terr) {
    const reg = maps.regionCents.get(terr)
    if (reg !== undefined) return reg
  }
  const cc = getMaxMindContinentCodeForCountry(u)
  if (cc) {
    const cont = maps.continentCents.get(cc)
    if (cont !== undefined) return cont
  }
  return defaultCents
}

/** Price before a region-level override (continent + default only). */
export function getResolvedPriceCentsForTerritory(
  territory: PricingTerritory,
  defaultCents: number,
  maps: RegionalOverrideMaps
): number {
  const cc = getMaxMindContinentCodeForTerritory(territory)
  if (cc) {
    const cont = maps.continentCents.get(cc)
    if (cont !== undefined) return cont
  }
  return defaultCents
}

/** Price used if this country had no country override (region → continent → default). */
export function getResolvedPriceCentsBeforeCountryOverride(
  iso2: string,
  defaultCents: number,
  maps: RegionalOverrideMaps
): number {
  const u = iso2.trim().toUpperCase()
  const terr = COUNTRY_TO_PRICING_TERRITORY[u]
  if (terr) {
    const reg = maps.regionCents.get(terr)
    if (reg !== undefined) return reg
  }
  const cc = getMaxMindContinentCodeForCountry(u)
  if (cc) {
    const cont = maps.continentCents.get(cc)
    if (cont !== undefined) return cont
  }
  return defaultCents
}
