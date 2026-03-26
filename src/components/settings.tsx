import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ImportResult } from "../types";

interface SettingsProps {
  addonsPath: string;
  onPathChange: (path: string) => void;
  onClose: () => void;
  onRefresh: () => void;
}

export function Settings({
  addonsPath,
  onPathChange,
  onClose,
  onRefresh,
}: SettingsProps) {
  const [path, setPath] = useState(addonsPath);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const handleSave = () => {
    if (path.trim()) {
      onPathChange(path.trim());
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter") handleSave();
  };

  const handleExport = async () => {
    setExportStatus(null);
    try {
      const json = await invoke<string>("export_addon_list", {
        addonsPath,
      });
      // Copy to clipboard
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
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2>Settings</h2>
        <div className="settings-field">
          <label htmlFor="addons-path">ESO AddOns Folder Path</label>
          <input
            id="addons-path"
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\Users\...\Elder Scrolls Online\live\AddOns"
            autoFocus
          />
        </div>

        <div className="settings-section">
          <h3>Backup & Restore</h3>
          <p className="settings-hint">
            Export your tracked addon list to clipboard, or import from a
            previously exported list.
          </p>
          <div className="settings-row">
            <button className="btn" onClick={handleExport}>
              Export to Clipboard
            </button>
            <button
              className="btn"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? "Importing..." : "Import from Clipboard"}
            </button>
          </div>
          {exportStatus && (
            <div className="settings-status">{exportStatus}</div>
          )}
          {importError && (
            <div className="install-error">{importError}</div>
          )}
          {importResult && (
            <div className="import-results">
              {importResult.installed.length > 0 && (
                <div className="install-success">
                  Installed: {importResult.installed.join(", ")}
                </div>
              )}
              {importResult.skipped.length > 0 && (
                <div className="settings-status">
                  Already installed: {importResult.skipped.join(", ")}
                </div>
              )}
              {importResult.failed.length > 0 && (
                <div className="install-error">
                  Failed: {importResult.failed.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="settings-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
