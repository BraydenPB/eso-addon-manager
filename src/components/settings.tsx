import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/lib/store";
import type { ImportResult } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { SectionHeader } from "@/components/ui/section-header";

interface SettingsProps {
  addonsPath: string;
  onPathChange: (path: string) => void;
  onClose: () => void;
  onRefresh: () => void;
  onShowBackups: () => void;
  onShowApiCompat: () => void;
  onShowCharacters: () => void;
}

export function Settings({
  addonsPath,
  onPathChange,
  onClose,
  onRefresh,
  onShowBackups,
  onShowApiCompat,
  onShowCharacters,
}: SettingsProps) {
  const [path, setPath] = useState(addonsPath);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [minionDetected, setMinionDetected] = useState(false);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    getSetting<boolean>("autoUpdate", false).then(setAutoUpdate);
    invoke<boolean>("detect_minion")
      .then(setMinionDetected)
      .catch(() => {});
  }, []);

  const handleSave = () => {
    if (path.trim()) {
      onPathChange(path.trim());
    }
    onClose();
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        title: "Select ESO AddOns Folder",
        defaultPath: path || undefined,
      });
      if (selected) {
        setPath(selected);
      }
    } catch (e) {
      toast.error(`Failed to open folder picker: ${e}`);
    }
  };

  const handleExport = async () => {
    setExportStatus(null);
    try {
      const json = await invoke<string>("export_addon_list", {
        addonsPath,
      });
      await navigator.clipboard.writeText(json);
      setExportStatus("Addon list copied to clipboard!");
    } catch (e) {
      setExportStatus(`Export failed: ${e}`);
    }
  };

  const handleImport = async () => {
    setImportError(null);
    setImportResult(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setImportError("Clipboard is empty. Copy an export JSON first.");
        return;
      }
      setImporting(true);
      const result = await invoke<ImportResult>("import_addon_list", {
        addonsPath,
        jsonData: text,
      });
      setImportResult(result);
      onRefresh();
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="addons-path" className="mb-1 block text-sm text-muted-foreground">
              ESO AddOns Folder Path
            </label>
            <div className="flex gap-2">
              <Input
                id="addons-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="C:\Users\...\Elder Scrolls Online\live\AddOns"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              <Button variant="outline" size="sm" onClick={handleBrowse}>
                Browse
              </Button>
            </div>
          </div>

          <div className="border-t border-white/[0.06]" />

          <div>
            <SectionHeader className="mb-1">Auto-Update</SectionHeader>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => {
                  setAutoUpdate(e.target.checked);
                  setSetting("autoUpdate", e.target.checked);
                }}
                className="accent-[var(--primary)]"
              />
              <span className="text-sm">Automatically update all addons on launch</span>
            </label>
          </div>

          <div className="border-t border-white/[0.06]" />

          <div>
            <SectionHeader className="mb-1">Tools</SectionHeader>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onShowBackups}>
                SavedVariables Backup
              </Button>
              <Button variant="outline" size="sm" onClick={onShowCharacters}>
                Characters
              </Button>
              <Button variant="outline" size="sm" onClick={onShowApiCompat}>
                API Compatibility
              </Button>
            </div>
            {minionDetected && (
              <div className="mt-3">
                <SectionHeader className="mb-1">Minion Migration</SectionHeader>
                <p className="mb-2 text-xs text-muted-foreground">
                  Minion detected. Import addon tracking data to enable update checking.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={migrating}
                  onClick={async () => {
                    setMigrating(true);
                    try {
                      const result = await invoke<{
                        found: boolean;
                        addonCount: number;
                        imported: number;
                        alreadyTracked: number;
                      }>("migrate_from_minion", { addonsPath });
                      const { imported, alreadyTracked } = result;
                      if (imported > 0) {
                        toast.success(
                          `Imported ${imported} addon${imported !== 1 ? "s" : ""} from Minion${alreadyTracked > 0 ? ` (${alreadyTracked} already tracked)` : ""}`
                        );
                        onRefresh();
                      } else {
                        toast.info("All Minion addons are already tracked.");
                      }
                    } catch (e) {
                      toast.error(String(e));
                    } finally {
                      setMigrating(false);
                    }
                  }}
                >
                  {migrating ? "Migrating..." : "Import from Minion"}
                </Button>
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.06]" />

          <div>
            <SectionHeader className="mb-1">Addon List Backup</SectionHeader>
            <p className="mb-3 text-xs text-muted-foreground">
              Export your tracked addon list to clipboard, or import from a previously exported
              list.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                Export to Clipboard
              </Button>
              <Button variant="outline" size="sm" onClick={handleImport} disabled={importing}>
                {importing ? "Importing..." : "Import from Clipboard"}
              </Button>
            </div>
            {exportStatus && <p className="mt-2 text-sm text-muted-foreground">{exportStatus}</p>}
            {importError && (
              <Alert variant="destructive" className="mt-2">
                {importError}
              </Alert>
            )}
            {importResult && (
              <div className="mt-2 space-y-2">
                {importResult.installed.length > 0 && (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-2 text-sm text-emerald-400">
                    Installed: {importResult.installed.join(", ")}
                  </div>
                )}
                {importResult.skipped.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Already installed: {importResult.skipped.join(", ")}
                  </p>
                )}
                {importResult.failed.length > 0 && (
                  <Alert variant="destructive">Failed: {importResult.failed.join(", ")}</Alert>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
