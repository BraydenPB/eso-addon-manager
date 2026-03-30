import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import type {
  DiscoverTab,
  EsouiSearchResult,
  EsouiCategory,
  EsouiAddonInfo,
  InstallResult,
} from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InfoPill } from "@/components/ui/info-pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getTauriErrorMessage, invokeOrThrow, invokeResult } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
  Download,
  Clock,
  TrendingUp,
  Search,
  FolderOpen,
  Link,
  Flame,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";

const PAGE_SIZE = 25;

interface DiscoverPanelProps {
  activeTab: DiscoverTab;
  onTabChange: (tab: DiscoverTab) => void;
  addonsPath: string;
  onInstalled: () => void;
  onSelectResult: (result: EsouiSearchResult | null) => void;
  selectedResultId: number | null;
}

function useAddonInstall(addonsPath: string, onInstalled: () => void) {
  const [installingId, setInstallingId] = useState<number | null>(null);

  const install = useCallback(
    async (id: number) => {
      setInstallingId(id);
      try {
        const info = await invokeOrThrow<EsouiAddonInfo>("resolve_esoui_addon", {
          input: String(id),
        });
        const res = await invokeOrThrow<InstallResult>("install_addon", {
          addonsPath,
          downloadUrl: info.downloadUrl,
          esouiId: id,
          esouiTitle: info.title,
          esouiVersion: info.version,
        });
        toast.success(`Installed ${res.installedFolders.join(", ")}`);
        onInstalled();
      } catch (e) {
        toast.error(getTauriErrorMessage(e));
      } finally {
        setInstallingId(null);
      }
    },
    [addonsPath, onInstalled]
  );

  return { installingId, install };
}

function DiscoverResultRow({
  result,
  selected,
  installingId,
  onSelect,
  onInstall,
  showMeta = false,
}: {
  result: EsouiSearchResult;
  selected: boolean;
  installingId: number | null;
  onSelect: () => void;
  onInstall: () => void;
  showMeta?: boolean;
}) {
  const isInstalling = installingId === result.id;

  return (
    <div
      className={cn(
        "cursor-pointer border-l-3 border-l-transparent px-4 py-2.5 transition-all duration-200 hover:bg-white/[0.04] group",
        selected &&
          "bg-[#c4a44a]/[0.06] border-l-[#c4a44a]! shadow-[inset_4px_0_16px_-4px_rgba(196,164,74,0.15),inset_0_0_0_1px_rgba(196,164,74,0.08)]"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium">{result.title}</span>
        <Button
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            onInstall();
          }}
          disabled={installingId !== null}
          className={cn(
            "shrink-0 transition-all",
            isInstalling
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          )}
        >
          {isInstalling ? (
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-[#0b1220]/20 border-t-[#0b1220]" />
              Installing
            </span>
          ) : (
            "Install"
          )}
        </Button>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/60">
        <span className="truncate">by {result.author}</span>
        {result.category && <InfoPill color="muted">{result.category}</InfoPill>}
      </div>
      {showMeta && (
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground/40">
          {result.downloads && (
            <span className="flex items-center gap-1">
              <Download className="size-3" />
              {result.downloads}
            </span>
          )}
          {result.updated && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {result.updated}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const DISCOVER_TABS: [DiscoverTab, string, React.FC<{ className?: string }>][] = [
  ["search", "Search", Search],
  ["popular", "Popular", Flame],
  ["categories", "Categories", FolderOpen],
  ["url", "URL / ID", Link],
];

export function DiscoverPanel({
  activeTab,
  onTabChange,
  addonsPath,
  onInstalled,
  onSelectResult,
  selectedResultId,
}: DiscoverPanelProps) {
  return (
    <div className="flex flex-1 flex-col">
      {/* Sub-tab selector */}
      <div
        className="flex gap-1 px-3 pb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Discover mode"
      >
        {DISCOVER_TABS.map(([tab, label, Icon]) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150 flex items-center gap-1.5",
              activeTab === tab
                ? "bg-[#c4a44a]/15 text-[#c4a44a] shadow-[0_0_8px_rgba(196,164,74,0.1),inset_0_1px_0_rgba(255,255,255,0.05)] border border-[#c4a44a]/25"
                : "text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.05] border border-transparent"
            )}
            onClick={() => onTabChange(tab)}
          >
            <Icon className="size-3" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "search" && (
        <SearchContent
          addonsPath={addonsPath}
          onInstalled={onInstalled}
          onSelectResult={onSelectResult}
          selectedResultId={selectedResultId}
        />
      )}
      {activeTab === "popular" && (
        <PopularContent
          addonsPath={addonsPath}
          onInstalled={onInstalled}
          onSelectResult={onSelectResult}
          selectedResultId={selectedResultId}
        />
      )}
      {activeTab === "categories" && (
        <CategoryContent
          addonsPath={addonsPath}
          onInstalled={onInstalled}
          onSelectResult={onSelectResult}
          selectedResultId={selectedResultId}
        />
      )}
      {activeTab === "url" && <UrlContent addonsPath={addonsPath} onInstalled={onInstalled} />}
    </div>
  );
}

/* ── Search Tab ───────────────────────────────────────── */

function SearchContent({
  addonsPath,
  onInstalled,
  onSelectResult,
  selectedResultId,
}: {
  addonsPath: string;
  onInstalled: () => void;
  onSelectResult: (result: EsouiSearchResult | null) => void;
  selectedResultId: number | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EsouiSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const { installingId, install: handleInstall } = useAddonInstall(addonsPath, onInstalled);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = ++searchIdRef.current;
    try {
      const r = await invokeOrThrow<EsouiSearchResult[]>("search_esoui_addons", {
        query: searchQuery.trim(),
      });
      if (searchIdRef.current === id) setResults(r);
    } catch (e) {
      if (searchIdRef.current === id) toast.error(getTauriErrorMessage(e));
    } finally {
      if (searchIdRef.current === id) setSearching(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(value), 500);
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;
      const currentIdx = results.findIndex((r) => r.id === selectedResultId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIdx < results.length - 1 ? currentIdx + 1 : 0;
        onSelectResult(results[next]);
        listRef.current?.querySelectorAll("[data-result-row]")?.[next]?.scrollIntoView({
          block: "nearest",
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = currentIdx > 0 ? currentIdx - 1 : results.length - 1;
        onSelectResult(results[prev]);
        listRef.current?.querySelectorAll("[data-result-row]")?.[prev]?.scrollIntoView({
          block: "nearest",
        });
      }
    },
    [results, selectedResultId, onSelectResult]
  );

  return (
    <>
      <div className="px-3 pb-2">
        <Input
          placeholder="Search ESOUI addons..."
          aria-label="Search ESOUI addons"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch(query);
            handleKeyDown(e);
          }}
          autoFocus
        />
      </div>

      {/* Results count bar */}
      {results.length > 0 && (
        <div className="flex items-center justify-between px-3 pb-1.5">
          <span className="text-[11px] font-heading font-bold uppercase tracking-[0.05em] text-muted-foreground/50">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[11px] text-muted-foreground/30">
            &uarr;&darr; to navigate
          </span>
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {searching ? (
          <LoadingSpinner message="Searching..." />
        ) : results.length === 0 && query.trim() ? (
          <EmptyState
            icon={<Search className="size-8 text-muted-foreground/30" />}
            title="No results found"
            subtitle={`Try different keywords for "${query}"`}
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Search className="size-8 text-muted-foreground/20" />}
            title="Search ESOUI"
            subtitle="Type to find addons by name, author, or keyword"
          />
        ) : (
          results.map((r) => (
            <div key={r.id} data-result-row>
              <DiscoverResultRow
                result={r}
                selected={selectedResultId === r.id}
                installingId={installingId}
                onSelect={() => onSelectResult(r)}
                onInstall={() => handleInstall(r.id)}
                showMeta
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ── Popular Tab ─────────────────────────────────────── */

type PopularSort = "downloads" | "newest";

function PopularContent({
  addonsPath,
  onInstalled,
  onSelectResult,
  selectedResultId,
}: {
  addonsPath: string;
  onInstalled: () => void;
  onSelectResult: (result: EsouiSearchResult | null) => void;
  selectedResultId: number | null;
}) {
  const [sortBy, setSortBy] = useState<PopularSort>("downloads");
  const [results, setResults] = useState<EsouiSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const { installingId, install: handleInstall } = useAddonInstall(addonsPath, onInstalled);
  const listRef = useRef<HTMLDivElement>(null);

  const loadPopular = useCallback(async (p: number, sort: PopularSort) => {
    setLoading(true);
    try {
      // Use category 0 (all) to get popular addons across all categories
      const r = await invokeOrThrow<EsouiSearchResult[]>("browse_esoui_category", {
        categoryId: 0,
        page: p,
        sortBy: sort,
      });
      setResults(r);
    } catch (e) {
      toast.error(getTauriErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadPopular(0, "downloads");
  }, [loadPopular]);

  const handleSortChange = (sort: string | null) => {
    if (!sort) return;
    setSortBy(sort as PopularSort);
    setPage(0);
    onSelectResult(null);
    loadPopular(0, sort as PopularSort);
  };

  return (
    <>
      <div className="px-3 pb-2">
        <div className="flex gap-1.5">
          <button
            className={cn(
              "flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 flex items-center justify-center gap-1.5",
              sortBy === "downloads"
                ? "bg-[#c4a44a]/15 text-[#c4a44a] border border-[#c4a44a]/25"
                : "text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.05] border border-white/[0.06]"
            )}
            onClick={() => handleSortChange("downloads")}
          >
            <TrendingUp className="size-3" />
            Most Popular
          </button>
          <button
            className={cn(
              "flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 flex items-center justify-center gap-1.5",
              sortBy === "newest"
                ? "bg-[#c4a44a]/15 text-[#c4a44a] border border-[#c4a44a]/25"
                : "text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.05] border border-white/[0.06]"
            )}
            onClick={() => handleSortChange("newest")}
          >
            <Clock className="size-3" />
            Recently Updated
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingSpinner message="Loading popular addons..." />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Flame className="size-8 text-muted-foreground/20" />}
            title="No addons found"
            subtitle="Could not load popular addons"
          />
        ) : (
          results.map((r, idx) => (
            <div key={r.id} data-result-row className="relative">
              {/* Rank indicator */}
              <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10">
                <span
                  className={cn(
                    "text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full",
                    idx + page * PAGE_SIZE < 3
                      ? "text-[#c4a44a] bg-[#c4a44a]/10"
                      : "text-muted-foreground/30"
                  )}
                >
                  {idx + 1 + page * PAGE_SIZE}
                </span>
              </div>
              <div className="pl-3">
                <DiscoverResultRow
                  result={r}
                  selected={selectedResultId === r.id}
                  installingId={installingId}
                  onSelect={() => onSelectResult(r)}
                  onInstall={() => handleInstall(r.id)}
                  showMeta
                />
              </div>
            </div>
          ))
        )}
      </div>

      {results.length > 0 && (
        <PaginationBar
          page={page}
          loading={loading}
          isLastPage={results.length < PAGE_SIZE}
          onPrev={() => {
            const p = page - 1;
            setPage(p);
            loadPopular(p, sortBy);
            listRef.current?.scrollTo(0, 0);
          }}
          onNext={() => {
            const p = page + 1;
            setPage(p);
            loadPopular(p, sortBy);
            listRef.current?.scrollTo(0, 0);
          }}
        />
      )}
    </>
  );
}

/* ── Categories Tab ───────────────────────────────────── */

function CategoryContent({
  addonsPath,
  onInstalled,
  onSelectResult,
  selectedResultId,
}: {
  addonsPath: string;
  onInstalled: () => void;
  onSelectResult: (result: EsouiSearchResult | null) => void;
  selectedResultId: number | null;
}) {
  const [categories, setCategories] = useState<EsouiCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState("downloads");
  const [results, setResults] = useState<EsouiSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [filterText, setFilterText] = useState("");
  const { installingId, install: handleInstall } = useAddonInstall(addonsPath, onInstalled);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void invokeResult<EsouiCategory[]>("get_esoui_categories").then((result) => {
      if (result.ok) {
        setCategories(result.data);
      } else {
        toast.error(`Failed to load categories: ${result.error}`);
      }
    });
  }, []);

  const loadCategory = useCallback(async (catId: number, p: number, sort: string) => {
    setLoading(true);
    try {
      const r = await invokeOrThrow<EsouiSearchResult[]>("browse_esoui_category", {
        categoryId: catId,
        page: p,
        sortBy: sort,
      });
      setResults(r);
    } catch (e) {
      toast.error(getTauriErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCategoryChange = (catId: string | null) => {
    if (!catId) return;
    const id = Number(catId);
    setSelectedCategory(id);
    setPage(0);
    setFilterText("");
    onSelectResult(null);
    loadCategory(id, 0, sortBy);
  };

  const handleSortChange = (sort: string | null) => {
    if (!sort) return;
    setSortBy(sort);
    setFilterText("");
    if (selectedCategory) {
      setPage(0);
      loadCategory(selectedCategory, 0, sort);
    }
  };

  const filteredResults = useMemo(() => {
    if (!filterText.trim()) return results;
    const q = filterText.toLowerCase();
    return results.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q)
    );
  }, [results, filterText]);

  const selectedCategoryName = useMemo(
    () => categories.find((c) => c.id === selectedCategory)?.name ?? null,
    [categories, selectedCategory]
  );

  return (
    <>
      <div className="space-y-2 px-3 pb-2">
        <Select onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a category..." />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={String(cat.id)}>
                {cat.depth > 0 ? `${"  ".repeat(cat.depth)}${cat.name}` : cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="downloads">Most Popular</SelectItem>
              <SelectItem value="newest">Recently Updated</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Inline filter for results */}
        {results.length > 0 && (
          <Input
            placeholder={`Filter ${selectedCategoryName ?? "results"}...`}
            aria-label="Filter category results"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="h-7 text-xs"
          />
        )}
      </div>

      {/* Results count */}
      {results.length > 0 && (
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-[11px] font-heading font-bold uppercase tracking-[0.05em] text-muted-foreground/50">
            {filterText
              ? `${filteredResults.length} of ${results.length}`
              : results.length}{" "}
            addon{(filterText ? filteredResults.length : results.length) !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingSpinner message="Loading..." />
        ) : filteredResults.length === 0 && filterText ? (
          <EmptyState
            icon={<Search className="size-8 text-muted-foreground/20" />}
            title="No matches"
            subtitle={`No addons matching "${filterText}" in this page`}
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="size-8 text-muted-foreground/20" />}
            title={selectedCategory ? "No addons in this category" : "Browse Categories"}
            subtitle={
              selectedCategory
                ? "Try a different category or sort order"
                : "Select a category above to explore addons"
            }
          />
        ) : (
          filteredResults.map((r) => (
            <DiscoverResultRow
              key={r.id}
              result={r}
              selected={selectedResultId === r.id}
              installingId={installingId}
              onSelect={() => onSelectResult(r)}
              onInstall={() => handleInstall(r.id)}
              showMeta
            />
          ))
        )}
      </div>

      {results.length > 0 && !filterText && (
        <PaginationBar
          page={page}
          loading={loading}
          isLastPage={results.length < PAGE_SIZE}
          onPrev={() => {
            const p = page - 1;
            setPage(p);
            if (selectedCategory) loadCategory(selectedCategory, p, sortBy);
            listRef.current?.scrollTo(0, 0);
          }}
          onNext={() => {
            const p = page + 1;
            setPage(p);
            if (selectedCategory) loadCategory(selectedCategory, p, sortBy);
            listRef.current?.scrollTo(0, 0);
          }}
        />
      )}
    </>
  );
}

/* ── URL / ID Tab ─────────────────────────────────────── */

function UrlContent({ addonsPath, onInstalled }: { addonsPath: string; onInstalled: () => void }) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<
    "idle" | "resolving" | "resolved" | "installing" | "installed" | "error"
  >("idle");
  const [addonInfo, setAddonInfo] = useState<EsouiAddonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);

  const handleResolve = async () => {
    if (!input.trim()) return;
    setState("resolving");
    setError(null);
    try {
      const info = await invokeOrThrow<EsouiAddonInfo>("resolve_esoui_addon", {
        input: input.trim(),
      });
      setAddonInfo(info);
      setState("resolved");
    } catch (e) {
      setError(getTauriErrorMessage(e));
      setState("error");
    }
  };

  const handleInstall = async () => {
    if (!addonInfo) return;
    setState("installing");
    setError(null);
    try {
      const installResult = await invokeOrThrow<InstallResult>("install_addon", {
        addonsPath,
        downloadUrl: addonInfo.downloadUrl,
        esouiId: addonInfo.id,
        esouiTitle: addonInfo.title,
        esouiVersion: addonInfo.version,
      });
      setResult(installResult);
      setState("installed");
      toast.success(`Installed ${installResult.installedFolders.join(", ")}`);
      onInstalled();
    } catch (e) {
      setError(getTauriErrorMessage(e));
      setState("error");
    }
  };

  const busy = state === "resolving" || state === "installing";

  return (
    <div className="flex-1 overflow-y-auto px-3 space-y-3">
      <div>
        <label htmlFor="esoui-input" className="mb-1 block text-xs text-muted-foreground/60">
          ESOUI URL or Addon ID
        </label>
        <Input
          id="esoui-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (state !== "idle" && state !== "error") {
              setState("idle");
              setAddonInfo(null);
              setResult(null);
            }
          }}
          placeholder="https://esoui.com/... or 123"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (state === "idle" || state === "error")) handleResolve();
          }}
          autoFocus
        />
      </div>

      <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-3 space-y-2">
        <div className="text-[11px] font-heading font-bold uppercase tracking-[0.05em] text-muted-foreground/40">
          Supported formats
        </div>
        <div className="space-y-1 text-xs text-muted-foreground/50">
          <div className="flex items-center gap-2">
            <span className="text-[#c4a44a]/60">1.</span>
            <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px]">
              https://esoui.com/downloads/info123
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#c4a44a]/60">2.</span>
            <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px]">123</code>
            <span className="text-muted-foreground/30">(addon ID)</span>
          </div>
        </div>
      </div>

      {(state === "idle" || state === "error") && (
        <Button onClick={handleResolve} disabled={!input.trim()} className="w-full" size="sm">
          Resolve
        </Button>
      )}

      {state === "resolving" && (
        <Button disabled className="w-full" size="sm">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-[#0b1220]/20 border-t-[#0b1220] mr-2" />
          Resolving...
        </Button>
      )}

      {addonInfo && state === "resolved" && (
        <div className="rounded-xl border border-[#c4a44a]/15 bg-[#c4a44a]/[0.03] p-3 space-y-2">
          <div className="font-heading font-medium bg-gradient-to-r from-[#c4a44a] to-[#d4b45a] bg-clip-text text-transparent">
            {addonInfo.title}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
            <span>ESOUI #{addonInfo.id}</span>
            {addonInfo.version && <span>v{addonInfo.version}</span>}
            {addonInfo.updated && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {addonInfo.updated}
              </span>
            )}
          </div>
          <Button onClick={handleInstall} className="w-full" size="sm">
            Install
          </Button>
        </div>
      )}

      {state === "installing" && (
        <Button disabled className="w-full" size="sm">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-[#0b1220]/20 border-t-[#0b1220] mr-2" />
          Installing...
        </Button>
      )}

      {state === "installed" && result && (
        <div className="space-y-2">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-sm text-emerald-400 flex items-center gap-2">
            <Check className="size-4 shrink-0" />
            Installed: {result.installedFolders.join(", ")}
          </div>
          {result.installedDeps.length > 0 && (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-sm text-emerald-400 flex items-center gap-2">
              <Check className="size-4 shrink-0" />
              Deps: {result.installedDeps.join(", ")}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/[0.04] p-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

/* ── Shared Components ────────────────────────────────── */

function LoadingSpinner({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
      <div className="relative">
        <span className="inline-block size-6 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
        <span className="absolute inset-0 inline-block size-6 animate-spin rounded-full border-2 border-transparent border-b-[#c4a44a]/30" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
      </div>
      <span className="text-sm">{message}</span>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 px-6">
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 shadow-[0_0_30px_rgba(196,164,74,0.03)]">
        {icon}
      </div>
      <div className="text-center">
        <p className="font-heading text-sm font-medium text-foreground/70">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground/40 max-w-[200px]">{subtitle}</p>
      </div>
    </div>
  );
}

function PaginationBar({
  page,
  loading,
  isLastPage,
  onPrev,
  onNext,
}: {
  page: number;
  loading: boolean;
  isLastPage: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-1.5">
      <Button variant="ghost" size="xs" disabled={page === 0 || loading} onClick={onPrev}>
        <ChevronLeft className="size-3" />
        Prev
      </Button>
      <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
        Page {page + 1}
      </span>
      <Button variant="ghost" size="xs" disabled={loading || isLastPage} onClick={onNext}>
        Next
        <ChevronRight className="size-3" />
      </Button>
    </div>
  );
}
