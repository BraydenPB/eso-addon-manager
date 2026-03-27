import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { BackupInfo } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BackupsProps {
  addonsPath: string;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Backups({ addonsPath, onClose }: BackupsProps) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadBackups = async () => {
    try {
      const result = await invoke<BackupInfo[]>("list_backups", { addonsPath });
      setBackups(result);
    } catch (e) {
      toast.error(`Failed to load backups: ${e}`);
    }
  };

  useEffect(() => {
    loadBackups();
    // Generate default name
    const now = new Date();
    const name = `backup-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setNewName(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const info = await invoke<BackupInfo>("create_backup", {
        addonsPath,
        backupName: newName.trim(),
      });
      toast.success(`Backup created: ${info.fileCount} files (${formatBytes(info.totalSize)})`);
      loadBackups();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (name: string) => {
    setRestoring(name);
    try {
      const count = await invoke<number>("restore_backup", {
        addonsPath,
        backupName: name,
      });
      toast.success(`Restored ${count} files from "${name}"`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await invoke("delete_backup", { addonsPath, backupName: name });
      toast.success(`Deleted backup "${name}"`);
      loadBackups();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>SavedVariables Backup</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Back up your addon settings (SavedVariables). Restore after reinstalling ESO or switching
          PCs.
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="Backup name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <Button onClick={handleCreate} disabled={creating || !newName.trim()} size="sm">
            {creating ? "Backing up..." : "Create Backup"}
          </Button>
        </div>

        <div className="border-t border-white/[0.06]" />

        <div className="max-h-[300px] overflow-y-auto space-y-2">
          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No backups yet.</p>
          ) : (
            backups.map((b) => (
              <div
                key={b.name}
                className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:border-white/[0.1]"
              >
                <div>
                  <div className="font-medium text-sm">{b.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {b.fileCount} files &middot; {formatBytes(b.totalSize)} &middot; {b.createdAt}
                  </div>
                </div>
                <div className="flex gap-1">
                  {confirmRestore === b.name ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-amber-400 mr-1">
                        Overwrite current SavedVariables?
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setConfirmRestore(null);
                          handleRestore(b.name);
                        }}
                        disabled={restoring !== null}
                      >
                        {restoring === b.name ? "Restoring..." : "Yes, Restore"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmRestore(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => setConfirmRestore(b.name)}
                      disabled={restoring !== null}
                    >
                      {restoring === b.name ? "Restoring..." : "Restore"}
                    </Button>
                  )}
                  {confirmDelete === b.name ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-amber-400 mr-1">Delete this backup?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setConfirmDelete(null);
                          handleDelete(b.name);
                        }}
                      >
                        Yes, Delete
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirmDelete(b.name)}
                    >
                      Delete
                    </Button>
                  )}
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
