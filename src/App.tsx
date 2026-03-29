import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useAppUpdate, AppUpdateBanner } from "./components/app-update";
import { AddonList } from "./components/addon-list";
import { AddonDetail } from "./components/addon-detail";
import { DiscoverDetail } from "./components/discover-detail";
import { Profiles } from "./components/profiles";
import { Packs } from "./components/packs";
import { Backups } from "./components/backups";
import { ApiCompat } from "./components/api-compat";
import { Characters } from "./components/characters";
import { Settings } from "./components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { getSetting, setSetting } from "@/lib/store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  RefreshCwIcon,
  SettingsIcon,
  MinusIcon,
  SquareIcon,
  XIcon,
  PackageIcon,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import type {
  AddonManifest,
  AuthUser,
  UpdateCheckResult,
  InstallResult,
  EsouiSearchResult,
  SortMode,
  FilterMode,
  ViewMode,
  DiscoverTab,
} from "./types";

function App() {
  const [addonsPath, setAddonsPath] = useState<string>("");
  const [addons, setAddons] = useState<AddonManifest[]>([]);
  const [selectedAddon, setSelectedAddon] = useState<AddonManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [activeDialog, setActiveDialog] = useState<
    "settings" | "profiles" | "packs" | "backups" | "api-compat" | "characters" | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [updateResults, setUpdateResults] = useState<UpdateCheckResult[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{
    completed: number;
    failed: number;
    total: number;
  } | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  // Auth
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  // Deep link: pack ID to auto-open
  const [deepLinkPackId, setDeepLinkPackId] = useState<string | null>(null);

  // Navigation
  const [viewMode, setViewMode] = useState<ViewMode>("installed");
  const [discoverTab, setDiscoverTab] = useState<DiscoverTab>("search");
  const [selectedDiscoverResult, setSelectedDiscoverResult] = useState<EsouiSearchResult | null>(
    null
  );

  // App auto-update
  const {
    state: appUpdateState,
    checkForAppUpdate,
    downloadAndInstall,
    restartApp,
  } = useAppUpdate();

  // Online/offline detection
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Deep link listener: eso-addon-manager://pack/{id}
  useEffect(() => {
    const unlisten = listen<string>("deep-link-pack", (event) => {
      setDeepLinkPackId(event.payload);
      setActiveDialog("packs");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Batch selection
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [batchRemoving, setBatchRemoving] = useState(false);

  // Ref for stable closure in scanAddons
  const selectedAddonRef = useRef(selectedAddon);
  selectedAddonRef.current = selectedAddon;

  const checkForUpdates = useCallback(async (path: string, autoUpdate = false) => {
    setCheckingUpdates(true);
    try {
      const results = await invoke<UpdateCheckResult[]>("check_for_updates", {
        addonsPath: path,
      });
      setUpdateResults(results);
      const updates = results.filter((r) => r.hasUpdate);

      if (autoUpdate && updates.length > 0) {
        toast.info(`Auto-updating ${updates.length} addon${updates.length > 1 ? "s" : ""}...`);
        setUpdatingAll(true);
        setUpdateProgress({ completed: 0, failed: 0, total: updates.length });
        let completed = 0;
        let failed = 0;
        // Sequential updates to avoid metadata race condition
        // (concurrent load/save overwrites previous updates)
        for (const u of updates) {
          try {
            await invoke<InstallResult>("update_addon", {
              addonsPath: path,
              esouiId: u.esouiId,
              apiVersion: u.remoteVersion,
            });
            completed++;
          } catch {
            failed++;
          }
          setUpdateProgress({ completed, failed, total: updates.length });
        }
        setUpdatingAll(false);
        setUpdateProgress(null);
        if (failed > 0) {
          toast.warning(
            `Auto-updated ${completed} addon${completed !== 1 ? "s" : ""}, ${failed} failed`
          );
        } else if (completed > 0) {
          toast.success(`Auto-updated ${completed} addon${completed !== 1 ? "s" : ""}`);
        }
        // Clear update results for successfully updated addons and re-scan
        setUpdateResults((prev) => {
          const updatedIds = new Set(updates.map((u) => u.esouiId));
          return prev.filter((r) => !updatedIds.has(r.esouiId));
        });
        // Re-scan to pick up new versions (inline to avoid circular dep)
        try {
          const refreshed = await invoke<AddonManifest[]>("scan_installed_addons", {
            addonsPath: path,
          });
          setAddons(refreshed);
          if (selectedAddonRef.current) {
            const updated = refreshed.find(
              (a) => a.folderName === selectedAddonRef.current!.folderName
            );
            setSelectedAddon(updated ?? null);
          }
        } catch {
          // Non-critical
        }
      } else if (updates.length > 0) {
        toast.info(`${updates.length} update${updates.length > 1 ? "s" : ""} available`);
      }
    } catch {
      // Silently fail — update checks are non-critical
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  const scanAddons = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<AddonManifest[]>("scan_installed_addons", {
        addonsPath: path,
      });
      setAddons(result);
      if (selectedAddonRef.current) {
        const updated = result.find((a) => a.folderName === selectedAddonRef.current!.folderName);
        setSelectedAddon(updated ?? null);
      }
    } catch (e) {
      setError(String(e));
      setAddons([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const scanAndCheck = useCallback(
    async (path: string) => {
      await scanAddons(path);
      checkForUpdates(path);
    },
    [scanAddons, checkForUpdates]
  );

  // Guards to prevent double-init in React StrictMode
  const initRan = useRef(false);

  // Auto-link untracked addons on first load
  const autoLinkRan = useRef(false);
  const runAutoLink = useCallback(
    async (path: string) => {
      if (autoLinkRan.current) return;
      autoLinkRan.current = true;
      try {
        const result = await invoke<{ linked: string[]; notFound: string[] }>("auto_link_addons", {
          addonsPath: path,
        });
        if (result.linked.length > 0) {
          toast.success(
            `Auto-linked ${result.linked.length} addon${result.linked.length > 1 ? "s" : ""} to ESOUI`
          );
          // Re-scan to pick up new ESOUI IDs (but don't re-check for updates
          // since checkForUpdates already ran — avoids duplicate toasts)
          scanAddons(path);
        }
      } catch {
        // Non-critical
      }
    },
    [scanAddons]
  );

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;

    async function init() {
      const savedSort = await getSetting<SortMode>("sortMode", "name");
      const savedFilter = await getSetting<FilterMode>("filterMode", "all");
      setSortMode(savedSort);
      setFilterMode(savedFilter);

      // Restore auth session
      try {
        const user = await invoke<AuthUser | null>("auth_get_user");
        setAuthUser(user ?? null);
      } catch {
        // Auth restore is non-critical
      }

      const savedPath = await getSetting<string>("addonsPath", "");
      try {
        let path = savedPath;
        if (!path) {
          path = await invoke<string>("detect_addons_folder");
        }
        setAddonsPath(path);
        await invoke("set_addons_path", { addonsPath: path });
        await setSetting("addonsPath", path);
        await scanAddons(path);
        const autoUpdate = await getSetting<boolean>("autoUpdate", false);
        await checkForUpdates(path, autoUpdate);
        // Auto-link after initial scan (must wait for auto-updates to finish
        // first, otherwise its check_for_updates call can overwrite metadata)
        runAutoLink(path);
      } catch {
        setError("Could not detect ESO AddOns folder. Please set it in Settings.");
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts — use refs to avoid re-registering the listener on state changes
  const addonsPathRef = useRef(addonsPath);
  addonsPathRef.current = addonsPath;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "r") {
        e.preventDefault();
        if (addonsPathRef.current) scanAndCheck(addonsPathRef.current);
      }
      if (e.ctrlKey && e.key === "i") {
        e.preventDefault();
        setViewMode("discover");
        setDiscoverTab("url");
      }
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        setViewMode("discover");
        setDiscoverTab("search");
      }
      if (e.key === "Escape") {
        if (viewModeRef.current === "discover") {
          setViewMode("installed");
        }
        setSelectedFolders(new Set());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [scanAndCheck]);

  const handleRefresh = () => {
    if (addonsPath) {
      scanAndCheck(addonsPath);
    }
  };

  const handleTagsChange = useCallback(
    async (folderName: string, tags: string[]) => {
      try {
        await invoke("set_addon_tags", { addonsPath, folderName, tags });
        // Update local state without a full rescan
        setAddons((prev) => prev.map((a) => (a.folderName === folderName ? { ...a, tags } : a)));
        // Keep selectedAddon in sync
        setSelectedAddon((prev) => (prev?.folderName === folderName ? { ...prev, tags } : prev));
      } catch (e) {
        toast.error(`Failed to save tags: ${e}`);
      }
    },
    [addonsPath]
  );

  // Lightweight refresh after a single addon update — just rescan
  // manifests and clear that addon's update result without re-checking
  // every addon against ESOUI (which takes 15+ seconds).
  const handleAddonUpdated = useCallback(
    (esouiId: number) => {
      if (addonsPath) {
        scanAddons(addonsPath);
      }
      setUpdateResults((prev) => prev.filter((r) => r.esouiId !== esouiId));
    },
    [addonsPath, scanAddons]
  );

  const handlePathChange = async (newPath: string) => {
    setAddonsPath(newPath);
    setSelectedAddon(null);
    setUpdateResults([]);
    await invoke("set_addons_path", { addonsPath: newPath });
    setSetting("addonsPath", newPath);
    scanAndCheck(newPath);
  };

  const handleSortChange = (mode: SortMode) => {
    setSortMode(mode);
    setSetting("sortMode", mode);
  };

  const handleFilterChange = (mode: FilterMode) => {
    setFilterMode(mode);
    setSetting("filterMode", mode);
  };

  const updatesAvailable = useMemo(() => updateResults.filter((r) => r.hasUpdate), [updateResults]);

  const runBatchUpdates = async (updates: UpdateCheckResult[]) => {
    const path = addonsPathRef.current;
    setUpdatingAll(true);
    setUpdateProgress({ completed: 0, failed: 0, total: updates.length });

    let completed = 0;
    let failed = 0;

    // Sequential updates to avoid metadata race condition
    // (concurrent load/save overwrites previous updates)
    for (const update of updates) {
      try {
        await invoke<InstallResult>("update_addon", {
          addonsPath: path,
          esouiId: update.esouiId,
          apiVersion: update.remoteVersion,
        });
        completed++;
      } catch {
        failed++;
      }
      setUpdateProgress({ completed, failed, total: updates.length });
    }

    setUpdatingAll(false);
    setUpdateProgress(null);

    if (failed > 0) {
      toast.warning(`Updated ${completed} addon${completed !== 1 ? "s" : ""}, ${failed} failed`);
    } else {
      toast.success(`Updated ${completed} addon${completed !== 1 ? "s" : ""}`);
    }
    if (path) scanAddons(path);
    setUpdateResults((prev) => {
      const updatedIds = new Set(updates.map((u) => u.esouiId));
      return prev.filter((r) => !updatedIds.has(r.esouiId));
    });
  };

  const handleUpdateAll = () => runBatchUpdates(updatesAvailable);

  // Batch operations
  const handleToggleSelect = (folderName: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  };

  const handleBatchRemove = async () => {
    if (selectedFolders.size === 0) return;
    setBatchRemoving(true);
    try {
      const removed = await invoke<string[]>("batch_remove_addons", {
        addonsPath,
        folderNames: Array.from(selectedFolders),
      });
      toast.success(`Removed ${removed.length} addon${removed.length !== 1 ? "s" : ""}`);
      setSelectedFolders(new Set());
      setSelectedAddon(null);
      handleRefresh();
    } catch (e) {
      toast.error(`Batch remove failed: ${e}`);
    } finally {
      setBatchRemoving(false);
    }
  };

  const handleBatchUpdate = async () => {
    const toUpdate = updatesAvailable.filter((u) => selectedFolders.has(u.folderName));
    if (toUpdate.length === 0) {
      toast.info("No selected addons have updates available");
      return;
    }
    await runBatchUpdates(toUpdate);
    setSelectedFolders(new Set());
  };

  const updatesSet = useMemo(
    () => new Set(updateResults.filter((r) => r.hasUpdate).map((r) => r.folderName)),
    [updateResults]
  );

  // Active tag filter (when filterMode is "tagged", filter by this tag)
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  const filteredAddons = useMemo(
    () =>
      addons
        .filter((addon) => {
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const matchesSearch =
              addon.title.toLowerCase().includes(q) ||
              addon.folderName.toLowerCase().includes(q) ||
              addon.author.toLowerCase().includes(q) ||
              addon.tags.some((t) => t.toLowerCase().includes(q));
            if (!matchesSearch) return false;
          }
          switch (filterMode) {
            case "addons":
              return !addon.isLibrary;
            case "libraries":
              return addon.isLibrary;
            case "outdated":
              return updatesSet.has(addon.folderName);
            case "missing-deps":
              return addon.missingDependencies.length > 0;
            case "favorites":
              return addon.tags.includes("favorite");
            case "tagged":
              return activeTagFilter ? addon.tags.includes(activeTagFilter) : addon.tags.length > 0;
            case "untracked":
              return !addon.esouiId;
            default:
              return true;
          }
        })
        .sort((a, b) => {
          switch (sortMode) {
            case "author":
              return a.author.toLowerCase().localeCompare(b.author.toLowerCase());
            case "name":
            default:
              return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
          }
        }),
    [addons, searchQuery, filterMode, sortMode, updatesSet, activeTagFilter]
  );

  const selectedUpdateResult = useMemo(
    () =>
      selectedAddon
        ? (updateResults.find((r) => r.folderName === selectedAddon.folderName) ?? null)
        : null,
    [updateResults, selectedAddon]
  );

  const batchMode = selectedFolders.size > 0;

  return (
    <div className="relative flex h-screen flex-col">
      {/* Ambient background orbs — gives glass morphism something to distort */}
      <div className="fixed inset-0 -z-10 overflow-hidden bg-[#060c18]">
        <div className="absolute -top-[15%] -left-[10%] h-[600px] w-[600px] rounded-full bg-[#c4a44a]/20 blur-[120px] animate-[orb-drift_25s_ease-in-out_infinite]" />
        <div className="absolute -bottom-[20%] -right-[10%] h-[500px] w-[500px] rounded-full bg-sky-500/15 blur-[120px] animate-[orb-drift_20s_ease-in-out_infinite_reverse]" />
        <div className="absolute top-[30%] left-[40%] h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[100px] animate-[orb-drift_30s_ease-in-out_infinite]" />
      </div>

      <header
        data-tauri-drag-region
        className="relative flex items-center border-b border-white/[0.06] bg-[rgba(10,18,36,0.85)] backdrop-blur-xl backdrop-saturate-[1.2] px-4 py-2 select-none shadow-[0_4px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]"
      >
        {/* Bottom glow line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#c4a44a]/30 to-transparent" />
        <div className="flex items-center gap-2">
          <Logo size={20} className="text-[#4dc2e6]" />
          <h1 className="font-heading text-sm font-semibold tracking-wide bg-gradient-to-r from-[#c4a44a] to-[#d4b45a] bg-clip-text text-transparent">
            ESOTK.COM - Addon Manager
          </h1>
        </div>
        <div className="flex-1" data-tauri-drag-region />
        <div className="flex items-center gap-2">
          {batchMode ? (
            <>
              <span className="mr-2 text-xs text-primary font-medium">
                {selectedFolders.size} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBatchUpdate}
                disabled={updatingAll}
              >
                {updatingAll ? "Updating..." : "Update Selected"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleBatchRemove}
                disabled={batchRemoving}
              >
                {batchRemoving ? "Removing..." : "Remove Selected"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedFolders(new Set())}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span
                className="mr-1 text-xs text-muted-foreground/50"
                aria-live="polite"
                aria-atomic="true"
              >
                {addons.length} addons
                {checkingUpdates && (
                  <span className="ml-1 inline-flex items-center gap-1">
                    \u00b7{" "}
                    <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleRefresh}
                disabled={loading}
                aria-label="Refresh addons"
                title="Refresh (Ctrl+R)"
              >
                <RefreshCwIcon className={loading ? "animate-spin" : ""} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setActiveDialog("packs")}
                aria-label="Addon Packs"
                title="Addon Packs"
              >
                <PackageIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setActiveDialog("settings")}
                aria-label="Settings"
                title="Settings"
              >
                <SettingsIcon />
              </Button>
            </>
          )}
        </div>
        {/* Window controls */}
        <div className="flex items-center ml-3 -mr-2">
          <button
            onClick={() => getCurrentWindow().minimize()}
            className="flex items-center justify-center w-8 h-8 text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.06] transition-colors"
            aria-label="Minimize"
          >
            <MinusIcon className="size-3.5" />
          </button>
          <button
            onClick={() => getCurrentWindow().toggleMaximize()}
            className="flex items-center justify-center w-8 h-8 text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.06] transition-colors"
            aria-label="Maximize"
          >
            <SquareIcon className="size-3" />
          </button>
          <button
            onClick={() => getCurrentWindow().close()}
            className="flex items-center justify-center w-8 h-8 text-muted-foreground/60 hover:text-foreground hover:bg-red-500/20 transition-colors rounded-tr-sm"
            aria-label="Close"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          {error}
        </Alert>
      )}

      {isOffline && (
        <Alert className="rounded-none border-x-0 border-t-0 bg-muted/50 text-muted-foreground">
          You're offline — some features may be unavailable
        </Alert>
      )}

      <AppUpdateBanner
        state={appUpdateState}
        onDownload={downloadAndInstall}
        onRestart={restartApp}
      />

      {/* Update banner */}
      {(updatesAvailable.length > 0 || updatingAll) && (
        <div className="border-b border-[#c4a44a]/15 bg-gradient-to-r from-[#c4a44a]/[0.06] via-[#c4a44a]/[0.03] to-transparent backdrop-blur-sm animate-[slide-down_0.3s_ease-out]">
          <div className="flex items-center justify-between px-5 py-2">
            {updatingAll && updateProgress ? (
              <span className="text-sm text-[#c4a44a] font-medium">
                Updating {updateProgress.completed + updateProgress.failed}/{updateProgress.total}
                {updateProgress.failed > 0 && (
                  <span className="text-red-400 ml-1">({updateProgress.failed} failed)</span>
                )}
              </span>
            ) : (
              <span className="text-sm text-[#c4a44a] font-medium">
                {updatesAvailable.length} update{updatesAvailable.length > 1 ? "s" : ""} available
              </span>
            )}
            <Button onClick={handleUpdateAll} size="sm" disabled={updatingAll}>
              {updatingAll ? "Updating..." : "Update All"}
            </Button>
          </div>
          {updatingAll && updateProgress && (
            <div className="h-0.5 bg-white/[0.06]">
              <div
                className="h-full bg-[#c4a44a] transition-all duration-300 ease-out"
                style={{
                  width: `${((updateProgress.completed + updateProgress.failed) / updateProgress.total) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <AddonList
          addons={filteredAddons}
          allAddons={addons}
          selectedAddon={selectedAddon}
          onSelect={setSelectedAddon}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          loading={loading}
          updateResults={updateResults}
          sortMode={sortMode}
          onSortChange={handleSortChange}
          filterMode={filterMode}
          onFilterChange={handleFilterChange}
          activeTagFilter={activeTagFilter}
          onActiveTagFilterChange={setActiveTagFilter}
          selectedFolders={selectedFolders}
          onToggleSelect={handleToggleSelect}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          discoverTab={discoverTab}
          onDiscoverTabChange={setDiscoverTab}
          addonsPath={addonsPath}
          onInstalled={handleRefresh}
          onSelectDiscoverResult={setSelectedDiscoverResult}
          selectedDiscoverResultId={selectedDiscoverResult?.id ?? null}
        />
        {viewMode === "installed" ? (
          <AddonDetail
            key={selectedAddon?.folderName ?? "none"}
            addon={selectedAddon}
            installedAddons={addons}
            addonsPath={addonsPath}
            onRemove={() => {
              setSelectedAddon(null);
              handleRefresh();
            }}
            updateResult={selectedUpdateResult}
            onAddonUpdated={handleAddonUpdated}
            onTagsChange={handleTagsChange}
          />
        ) : (
          <DiscoverDetail
            key={selectedDiscoverResult?.id ?? "none"}
            result={selectedDiscoverResult}
            addonsPath={addonsPath}
            onInstalled={handleRefresh}
          />
        )}
      </div>

      {activeDialog === "packs" && (
        <Packs
          addonsPath={addonsPath}
          installedAddons={addons}
          authUser={authUser}
          onAuthChange={setAuthUser}
          onClose={() => {
            setActiveDialog(null);
            setDeepLinkPackId(null);
          }}
          onRefresh={handleRefresh}
          initialPackId={deepLinkPackId}
        />
      )}

      {activeDialog === "profiles" && (
        <Profiles
          addonsPath={addonsPath}
          onClose={() => setActiveDialog(null)}
          onRefresh={handleRefresh}
        />
      )}

      {activeDialog === "backups" && (
        <Backups addonsPath={addonsPath} onClose={() => setActiveDialog(null)} />
      )}

      {activeDialog === "api-compat" && (
        <ApiCompat addonsPath={addonsPath} onClose={() => setActiveDialog(null)} />
      )}

      {activeDialog === "characters" && (
        <Characters addonsPath={addonsPath} onClose={() => setActiveDialog(null)} />
      )}

      {activeDialog === "settings" && (
        <Settings
          addonsPath={addonsPath}
          onPathChange={handlePathChange}
          onClose={() => setActiveDialog(null)}
          onRefresh={handleRefresh}
          onShowBackups={() => setActiveDialog("backups")}
          onShowApiCompat={() => setActiveDialog("api-compat")}
          onShowCharacters={() => setActiveDialog("characters")}
          onCheckForAppUpdate={() => checkForAppUpdate(false)}
        />
      )}
    </div>
  );
}

export default App;
