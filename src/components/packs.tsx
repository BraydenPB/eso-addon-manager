import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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

interface VoteResponse {
  voted: boolean;
  voteCount: number;
}
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
import { getTauriErrorMessage, invokeOrThrow, invokeResult } from "@/lib/tauri";
import { cn, decodeHtml } from "@/lib/utils";
import {
  PackageIcon,
  DownloadIcon,
  ArrowLeftIcon,
  SearchIcon,
  AlertCircleIcon,
  Loader2Icon,
  PlusIcon,
  XIcon,
  ArrowUpIcon,
  CheckIcon,
  PencilIcon,
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
type SortOption = "votes" | "newest" | "updated";
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

const PACK_TYPE_ACCENT: Record<
  string,
  { border: string; bg: string; hoverBg: string; text: string }
> = {
  "addon-pack": {
    border: "border-l-[#c4a44a]/60",
    bg: "bg-[#c4a44a]/[0.02]",
    hoverBg: "hover:bg-[#c4a44a]/[0.06]",
    text: "text-[#c4a44a]",
  },
  "build-pack": {
    border: "border-l-sky-400/60",
    bg: "bg-sky-400/[0.02]",
    hoverBg: "hover:bg-sky-400/[0.06]",
    text: "text-sky-400",
  },
  "roster-pack": {
    border: "border-l-violet-400/60",
    bg: "bg-violet-400/[0.02]",
    hoverBg: "hover:bg-violet-400/[0.06]",
    text: "text-violet-400",
  },
};

const PACK_TYPE_PILL_COLOR: Record<string, "gold" | "sky" | "violet" | "muted"> = {
  "addon-pack": "gold",
  "build-pack": "sky",
  "roster-pack": "violet",
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
  const [sortMode, setSortMode] = useState<SortOption>("votes");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [confirmInstall, setConfirmInstall] = useState(false);

  const installedEsouiIds = useMemo(
    () => new Set(installedAddons.filter((a) => a.esouiId && a.esouiId > 0).map((a) => a.esouiId!)),
    [installedAddons]
  );

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
  const [createAnonymous, setCreateAnonymous] = useState(false);
  const [editingPackId, setEditingPackId] = useState<string | null>(null);

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

  const loadPacksSeqRef = useRef(0);
  const loadPacks = useCallback(
    async (q: string, page: number = 1) => {
      const seq = ++loadPacksSeqRef.current;
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const result = await invokeOrThrow<PackPage>("list_packs", {
          packType: typeFilter === "all" ? null : typeFilter,
          tag: null,
          query: q || null,
          sort: sortMode,
          page,
        });
        // Discard stale response if a newer request was fired
        if (seq !== loadPacksSeqRef.current) return;
        if (page === 1) {
          setPacks(result.packs);
        } else {
          setPacks((prev) => [...prev, ...result.packs]);
        }
        setCurrentPage(result.page);
        // If the API returned fewer results than the page size, there are no more pages
        const PAGE_SIZE = 10;
        setHasMore(result.packs.length >= PAGE_SIZE);
      } catch (e) {
        if (seq !== loadPacksSeqRef.current) return;
        const msg = getTauriErrorMessage(e);
        if (msg.includes("connect") || msg.includes("internet")) {
          setError("Could not reach Pack Hub. Check your internet connection and try again.");
        } else if (msg.includes("parse") || msg.includes("JSON")) {
          setError("Pack Hub returned an unexpected response. This may be a temporary issue.");
        } else {
          setError("Something went wrong loading packs. Please try again.");
        }
      } finally {
        if (seq === loadPacksSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [typeFilter, sortMode]
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

  const selectPackSeqRef = useRef(0);
  const handleSelectPack = useCallback(async (id: string) => {
    const seq = ++selectPackSeqRef.current;
    setLoadingDetail(true);
    try {
      const pack = await invokeOrThrow<Pack>("get_pack", { id });
      if (seq !== selectPackSeqRef.current) return;
      setSelectedPack(pack);
    } catch (e) {
      if (seq !== selectPackSeqRef.current) return;
      toast.error(`Failed to load pack: ${getTauriErrorMessage(e)}`);
    } finally {
      if (seq === selectPackSeqRef.current) {
        setLoadingDetail(false);
      }
    }
  }, []);

  // Auto-open a specific pack when triggered via deep link
  useEffect(() => {
    if (initialPackId) {
      handleSelectPack(initialPackId);
    }
  }, [initialPackId, handleSelectPack]);

  const handleBack = () => {
    setSelectedPack(null);
    setConfirmInstall(false);
    setInstalling(false);
    setInstallProgress(null);
  };

  const resetCreateForm = useCallback(() => {
    setCreateTitle("");
    setCreateDescription("");
    setCreatePackType("addon-pack");
    setCreateTags([]);
    setCreateAddons([]);
    setCreateAnonymous(false);
    setCreateStep("details");
    setEditingPackId(null);
  }, []);

  const handleStartEditing = useCallback((pack: Pack) => {
    setCreateTitle(decodeHtml(pack.title));
    setCreateDescription(decodeHtml(pack.description));
    setCreatePackType(pack.packType);
    setCreateTags([...pack.tags]);
    setCreateAddons(
      pack.addons.map((addon) => ({
        esouiId: addon.esouiId,
        name: decodeHtml(addon.name),
        required: addon.required,
        note: addon.note ? decodeHtml(addon.note) : undefined,
      }))
    );
    setCreateAnonymous(pack.isAnonymous);
    setCreateStep("details");
    setEditingPackId(pack.id);
    setSelectedPack(null);
    setTab("create");
  }, []);

  const canEditSelectedPack = !!(
    selectedPack &&
    authUser &&
    selectedPack.authorId &&
    selectedPack.authorId === authUser.userId
  );

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

  const newAddonsToInstall = useMemo(
    () =>
      selectedPack
        ? selectedPack.addons.filter(
            (a) => selectedAddons.has(a.esouiId) && !installedEsouiIds.has(a.esouiId)
          )
        : [],
    [selectedPack, selectedAddons, installedEsouiIds]
  );

  const handleInstallPack = async () => {
    if (!selectedPack) return;
    if (newAddonsToInstall.length === 0) {
      toast.info("All selected addons are already installed.");
      return;
    }

    setConfirmInstall(false);
    setInstalling(true);
    setInstallProgress({ completed: 0, failed: 0, total: newAddonsToInstall.length });

    let completed = 0;
    let failed = 0;
    const failedNames: string[] = [];

    for (const addon of newAddonsToInstall) {
      const info = await invokeResult<EsouiAddonInfo>("resolve_esoui_addon", {
        input: String(addon.esouiId),
      });
      if (!info.ok) {
        failed++;
        failedNames.push(addon.name);
        setInstallProgress({ completed, failed, total: newAddonsToInstall.length });
        continue;
      }

      const install = await invokeResult<InstallResult>("install_addon", {
        addonsPath,
        downloadUrl: info.data.downloadUrl,
        esouiId: addon.esouiId,
        esouiTitle: info.data.title,
        esouiVersion: info.data.version,
      });

      if (install.ok) {
        completed++;
      } else {
        failed++;
        failedNames.push(addon.name);
      }

      setInstallProgress({ completed, failed, total: newAddonsToInstall.length });
    }

    setInstalling(false);
    setInstallProgress(null);

    if (failed > 0) {
      toast.warning(
        `Installed ${completed} addon${completed !== 1 ? "s" : ""}, ${failed} failed: ${failedNames.join(", ")}`
      );
    } else {
      toast.success(
        `Installed ${completed} addon${completed !== 1 ? "s" : ""} from "${decodeHtml(selectedPack.title)}"`
      );
    }
    onRefresh();
  };

  // ── Voting ──────────────────────────────────────────────────────────
  const [votingPacks, setVotingPacks] = useState<Set<string>>(new Set());

  const handleVote = async (packId: string) => {
    if (!authUser) {
      toast.error("Sign in to vote on packs.");
      return;
    }
    if (votingPacks.has(packId)) return; // debounce

    // Optimistic update helper
    const applyVote = (pack: Pack): Pack => {
      const willVote = !pack.userVoted;
      return {
        ...pack,
        userVoted: willVote,
        voteCount: pack.voteCount + (willVote ? 1 : -1),
      };
    };

    // Optimistic: update list + detail
    setPacks((prev) => prev.map((p) => (p.id === packId ? applyVote(p) : p)));
    setSelectedPack((prev) => (prev?.id === packId ? applyVote(prev) : prev));

    setVotingPacks((prev) => new Set(prev).add(packId));
    try {
      const result = await invokeOrThrow<VoteResponse>("vote_pack", { packId });
      // Reconcile with server truth
      const reconcile = (pack: Pack): Pack => ({
        ...pack,
        userVoted: result.voted,
        voteCount: result.voteCount,
      });
      setPacks((prev) => prev.map((p) => (p.id === packId ? reconcile(p) : p)));
      setSelectedPack((prev) => (prev?.id === packId ? reconcile(prev) : prev));
    } catch (e) {
      // Revert optimistic update
      const revert = (pack: Pack): Pack => {
        const wasVoted = !pack.userVoted;
        return {
          ...pack,
          userVoted: wasVoted,
          voteCount: pack.voteCount + (wasVoted ? 1 : -1),
        };
      };
      setPacks((prev) => prev.map((p) => (p.id === packId ? revert(p) : p)));
      setSelectedPack((prev) => (prev?.id === packId ? revert(prev) : prev));
      const msg = getTauriErrorMessage(e);
      if (msg.includes("expired") || msg.includes("sign in") || msg.includes("Sign in")) {
        onAuthChange(null);
      }
      toast.error(msg);
    } finally {
      setVotingPacks((prev) => {
        const next = new Set(prev);
        next.delete(packId);
        return next;
      });
    }
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
            {selectedPack ? decodeHtml(selectedPack.title) : "Pack Hub"}
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
                  {t === "browse" ? "Browse Packs" : editingPackId ? "Edit Pack" : "Create Pack"}
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
            installedEsouiIds={installedEsouiIds}
            votingPacks={votingPacks}
            onToggleAddon={handleToggleAddon}
            onSelectAllOptional={(select) => {
              if (!selectedPack) return;
              setSelectedAddons((prev) => {
                const next = new Set(prev);
                for (const a of selectedPack.addons) {
                  if (!a.required) {
                    if (select) next.add(a.esouiId);
                    else next.delete(a.esouiId);
                  }
                }
                return next;
              });
            }}
            onVote={handleVote}
            authUser={authUser}
            canEdit={canEditSelectedPack}
            onEdit={() => selectedPack && handleStartEditing(selectedPack)}
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
            sortMode={sortMode}
            onSortChange={setSortMode}
            onSelectPack={handleSelectPack}
            onLoadMore={handleLoadMore}
            onRetry={() => loadPacks(searchQuery, 1)}
            onVote={handleVote}
            votingPacks={votingPacks}
            authUser={authUser}
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
            isAnonymous={createAnonymous}
            onAnonymousChange={setCreateAnonymous}
            editingPackId={editingPackId}
            onPublished={(pack) => {
              resetCreateForm();
              setSelectedPack(pack);
              setTab("browse");
              loadPacks(searchQuery, 1);
            }}
            onCancelEdit={
              editingPackId
                ? () => {
                    resetCreateForm();
                    setTab("browse");
                    loadPacks(searchQuery, 1);
                  }
                : undefined
            }
          />
        )}

        <DialogFooter>
          {selectedPack ? (
            <>
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              {confirmInstall ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground/60">
                    Install {newAddonsToInstall.length} new addon
                    {newAddonsToInstall.length !== 1 ? "s" : ""}?
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setConfirmInstall(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleInstallPack}>
                    Confirm
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => setConfirmInstall(true)}
                  disabled={installing || newAddonsToInstall.length === 0}
                >
                  {installing ? (
                    <>
                      <Loader2Icon className="size-4 animate-spin mr-1.5" />
                      Installing...
                    </>
                  ) : (
                    <>
                      <DownloadIcon className="size-4 mr-1.5" />
                      {newAddonsToInstall.length === 0
                        ? "All Installed"
                        : `Install ${newAddonsToInstall.length} New Addon${newAddonsToInstall.length !== 1 ? "s" : ""}`}
                    </>
                  )}
                </Button>
              )}
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
  sortMode,
  onSortChange,
  onSelectPack,
  onLoadMore,
  onRetry,
  onVote,
  votingPacks,
  authUser,
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
  sortMode: SortOption;
  onSortChange: (s: SortOption) => void;
  onSelectPack: (id: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onVote: (packId: string) => void;
  votingPacks: Set<string>;
  authUser: AuthUser | null;
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
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="addon-pack">Addon Packs</SelectItem>
            <SelectItem value="build-pack">Build Packs</SelectItem>
            <SelectItem value="roster-pack">Roster Packs</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortMode} onValueChange={(v) => v && onSortChange(v as SortOption)}>
          <SelectTrigger className="w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="votes">Top Voted</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0 max-h-[400px] px-1 -mx-1 py-1 -my-1">
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
          packs.map((pack) => {
            const accent = PACK_TYPE_ACCENT[pack.packType] ?? PACK_TYPE_ACCENT["addon-pack"];
            const pillColor = PACK_TYPE_PILL_COLOR[pack.packType] ?? "muted";
            return (
              <div
                key={pack.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectPack(pack.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectPack(pack.id);
                  }
                }}
                className={cn(
                  "group w-full text-left rounded-xl border border-white/[0.06] p-3",
                  "border-l-[3px] transition-all duration-200 cursor-pointer",
                  accent.border,
                  accent.bg,
                  accent.hoverBg,
                  "hover:border-white/[0.12] hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/50"
                )}
              >
                {/* Top row: title + vote button */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-heading text-sm font-semibold truncate group-hover:text-[#c4a44a] transition-colors duration-200">
                        {decodeHtml(pack.title)}
                      </span>
                      <InfoPill color={pillColor}>
                        {TYPE_LABELS[pack.packType] ?? pack.packType}
                      </InfoPill>
                    </div>
                  </div>
                  {/* Vote button — right-aligned */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onVote(pack.id);
                    }}
                    disabled={votingPacks.has(pack.id)}
                    title={
                      authUser ? (pack.userVoted ? "Remove vote" : "Upvote") : "Sign in to vote"
                    }
                    className={cn(
                      "group/vote relative flex flex-col items-center gap-0.5 text-xs font-semibold rounded-lg px-2 py-1.5 transition-all duration-200 border shrink-0",
                      votingPacks.has(pack.id) && "opacity-60 pointer-events-none",
                      pack.userVoted
                        ? "text-[#c4a44a] bg-[#c4a44a]/[0.12] border-[#c4a44a]/30 hover:bg-[#c4a44a]/[0.2] shadow-[0_0_8px_rgba(196,164,74,0.15)]"
                        : "text-muted-foreground/50 bg-white/[0.03] border-white/[0.06] hover:text-[#c4a44a] hover:border-[#c4a44a]/20 hover:bg-[#c4a44a]/[0.06]"
                    )}
                  >
                    <ArrowUpIcon
                      className={cn(
                        "size-3.5 transition-all duration-200",
                        pack.userVoted
                          ? "-translate-y-[1px]"
                          : "group-hover/vote:-translate-y-[1px]"
                      )}
                      strokeWidth={pack.userVoted ? 2.5 : 2}
                    />
                    <span className="tabular-nums leading-none">
                      {pack.voteCount > 0 ? pack.voteCount : 0}
                    </span>
                  </button>
                </div>

                {/* Description */}
                {pack.description && (
                  <p className="mt-1.5 text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
                    {decodeHtml(pack.description)}
                  </p>
                )}

                {/* Bottom row: tags + meta */}
                <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                  {pack.tags.map((tag) => (
                    <InfoPill key={tag} color={TAG_COLORS[tag] ?? "muted"}>
                      {tag}
                    </InfoPill>
                  ))}
                  {pack.tags.length > 0 && pack.addons.length > 0 && (
                    <span className="text-muted-foreground/20 mx-0.5">·</span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50">
                    <PackageIcon className="size-3" />
                    {pack.addons.length} addon{pack.addons.length !== 1 ? "s" : ""}
                  </span>
                  {!pack.isAnonymous && pack.authorName && (
                    <span className="text-[11px] text-muted-foreground/40 ml-auto inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center size-4 rounded-full text-[8px] font-bold uppercase leading-none",
                          "bg-white/[0.08] text-muted-foreground/60"
                        )}
                      >
                        {[...decodeHtml(pack.authorName)][0]}
                      </span>
                      {decodeHtml(pack.authorName)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
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
  installedEsouiIds,
  votingPacks,
  onToggleAddon,
  onSelectAllOptional,
  onVote,
  authUser,
  canEdit,
  onEdit,
}: {
  pack: Pack | null;
  loading: boolean;
  installing: boolean;
  installProgress: { completed: number; failed: number; total: number } | null;
  selectedAddons: Set<number>;
  installedEsouiIds: Set<number>;
  votingPacks: Set<string>;
  onToggleAddon: (esouiId: number, required: boolean) => void;
  onSelectAllOptional: (select: boolean) => void;
  onVote: (packId: string) => void;
  authUser: AuthUser | null;
  canEdit: boolean;
  onEdit: () => void;
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
      {pack.description && (
        <p className="text-sm text-muted-foreground">{decodeHtml(pack.description)}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <InfoPill color="muted">{TYPE_LABELS[pack.packType] ?? pack.packType}</InfoPill>
        {pack.tags.map((tag) => (
          <InfoPill key={tag} color={TAG_COLORS[tag] ?? "muted"}>
            {tag}
          </InfoPill>
        ))}
        {!pack.isAnonymous && (
          <span className="text-xs text-muted-foreground/50">by {decodeHtml(pack.authorName)}</span>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit} className="ml-auto">
            <PencilIcon className="size-3.5 mr-1.5" />
            Edit
          </Button>
        )}
        <button
          onClick={() => onVote(pack.id)}
          disabled={votingPacks.has(pack.id)}
          title={
            authUser ? (pack.userVoted ? "Remove vote" : "Upvote this pack") : "Sign in to vote"
          }
          className={cn(
            "group/vote relative flex items-center gap-1.5 text-sm font-medium rounded-full px-3 py-1.5 transition-all duration-200 border",
            votingPacks.has(pack.id) && "opacity-60 pointer-events-none",
            pack.userVoted
              ? "text-[#c4a44a] bg-[#c4a44a]/[0.12] border-[#c4a44a]/30 hover:bg-[#c4a44a]/[0.2] shadow-[0_0_12px_rgba(196,164,74,0.15)]"
              : "text-muted-foreground/60 bg-white/[0.03] border-white/[0.08] hover:text-[#c4a44a] hover:border-[#c4a44a]/20 hover:bg-[#c4a44a]/[0.06]"
          )}
        >
          <ArrowUpIcon
            className={cn(
              "size-4 transition-all duration-200",
              pack.userVoted ? "-translate-y-[1px]" : "group-hover/vote:-translate-y-[1px]"
            )}
            strokeWidth={pack.userVoted ? 2.5 : 2}
          />
          <span>{pack.voteCount > 0 ? pack.voteCount : 0}</span>
        </button>
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
                isInstalled={installedEsouiIds.has(addon.esouiId)}
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
            {(() => {
              const allSelected = optionalAddons.every((a) => selectedAddons.has(a.esouiId));
              return (
                <button
                  onClick={() => onSelectAllOptional(!allSelected)}
                  className="text-[10px] text-sky-400/60 font-medium hover:text-sky-400 transition-colors"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              );
            })()}
          </div>
          <div className="space-y-1">
            {optionalAddons.map((addon) => (
              <AddonRow
                key={addon.esouiId}
                addon={addon}
                checked={selectedAddons.has(addon.esouiId)}
                locked={false}
                isInstalled={installedEsouiIds.has(addon.esouiId)}
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
  isInstalled,
  onToggle,
}: {
  addon: PackAddonEntry;
  checked: boolean;
  locked: boolean;
  isInstalled: boolean;
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
          {(checked || locked) && (
            <CheckIcon
              className={cn("size-3.5", locked ? "text-[#c4a44a]/70" : "text-[#c4a44a]")}
            />
          )}
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
            {isInstalled && (
              <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400/60 shrink-0">
                Installed
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
  onTagsChange: (v: string[] | ((prev: string[]) => string[])) => void;
  addons: PackAddonEntry[];
  onAddonsChange: (v: PackAddonEntry[] | ((prev: PackAddonEntry[]) => PackAddonEntry[])) => void;
  isAnonymous: boolean;
  onAnonymousChange: (v: boolean) => void;
  editingPackId: string | null;
  onPublished: (pack: Pack) => void;
  onCancelEdit?: () => void;
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
  isAnonymous,
  onAnonymousChange: setIsAnonymous,
  editingPackId,
  onPublished,
  onCancelEdit,
}: CreateViewProps) {
  // Search
  const [addonSource, setAddonSource] = useState<AddonSource>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EsouiSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const createSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createSearchSeqRef = useRef(0);

  // Clean up search timer on unmount
  useEffect(() => {
    return () => {
      if (createSearchTimerRef.current) clearTimeout(createSearchTimerRef.current);
    };
  }, []);

  // Installed addons filter
  const [installedFilter, setInstalledFilter] = useState("");

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (prev.length >= 5) return prev;
      return [...prev, tag];
    });
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
      const seq = ++createSearchSeqRef.current;
      try {
        const results = await invokeOrThrow<EsouiSearchResult[]>("search_esoui_addons", {
          query: query.trim(),
        });
        if (seq !== createSearchSeqRef.current) return;
        setSearchResults(results);
      } catch (e) {
        if (seq !== createSearchSeqRef.current) return;
        setSearchResults([]);
        toast.error(`Search failed: ${getTauriErrorMessage(e)}`);
      } finally {
        if (seq === createSearchSeqRef.current) {
          setSearching(false);
        }
      }
    }, 400);
  };

  const handleAddAddon = (entry: PackAddonEntry) => {
    let added = false;
    setAddons((prev) => {
      if (prev.some((a) => a.esouiId === entry.esouiId)) return prev;
      added = true;
      return [...prev, entry];
    });
    // Toast after updater so we know the outcome
    // React processes the updater synchronously within setState, so `added` is set by here
    if (added) {
      toast.success(`Added "${entry.name}"`);
    } else {
      toast.error(`"${entry.name}" is already in the pack.`);
    }
  };

  const handleRemoveAddon = (esouiId: number) => {
    setAddons((prev) => prev.filter((a) => a.esouiId !== esouiId));
  };

  const handleToggleRequired = (esouiId: number) => {
    setAddons((prev) =>
      prev.map((a) => (a.esouiId === esouiId ? { ...a, required: !a.required } : a))
    );
  };

  const [publishing, setPublishing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const handleLogin = async () => {
    setLoggingIn(true);
    try {
      const user = await invokeOrThrow<AuthUser>("auth_login");
      onAuthChange(user);
      toast.success(`Signed in as ${user.userName}`);
    } catch (e) {
      toast.error(`Sign in failed: ${getTauriErrorMessage(e)}`);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await invokeOrThrow("auth_logout");
      onAuthChange(null);
      toast.success("Signed out");
    } catch (e) {
      toast.error(`Sign out failed: ${getTauriErrorMessage(e)}`);
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
      const pack = editingPackId
        ? await invokeOrThrow<Pack>("update_pack", {
            payload: {
              id: editingPackId,
              title: title.trim(),
              description: description.trim(),
              packType,
              addons,
              tags: selectedTags,
              isAnonymous,
            },
          })
        : await invokeOrThrow<Pack>("create_pack", {
            payload: {
              title: title.trim(),
              description: description.trim(),
              packType,
              addons,
              tags: selectedTags,
              isAnonymous,
            },
          });
      toast.success(editingPackId ? "Pack updated!" : "Pack published!");
      onPublished(pack);
    } catch (e) {
      const msg = getTauriErrorMessage(e);
      if (msg.includes("expired") || msg.includes("sign in")) {
        onAuthChange(null);
      }
      toast.error(`Publish failed: ${msg}`);
    } finally {
      setPublishing(false);
    }
  };

  // Filtered installed addons (only those with ESOUI IDs)
  const filteredInstalled = useMemo(
    () =>
      installedAddons
        .filter((a) => a.esouiId && a.esouiId > 0)
        .filter(
          (a) =>
            !installedFilter ||
            a.title.toLowerCase().includes(installedFilter.toLowerCase()) ||
            a.folderName.toLowerCase().includes(installedFilter.toLowerCase())
        ),
    [installedAddons, installedFilter]
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
          {editingPackId ? "Editing as " : "Creating as "}
          <span className="text-[#c4a44a] font-semibold">{authUser.userName}</span>
        </span>
        <div className="flex items-center gap-3">
          {editingPackId && onCancelEdit && (
            <button
              onClick={onCancelEdit}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              Cancel edit
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {step === "details" ? (
        /* ── Step 1: Pack Details ── */
        <div className="flex flex-col gap-3 overflow-y-auto max-h-[420px] px-3 -mx-3 pr-1">
          <p className="text-sm text-muted-foreground">
            {editingPackId
              ? "Update your pack details, then review the addon list before saving."
              : "Create an addon pack to share with the community. Search and add addons in the next step."}
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
                  {editingPackId ? "Saving..." : "Publishing..."}
                </>
              ) : editingPackId ? (
                "Save Changes"
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
