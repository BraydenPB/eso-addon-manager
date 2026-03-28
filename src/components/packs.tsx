import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { Pack, PackIndexItem, InstallResult } from "../types";
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
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";
import {
  PackageIcon,
  DownloadIcon,
  ArrowLeftIcon,
  SearchIcon,
  AlertCircleIcon,
  Loader2Icon,
} from "lucide-react";

interface PacksProps {
  addonsPath: string;
  onClose: () => void;
  onRefresh: () => void;
  initialPackId?: string | null;
}

type PackTypeFilter = "all" | "addon-pack" | "build-pack" | "roster-pack";

const TYPE_LABELS: Record<string, string> = {
  "addon-pack": "Addon Pack",
  "build-pack": "Build Pack",
  "roster-pack": "Roster Pack",
};

const TAG_COLORS: Record<
  string,
  "gold" | "sky" | "emerald" | "amber" | "red" | "violet" | "muted"
> = {
  essential: "gold",
  trial: "sky",
  pve: "emerald",
  pvp: "red",
  healer: "emerald",
  dps: "amber",
  tank: "violet",
  beginner: "muted",
};

export function Packs({ addonsPath, onClose, onRefresh, initialPackId }: PacksProps) {
  const [packs, setPacks] = useState<PackIndexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<PackTypeFilter>("all");

  // Detail view
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [packDetail, setPackDetail] = useState<Pack | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Installation
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<{
    completed: number;
    failed: number;
    total: number;
  } | null>(null);

  const loadPacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await invoke<PackIndexItem[]>("list_packs", {
        packType: typeFilter === "all" ? null : typeFilter,
        tag: null,
        query: searchQuery || null,
      });
      setPacks(items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [typeFilter, searchQuery]);

  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

  // Auto-open a specific pack when triggered via deep link
  useEffect(() => {
    if (initialPackId) {
      handleSelectPack(initialPackId);
    }
  }, [initialPackId]);

  const handleSelectPack = async (id: string) => {
    setSelectedPackId(id);
    setLoadingDetail(true);
    try {
      const pack = await invoke<Pack>("get_pack", { id });
      setPackDetail(pack);
    } catch (e) {
      toast.error(`Failed to load pack: ${e}`);
      setSelectedPackId(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleBack = () => {
    setSelectedPackId(null);
    setPackDetail(null);
  };

  const handleInstallPack = async () => {
    if (!packDetail) return;
    const addons = packDetail.addons.filter((a) => a.defaultEnabled);
    if (addons.length === 0) {
      toast.info("No addons to install in this pack.");
      return;
    }

    setInstalling(true);
    setInstallProgress({ completed: 0, failed: 0, total: addons.length });

    let completed = 0;
    let failed = 0;

    for (const addon of addons) {
      try {
        await invoke<InstallResult>("install_addon", {
          addonsPath,
          esouiId: addon.esouiId,
        });
        completed++;
      } catch {
        failed++;
      }
      setInstallProgress({ completed, failed, total: addons.length });
    }

    setInstalling(false);
    setInstallProgress(null);

    if (failed > 0) {
      toast.success(`Installed ${completed} addon${completed !== 1 ? "s" : ""}, ${failed} failed`);
    } else {
      toast.success(
        `Installed ${completed} addon${completed !== 1 ? "s" : ""} from "${packDetail.name}"`
      );
    }
    onRefresh();
  };

  // Filtered list (client-side text search on top of server-side)
  const filteredPacks = packs;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedPackId && (
              <Button variant="ghost" size="icon-sm" onClick={handleBack} className="mr-1">
                <ArrowLeftIcon className="size-4" />
              </Button>
            )}
            <PackageIcon className="size-4 text-[#c4a44a]" />
            {selectedPackId ? (packDetail?.name ?? "Loading...") : "Addon Packs"}
          </DialogTitle>
        </DialogHeader>

        {selectedPackId ? (
          <PackDetailView
            pack={packDetail}
            loading={loadingDetail}
            installing={installing}
            installProgress={installProgress}
          />
        ) : (
          <PackListView
            packs={filteredPacks}
            loading={loading}
            error={error}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            onSelectPack={handleSelectPack}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={selectedPackId ? handleBack : onClose}>
            {selectedPackId ? "Back" : "Close"}
          </Button>
          {selectedPackId && packDetail && (
            <Button onClick={handleInstallPack} disabled={installing}>
              {installing ? (
                <>
                  <Loader2Icon className="size-4 animate-spin mr-1.5" />
                  Installing...
                </>
              ) : (
                <>
                  <DownloadIcon className="size-4 mr-1.5" />
                  Install Pack
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackListView({
  packs,
  loading,
  error,
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  onSelectPack,
}: {
  packs: PackIndexItem[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  typeFilter: PackTypeFilter;
  onTypeFilterChange: (f: PackTypeFilter) => void;
  onSelectPack: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 overflow-hidden">
      <p className="text-sm text-muted-foreground">
        Curated addon collections for trials, PvP, healing, and more. Install an entire pack with
        one click.
      </p>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
          <Input
            placeholder="Search packs..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value as PackTypeFilter)}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-sky-400/50"
        >
          <option value="all">All Types</option>
          <option value="addon-pack">Addon Packs</option>
          <option value="build-pack">Build Packs</option>
          <option value="roster-pack">Roster Packs</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0 max-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="inline-block size-6 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="rounded-xl bg-white/[0.03] p-4">
              <AlertCircleIcon className="size-8 text-red-400/60" />
            </div>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : packs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="rounded-xl bg-white/[0.03] p-4">
              <PackageIcon className="size-8 text-muted-foreground/40" />
            </div>
            <p className="font-heading text-sm font-medium">No packs found</p>
            <p className="text-xs text-muted-foreground/60">
              {searchQuery ? "Try a different search term" : "The packs service may be offline"}
            </p>
          </div>
        ) : (
          packs.map((pack) => (
            <button
              key={pack.id}
              onClick={() => onSelectPack(pack.id)}
              className={cn(
                "w-full text-left rounded-xl border border-white/[0.06] bg-white/[0.02] p-3",
                "transition-all duration-200 hover:bg-white/[0.04] hover:border-white/[0.1]",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/50"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm font-semibold truncate">{pack.name}</span>
                    <InfoPill color="muted">{TYPE_LABELS[pack.type] ?? pack.type}</InfoPill>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {pack.description}
                  </p>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {pack.tags.map((tag) => (
                      <InfoPill key={tag} color={TAG_COLORS[tag] ?? "muted"}>
                        {tag}
                      </InfoPill>
                    ))}
                    <span className="text-xs text-muted-foreground/50">
                      {pack.addonCount} addon{pack.addonCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function PackDetailView({
  pack,
  loading,
  installing,
  installProgress,
}: {
  pack: Pack | null;
  loading: boolean;
  installing: boolean;
  installProgress: { completed: number; failed: number; total: number } | null;
}) {
  if (loading || !pack) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="inline-block size-6 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
      </div>
    );
  }

  const requiredAddons = pack.addons.filter((a) => a.required);
  const optionalAddons = pack.addons.filter((a) => !a.required);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto max-h-[400px]">
      <p className="text-sm text-muted-foreground">{pack.description}</p>

      <div className="flex items-center gap-2 flex-wrap">
        <InfoPill color="muted">{TYPE_LABELS[pack.type] ?? pack.type}</InfoPill>
        {pack.tags.map((tag) => (
          <InfoPill key={tag} color={TAG_COLORS[tag] ?? "muted"}>
            {tag}
          </InfoPill>
        ))}
        <span className="text-xs text-muted-foreground/50">by {pack.metadata.createdBy}</span>
      </div>

      {/* Install progress bar */}
      {installing && installProgress && (
        <div className="rounded-lg border border-[#c4a44a]/20 bg-[#c4a44a]/[0.04] p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-[#c4a44a] font-medium">
              Installing {installProgress.completed + installProgress.failed}/
              {installProgress.total}
            </span>
            {installProgress.failed > 0 && (
              <span className="text-red-400 text-xs">{installProgress.failed} failed</span>
            )}
          </div>
          <div className="h-1 rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[#c4a44a] transition-all duration-300 ease-out"
              style={{
                width: `${((installProgress.completed + installProgress.failed) / installProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Required addons */}
      {requiredAddons.length > 0 && (
        <div>
          <SectionHeader className="mb-2">Required Addons</SectionHeader>
          <div className="space-y-1">
            {requiredAddons.map((addon) => (
              <AddonRow key={addon.esouiId} addon={addon} />
            ))}
          </div>
        </div>
      )}

      {/* Optional addons */}
      {optionalAddons.length > 0 && (
        <div>
          <SectionHeader className="mb-2">Optional Addons</SectionHeader>
          <div className="space-y-1">
            {optionalAddons.map((addon) => (
              <AddonRow key={addon.esouiId} addon={addon} />
            ))}
          </div>
        </div>
      )}

      {/* Build references */}
      {pack.builds && pack.builds.length > 0 && (
        <div>
          <SectionHeader className="mb-2">Linked Builds</SectionHeader>
          <div className="space-y-1">
            {pack.builds.map((build) => (
              <GlassPanel
                key={build.buildHubId}
                variant="subtle"
                className="flex items-center justify-between p-2.5"
              >
                <div>
                  <span className="text-sm font-medium">{build.title}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {build.esoClass && <InfoPill color="violet">{build.esoClass}</InfoPill>}
                    {build.role && <InfoPill color="sky">{build.role}</InfoPill>}
                  </div>
                </div>
              </GlassPanel>
            ))}
          </div>
        </div>
      )}

      {/* Roster references */}
      {pack.rosters && pack.rosters.length > 0 && (
        <div>
          <SectionHeader className="mb-2">Linked Rosters</SectionHeader>
          <div className="space-y-1">
            {pack.rosters.map((roster) => (
              <GlassPanel
                key={roster.rosterHubId}
                variant="subtle"
                className="flex items-center justify-between p-2.5"
              >
                <div>
                  <span className="text-sm font-medium">{roster.title}</span>
                  {roster.trialId && (
                    <InfoPill color="gold" className="ml-2">
                      {roster.trialId}
                    </InfoPill>
                  )}
                </div>
              </GlassPanel>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AddonRow({ addon }: { addon: Pack["addons"][number] }) {
  return (
    <GlassPanel
      variant="subtle"
      className={cn(
        "flex items-center gap-3 p-2.5",
        "border-l-[3px]",
        addon.required ? "border-l-[#c4a44a]/60" : "border-l-white/[0.08]"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{addon.name}</span>
          {addon.required && <InfoPill color="gold">Required</InfoPill>}
          {!addon.defaultEnabled && <InfoPill color="muted">Disabled</InfoPill>}
        </div>
        {addon.note && (
          <p className="mt-0.5 text-xs text-muted-foreground/60 truncate">{addon.note}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground/40 tabular-nums shrink-0">
        #{addon.esouiId}
      </span>
    </GlassPanel>
  );
}
