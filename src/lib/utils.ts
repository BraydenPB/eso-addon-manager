import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const _htmlDecodeEl = typeof document !== "undefined" ? document.createElement("textarea") : null;

export function decodeHtml(str: string): string {
  if (!_htmlDecodeEl) return str;
  _htmlDecodeEl.innerHTML = str;
  return _htmlDecodeEl.value;
}
