import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { AddonProfile } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ProfilesProps {
  addonsPath: string;
  onClose: () => void;
  onRefresh: () => void;
}

export function Profiles({ addonsPath, onClose, onRefresh }: ProfilesProps) {
  const [profiles, setProfiles] = useState<AddonProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);

  const loadProfiles = async () => {
    try {
      const [profs, active] = await invoke<[AddonProfile[], string | null]>(
        "list_profiles",
        { addonsPath },
      );
      setProfiles(profs);
      setActiveProfile(active);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await invoke<AddonProfile>("create_profile", {
        addonsPath,
        profileName: newName.trim(),
      });
      toast.success(`Profile "${newName.trim()}" created`);
      setNewName("");
      loadProfiles();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleActivate = async (name: string) => {
    setActivating(name);
    try {
      const [enabled, disabled] = await invoke<[string[], string[]]>(
        "activate_profile",
        { addonsPath, profileName: name },
      );
      const parts: string[] = [];
      if (enabled.length > 0) parts.push(`${enabled.length} enabled`);
      if (disabled.length > 0) parts.push(`${disabled.length} disabled`);
      toast.success(
        `Profile "${name}" activated${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`,
      );
      setActiveProfile(name);
      onRefresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setActivating(null);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await invoke("delete_profile", { addonsPath, profileName: name });
      toast.success(`Profile "${name}" deleted`);
      loadProfiles();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Addon Profiles</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Save and switch between addon configurations. Activating a profile
          enables/disables addons by renaming folders.
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="New profile name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            size="sm"
          >
            {creating ? "Creating..." : "Save Current"}
          </Button>
        </div>

        <Separator />

        <div className="max-h-[300px] overflow-y-auto space-y-2">
          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No profiles yet. Save your current addon setup as a profile.
            </p>
          ) : (
            profiles.map((p) => (
              <div
                key={p.name}
                className={cn(
                  "flex items-center justify-between rounded-lg border border-border p-3",
                  activeProfile === p.name && "border-primary/50 bg-primary/5",
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{p.name}</span>
                    {activeProfile === p.name && (
                      <Badge>Active</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {p.enabledAddons.length} addons &middot; {p.createdAt}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={activeProfile === p.name ? "outline" : "default"}
                    onClick={() => handleActivate(p.name)}
                    disabled={activating !== null}
                  >
                    {activating === p.name ? "Activating..." : "Activate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(p.name)}
                  >
                    Delete
                  </Button>
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
