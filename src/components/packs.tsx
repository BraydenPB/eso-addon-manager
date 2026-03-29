import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  Pack,
  PackPage,
  PackAddonEntry,
  InstallResult,
  EsouiAddonInfo,
  EsouiSearchResult,
  AddonManifest,
  AuthUser,
} from "../types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PackageIcon,
  DownloadIcon,
  ArrowLeftIcon,
  SearchIcon,
  AlertCircleIcon,
  Loader2Icon,
  PlusIcon,
  XIcon,
  HeartIcon,
  CheckIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────

interface PacksProps {
  addonsPath: string;
  installedAddons: AddonManifest[];
  authUser: AuthUser | null;
  onAuthChange: (user: AuthUser | null) => void;
  onClose: () => void;
  onRefresh: () => void;
  initialPackId?: string | null;
}

type PackTypeFilter = "all" | "addon-pack" | "build-pack" | "roster-pack";
type TabMode = "browse" | "create";

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
  trial: "red",
  pve: "emerald",
  pvp: "red",
  healer: "sky",
  dps: "amber",
  tank: "violet",
  beginner: "emerald",
  utility: "muted",
};

const PRESET_TAGS = ["trial", "pvp", "beginner", "healer", "tank", "dps", "utility"] as const;

// ── Main Packs Component ──────────────────────────────────────────────────

export function Packs({
  addonsPath,
  installedAddons,
  authUser,
  onAuthChange,
  onClose,
  onRefresh,
  initialPackId,
}: PacksProps) {
  const [tab, setTab] = useState<TabMode>("browse");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<PackTypeFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Detail view
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Create pack form state (lifted here so tab switches don't reset it)
  const [createStep, setCreateStep] = useState<"details" | "addons">("details");
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPackType, setCreatePackType] = useState("addon-pack");
  const [createTags, setCreateTags] = useState<string[]>([]);
  const [createAddons, setCreateAddons] = useState<PackAddonEntry[]>([]);

  // Installation — selected addons (esouiId set)
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<{
    completed: number;
    failed: number;
    total: number;
  } | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<Set<number>>(new Set());

  // When a pack is selected, pre-select all required addons
  useEffect(() => {
    if (selectedPack) {
      setSelectedAddons(
        new Set(selectedPack.addons.filter((a) => a.required).map((a) => a.esouiId))
      );
    }
  }, [selectedPack]);

  const loadPacks = useCallback(
    async (q: string, page: number = 1) => {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const result = await invoke<PackPage>("list_packs", {
          packType: typeFilter === "all" ? null : typeFilter,
          tag: null,
          query: q || null,
          sort: "votes",
          page,
        });
        if (page === 1) {
          setPacks(result.packs);
        } else {
          setPacks((prev) => [...prev, ...result.packs]);
        }
        setCurrentPage(result.page);
        // If the API returned a full page, there might be more
        setHasMore(result.packs.length >= 20);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [typeFilter]
  );

  const handleLoadMore = () => {
    loadPacks(searchQuery, currentPage + 1);
  };

  // Debounce search queries (400ms), but load immediately on type filter change
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(
      () => {
        loadPacks(searchQuery, 1);
      },
      searchQuery ? 400 : 0
    );
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, loadPacks]);

  // Auto-open a specific pack when triggered via deep link
  useEffect(() => {
    if (initialPackId) {
      handleSelectPack(initialPackId);
    }
  }, [initialPackId]);

  const handleSelectPack = async (id: string) => {
    setLoadingDetail(true);
    try {
      const pack = await invoke<Pack>("get_pack", { id });
      setSelectedPack(pack);
    } catch (e) {
      toast.error(`Failed to load pack: ${e}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleBack = () => {
    setSelectedPack(null);
  };

  const handleToggleAddon = (esouiId: number, required: boolean) => {
    // Required addons can't be deselected
    if (required) return;
    setSelectedAddons((prev) => {
      const next = new Set(prev);
      if (next.has(esouiId)) {
        next.delete(esouiId);
      } else {
        next.add(esouiId);
      }
      return next;
    });
  };

  const handleInstallPack = async () => {
    if (!selectedPack) return;
    const toInstall = selectedPack.addons.filter((a) => selectedAddons.has(a.esouiId));
    if (toInstall.length === 0) {
      toast.info("No addons selected to install.");
      return;
    }

    setInstalling(true);
    setInstallProgress({ completed: 0, failed: 0, total: toInstall.length });

    let completed = 0;
    let failed = 0;

    for (const addon of toInstall) {
      try {
        const info = await invoke<EsouiAddonInfo>("resolve_esoui_addon", {
          input: String(addon.esouiId),
        });
        await invoke<InstallResult>("install_addon", {
          addonsPath,
          downloadUrl: info.downloadUrl,
          esouiId: addon.esouiId,
          esouiTitle: info.title,
          esouiVersion: info.version,
        });
        completed++;
      } catch {
        failed++;
      }
      setInstallProgress({ completed, failed, total: toInstall.length });
    }

    setInstalling(false);
    setInstallProgress(null);

    if (failed > 0) {
      toast.warning(`Installed ${completed} addon${completed !== 1 ? "s" : ""}, ${failed} failed`);
    } else {
      toast.success(
        `Installed ${completed} addon${completed !== 1 ? "s" : ""} from "${selectedPack.title}"`
      );
    }
    onRefresh();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedPack && (
              <Button variant="ghost" size="icon-sm" onClick={handleBack} className="mr-1">
                <ArrowLeftIcon className="size-4" />
              </Button>
            )}
            <PackageIcon className="size-4 text-[#c4a44a]" />
            {selectedPack ? selectedPack.title : "Pack Hub"}
          </DialogTitle>

          {/* Tab bar with animated pill indicator */}
          {!selectedPack && (
            <div className="relative flex gap-1 mt-2 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              {/* Sliding pill background */}
              <div
                className="absolute top-0.5 bottom-0.5 rounded-md bg-white/[0.08] shadow-sm transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                style={{
                  left: tab === "browse" ? "2px" : "calc(50% + 0px)",
                  width: "calc(50% - 2px)",
                }}
              />
              {(["browse", "create"] as TabMode[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "relative z-10 flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors duration-200",
                    tab === t
                      ? "text-foreground"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  )}
                >
                  {t === "browse" ? "Browse Packs" : "Create Pack"}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>

        {selectedPack ? (
          <PackDetailView
            pack={selectedPack}
            loading={loadingDetail}
            installing={installing}
            installProgress={installProgress}
            selectedAddons={selectedAddons}
            onToggleAddon={handleToggleAddon}
          />
        ) : tab === "browse" ? (
          <PackListView
            packs={packs}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            error={error}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            onSelectPack={handleSelectPack}
            onLoadMore={handleLoadMore}
            onRetry={() => loadPacks(searchQuery, 1)}
          />
        ) : (
          <PackCreateView
            installedAddons={installedAddons}
            authUser={authUser}
            onAuthChange={onAuthChange}
            step={createStep}
            onStepChange={setCreateStep}
            title={createTitle}
            onTitleChange={setCreateTitle}
            description={createDescription}
            onDescriptionChange={setCreateDescription}
            packType={createPackType}
            onPackTypeChange={setCreatePackType}
            selectedTags={createTags}
            onTagsChange={setCreateTags}
            addons={createAddons}
            onAddonsChange={setCreateAddons}
            onPublished={() => {
              // Reset form and switch to browse
              setCreateTitle("");
              setCreateDescription("");
              setCreatePackType("addon-pack");
              setCreateTags([]);
              setCreateAddons([]);
              setCreateStep("details");
              setTab("browse");
              loadPacks("", 1);
            }}
          />
        )}

        <DialogFooter>
          {selectedPack ? (
            <>
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button
                onClick={handleInstallPack}
                disabled={installing || selectedAddons.size === 0}
              >
                {installing ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin mr-1.5" />
                    Installing...
                  </>
                ) : (
                  <>
                    <DownloadIcon className="size-4 mr-1.5" />
                    Install {selectedAddons.size} Addon{selectedAddons.size !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Browse / List View ────────────────────────────────────────────────────

function PackListView({
  packs,
  loading,
  loadingMore,
  hasMore,
  error,
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  onSelectPack,
  onLoadMore,
  onRetry,
}: {
  packs: Pack[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  typeFilter: PackTypeFilter;
  onTypeFilterChange: (f: PackTypeFilter) => void;
  onSelectPack: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 min-h-0">
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
        <Select
          value={typeFilter}
          onValueChange={(v) => v && onTypeFilterChange(v as PackTypeFilter)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="addon-pack">Addon Packs</SelectItem>
            <SelectItem value="build-pack">Build Packs</SelectItem>
            <SelectItem value="roster-pack">Roster Packs</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0 max-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="inline-block size-6 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="rounded-xl bg-red-500/[0.06] border border-red-500/[0.1] p-4">
              <AlertCircleIcon className="size-8 text-red-400/60" />
            </div>
            <p className="font-heading text-sm font-medium text-red-400">Could not load packs</p>
            <p className="text-xs text-muted-foreground/60 max-w-[280px]">{error}</p>
            <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
              <RefreshCwIcon className="size-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        ) : packs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="rounded-xl bg-[#c4a44a]/[0.06] border border-[#c4a44a]/[0.1] p-4">
              <SparklesIcon className="size-8 text-[#c4a44a]/50" />
            </div>
            <p className="font-heading text-sm font-medium">
              {searchQuery ? "No packs match your search" : "The Pack Hub is empty"}
            </p>
            <p className="text-xs text-muted-foreground/60 max-w-[260px]">
              {searchQuery
                ? "Try different keywords or clear filters"
                : "Be the first to share an addon pack with the community!"}
            </p>
          </div>
        ) : (
          packs.map((pack) => (
            <button
              key={pack.id}
              onClick={() => onSelectPack(pack.id)}
              className={cn(
                "group w-full text-left rounded-xl border border-white/[0.06] bg-white/[0.02] p-3",
                "transition-all duration-200",
                "hover:bg-white/[0.05] hover:border-white/[0.12] hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/50"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm font-semibold truncate group-hover:text-[#c4a44a] transition-colors duration-200">
                      {pack.title}
                    </span>
                    <InfoPill color="muted">{TYPE_LABELS[pack.packType] ?? pack.packType}</InfoPill>
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
                      {pack.addons.length} addon{pack.addons.length !== 1 ? "s" : ""}
                    </span>
                    {pack.voteCount > 0 && (
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground/50">
                        <HeartIcon className="size-3" />
                        {pack.voteCount}
                      </span>
                    )}
                    {!pack.isAnonymous && pack.authorName && (
                      <span className="text-xs text-muted-foreground/40 ml-auto">
                        by {pack.authorName}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
        {!loading && hasMore && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className={cn(
              "w-full py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs font-semibold",
              "transition-all duration-200 hover:bg-white/[0.04] hover:border-white/[0.1]",
              "text-muted-foreground/60 hover:text-muted-foreground",
              loadingMore && "opacity-60 cursor-wait"
            )}
          >
            {loadingMore ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
                Loading...
              </span>
            ) : (
              "Load More"
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────

function PackDetailView({
  pack,
  loading,
  installing,
  installProgress,
  selectedAddons,
  onToggleAddon,
}: {
  pack: Pack | null;
  loading: boolean;
  installing: boolean;
  installProgress: { completed: number; failed: number; total: number } | null;
  selectedAddons: Set<number>;
  onToggleAddon: (esouiId: number, required: boolean) => void;
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
        <InfoPill color="muted">{TYPE_LABELS[pack.packType] ?? pack.packType}</InfoPill>
        {pack.tags.map((tag) => (
          <InfoPill key={tag} color={TAG_COLORS[tag] ?? "muted"}>
            {tag}
          </InfoPill>
        ))}
        {!pack.isAnonymous && (
          <span className="text-xs text-muted-foreground/50">by {pack.authorName}</span>
        )}
        {pack.voteCount > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground/50">
            <HeartIcon className="size-3" /> {pack.voteCount}
          </span>
        )}
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

      {/* Required addons — always installed */}
      {requiredAddons.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <SectionHeader>Required</SectionHeader>
            <span className="text-[10px] text-[#c4a44a]/60 font-medium">Always included</span>
          </div>
          <div className="space-y-1">
            {requiredAddons.map((addon) => (
              <AddonRow
                key={addon.esouiId}
                addon={addon}
                checked={selectedAddons.has(addon.esouiId)}
                locked
                onToggle={() => onToggleAddon(addon.esouiId, true)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Optional addons — toggle to include */}
      {optionalAddons.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <SectionHeader>Optional</SectionHeader>
            <span className="text-[10px] text-sky-400/60 font-medium">Click to add</span>
          </div>
          <div className="space-y-1">
            {optionalAddons.map((addon) => (
              <AddonRow
                key={addon.esouiId}
                addon={addon}
                checked={selectedAddons.has(addon.esouiId)}
                locked={false}
                onToggle={() => onToggleAddon(addon.esouiId, false)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AddonRow({
  addon,
  checked,
  locked,
  onToggle,
}: {
  addon: PackAddonEntry;
  checked: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={locked}
      className={cn(
        "group w-full text-left rounded-lg transition-all duration-150",
        !locked && "cursor-pointer",
        // Unchecked optional: prominent interactive appearance
        !locked && !checked && "hover:bg-sky-400/[0.06] hover:ring-1 hover:ring-sky-400/20",
        // Checked: gold tint
        !locked && checked && "hover:bg-[#c4a44a]/[0.06]"
      )}
    >
      <GlassPanel
        variant="subtle"
        className={cn(
          "flex items-center gap-3 p-2.5 transition-all duration-150 rounded-lg",
          "border-l-[3px]",
          locked
            ? "border-l-[#c4a44a]/60"
            : checked
              ? "border-l-[#c4a44a]/60 bg-[#c4a44a]/[0.03]"
              : "border-l-sky-400/30"
        )}
      >
        {/* Checkbox — larger, more visible */}
        <div
          className={cn(
            "flex items-center justify-center size-5 rounded-md border-2 shrink-0 transition-all duration-150",
            locked
              ? "bg-[#c4a44a]/15 border-[#c4a44a]/40"
              : checked
                ? "bg-[#c4a44a]/20 border-[#c4a44a]/50 shadow-[0_0_6px_rgba(196,164,74,0.15)]"
                : "border-white/20 bg-white/[0.03] group-hover:border-sky-400/40 group-hover:bg-sky-400/[0.06]"
          )}
        >
          {checked && <CheckIcon className="size-3.5 text-[#c4a44a]" />}
          {locked && <CheckIcon className="size-3.5 text-[#c4a44a]/70" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium truncate transition-colors duration-150",
                locked
                  ? "text-foreground"
                  : checked
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground"
              )}
            >
              {addon.name}
            </span>
            {locked && (
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[#c4a44a]/50 shrink-0">
                Required
              </span>
            )}
            {!locked && !checked && (
              <PlusIcon className="size-3.5 text-sky-400/0 group-hover:text-sky-400/60 transition-all duration-150 shrink-0" />
            )}
          </div>
          {addon.note && (
            <p className="mt-0.5 text-xs text-muted-foreground/60 truncate">{addon.note}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground/40 tabular-nums shrink-0">
          #{addon.esouiId}
        </span>
      </GlassPanel>
    </button>
  );
}

// ── Create Pack View ──────────────────────────────────────────────────────

type AddonSource = "search" | "installed";

interface CreateViewProps {
  installedAddons: AddonManifest[];
  authUser: AuthUser | null;
  onAuthChange: (user: AuthUser | null) => void;
  step: "details" | "addons";
  onStepChange: (s: "details" | "addons") => void;
  title: string;
  onTitleChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  packType: string;
  onPackTypeChange: (v: string) => void;
  selectedTags: string[];
  onTagsChange: (v: string[]) => void;
  addons: PackAddonEntry[];
  onAddonsChange: (v: PackAddonEntry[] | ((prev: PackAddonEntry[]) => PackAddonEntry[])) => void;
  onPublished: () => void;
}

function PackCreateView({
  installedAddons,
  authUser,
  onAuthChange,
  step,
  onStepChange: setStep,
  title,
  onTitleChange: setTitle,
  description,
  onDescriptionChange: setDescription,
  packType,
  onPackTypeChange: setPackType,
  selectedTags,
  onTagsChange: setSelectedTags,
  addons,
  onAddonsChange: setAddons,
  onPublished,
}: CreateViewProps) {
  // Search
  const [addonSource, setAddonSource] = useState<AddonSource>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EsouiSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const createSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up search timer on unmount
  useEffect(() => {
    return () => {
      if (createSearchTimerRef.current) clearTimeout(createSearchTimerRef.current);
    };
  }, []);

  // Installed addons filter
  const [installedFilter, setInstalledFilter] = useState("");

  const handleTagToggle = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else if (selectedTags.length < 5) {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (createSearchTimerRef.current) clearTimeout(createSearchTimerRef.current);
    if (query.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    createSearchTimerRef.current = setTimeout(async () => {
      try {
        const results = await invoke<EsouiSearchResult[]>("search_esoui_addons", {
          query: query.trim(),
        });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  };

  const handleAddAddon = (entry: PackAddonEntry) => {
    if (addons.some((a) => a.esouiId === entry.esouiId)) {
      toast.error(`"${entry.name}" is already in the pack.`);
      return;
    }
    setAddons([...addons, entry]);
    toast.success(`Added "${entry.name}"`);
  };

  const handleRemoveAddon = (esouiId: number) => {
    setAddons(addons.filter((a) => a.esouiId !== esouiId));
  };

  const handleToggleRequired = (esouiId: number) => {
    setAddons(addons.map((a) => (a.esouiId === esouiId ? { ...a, required: !a.required } : a)));
  };

  const [publishing, setPublishing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);

  const handleLogin = async () => {
    setLoggingIn(true);
    try {
      const user = await invoke<AuthUser>("auth_login");
      onAuthChange(user);
      toast.success(`Signed in as ${user.userName}`);
    } catch (e) {
      toast.error(`Sign in failed: ${e}`);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await invoke("auth_logout");
      onAuthChange(null);
      toast.success("Signed out");
    } catch (e) {
      toast.error(`Sign out failed: ${e}`);
    }
  };

  const handlePublish = async () => {
    if (!title.trim()) {
      toast.error("Pack needs a title.");
      return;
    }
    if (addons.length === 0) {
      toast.error("Add at least one addon.");
      return;
    }
    setPublishing(true);
    try {
      await invoke<Pack>("create_pack", {
        payload: {
          title: title.trim(),
          description: description.trim(),
          packType: packType,
          addons,
          tags: selectedTags,
          isAnonymous,
        },
      });
      toast.success("Pack published!");
      onPublished();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("expired") || msg.includes("sign in")) {
        onAuthChange(null);
      }
      toast.error(`Publish failed: ${msg}`);
    } finally {
      setPublishing(false);
    }
  };

  // Filtered installed addons (only those with ESOUI IDs)
  const filteredInstalled = installedAddons
    .filter((a) => a.esouiId && a.esouiId > 0)
    .filter(
      (a) =>
        !installedFilter ||
        a.title.toLowerCase().includes(installedFilter.toLowerCase()) ||
        a.folderName.toLowerCase().includes(installedFilter.toLowerCase())
    );

  const canProceed = !!title.trim();

  // Auth gate — must be signed in to create packs
  if (!authUser) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="rounded-xl bg-[#c4a44a]/[0.06] border border-[#c4a44a]/[0.1] p-5">
          <PackageIcon className="size-10 text-[#c4a44a]/50" />
        </div>
        <div>
          <p className="font-heading text-sm font-semibold">Sign in to create packs</p>
          <p className="mt-1 text-xs text-muted-foreground/60 max-w-[260px]">
            Sign in with your ESO Logs account to publish addon packs to the community.
          </p>
        </div>
        <Button onClick={handleLogin} disabled={loggingIn} className="mt-1">
          {loggingIn ? (
            <>
              <Loader2Icon className="size-4 animate-spin mr-1.5" />
              Signing in...
            </>
          ) : (
            "Sign in with ESO Logs"
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Signed-in header */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground/60">
          Creating as <span className="text-[#c4a44a] font-semibold">{authUser.userName}</span>
        </span>
        <button
          onClick={handleLogout}
          className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          Sign out
        </button>
      </div>

      {step === "details" ? (
        /* ── Step 1: Pack Details ── */
        <div className="flex flex-col gap-3 overflow-y-auto max-h-[420px] px-3 -mx-3 pr-1">
          <p className="text-sm text-muted-foreground">
            Create an addon pack to share with the community. Search and add addons in the next
            step.
          </p>

          {/* Title */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 block">
              Pack Name <span className="text-red-400">*</span>
            </label>
            <Input
              placeholder="e.g. Trial Essentials, PvP Toolkit"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              autoFocus
            />
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1 h-0.5 rounded bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded bg-[#c4a44a] transition-all duration-300"
                  style={{ width: `${Math.min((title.length / 100) * 100, 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                {title.length}/100
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 block">
              Description
            </label>
            <textarea
              placeholder="What is this pack for? Who should use it?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none dark:bg-input/30 dark:hover:bg-input/50"
            />
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1 h-0.5 rounded bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded bg-[#c4a44a] transition-all duration-300"
                  style={{ width: `${Math.min((description.length / 500) * 100, 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                {description.length}/500
              </span>
            </div>
          </div>

          {/* Pack type */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 block">
              Pack Type
            </label>
            <Select value={packType} onValueChange={(v) => v && setPackType(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="addon-pack">Addon Pack</SelectItem>
                <SelectItem value="build-pack">Build Pack</SelectItem>
                <SelectItem value="roster-pack">Roster Pack</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Tags
              </label>
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  selectedTags.length >= 5 ? "text-amber-400" : "text-muted-foreground/40"
                )}
              >
                {selectedTags.length}/5
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_TAGS.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                const isDisabled = !isSelected && selectedTags.length >= 5;
                return (
                  <button
                    key={tag}
                    onClick={() => !isDisabled && handleTagToggle(tag)}
                    disabled={isDisabled}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-semibold transition-all duration-150",
                      isSelected
                        ? "bg-[#c4a44a]/20 text-[#c4a44a] border border-[#c4a44a]/40"
                        : "bg-white/[0.03] text-muted-foreground/60 border border-white/[0.06] hover:border-white/[0.12] hover:text-muted-foreground",
                      isDisabled && "opacity-30 cursor-not-allowed"
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Next button */}
          <Button onClick={() => setStep("addons")} disabled={!canProceed} className="mt-1">
            Next: Add Addons
            <ArrowLeftIcon className="size-4 ml-1.5 rotate-180" />
          </Button>
        </div>
      ) : (
        /* ── Step 2: Addon Search & Selection ── */
        <div className="flex flex-col gap-3 min-h-0">
          {/* Back + addon count */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep("details")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeftIcon className="size-3" />
              Back to details
            </button>
            {addons.length > 0 && (
              <span className="text-xs text-[#c4a44a] font-semibold">
                {addons.length} addon{addons.length !== 1 ? "s" : ""} selected
              </span>
            )}
          </div>

          {/* Source toggle with animated pill */}
          <div className="relative flex gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <div
              className="absolute top-0.5 bottom-0.5 rounded-md bg-white/[0.08] shadow-sm transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              style={{
                left: addonSource === "search" ? "2px" : "calc(50% + 0px)",
                width: "calc(50% - 2px)",
              }}
            />
            {(["search", "installed"] as AddonSource[]).map((src) => (
              <button
                key={src}
                onClick={() => setAddonSource(src)}
                className={cn(
                  "relative z-10 flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors duration-200",
                  addonSource === src
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                )}
              >
                {src === "search" ? (
                  <>
                    <SearchIcon className="size-3 inline mr-1" />
                    Search ESOUI
                  </>
                ) : (
                  <>
                    <PackageIcon className="size-3 inline mr-1" />
                    My Addons
                  </>
                )}
              </button>
            ))}
          </div>

          {/* Search / Filter input */}
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
            {addonSource === "search" ? (
              <Input
                placeholder="Search ESOUI addons..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
                autoFocus
              />
            ) : (
              <Input
                placeholder="Filter installed addons..."
                value={installedFilter}
                onChange={(e) => setInstalledFilter(e.target.value)}
                className="pl-9"
                autoFocus
              />
            )}
          </div>

          {/* Two-pane layout: results + selected */}
          <div className="flex gap-2 min-h-0 flex-1 overflow-hidden" style={{ maxHeight: 300 }}>
            {/* Left: search results or installed addons */}
            <div className="flex-1 overflow-y-auto space-y-1 min-w-0">
              {addonSource === "search" ? (
                searching ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="inline-block size-5 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="text-center py-8">
                    <SearchIcon className="size-6 mx-auto text-muted-foreground/20 mb-2" />
                    <p className="text-xs text-muted-foreground/50">
                      {searchQuery.length < 2 ? "Type to search ESOUI addons" : "No results found"}
                    </p>
                  </div>
                ) : (
                  searchResults.map((result) => {
                    const alreadyAdded = addons.some((a) => a.esouiId === result.id);
                    return (
                      <button
                        key={result.id}
                        disabled={alreadyAdded}
                        onClick={() =>
                          handleAddAddon({
                            esouiId: result.id,
                            name: result.title,
                            required: true,
                          })
                        }
                        className={cn(
                          "w-full text-left rounded-lg p-2 transition-all duration-150",
                          "border border-transparent",
                          alreadyAdded
                            ? "opacity-40 cursor-not-allowed bg-white/[0.02]"
                            : "hover:bg-white/[0.04] hover:border-white/[0.08] cursor-pointer"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {alreadyAdded ? (
                            <CheckIcon className="size-3.5 text-[#c4a44a] shrink-0" />
                          ) : (
                            <PlusIcon className="size-3.5 text-[#c4a44a] shrink-0" />
                          )}
                          <span className="text-sm font-medium truncate">{result.title}</span>
                          <span className="text-[10px] text-muted-foreground/30 tabular-nums shrink-0">
                            #{result.id}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground/50 mt-0.5 truncate ml-5">
                          by {result.author}
                          {result.category ? ` · ${result.category}` : ""}
                          {result.downloads ? ` · ${result.downloads} downloads` : ""}
                        </p>
                      </button>
                    );
                  })
                )
              ) : filteredInstalled.length === 0 ? (
                <div className="text-center py-8">
                  <PackageIcon className="size-6 mx-auto text-muted-foreground/20 mb-2" />
                  <p className="text-xs text-muted-foreground/50">
                    {installedFilter
                      ? "No matching installed addons"
                      : "No installed addons with ESOUI IDs"}
                  </p>
                </div>
              ) : (
                filteredInstalled.map((addon) => {
                  const alreadyAdded = addons.some((a) => a.esouiId === addon.esouiId);
                  return (
                    <button
                      key={addon.folderName}
                      disabled={alreadyAdded}
                      onClick={() =>
                        handleAddAddon({
                          esouiId: addon.esouiId!,
                          name: addon.title || addon.folderName,
                          required: true,
                        })
                      }
                      className={cn(
                        "w-full text-left rounded-lg p-2 transition-all duration-150",
                        "border border-transparent",
                        alreadyAdded
                          ? "opacity-40 cursor-not-allowed bg-white/[0.02]"
                          : "hover:bg-white/[0.04] hover:border-white/[0.08] cursor-pointer"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {alreadyAdded ? (
                          <CheckIcon className="size-3.5 text-[#c4a44a] shrink-0" />
                        ) : (
                          <PlusIcon className="size-3.5 text-[#c4a44a] shrink-0" />
                        )}
                        <span className="text-sm font-medium truncate">
                          {addon.title || addon.folderName}
                        </span>
                        <span className="text-[10px] text-muted-foreground/30 tabular-nums shrink-0">
                          #{addon.esouiId}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/50 mt-0.5 truncate ml-5">
                        by {addon.author} · v{addon.version}
                      </p>
                    </button>
                  );
                })
              )}
            </div>

            {/* Right: selected addons */}
            <div className="w-[220px] shrink-0 overflow-y-auto border-l border-white/[0.06] pl-2">
              <SectionHeader className="mb-1.5 sticky top-0 bg-background/80 backdrop-blur-sm pb-1">
                Selected ({addons.length})
              </SectionHeader>
              {addons.length === 0 ? (
                <div className="text-center py-6">
                  <PackageIcon className="size-5 mx-auto text-muted-foreground/20 mb-1.5" />
                  <p className="text-[11px] text-muted-foreground/40">Add addons from the left</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {addons.map((addon) => (
                    <div
                      key={addon.esouiId}
                      className={cn(
                        "group/item rounded-lg p-2 transition-all duration-150",
                        "border border-white/[0.04] bg-white/[0.02]",
                        "hover:bg-white/[0.04] hover:border-white/[0.08]"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <p className="text-[11px] font-medium truncate flex-1">{addon.name}</p>
                        <button
                          onClick={() => handleRemoveAddon(addon.esouiId)}
                          className="text-muted-foreground/20 hover:text-red-400 transition-colors p-0.5 opacity-0 group-hover/item:opacity-100"
                          title="Remove"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </div>
                      {/* Required / Optional toggle pill */}
                      <div className="relative flex p-0.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
                        <div
                          className={cn(
                            "absolute top-0.5 bottom-0.5 rounded-[5px] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                            addon.required
                              ? "left-0.5 w-[calc(50%-2px)] bg-[#c4a44a]/20 border border-[#c4a44a]/30"
                              : "left-[calc(50%)] w-[calc(50%-2px)] bg-white/[0.06] border border-white/[0.08]"
                          )}
                        />
                        <button
                          onClick={() => handleToggleRequired(addon.esouiId)}
                          className={cn(
                            "relative z-10 flex-1 text-[10px] font-semibold py-0.5 rounded-[5px] transition-colors duration-150 text-center",
                            addon.required
                              ? "text-[#c4a44a]"
                              : "text-muted-foreground/40 hover:text-muted-foreground/60"
                          )}
                        >
                          Required
                        </button>
                        <button
                          onClick={() => handleToggleRequired(addon.esouiId)}
                          className={cn(
                            "relative z-10 flex-1 text-[10px] font-semibold py-0.5 rounded-[5px] transition-colors duration-150 text-center",
                            !addon.required
                              ? "text-foreground/70"
                              : "text-muted-foreground/40 hover:text-muted-foreground/60"
                          )}
                        >
                          Optional
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Anonymous toggle + Publish button */}
          <div className="flex flex-col gap-2 mt-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground/60 cursor-pointer">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="rounded border-white/20 bg-white/[0.03] accent-[#c4a44a]"
              />
              Publish anonymously
            </label>
            <Button
              onClick={handlePublish}
              disabled={addons.length === 0 || publishing}
              className="w-full"
            >
              {publishing ? (
                <>
                  <Loader2Icon className="size-4 animate-spin mr-1.5" />
                  Publishing...
                </>
              ) : (
                "Publish Pack"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
