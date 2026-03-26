import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AddonManifest, UpdateCheckResult, InstallResult } from "../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface AddonDetailProps {
  addon: AddonManifest | null;
  installedAddons: AddonManifest[];
  addonsPath: string;
  onRemove: () => void;
  updateResult: UpdateCheckResult | null;
  onUpdated: () => void;
}

export function AddonDetail({
  addon,
  installedAddons,
  addonsPath,
  onRemove,
  updateResult,
  onUpdated,
}: AddonDetailProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  if (!addon) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Select an addon to view details
      </div>
    );
  }

  const installedSet = new Set(installedAddons.map((a) => a.folderName));

  const dependents = installedAddons.filter((a) =>
    a.dependsOn.some((dep) => dep.name === addon.folderName),
  );

  const handleRemove = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await invoke("remove_addon", {
        addonsPath,
        folderName: addon.folderName,
      });
      setConfirmingRemove(false);
      onRemove();
    } catch (e) {
      setRemoveError(String(e));
      setRemoving(false);
    }
  };

  const handleUpdate = async () => {
    if (!updateResult) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      await invoke<InstallResult>("update_addon", {
        addonsPath,
        esouiId: updateResult.esouiId,
      });
      onUpdated();
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="text-xl font-semibold text-primary">{addon.title}</h2>
      <div className="mt-1 mb-4 font-mono text-xs text-muted-foreground">
        {addon.folderName}/
        {addon.esouiId && (
          <span>
            {" "}&middot;{" "}
            <a
              className="text-primary hover:underline"
              href={`https://www.esoui.com/downloads/info${addon.esouiId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              ESOUI #{addon.esouiId}
            </a>
          </span>
        )}
      </div>

      {updateResult?.hasUpdate && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
          <span className="text-sm text-blue-400">
            Update available: {updateResult.currentVersion} &rarr;{" "}
            {updateResult.remoteVersion}
          </span>
          <Button onClick={handleUpdate} disabled={updating} size="sm">
            {updating ? "Updating..." : "Update"}
          </Button>
        </div>
      )}

      {updateError && (
        <Alert variant="destructive" className="mb-4">{updateError}</Alert>
      )}

      <dl className="mb-6 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
        {addon.author && (
          <>
            <dt className="text-muted-foreground">Author</dt>
            <dd>{addon.author}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Version</dt>
        <dd>{addon.version || addon.addonVersion || "Unknown"}</dd>
        {addon.apiVersion.length > 0 && (
          <>
            <dt className="text-muted-foreground">API Version</dt>
            <dd>{addon.apiVersion.join(", ")}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Type</dt>
        <dd>
          {addon.isLibrary ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              Library
            </Badge>
          ) : (
            "Addon"
          )}
        </dd>
      </dl>

      {addon.description && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Description
          </h3>
          <p className="text-sm">{addon.description}</p>
        </div>
      )}

      {addon.dependsOn.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Required Dependencies
          </h3>
          <ul className="space-y-1">
            {addon.dependsOn.map((dep) => {
              const installed = installedSet.has(dep.name);
              return (
                <li key={dep.name} className="flex items-center gap-2 text-sm">
                  <span className={installed ? "text-emerald-400" : "text-destructive"}>
                    {installed ? "\u2713" : "\u2717"}
                  </span>
                  <span>{dep.name}</span>
                  {dep.min_version !== null && (
                    <span className="text-xs text-muted-foreground">
                      &gt;={dep.min_version}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {addon.optionalDependsOn.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Optional Dependencies
          </h3>
          <ul className="space-y-1">
            {addon.optionalDependsOn.map((dep) => {
              const installed = installedSet.has(dep.name);
              return (
                <li
                  key={dep.name}
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    !installed && "italic text-muted-foreground",
                  )}
                >
                  <span className={installed ? "text-emerald-400" : ""}>
                    {installed ? "\u2713" : "\u25CB"}
                  </span>
                  <span>{dep.name}</span>
                  {dep.min_version !== null && (
                    <span className="text-xs text-muted-foreground">
                      &gt;={dep.min_version}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Separator className="my-4" />

      <div>
        {!confirmingRemove ? (
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmingRemove(true);
              setRemoveError(null);
            }}
          >
            Remove Addon
          </Button>
        ) : (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <p className="mb-2 text-sm">
              Remove <strong>{addon.title}</strong>?
            </p>
            {dependents.length > 0 && (
              <p className="mb-2 text-sm text-yellow-500">
                Warning: {dependents.map((d) => d.title).join(", ")}{" "}
                {dependents.length === 1 ? "depends" : "depend"} on this addon.
              </p>
            )}
            {removeError && (
              <Alert variant="destructive" className="mb-2">{removeError}</Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingRemove(false)}
                disabled={removing}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemove}
                disabled={removing}
              >
                {removing ? "Removing..." : "Confirm Remove"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
