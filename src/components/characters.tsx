import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Clock, Skull, Swords, FileText } from "lucide-react";
import type { CharacterInfo } from "../types";
import type { Encounter, LogAnalysis, LogFileInfo } from "@/types/logs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoPill } from "@/components/ui/info-pill";
import { SectionHeader } from "@/components/ui/section-header";
import { getTauriErrorMessage, invokeOrThrow, invokeResult } from "@/lib/tauri";
import { getSetting } from "@/lib/store";
import { formatDuration } from "@/lib/utils";

interface CharacterEncounter {
  encounter: Encounter;
  fileName: string;
}

interface CharactersProps {
  addonsPath: string;
  onClose: () => void;
  onViewLogs?: (characterName: string) => void;
}

export function Characters({ addonsPath, onClose, onViewLogs }: CharactersProps) {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [backupName, setBackupName] = useState("");
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const [recentEncounters, setRecentEncounters] = useState<Map<string, CharacterEncounter[]>>(
    new Map()
  );
  const [expandedChar, setExpandedChar] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const chars = await invokeOrThrow<CharacterInfo[]>("list_characters", {
          addonsPath,
        });
        setCharacters(chars);
      } catch (e) {
        toast.error(`Failed to load characters: ${getTauriErrorMessage(e)}`);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [addonsPath]);

  // Load recent encounters for all characters from log files
  useEffect(() => {
    async function loadEncounters() {
      const logsPath = await getSetting<string>("logsPath", "");
      if (!logsPath || characters.length === 0) return;

      const filesResult = await invokeResult<LogFileInfo[]>("list_logs", { logsPath });
      if (!filesResult.ok) {
        toast.error("Failed to load log files for encounter history");
        return;
      }

      // Analyze the 5 most recent log files to find character encounters
      const recentFiles = filesResult.data.slice(0, 5);
      const charMap = new Map<string, CharacterEncounter[]>();

      for (const file of recentFiles) {
        const analysisResult = await invokeResult<LogAnalysis>("analyze_log", {
          filePath: file.path,
        });
        if (!analysisResult.ok) {
          console.warn(`Failed to analyze log file: ${file.fileName}`);
          continue;
        }

        for (const encounter of analysisResult.data.encounters) {
          for (const player of encounter.players) {
            for (const char of characters) {
              if (player.name.toLowerCase() === char.name.toLowerCase()) {
                const existing = charMap.get(char.name) ?? [];
                existing.push({ encounter, fileName: file.fileName });
                charMap.set(char.name, existing);
              }
            }
          }
        }
      }

      // Sort by startTime descending and keep only the 3 most recent per character
      for (const [name, encounters] of charMap) {
        encounters.sort((a, b) => b.encounter.startTime - a.encounter.startTime);
        charMap.set(name, encounters.slice(0, 3));
      }

      setRecentEncounters(charMap);
    }

    void loadEncounters();
  }, [characters]);

  const handleBackup = async (char: CharacterInfo) => {
    const name = backupName.trim() || `${char.name}-backup`;
    setBackingUp(char.name);
    try {
      const count = await invokeOrThrow<number>("backup_character_settings", {
        addonsPath,
        characterName: char.name,
        backupName: name,
      });
      toast.success(`Backed up ${count} SavedVariables files for ${char.name}`);
    } catch (e) {
      toast.error(getTauriErrorMessage(e));
    } finally {
      setBackingUp(null);
    }
  };

  const byServer = useMemo(
    () =>
      characters.reduce(
        (acc, char) => {
          if (!acc[char.server]) acc[char.server] = [];
          acc[char.server].push(char);
          return acc;
        },
        {} as Record<string, CharacterInfo[]>
      ),
    [characters]
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Characters</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Your ESO characters. Back up SavedVariables for a specific character to preserve their
          addon settings.
        </p>

        <div>
          <label htmlFor="backup-name" className="text-xs text-muted-foreground">
            Backup name (optional)
          </label>
          <Input
            id="backup-name"
            placeholder="Leave blank for auto-name"
            value={backupName}
            onChange={(e) => setBackupName(e.target.value)}
          />
        </div>

        <div className="border-t border-white/[0.06]" />

        <div className="max-h-[350px] overflow-y-auto space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="inline-block size-5 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
            </div>
          ) : Object.keys(byServer).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No characters found. Launch ESO at least once to generate character data.
            </p>
          ) : (
            Object.entries(byServer).map(([server, chars]) => (
              <div key={server}>
                <div className="flex items-center gap-2 mb-2">
                  <InfoPill color="sky">{server}</InfoPill>
                  <span className="text-xs text-muted-foreground">
                    {chars.length} character{chars.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-1">
                  {chars.map((char) => {
                    const charEncounters = recentEncounters.get(char.name) ?? [];
                    const isExpanded = expandedChar === char.name;

                    return (
                      <div
                        key={`${char.server}-${char.name}`}
                        className="rounded-xl border border-white/[0.06] bg-white/[0.02] transition-all duration-200 hover:border-white/[0.1]"
                      >
                        <div className="flex items-center justify-between p-3">
                          <button
                            className="flex items-center gap-2 text-sm font-medium hover:text-[#c4a44a] transition-colors"
                            onClick={() => setExpandedChar(isExpanded ? null : char.name)}
                          >
                            {char.name}
                            {charEncounters.length > 0 && (
                              <span className="text-[10px] text-muted-foreground/50">
                                {charEncounters.length} recent log
                                {charEncounters.length !== 1 ? "s" : ""}
                              </span>
                            )}
                          </button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleBackup(char)}
                            disabled={backingUp !== null}
                          >
                            {backingUp === char.name ? "Backing up..." : "Backup Settings"}
                          </Button>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-white/[0.06] px-3 pb-3 pt-2">
                            <SectionHeader className="mb-2 text-[10px]">Recent Logs</SectionHeader>
                            {charEncounters.length === 0 ? (
                              <p className="text-xs text-muted-foreground/50">
                                No recent encounters found for this character.
                              </p>
                            ) : (
                              <div className="space-y-1">
                                {charEncounters.map((ce, i) => (
                                  <div
                                    key={`${ce.fileName}-${ce.encounter.index}-${i}`}
                                    className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2 py-1.5 text-xs"
                                  >
                                    <div
                                      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                        ce.encounter.isKill
                                          ? "bg-emerald-500/10 text-emerald-400"
                                          : "bg-red-500/10 text-red-400"
                                      }`}
                                    >
                                      {ce.encounter.isKill ? "K" : "W"}
                                    </div>
                                    <span className="font-medium text-foreground truncate">
                                      {ce.encounter.bossName}
                                    </span>
                                    <div className="flex items-center gap-1 text-muted-foreground/60">
                                      <Clock className="size-2.5" />
                                      {formatDuration(ce.encounter.durationSecs)}
                                    </div>
                                    <div className="flex items-center gap-1 text-sky-400/70">
                                      <Swords className="size-2.5" />
                                      {Math.round(ce.encounter.groupDps).toLocaleString()}
                                    </div>
                                    {ce.encounter.totalDeaths > 0 && (
                                      <div className="flex items-center gap-1 text-red-400/70">
                                        <Skull className="size-2.5" />
                                        {ce.encounter.totalDeaths}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {onViewLogs && (
                              <Button
                                variant="ghost"
                                size="xs"
                                className="mt-2 text-[10px] text-[#c4a44a]"
                                onClick={() => {
                                  onViewLogs(char.name);
                                  onClose();
                                }}
                              >
                                <FileText className="mr-1 size-3" data-icon="inline-start" />
                                View all logs
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
