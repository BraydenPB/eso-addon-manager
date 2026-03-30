import { ArrowLeft, Clock, Heart, Package, Shield, Skull, Swords, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { InfoPill } from "@/components/ui/info-pill";
import { SectionHeader } from "@/components/ui/section-header";
import type { Encounter, PlayerRole } from "@/types/logs";
import { formatDuration } from "@/lib/utils";

interface EncounterDetailProps {
  encounter: Encounter;
  logPath: string;
  onBack: () => void;
  onViewAddonsAtDate?: (timestamp: number) => void;
}

export function EncounterDetail({ encounter, onBack, onViewAddonsAtDate }: EncounterDetailProps) {
  const maxDps = Math.max(...encounter.players.map((p) => p.dps), 1);
  const maxHps = Math.max(...encounter.players.map((p) => p.hps), 1);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-base font-bold text-foreground">{encounter.bossName}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <span>{formatDuration(encounter.durationSecs)}</span>
            <span className="text-white/10">|</span>
            <span>{encounter.players.length} players</span>
          </div>
        </div>
        <InfoPill color={encounter.isKill ? "emerald" : "red"}>
          {encounter.isKill ? "Kill" : "Wipe"}
        </InfoPill>
        {onViewAddonsAtDate && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onViewAddonsAtDate(encounter.startTime)}
          >
            <Package className="mr-1.5 size-3" data-icon="inline-start" />
            View addons at this date
          </Button>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard
          icon={<Clock className="size-4" />}
          label="Duration"
          value={formatDuration(encounter.durationSecs)}
          color="text-muted-foreground"
        />
        <StatCard
          icon={<Swords className="size-4" />}
          label="Group DPS"
          value={Math.round(encounter.groupDps).toLocaleString()}
          color="text-sky-400"
        />
        <StatCard
          icon={<Heart className="size-4" />}
          label="Group HPS"
          value={Math.round(encounter.groupHps).toLocaleString()}
          color="text-emerald-400"
        />
        <StatCard
          icon={<Skull className="size-4" />}
          label="Deaths"
          value={encounter.totalDeaths.toString()}
          color="text-red-400"
        />
      </div>

      {/* Players table */}
      <SectionHeader>Players</SectionHeader>

      <GlassPanel variant="default" className="overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_80px_1fr_80px_1fr_60px] items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40">
          <div className="w-6" />
          <div>Player</div>
          <div className="text-right">DPS</div>
          <div />
          <div className="text-right">HPS</div>
          <div />
          <div className="text-center">Deaths</div>
        </div>

        {/* Player rows */}
        {encounter.players.map((player) => (
          <div
            key={player.name}
            className="grid grid-cols-[auto_1fr_80px_1fr_80px_1fr_60px] items-center gap-2 border-b border-white/[0.03] px-3 py-2 last:border-0 hover:bg-white/[0.02]"
          >
            {/* Role icon */}
            <div className="flex size-6 items-center justify-center">
              <RoleIcon role={player.role} />
            </div>

            {/* Name */}
            <div className="truncate text-sm font-medium text-foreground">
              {player.name}
            </div>

            {/* DPS number */}
            <div className="text-right text-xs font-semibold text-sky-400">
              {Math.round(player.dps).toLocaleString()}
            </div>

            {/* DPS bar */}
            <div className="h-1.5 rounded-full bg-white/[0.04]">
              <div
                className="h-full rounded-full bg-sky-400/40"
                style={{ width: `${(player.dps / maxDps) * 100}%` }}
              />
            </div>

            {/* HPS number */}
            <div className="text-right text-xs font-semibold text-emerald-400">
              {Math.round(player.hps).toLocaleString()}
            </div>

            {/* HPS bar */}
            <div className="h-1.5 rounded-full bg-white/[0.04]">
              <div
                className="h-full rounded-full bg-emerald-400/40"
                style={{ width: `${(player.hps / maxHps) * 100}%` }}
              />
            </div>

            {/* Deaths */}
            <div
              className={`text-center text-xs font-semibold ${
                player.deaths > 0 ? "text-red-400" : "text-muted-foreground/30"
              }`}
            >
              {player.deaths}
            </div>
          </div>
        ))}
      </GlassPanel>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <GlassPanel variant="subtle" className="flex flex-col items-center gap-1 px-3 py-3">
      <div className={`${color} opacity-60`}>{icon}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/40">{label}</div>
    </GlassPanel>
  );
}

function RoleIcon({ role }: { role: PlayerRole }) {
  switch (role) {
    case "tank":
      return <Shield className="size-3.5 text-amber-400/70" />;
    case "healer":
      return <Heart className="size-3.5 text-emerald-400/70" />;
    case "damageDealer":
      return <Swords className="size-3.5 text-red-400/70" />;
    default:
      return <User className="size-3.5 text-muted-foreground/40" />;
  }
}

