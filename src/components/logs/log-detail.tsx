import { useState, useMemo } from "react";
import { ArrowLeft, Clock, Skull, Swords, Heart, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { InfoPill } from "@/components/ui/info-pill";
import { SectionHeader } from "@/components/ui/section-header";
import type { LogAnalysis, Encounter } from "@/types/logs";
import { formatDuration } from "@/lib/utils";

interface LogDetailProps {
  analysis: LogAnalysis;
  onBack: () => void;
  onOpenEncounter: (encounter: Encounter) => void;
}

type EncounterFilter = "all" | "kills" | "wipes";

export function LogDetail({ analysis, onBack, onOpenEncounter }: LogDetailProps) {
  const [filter, setFilter] = useState<EncounterFilter>("all");

  const filteredEncounters = useMemo(() => {
    switch (filter) {
      case "kills":
        return analysis.encounters.filter((e) => e.isKill);
      case "wipes":
        return analysis.encounters.filter((e) => !e.isKill);
      default:
        return analysis.encounters;
    }
  }, [analysis.encounters, filter]);

  // Group encounters by boss name
  const groupedEncounters = useMemo(() => {
    const groups = new Map<string, Encounter[]>();
    for (const enc of filteredEncounters) {
      const existing = groups.get(enc.bossName) ?? [];
      existing.push(enc);
      groups.set(enc.bossName, existing);
    }
    return groups;
  }, [filteredEncounters]);

  const kills = analysis.encounters.filter((e) => e.isKill).length;
  const wipes = analysis.encounters.length - kills;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="truncate text-base font-bold text-foreground">
            {analysis.file.fileName}
          </h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <span>{analysis.totalEvents.toLocaleString()} events</span>
            <span className="text-white/10">|</span>
            <span>{analysis.encounters.length} encounters</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <InfoPill color="emerald">{kills} kills</InfoPill>
          <InfoPill color="red">{wipes} wipes</InfoPill>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="size-3.5 text-muted-foreground/40" />
        {(["all", "kills", "wipes"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "kills" ? "Kills" : "Wipes"}
          </Button>
        ))}
      </div>

      {/* Grouped encounters */}
      {groupedEncounters.size === 0 ? (
        <GlassPanel variant="subtle" className="py-8 text-center text-sm text-muted-foreground/50">
          No encounters match the current filter.
        </GlassPanel>
      ) : (
        Array.from(groupedEncounters.entries()).map(([bossName, encounters]) => (
          <div key={bossName} className="flex flex-col gap-1">
            <SectionHeader className="flex items-center gap-2 px-1">
              <span>{bossName}</span>
              <span className="text-muted-foreground/30">
                — {encounters.length} encounter{encounters.length !== 1 ? "s" : ""}
                {" "}({encounters.filter((e) => e.isKill).length} kills)
              </span>
            </SectionHeader>

            {encounters.map((encounter) => (
              <button
                key={encounter.index}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.06]"
                onClick={() => onOpenEncounter(encounter)}
              >
                {/* Kill/Wipe indicator */}
                <div
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    encounter.isKill
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {encounter.isKill ? "K" : "W"}
                </div>

                {/* Duration */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground/60 w-16">
                  <Clock className="size-3" />
                  {formatDuration(encounter.durationSecs)}
                </div>

                {/* Group DPS */}
                <div className="flex items-center gap-1 text-xs text-sky-400/80 w-24">
                  <Swords className="size-3" />
                  {Math.round(encounter.groupDps).toLocaleString()} DPS
                </div>

                {/* Group HPS */}
                <div className="flex items-center gap-1 text-xs text-emerald-400/80 w-24">
                  <Heart className="size-3" />
                  {Math.round(encounter.groupHps).toLocaleString()} HPS
                </div>

                {/* Deaths */}
                {encounter.totalDeaths > 0 && (
                  <div className="flex items-center gap-1 text-xs text-red-400/80">
                    <Skull className="size-3" />
                    {encounter.totalDeaths}
                  </div>
                )}

                {/* Players count */}
                <div className="ml-auto text-xs text-muted-foreground/40">
                  {encounter.players.length} player
                  {encounter.players.length !== 1 ? "s" : ""}
                </div>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

