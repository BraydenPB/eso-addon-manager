import { useState } from "react";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { useLogWatcher } from "@/hooks/useLogWatcher";

interface LiveLoggingBarProps {
  /** Full path to the log file to tail. */
  logFilePath: string;
}

export function LiveLoggingBar({ logFilePath }: LiveLoggingBarProps) {
  const [enabled, setEnabled] = useState(false);
  const { liveLines, isWatching } = useLogWatcher(enabled ? logFilePath : null);
  const lastFive = liveLines.slice(-5);

  return (
    <GlassPanel variant="subtle" className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isWatching ? (
            <>
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-emerald-400">Live</span>
            </>
          ) : (
            <>
              <span className="size-2 rounded-full bg-muted-foreground/30" />
              <span className="text-xs font-medium text-muted-foreground/60">Idle</span>
            </>
          )}
        </div>

        <Button
          variant={isWatching ? "destructive" : "default"}
          size="xs"
          onClick={() => setEnabled((prev) => !prev)}
        >
          <Radio className="mr-1.5 size-3" data-icon="inline-start" />
          {isWatching ? "Stop" : "Start"}
        </Button>
      </div>

      {isWatching && lastFive.length > 0 && (
        <div className="flex flex-col gap-0.5 overflow-hidden">
          {lastFive.map((line, i) => (
            <div
              key={`${liveLines.length - 5 + i}`}
              className="truncate font-mono text-[11px] leading-tight text-muted-foreground/70"
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
