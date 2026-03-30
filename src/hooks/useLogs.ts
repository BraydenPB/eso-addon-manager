import { useState, useCallback, useEffect, useRef } from "react";
import { invokeResult } from "@/lib/tauri";
import { getSetting } from "@/lib/store";
import type { LogFile, ParsedLog } from "@/types/logs";

// ── useLogs ─────────────────────────────────────────────────────────────

interface UseLogsReturn {
  logs: LogFile[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useLogs(logsPath: string | null): UseLogsReturn {
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!logsPath) return;
    setLoading(true);
    setError(null);

    const result = await invokeResult<LogFile[]>("list_logs", { logsPath });
    if (result.ok) {
      setLogs(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [logsPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { logs, loading, error, refresh };
}

// ── useAnalyzeLog ───────────────────────────────────────────────────────

interface UseAnalyzeLogReturn {
  data: ParsedLog | null;
  loading: boolean;
  error: string | null;
}

export function useAnalyzeLog(path: string | null): UseAnalyzeLogReturn {
  const [data, setData] = useState<ParsedLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    if (!path || path === prevPath.current) return;
    prevPath.current = path;

    let cancelled = false;

    async function analyze() {
      setLoading(true);
      setError(null);

      const result = await invokeResult<ParsedLog>("analyze_log", {
        filePath: path,
      });

      if (cancelled) return;

      if (result.ok) {
        setData(result.data);
      } else {
        setError(result.error);
      }
      setLoading(false);
    }

    void analyze();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, loading, error };
}

// ── useLogsDir ──────────────────────────────────────────────────────────

export function useLogsDir(): {
  logsDir: string;
  loading: boolean;
} {
  const [logsDir, setLogsDir] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      // Check saved setting first
      const saved = await getSetting<string>("logsPath", "");
      if (saved) {
        if (!cancelled) {
          setLogsDir(saved);
          setLoading(false);
        }
        return;
      }

      // Auto-detect from Rust backend
      const result = await invokeResult<{ path: string | null }>(
        "detect_log_path"
      );
      if (!cancelled) {
        setLogsDir(result.ok && result.data.path ? result.data.path : "");
        setLoading(false);
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  return { logsDir, loading };
}
