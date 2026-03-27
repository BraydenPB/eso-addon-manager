import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { AddonManifest, UpdateCheckResult, InstallResult } from "../types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoPill } from "@/components/ui/info-pill";
import { cn } from "@/lib/utils";

interface AddonDetailProps {
  addon: AddonManifest | null;
  installedAddons: AddonManifest[];
  addonsPath: string;
  onRemove: () => void;
  updateResult: UpdateCheckResult | null;
  onAddonUpdated: (esouiId: number) => void;
}

export function AddonDetail({
  addon,
  installedAddons,
  addonsPath,
  onRemove,
  updateResult,
  onAddonUpdated,
}: AddonDetailProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const installedSet = useMemo(
    () => new Set(installedAddons.map((a) => a.folderName)),
    [installedAddons]
  );

  const dependents = useMemo(
    () =>
      addon
        ? installedAddons.filter((a) => a.dependsOn.some((dep) => dep.name === addon.folderName))
        : [],
    [installedAddons, addon]
  );

  if (!addon) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground px-8">
        {/* Ambient glow behind icon */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[200px] w-[200px] rounded-full bg-[#c4a44a]/[0.04] blur-[60px]" />
        <div className="relative rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 shadow-[0_0_30px_rgba(196,164,74,0.03)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground/30"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <line x1="10" y1="9" x2="8" y2="9" />
          </svg>
        </div>
        <div className="relative text-center">
          <p className="font-heading text-sm font-medium text-foreground/70">No addon selected</p>
          <p className="mt-1 text-xs text-muted-foreground/40">
            Select an addon from the list to view details
          </p>
        </div>
      </div>
    );
  }

  const handleRemove = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await invoke("remove_addon", {
        addonsPath,
        folderName: addon.folderName,
      });
      setConfirmingRemove(false);
      toast.success(`Removed ${addon.title}`);
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
      toast.success(`Updated ${addon.title}`);
      onAddonUpdated(updateResult.esouiId);
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="font-heading text-xl font-semibold bg-gradient-to-r from-[#c4a44a] to-[#d4b45a] bg-clip-text text-transparent">
        {addon.title}
      </h2>
      <div className="mt-1 mb-4 flex items-center gap-2 flex-wrap">
        <InfoPill color="muted">{addon.folderName}/</InfoPill>
        {addon.esouiId && (
          <a
            className="inline-flex"
            href={`https://www.esoui.com/downloads/info${addon.esouiId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <InfoPill
              color="sky"
              className="hover:border-sky-400/40 cursor-pointer transition-colors"
            >
              ESOUI #{addon.esouiId}
            </InfoPill>
          </a>
        )}
      </div>

      {updateResult?.hasUpdate && (
        <GlassPanel
          variant="subtle"
          className="mb-4 flex items-center justify-between gap-3 border-amber-500/20! bg-amber-500/[0.04]! p-3"
        >
          <span className="text-sm text-amber-400">
            Update available: {updateResult.currentVersion} &rarr; {updateResult.remoteVersion}
          </span>
          <Button onClick={handleUpdate} disabled={updating} size="sm">
            {updating ? "Updating..." : "Update"}
          </Button>
        </GlassPanel>
      )}

      {updateError && (
        <Alert variant="destructive" className="mb-4">
          {updateError}
        </Alert>
      )}

      <GlassPanel variant="subtle" className="mb-6 p-3">
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
          {addon.author && (
            <>
              <dt className="text-muted-foreground/60 font-heading text-xs uppercase tracking-wider">
                Author
              </dt>
              <dd>{addon.author}</dd>
            </>
          )}
          <dt className="text-muted-foreground/60 font-heading text-xs uppercase tracking-wider">
            Version
          </dt>
          <dd>{addon.version || addon.addonVersion || "Unknown"}</dd>
          {addon.apiVersion.length > 0 && (
            <>
              <dt className="text-muted-foreground/60 font-heading text-xs uppercase tracking-wider">
                API Version
              </dt>
              <dd>{addon.apiVersion.join(", ")}</dd>
            </>
          )}
          <dt className="text-muted-foreground/60 font-heading text-xs uppercase tracking-wider">
            Type
          </dt>
          <dd>
            {addon.isLibrary ? (
              <InfoPill color="emerald">Library</InfoPill>
            ) : (
              <InfoPill color="gold">Addon</InfoPill>
            )}
          </dd>
        </dl>
      </GlassPanel>

      {addon.description && (
        <div className="mb-5">
          <SectionHeader className="mb-2">Description</SectionHeader>
          <p className="text-sm leading-relaxed">{addon.description}</p>
        </div>
      )}

      {addon.dependsOn.length > 0 && (
        <div className="mb-5">
          <SectionHeader className="mb-2">Required Dependencies</SectionHeader>
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
                    <span className="text-xs text-muted-foreground">&gt;={dep.min_version}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {addon.optionalDependsOn.length > 0 && (
        <div className="mb-5">
          <SectionHeader className="mb-2">Optional Dependencies</SectionHeader>
          <ul className="space-y-1">
            {addon.optionalDependsOn.map((dep) => {
              const installed = installedSet.has(dep.name);
              return (
                <li
                  key={dep.name}
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    !installed && "italic text-muted-foreground"
                  )}
                >
                  <span className={installed ? "text-emerald-400" : ""}>
                    {installed ? "\u2713" : "\u25CB"}
                  </span>
                  <span>{dep.name}</span>
                  {dep.min_version !== null && (
                    <span className="text-xs text-muted-foreground">&gt;={dep.min_version}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 border-t border-white/[0.06] pt-4">
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
          <GlassPanel variant="subtle" className="border-red-500/20! bg-red-500/[0.04]! p-3">
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
              <Alert variant="destructive" className="mb-2">
                {removeError}
              </Alert>
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
              <Button variant="destructive" size="sm" onClick={handleRemove} disabled={removing}>
                {removing ? "Removing..." : "Confirm Remove"}
              </Button>
            </div>
          </GlassPanel>
        )}
      </div>
    </div>
  );
}
