import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const _domParser = typeof DOMParser !== "undefined" ? new DOMParser() : null;

export function decodeHtml(str: string): string {
  if (!_domParser) {
    // Lightweight fallback for SSR/Node where DOMParser is unavailable.
    // Covers the most common HTML entities; others pass through unchanged.
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/");
  }
  const doc = _domParser.parseFromString(`<!doctype html><body>${str}`, "text/html");
  return doc.body.textContent ?? "";
}
