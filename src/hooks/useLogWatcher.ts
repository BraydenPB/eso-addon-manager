import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface LogUpdatedPayload {
  path: string;
  new_lines: string[];
}

export function useLogWatcher(logPath: string | null) {
  const [liveLines, setLiveLines] = useState<string[]>([]);
  const [isWatching, setIsWatching] = useState(false);
  const activePathRef = useRef<string | null>(null);

  // Start watching whenever logPath changes (non-null = watch, null = stop)
  // When logPath changes, the cleanup from the previous effect handles stopping.
  useEffect(() => {
    if (!logPath) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    async function start() {
      try {
        await invoke("start_log_watch", { path: logPath });
        if (disposed) {
          await invoke("stop_log_watch");
          return;
        }
        activePathRef.current = logPath;
        setIsWatching(true);
      } catch (err) {
        console.error("[useLogWatcher] start_log_watch failed:", err);
        return;
      }

      try {
        const unsub = await listen<LogUpdatedPayload>("log-updated", (event) => {
          if (disposed) return;
          setLiveLines((prev) => {
            const merged = [...prev, ...event.payload.new_lines];
            return merged.length > 200 ? merged.slice(-200) : merged;
          });
        });
        if (disposed) {
          unsub();
        } else {
          unlisten = unsub;
        }
      } catch (err) {
        console.error("[useLogWatcher] listen failed:", err);
      }
    }

    void start();

    return () => {
      disposed = true;
      activePathRef.current = null;
      setIsWatching(false);
      setLiveLines([]);
      unlisten?.();
      void invoke("stop_log_watch").catch(() => {});
    };
  }, [logPath]);

  return { liveLines, isWatching };
}
