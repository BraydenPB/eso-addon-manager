import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const _domParser = typeof DOMParser !== "undefined" ? new DOMParser() : null;

export function decodeHtml(str: string): string {
  if (!_domParser) return str;
  const doc = _domParser.parseFromString(`<!doctype html><body>${str}`, "text/html");
  return doc.body.textContent ?? "";
}
