import { useState, useMemo, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import type { AddonManifest, UpdateCheckResult, InstallResult } from "../types";
import { PRESET_TAGS } from "../types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoPill } from "@/components/ui/info-pill";
import { getTauriErrorMessage, invokeOrThrow } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface AddonDetailProps {
  addon: AddonManifest | null;
  installedAddons: AddonManifest[];
  addonsPath: string;
  onRemove: () => void;
  updateResult: UpdateCheckResult | null;
  onAddonUpdated: (esouiId: number) => void;
  onTagsChange: (folderName: string, tags: string[]) => void;
}

export function AddonDetail({
  addon,
  installedAddons,
  addonsPath,
  onRemove,
  updateResult,
  onAddonUpdated,
  onTagsChange,
}: AddonDetailProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [installingDep, setInstallingDep] = useState<string | null>(null);
  const [removingDep, setRemovingDep] = useState<string | null>(null);
  const [customTagInput, setCustomTagInput] = useState("");
  const customTagRef = useRef<HTMLInputElement>(null);

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
      await invokeOrThrow("remove_addon", {
        addonsPath,
        folderName: addon.folderName,
      });
      setConfirmingRemove(false);
      toast.success(`Removed ${addon.title}`);
      onRemove();
    } catch (e) {
      setRemoveError(getTauriErrorMessage(e));
      setRemoving(false);
    }
  };

  const handleUpdate = async () => {
    if (!updateResult) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      await invokeOrThrow<InstallResult>("update_addon", {
        addonsPath,
        esouiId: updateResult.esouiId,
      });
      toast.success(`Updated ${addon.title}`);
      onAddonUpdated(updateResult.esouiId);
    } catch (e) {
      setUpdateError(getTauriErrorMessage(e));
    } finally {
      setUpdating(false);
    }
  };

  const handleInstallDep = async (depName: string) => {
    setInstallingDep(depName);
    try {
      await invokeOrThrow<InstallResult>("install_dependency", {
        addonsPath,
        depName,
      });
      toast.success(`Installed ${depName}`);
      onRemove(); // refresh addon list
    } catch (e) {
      toast.error(`Failed to install ${depName}: ${getTauriErrorMessage(e)}`);
    } finally {
      setInstallingDep(null);
    }
  };

  const handleRemoveDep = async (depName: string) => {
    setRemovingDep(depName);
    try {
      await invokeOrThrow("remove_addon", {
        addonsPath,
        folderName: depName,
      });
      toast.success(`Removed ${depName}`);
      onRemove(); // refresh addon list
    } catch (e) {
      toast.error(`Failed to remove ${depName}: ${getTauriErrorMessage(e)}`);
    } finally {
      setRemovingDep(null);
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
          {addon.esouiLastUpdate > 0 && (
            <>
              <dt className="text-muted-foreground/60 font-heading text-xs uppercase tracking-wider">
                Last Updated
              </dt>
              <dd>{new Date(addon.esouiLastUpdate).toLocaleDateString()}</dd>
            </>
          )}
        </dl>
        {addon.esouiId && (
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <button
              onClick={() => openUrl(`https://www.esoui.com/downloads/info${addon.esouiId}`)}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              View on ESOUI
            </button>
          </div>
        )}
      </GlassPanel>

      {/* Tags */}
      <div className="mb-5">
        <SectionHeader className="mb-2">Tags</SectionHeader>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_TAGS.map((tag) => {
            const active = addon.tags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => {
                  const next = active ? addon.tags.filter((t) => t !== tag) : [...addon.tags, tag];
                  onTagsChange(addon.folderName, next);
                }}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 border",
                  active
                    ? tag === "favorite"
                      ? "bg-[#c4a44a]/15 text-[#c4a44a] border-[#c4a44a]/25"
                      : tag === "broken"
                        ? "bg-red-500/15 text-red-400 border-red-500/25"
                        : tag === "testing"
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
                          : tag === "essential"
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                            : "bg-violet-500/15 text-violet-400 border-violet-500/25"
                    : "bg-white/[0.03] text-muted-foreground/50 border-white/[0.06] hover:bg-white/[0.06] hover:text-muted-foreground"
                )}
              >
                {tag === "favorite" && (active ? "\u2605 " : "\u2606 ")}
                {tag}
              </button>
            );
          })}
          {/* Custom tags */}
          {addon.tags
            .filter((t) => !(PRESET_TAGS as readonly string[]).includes(t))
            .map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 text-sky-400 border border-sky-500/25 px-2.5 py-1 text-xs font-medium"
              >
                {tag}
                <button
                  onClick={() =>
                    onTagsChange(
                      addon.folderName,
                      addon.tags.filter((t) => t !== tag)
                    )
                  }
                  className="cursor-pointer ml-0.5 text-sky-400/60 hover:text-sky-400 transition-colors"
                  aria-label={`Remove tag ${tag}`}
                >
                  &times;
                </button>
              </span>
            ))}
          {/* Add custom tag */}
          <form
            className="inline-flex"
            onSubmit={(e) => {
              e.preventDefault();
              const tag = customTagInput.trim().toLowerCase();
              if (tag && !addon.tags.includes(tag)) {
                onTagsChange(addon.folderName, [...addon.tags, tag]);
              }
              setCustomTagInput("");
            }}
          >
            <input
              ref={customTagRef}
              type="text"
              value={customTagInput}
              onChange={(e) => setCustomTagInput(e.target.value)}
              placeholder="+ tag"
              className="w-16 focus:w-24 transition-all duration-150 rounded-md bg-white/[0.03] border border-white/[0.06] px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-sky-400/30 focus:bg-white/[0.05]"
            />
          </form>
        </div>
      </div>

      {addon.description && (
        <div className="mb-5">
          <SectionHeader className="mb-2">Description</SectionHeader>
          <p className="text-sm leading-relaxed">{addon.description}</p>
        </div>
      )}

      {addon.dependsOn.length > 0 && (
        <div className="mb-5">
          <SectionHeader className="mb-2">Required Dependencies</SectionHeader>
          <div className="space-y-0.5">
            {addon.dependsOn.map((dep) => {
              const installed = installedSet.has(dep.name);
              return (
                <div
                  key={dep.name}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/[0.03] transition-colors"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                      installed
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    )}
                  >
                    {installed ? "\u2713" : "!"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="truncate block">{dep.name}</span>
                    {dep.min_version !== null && (
                      <span className="text-[11px] text-muted-foreground/50">
                        v{dep.min_version}+
                      </span>
                    )}
                  </div>
                  {installed ? (
                    <button
                      className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground/30 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                      onClick={() => handleRemoveDep(dep.name)}
                      disabled={removingDep === dep.name}
                      title={`Remove ${dep.name}`}
                    >
                      {removingDep === dep.name ? (
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/[0.1] border-t-red-400" />
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      )}
                    </button>
                  ) : (
                    <button
                      className="shrink-0 cursor-pointer rounded bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                      onClick={() => handleInstallDep(dep.name)}
                      disabled={installingDep === dep.name}
                      title={`Install ${dep.name}`}
                    >
                      {installingDep === dep.name ? (
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/[0.1] border-t-sky-400" />
                      ) : (
                        "Install"
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {addon.optionalDependsOn.length > 0 && (
        <div className="mb-5">
          <SectionHeader className="mb-2">Optional Dependencies</SectionHeader>
          <div className="space-y-0.5">
            {addon.optionalDependsOn.map((dep) => {
              const installed = installedSet.has(dep.name);
              return (
                <div
                  key={dep.name}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/[0.03] transition-colors"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                      installed
                        ? "bg-emerald-500/15 text-emerald-400 font-bold"
                        : "bg-white/[0.04] text-muted-foreground/40"
                    )}
                  >
                    {installed ? "\u2713" : "\u2013"}
                  </span>
                  <div className={cn("flex-1 min-w-0", !installed && "text-muted-foreground/60")}>
                    <span className="truncate block">{dep.name}</span>
                    {dep.min_version !== null && (
                      <span className="text-[11px] text-muted-foreground/50">
                        v{dep.min_version}+
                      </span>
                    )}
                  </div>
                  {installed ? (
                    <button
                      className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground/30 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                      onClick={() => handleRemoveDep(dep.name)}
                      disabled={removingDep === dep.name}
                      title={`Remove ${dep.name}`}
                    >
                      {removingDep === dep.name ? (
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/[0.1] border-t-red-400" />
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      )}
                    </button>
                  ) : (
                    <button
                      className="shrink-0 cursor-pointer rounded bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                      onClick={() => handleInstallDep(dep.name)}
                      disabled={installingDep === dep.name}
                      title={`Install ${dep.name}`}
                    >
                      {installingDep === dep.name ? (
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/[0.1] border-t-sky-400" />
                      ) : (
                        "Install"
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
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
