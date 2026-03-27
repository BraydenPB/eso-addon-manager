import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { CharacterInfo } from "../types";
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

interface CharactersProps {
  addonsPath: string;
  onClose: () => void;
}

export function Characters({ addonsPath, onClose }: CharactersProps) {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [backupName, setBackupName] = useState("");
  const [backingUp, setBackingUp] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const chars = await invoke<CharacterInfo[]>("list_characters", {
          addonsPath,
        });
        setCharacters(chars);
      } catch (e) {
        toast.error(`Failed to load characters: ${e}`);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [addonsPath]);

  const handleBackup = async (char: CharacterInfo) => {
    const name = backupName.trim() || `${char.name}-backup`;
    setBackingUp(char.name);
    try {
      const count = await invoke<number>("backup_character_settings", {
        addonsPath,
        characterName: char.name,
        backupName: name,
      });
      toast.success(`Backed up ${count} SavedVariables files for ${char.name}`);
    } catch (e) {
      toast.error(String(e));
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
      <DialogContent className="sm:max-w-lg">
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
                  {chars.map((char) => (
                    <div
                      key={`${char.server}-${char.name}`}
                      className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:border-white/[0.1]"
                    >
                      <span className="text-sm font-medium">{char.name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleBackup(char)}
                        disabled={backingUp !== null}
                      >
                        {backingUp === char.name ? "Backing up..." : "Backup Settings"}
                      </Button>
                    </div>
                  ))}
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
