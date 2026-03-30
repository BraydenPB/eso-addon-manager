import { useState, useCallback } from "react";
import {
  FileText,
  FolderOpen,
  HardDriveDownload,
  Radio,
  RefreshCw,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { invokeResult, toastTauriError } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoPill } from "@/components/ui/info-pill";
import type { LogPathDetection, LogFileInfo, LiveSessionStatus } from "@/types/logs";

interface LogsHomeProps {
  logsPath: string | null;
  detection: LogPathDetection | null;
  logFiles: LogFileInfo[];
  onSetLogsPath: (path: string) => void;
  onOpenLog: (file: LogFileInfo) => void;
  onRefresh: () => void;
}

export function LogsHome({
  logsPath,
  detection,
  logFiles,
  onSetLogsPath,
  onOpenLog,
  onRefresh,
}: LogsHomeProps) {
  const [liveStatus, setLiveStatus] = useState<LiveSessionStatus | null>(null);
  const [startingLive, setStartingLive] = useState(false);

  const handlePickFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      onSetLogsPath(selected);
    }
  }, [onSetLogsPath]);

  const handleStartLiveLogging = useCallback(async () => {
    if (!logsPath) return;

    setStartingLive(true);
    try {
      // Find the most recent log file to watch
      const newest = logFiles[0];
      if (!newest) {
        toast.error("No log files found. Start ESO with combat logging enabled first.");
        return;
      }

      const result = await invokeResult<void>("watch_log_start", {
        filePath: newest.path,
      });

      if (result.ok) {
        toast.success("Live logging started");
        // Fetch initial status
        const status = await invokeResult<LiveSessionStatus>("get_live_status");
        if (status.ok) {
          setLiveStatus(status.data);
        }
      } else {
        toastTauriError("Failed to start live logging", result.error);
      }
    } finally {
      setStartingLive(false);
    }
  }, [logFiles, logsPath]);

  const handleStopLiveLogging = useCallback(async () => {
    const result = await invokeResult<void>("watch_log_stop");
    if (result.ok) {
      setLiveStatus(null);
      toast.success("Live logging stopped");
    }
  }, []);

  // No path configured yet — show onboarding
  if (!logsPath) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <GlassPanel variant="primary" className="max-w-md p-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[#c4a44a]/10 text-[#c4a44a]">
              <FileText className="size-8" />
            </div>
          </div>
          <h2 className="font-heading mb-2 text-lg font-bold text-foreground">
            ESO Logs Workspace
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            {detection?.message ??
              "Select your ESO log directory to get started. Logs are usually located next to your AddOns folder."}
          </p>
          <Button onClick={() => void handlePickFolder()}>
            <FolderOpen className="mr-2 size-4" data-icon="inline-start" />
            Select Log Folder
          </Button>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Status and live logging */}
      <div className="flex items-center gap-3">
        <GlassPanel variant="subtle" className="flex flex-1 items-center gap-3 px-4 py-3">
          <FileText className="size-4 text-muted-foreground/60" />
          <div className="flex-1 truncate text-sm text-muted-foreground">
            {logsPath}
          </div>
          <Button variant="ghost" size="icon-xs" onClick={() => void handlePickFolder()}>
            <FolderOpen className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onRefresh}>
            <RefreshCw className="size-3.5" />
          </Button>
        </GlassPanel>

        {liveStatus?.active ? (
          <Button variant="destructive" size="sm" onClick={() => void handleStopLiveLogging()}>
            <Radio className="mr-1.5 size-3.5 animate-pulse" data-icon="inline-start" />
            Stop Live Logging
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={startingLive || logFiles.length === 0}
            onClick={() => void handleStartLiveLogging()}
          >
            <Radio className="mr-1.5 size-3.5" data-icon="inline-start" />
            {startingLive ? "Starting..." : "Start Live Logging"}
          </Button>
        )}
      </div>

      {/* Live status banner */}
      {liveStatus?.active && (
        <GlassPanel variant="primary" className="flex items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-sm font-medium text-emerald-400">Recording</span>
          </div>
          <InfoPill color="muted">
            {formatFileSize(liveStatus.fileSize)}
          </InfoPill>
          {liveStatus.currentEncounter && (
            <>
              <InfoPill color="amber">{liveStatus.currentEncounter.bossName}</InfoPill>
              <InfoPill color="sky">
                Group DPS: {Math.round(liveStatus.currentEncounter.groupDps).toLocaleString()}
              </InfoPill>
            </>
          )}
          <InfoPill color="muted">
            {liveStatus.encountersCompleted} encounter
            {liveStatus.encountersCompleted !== 1 ? "s" : ""}
          </InfoPill>
        </GlassPanel>
      )}

      {/* Log files list */}
      <SectionHeader>
        Log Files ({logFiles.length})
      </SectionHeader>

      {logFiles.length === 0 ? (
        <GlassPanel variant="subtle" className="flex flex-col items-center gap-3 py-12 text-center">
          <HardDriveDownload className="size-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/60">
            No log files found. Enable combat logging in ESO to start recording.
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-1">
          {logFiles.map((file) => (
            <button
              key={file.path}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.06]"
              onClick={() => onOpenLog(file)}
            >
              <FileText className="size-4 shrink-0 text-muted-foreground/40" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {file.fileName}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                  <span>{formatFileSize(file.sizeBytes)}</span>
                  {file.encounterCount != null && (
                    <>
                      <span className="text-white/10">|</span>
                      <span>
                        {file.encounterCount} encounter
                        {file.encounterCount !== 1 ? "s" : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {file.tags.length > 0 && (
                <div className="flex gap-1">
                  {file.tags.map((tag) => (
                    <InfoPill key={tag} color="gold">
                      {tag}
                    </InfoPill>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
