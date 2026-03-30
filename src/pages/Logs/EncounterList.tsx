import { Clock, Swords, Heart, Skull } from "lucide-react";
import type { Encounter, EncounterOutcome } from "@/types/logs";

interface EncounterListProps {
  encounters: Encounter[];
  onSelect: (encounter: Encounter) => void;
}

export function EncounterList({ encounters, onSelect }: EncounterListProps) {
  return (
    <div className="flex flex-col gap-1">
      {encounters.map((encounter) => {
        const outcome: EncounterOutcome = encounter.isKill ? "kill" : "wipe";

        return (
          <button
            key={encounter.index}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.06]"
            onClick={() => onSelect(encounter)}
          >
            {/* Outcome badge */}
            <div
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                outcome === "kill"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {outcome === "kill" ? "K" : "W"}
            </div>

            {/* Boss name */}
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {encounter.bossName}
            </div>

            {/* Duration */}
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <Clock className="size-3" />
              {formatDuration(encounter.durationSecs)}
            </div>

            {/* Group DPS */}
            <div className="flex items-center gap-1 text-xs text-sky-400/80">
              <Swords className="size-3" />
              {Math.round(encounter.groupDps).toLocaleString()}
            </div>

            {/* Group HPS */}
            <div className="flex items-center gap-1 text-xs text-emerald-400/80">
              <Heart className="size-3" />
              {Math.round(encounter.groupHps).toLocaleString()}
            </div>

            {/* Deaths */}
            {encounter.totalDeaths > 0 && (
              <div className="flex items-center gap-1 text-xs text-red-400/80">
                <Skull className="size-3" />
                {encounter.totalDeaths}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
