import { useState, useCallback } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { setSetting } from "@/lib/store";
import { toastTauriError, invokeOrThrow } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SectionHeader } from "@/components/ui/section-header";
import { EncounterDetail } from "@/components/logs/encounter-detail";
import { useLogs, useLogsDir } from "@/hooks/useLogs";
import type { LogFile, Encounter, ParsedLog } from "@/types/logs";
import { EmptyLogsState } from "./EmptyLogsState";
import { LogsList } from "./LogsList";
import { EncounterList } from "./EncounterList";

export function LogsPage() {
  const { logsDir, loading: detectingDir } = useLogsDir();
  const [logsPath, setLogsPath] = useState<string | null>(null);

  // Resolve effective path: explicit override > auto-detected
  const effectivePath = logsPath ?? (logsDir || null);

  const { logs, loading: loadingLogs, refresh } = useLogs(effectivePath);
  const [selectedLog, setSelectedLog] = useState<ParsedLog | null>(null);
  const [selectedEncounter, setSelectedEncounter] = useState<Encounter | null>(
    null
  );

  const handleSetLogsPath = useCallback(async (path: string) => {
    setLogsPath(path);
    await setSetting("logsPath", path);
  }, []);

  const handlePickFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      await handleSetLogsPath(selected);
    }
  }, [handleSetLogsPath]);

  const handleOpenLog = useCallback(async (file: LogFile) => {
    try {
      const analysis = await invokeOrThrow<ParsedLog>("analyze_log", {
        filePath: file.path,
      });
      setSelectedLog(analysis);
      setSelectedEncounter(null);
    } catch (err) {
      toastTauriError("Failed to analyze log", err);
    }
  }, []);

  const handleOpenEncounter = useCallback((encounter: Encounter) => {
    setSelectedEncounter(encounter);
  }, []);

  const handleBackFromEncounter = useCallback(() => {
    setSelectedEncounter(null);
  }, []);

  const handleBackFromLog = useCallback(() => {
    setSelectedLog(null);
    setSelectedEncounter(null);
  }, []);

  // Loading detection
  if (detectingDir) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground/50">
        Detecting log directory...
      </div>
    );
  }

  // No path — empty state
  if (!effectivePath) {
    return <EmptyLogsState onSetLogsPath={(p) => void handleSetLogsPath(p)} />;
  }

  // Encounter detail view (full panel)
  if (selectedEncounter && selectedLog) {
    return (
      <EncounterDetail
        encounter={selectedEncounter}
        logPath={selectedLog.file.path}
        onBack={handleBackFromEncounter}
      />
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left sidebar: log file list */}
      <div className="flex w-[320px] min-w-[260px] flex-col border-r border-white/[0.06]">
        {/* Path bar */}
        <GlassPanel
          variant="subtle"
          className="m-3 mb-0 flex items-center gap-2 px-3 py-2"
        >
          <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground/60">
            {effectivePath}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void handlePickFolder()}
          >
            <FolderOpen className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={refresh}>
            <RefreshCw className="size-3.5" />
          </Button>
        </GlassPanel>

        <div className="px-3 pt-3">
          <SectionHeader>Log Files ({logs.length})</SectionHeader>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-1">
          {loadingLogs ? (
            <div className="py-8 text-center text-sm text-muted-foreground/40">
              Loading...
            </div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground/40">
              No log files found.
            </div>
          ) : (
            <LogsList
              logs={logs}
              selectedPath={selectedLog?.file.path ?? null}
              onSelect={(file) => void handleOpenLog(file)}
            />
          )}
        </div>
      </div>

      {/* Right panel: encounters for selected log */}
      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {selectedLog ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackFromLog}
              >
                &larr; Back
              </Button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold text-foreground">
                  {selectedLog.file.fileName}
                </h2>
                <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                  <span>
                    {selectedLog.totalEvents.toLocaleString()} events
                  </span>
                  <span className="text-white/10">|</span>
                  <span>
                    {selectedLog.encounters.length} encounter
                    {selectedLog.encounters.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>

            {selectedLog.encounters.length === 0 ? (
              <GlassPanel
                variant="subtle"
                className="py-8 text-center text-sm text-muted-foreground/50"
              >
                No encounters found in this log.
              </GlassPanel>
            ) : (
              <EncounterList
                encounters={selectedLog.encounters}
                onSelect={handleOpenEncounter}
              />
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/40">
            Select a log file to view encounters
          </div>
        )}
      </div>
    </div>
  );
}
