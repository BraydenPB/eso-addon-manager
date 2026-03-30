import { FileText } from "lucide-react";
import { InfoPill } from "@/components/ui/info-pill";
import type { LogFile } from "@/types/logs";

interface LogsListProps {
  logs: LogFile[];
  selectedPath: string | null;
  onSelect: (file: LogFile) => void;
}

export function LogsList({ logs, selectedPath, onSelect }: LogsListProps) {
  return (
    <div className="flex flex-col gap-1">
      {logs.map((file) => (
        <button
          key={file.path}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.06] ${
            selectedPath === file.path ? "bg-white/[0.06]" : ""
          }`}
          onClick={() => onSelect(file)}
        >
          <FileText className="size-4 shrink-0 text-muted-foreground/40" />
          <div className="min-w-0 flex-1">
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
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
