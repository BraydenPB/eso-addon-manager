import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

export type TauriResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function getTauriErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Something went wrong";
}

export async function invokeResult<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<TauriResult<T>> {
  try {
    return { ok: true, data: await invoke<T>(command, args) };
  } catch (error) {
    const message = getTauriErrorMessage(error);
    console.error(`[tauri:${command}]`, error);
    return { ok: false, error: message };
  }
}

export async function invokeOrThrow<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const result = await invokeResult<T>(command, args);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function toastTauriError(action: string, error: unknown) {
  toast.error(`${action}: ${getTauriErrorMessage(error)}`);
}
