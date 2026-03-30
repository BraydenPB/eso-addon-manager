import { useState, useCallback, useEffect } from "react";
import { invokeOrThrow, invokeResult, toastTauriError } from "@/lib/tauri";
import { getSetting, setSetting } from "@/lib/store";
import type {
  LogPathDetection,
  LogFileInfo,
  LogAnalysis,
  Encounter,
  LogsView,
} from "@/types/logs";
import { LogsHome } from "./logs-home";
import { LogDetail } from "./log-detail";
import { EncounterDetail } from "./encounter-detail";

interface LogsWorkspaceProps {
  addonsPath: string;
  onViewAddonsAtDate?: (timestamp: number) => void;
  characterFilter?: string | null;
}

export function LogsWorkspace({ addonsPath, onViewAddonsAtDate, characterFilter }: LogsWorkspaceProps) {
  const [logsPath, setLogsPath] = useState<string | null>(null);
  const [detection, setDetection] = useState<LogPathDetection | null>(null);
  const [logFiles, setLogFiles] = useState<LogFileInfo[]>([]);
  const [currentAnalysis, setCurrentAnalysis] = useState<LogAnalysis | null>(null);
  const [selectedEncounter, setSelectedEncounter] = useState<Encounter | null>(null);
  const [view, setView] = useState<LogsView>("home");
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Detect log path on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Check for saved logs path first
      const saved = await getSetting<string>("logsPath", "");
      if (saved) {
        setLogsPath(saved);
        setLoading(false);
        return;
      }

      // Auto-detect from addon path
      const result = await invokeResult<LogPathDetection>("detect_log_path");
      if (cancelled) return;

      if (result.ok) {
        setDetection(result.data);
        if (result.data.path) {
          setLogsPath(result.data.path);
          void setSetting("logsPath", result.data.path);
        }
      } else {
        toastTauriError("Failed to detect log path", result.error);
      }
      setLoading(false);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [addonsPath]);

  // Load log files when path is available
  useEffect(() => {
    if (!logsPath) return;

    async function loadFiles() {
      setLoadingFiles(true);
      const result = await invokeResult<LogFileInfo[]>("list_logs", {
        logsPath,
      });
      if (result.ok) {
        setLogFiles(result.data);
      } else {
        toastTauriError("Failed to load log files", result.error);
      }
      setLoadingFiles(false);
    }

    void loadFiles();
  }, [logsPath]);

  const handleSetLogsPath = useCallback(async (path: string) => {
    setLogsPath(path);
    await setSetting("logsPath", path);

    const result = await invokeResult<LogFileInfo[]>("list_logs", {
      logsPath: path,
    });
    if (result.ok) {
      setLogFiles(result.data);
    } else {
      toastTauriError("Failed to load log files", result.error);
    }
  }, []);

  const handleOpenLog = useCallback(async (file: LogFileInfo) => {
    try {
      const analysis = await invokeOrThrow<LogAnalysis>("analyze_log", {
        filePath: file.path,
      });
      setCurrentAnalysis(analysis);
      setView("log-detail");
    } catch (err) {
      toastTauriError("Failed to analyze log", err);
    }
  }, []);

  const handleOpenEncounter = useCallback((encounter: Encounter) => {
    setSelectedEncounter(encounter);
    setView("encounter-detail");
  }, []);

  const handleBack = useCallback(() => {
    if (view === "encounter-detail") {
      setSelectedEncounter(null);
      setView("log-detail");
    } else {
      setCurrentAnalysis(null);
      setView("home");
    }
  }, [view]);

  const handleRefreshFiles = useCallback(async () => {
    if (!logsPath) return;
    setLoadingFiles(true);
    const result = await invokeResult<LogFileInfo[]>("list_logs", {
      logsPath,
    });
    if (result.ok) {
      setLogFiles(result.data);
    } else {
      toastTauriError("Failed to refresh log files", result.error);
    }
    setLoadingFiles(false);
  }, [logsPath]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground/50">
        Detecting log directory...
      </div>
    );
  }

  switch (view) {
    case "log-detail":
      return currentAnalysis ? (
        <LogDetail
          analysis={currentAnalysis}
          onBack={handleBack}
          onOpenEncounter={handleOpenEncounter}
        />
      ) : null;

    case "encounter-detail":
      return selectedEncounter ? (
        <EncounterDetail
          encounter={selectedEncounter}
          logPath={currentAnalysis?.file.path ?? ""}
          onBack={handleBack}
          onViewAddonsAtDate={onViewAddonsAtDate}
        />
      ) : null;

    case "home":
    default:
      return (
        <LogsHome
          logsPath={logsPath}
          detection={detection}
          logFiles={logFiles}
          loadingFiles={loadingFiles}
          onSetLogsPath={handleSetLogsPath}
          onOpenLog={handleOpenLog}
          onRefresh={handleRefreshFiles}
          characterFilter={characterFilter}
        />
      );
  }
}
