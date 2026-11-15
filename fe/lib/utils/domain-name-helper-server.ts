'use server'
/* ---- */
/* Domain utility functions                                            */
/* ---- */
import { headers } from "next/headers";
/**
 * Cleans a domain/URL to extract just the hostname
 * Examples:
 * - "http://learn.example.com:3000" → "learn.example.com"
 * - "https://learn.example.com:3000" → "learn.example.com"
 * - "learn.example.com:3000" → "learn.example.com"
 * - "learn.example.com" → "learn.example.com"
 * - "www.learn.example.com" → "www.learn.example.com"
 */
export async function cleanDomain(domain: string): Promise<string> {
  if (!domain) return ""
  
  try {
    // If it's already just a hostname (no protocol), add protocol for URL parsing
    let urlToParse = domain
    if (!domain.includes('://')) {
      urlToParse = `http://${domain}`
    }
    
    // Use URL constructor to parse the domain
    const url = new URL(urlToParse)
    
    // Return just the hostname (without port)
    return url.hostname
  } catch (error) {
    // If URL parsing fails, try to extract hostname manually
    console.warn('Failed to parse domain with URL constructor, using fallback:', domain)
    
    // Remove protocol if present
    let cleaned = domain.replace(/^https?:\/\//, '')
    
    // Remove port if present
    cleaned = cleaned.split(':')[0]
    
    // Remove path if present
    cleaned = cleaned.split('/')[0]
    
    return cleaned
  }
}

/**
 * Extracts subdomain from a hostname
 * Examples:
 * - "learn.example.com" → "learn"
 * - "www.example.com" → "www"
 * - "example.com" → null (no subdomain)
 */
export async function extractSubdomain(hostname: string): Promise<string | null> {
  if (!hostname) return null
  
  const cleaned = await cleanDomain(hostname)
  const parts = cleaned.split('.')
  
  // If we have more than 2 parts, the first part is the subdomain
  if (parts.length > 2) {
    return parts[0]
  }
  
  return null
}

/**
 * Checks if a domain is a localhost/development domain
 */
export async function isLocalhost(domain: string): Promise<boolean> {
  const cleaned = await cleanDomain(domain)
  return cleaned === 'localhost' || cleaned.endsWith('.localhost') || cleaned.includes('127.0.0.1')
}

export async function getDomain() {
  const headersList = await headers();
  const domain = headersList.get('host')?.split(':')[0];
  return domain;
}
