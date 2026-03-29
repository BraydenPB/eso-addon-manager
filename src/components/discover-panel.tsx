import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { cn } from "@/lib/utils";

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
        const info = await invoke<EsouiAddonInfo>("resolve_esoui_addon", {
          input: String(id),
        });
        const res = await invoke<InstallResult>("install_addon", {
          addonsPath,
          downloadUrl: info.downloadUrl,
          esouiId: id,
          esouiTitle: info.title,
          esouiVersion: info.version,
        });
        toast.success(`Installed ${res.installedFolders.join(", ")}`);
        onInstalled();
      } catch (e) {
        toast.error(String(e));
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
  subtitle,
}: {
  result: EsouiSearchResult;
  selected: boolean;
  installingId: number | null;
  onSelect: () => void;
  onInstall: () => void;
  subtitle: React.ReactNode;
}) {
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
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {installingId === result.id ? "..." : "Install"}
        </Button>
      </div>
      {subtitle}
    </div>
  );
}

const DISCOVER_TABS: [DiscoverTab, string][] = [
  ["search", "Search"],
  ["categories", "Categories"],
  ["url", "URL / ID"],
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
        {DISCOVER_TABS.map(([tab, label]) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150",
              activeTab === tab
                ? "bg-[#c4a44a]/15 text-[#c4a44a] shadow-[0_0_8px_rgba(196,164,74,0.1),inset_0_1px_0_rgba(255,255,255,0.05)] border border-[#c4a44a]/25"
                : "text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.05] border border-transparent"
            )}
            onClick={() => onTabChange(tab)}
          >
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
      const r = await invoke<EsouiSearchResult[]>("search_esoui_addons", {
        query: searchQuery.trim(),
      });
      if (searchIdRef.current === id) setResults(r);
    } catch (e) {
      if (searchIdRef.current === id) toast.error(String(e));
    } finally {
      if (searchIdRef.current === id) setSearching(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(value), 500);
  };

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
          }}
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <span className="inline-block size-5 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
            <span className="ml-2">Searching...</span>
          </div>
        ) : results.length === 0 && query.trim() ? (
          <div className="py-8 text-center text-muted-foreground text-sm">No results found</div>
        ) : results.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground/50 text-sm">
            Type to search ESOUI
          </div>
        ) : (
          results.map((r) => (
            <DiscoverResultRow
              key={r.id}
              result={r}
              selected={selectedResultId === r.id}
              installingId={installingId}
              onSelect={() => onSelectResult(r)}
              onInstall={() => handleInstall(r.id)}
              subtitle={
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground/60">
                  <span>by {r.author}</span>
                  {r.category && <InfoPill color="muted">{r.category}</InfoPill>}
                </div>
              }
            />
          ))
        )}
      </div>
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
  const { installingId, install: handleInstall } = useAddonInstall(addonsPath, onInstalled);

  useEffect(() => {
    invoke<EsouiCategory[]>("get_esoui_categories")
      .then(setCategories)
      .catch(() => {});
  }, []);

  const loadCategory = async (catId: number, p: number, sort: string) => {
    setLoading(true);
    try {
      const r = await invoke<EsouiSearchResult[]>("browse_esoui_category", {
        categoryId: catId,
        page: p,
        sortBy: sort,
      });
      setResults(r);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (catId: string | null) => {
    if (!catId) return;
    const id = Number(catId);
    setSelectedCategory(id);
    setPage(0);
    onSelectResult(null);
    loadCategory(id, 0, sortBy);
  };

  const handleSortChange = (sort: string | null) => {
    if (!sort) return;
    setSortBy(sort);
    if (selectedCategory) {
      setPage(0);
      loadCategory(selectedCategory, 0, sort);
    }
  };

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
        <Select value={sortBy} onValueChange={handleSortChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="downloads">Most Popular</SelectItem>
            <SelectItem value="newest">Recently Updated</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <span className="inline-block size-5 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
            <span className="ml-2">Loading...</span>
          </div>
        ) : results.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground/50 text-sm">
            {selectedCategory ? "No addons in this category" : "Select a category to browse"}
          </div>
        ) : (
          results.map((r) => (
            <DiscoverResultRow
              key={r.id}
              result={r}
              selected={selectedResultId === r.id}
              installingId={installingId}
              onSelect={() => onSelectResult(r)}
              onInstall={() => handleInstall(r.id)}
              subtitle={
                r.category ? (
                  <div className="mt-0.5 text-xs text-muted-foreground/60">{r.category}</div>
                ) : null
              }
            />
          ))
        )}
      </div>

      {results.length > 0 && (
        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-1.5">
          <Button
            variant="ghost"
            size="xs"
            disabled={page === 0 || loading}
            onClick={() => {
              const p = page - 1;
              setPage(p);
              if (selectedCategory) loadCategory(selectedCategory, p, sortBy);
            }}
          >
            Prev
          </Button>
          <span className="text-[11px] text-muted-foreground/50">Page {page + 1}</span>
          <Button
            variant="ghost"
            size="xs"
            disabled={loading || results.length === 0}
            onClick={() => {
              const p = page + 1;
              setPage(p);
              if (selectedCategory) loadCategory(selectedCategory, p, sortBy);
            }}
          >
            Next
          </Button>
        </div>
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
      const info = await invoke<EsouiAddonInfo>("resolve_esoui_addon", {
        input: input.trim(),
      });
      setAddonInfo(info);
      setState("resolved");
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  };

  const handleInstall = async () => {
    if (!addonInfo) return;
    setState("installing");
    setError(null);
    try {
      const installResult = await invoke<InstallResult>("install_addon", {
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
      setError(String(e));
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

      {(state === "idle" || state === "error") && (
        <Button onClick={handleResolve} disabled={!input.trim()} className="w-full" size="sm">
          Resolve
        </Button>
      )}

      {state === "resolving" && (
        <Button disabled className="w-full" size="sm">
          Resolving...
        </Button>
      )}

      {addonInfo && state === "resolved" && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <div className="font-heading font-medium bg-gradient-to-r from-[#c4a44a] to-[#d4b45a] bg-clip-text text-transparent">
            {addonInfo.title}
          </div>
          <div className="text-xs text-muted-foreground/60">
            ESOUI #{addonInfo.id}
            {addonInfo.version && ` \u00b7 v${addonInfo.version}`}
          </div>
          <Button onClick={handleInstall} className="w-full" size="sm">
            Install
          </Button>
        </div>
      )}

      {state === "installing" && (
        <Button disabled className="w-full" size="sm">
          Installing...
        </Button>
      )}

      {state === "installed" && result && (
        <div className="space-y-2">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-sm text-emerald-400">
            Installed: {result.installedFolders.join(", ")}
          </div>
          {result.installedDeps.length > 0 && (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-sm text-emerald-400">
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
