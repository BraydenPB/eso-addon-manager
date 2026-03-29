import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useAppUpdate } from "./components/app-update";
import { AddonList } from "./components/addon-list";
import { AddonDetail } from "./components/addon-detail";
import { AppBackground } from "./components/app-background";
import { AppDialogs } from "./components/app-dialogs";
import { AppHeader } from "./components/app-header";
import { DiscoverDetail } from "./components/discover-detail";
import { StatusBanners } from "./components/status-banners";
import { UpdateBanner } from "./components/update-banner";
import { getSetting, setSetting } from "@/lib/store";
import { getTauriErrorMessage, invokeOrThrow, invokeResult } from "@/lib/tauri";
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

type ActiveDialog =
  | "settings"
  | "profiles"
  | "packs"
  | "backups"
  | "api-compat"
  | "characters"
  | null;

interface PendingDeepLinkPayload {
  packId: string | null;
  shareCode: string | null;
}

function App() {
  const [addonsPath, setAddonsPath] = useState("");
  const [addons, setAddons] = useState<AddonManifest[]>([]);
  const [selectedAddon, setSelectedAddon] = useState<AddonManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
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
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [deepLinkPackId, setDeepLinkPackId] = useState<string | null>(null);
  const [deepLinkShareCode, setDeepLinkShareCode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("installed");
  const [discoverTab, setDiscoverTab] = useState<DiscoverTab>("search");
  const [selectedDiscoverResult, setSelectedDiscoverResult] = useState<EsouiSearchResult | null>(
    null
  );
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [batchRemoving, setBatchRemoving] = useState(false);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  const {
    state: appUpdateState,
    checkForAppUpdate,
    downloadAndInstall,
    restartApp,
  } = useAppUpdate();

  const initRan = useRef(false);
  const autoLinkRan = useRef(false);
  const selectedAddonRef = useRef<AddonManifest | null>(null);
  const addonsPathRef = useRef("");
  const viewModeRef = useRef<ViewMode>("installed");
  const scanSeqRef = useRef(0);
  const checkSeqRef = useRef(0);

  selectedAddonRef.current = selectedAddon;
  addonsPathRef.current = addonsPath;
  viewModeRef.current = viewMode;

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

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];

    void listen<string>("deep-link-pack", (event) => {
      setDeepLinkPackId(event.payload);
      setActiveDialog("packs");
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanups.push(unlisten);
      })
      .catch((listenError) => {
        console.error("[tauri:deep-link-pack]", listenError);
      });

    void listen<string>("deep-link-share", (event) => {
      setDeepLinkShareCode(event.payload);
      setActiveDialog("packs");
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanups.push(unlisten);
      })
      .catch((listenError) => {
        console.error("[tauri:deep-link-share]", listenError);
      });

    void invokeOrThrow<PendingDeepLinkPayload>("consume_initial_deep_link")
      .then((payload) => {
        if (disposed) return;
        if (payload.packId) {
          setDeepLinkPackId(payload.packId);
          setActiveDialog("packs");
        } else if (payload.shareCode) {
          setDeepLinkShareCode(payload.shareCode);
          setActiveDialog("packs");
        }
      })
      .catch((invokeError) => {
        console.error("[tauri:consume_initial_deep_link]", invokeError);
      });

    return () => {
      disposed = true;
      for (const fn of cleanups) fn();
    };
  }, []);

  const scanAddons = useCallback(async (path: string) => {
    const seq = ++scanSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await invokeOrThrow<AddonManifest[]>("scan_installed_addons", {
        addonsPath: path,
      });
      if (seq !== scanSeqRef.current) return;

      setAddons(result);
      if (selectedAddonRef.current) {
        const updated = result.find(
          (addon) => addon.folderName === selectedAddonRef.current?.folderName
        );
        setSelectedAddon(updated ?? null);
      }
    } catch (scanError) {
      if (seq !== scanSeqRef.current) return;
      setError(getTauriErrorMessage(scanError));
      setAddons([]);
    } finally {
      if (seq === scanSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const checkForUpdates = useCallback(
    async (path: string, autoUpdate = false, notifyOnError = false) => {
      const seq = ++checkSeqRef.current;
      setUpdatingAll(false);
      setUpdateProgress(null);
      setCheckingUpdates(true);
      try {
        const results = await invokeOrThrow<UpdateCheckResult[]>("check_for_updates", {
          addonsPath: path,
        });
        if (seq !== checkSeqRef.current) return;

        setUpdateResults(results);
        const updates = results.filter((result) => result.hasUpdate);

        if (autoUpdate && updates.length > 0) {
          toast.info(`Auto-updating ${updates.length} addon${updates.length > 1 ? "s" : ""}...`);
          setUpdatingAll(true);
          setUpdateProgress({ completed: 0, failed: 0, total: updates.length });

          let completed = 0;
          let failed = 0;

          for (const update of updates) {
            const updateResult = await invokeResult<InstallResult>("update_addon", {
              addonsPath: path,
              esouiId: update.esouiId,
              apiVersion: update.remoteVersion,
            });

            if (updateResult.ok) {
              completed++;
            } else {
              failed++;
            }

            if (seq !== checkSeqRef.current) return;
            setUpdateProgress({ completed, failed, total: updates.length });
          }

          if (seq !== checkSeqRef.current) return;

          setUpdatingAll(false);
          setUpdateProgress(null);

          if (failed > 0) {
            toast.warning(
              `Auto-updated ${completed} addon${completed !== 1 ? "s" : ""}, ${failed} failed`
            );
          } else if (completed > 0) {
            toast.success(`Auto-updated ${completed} addon${completed !== 1 ? "s" : ""}`);
          }

          setUpdateResults((prev) => {
            const updatedIds = new Set(updates.map((update) => update.esouiId));
            return prev.filter((result) => !updatedIds.has(result.esouiId));
          });

          await scanAddons(path);
        } else if (updates.length > 0) {
          toast.info(`${updates.length} update${updates.length > 1 ? "s" : ""} available`);
        }
      } catch (updateError) {
        if (seq !== checkSeqRef.current) return;
        console.error("[tauri:check_for_updates]", updateError);
        if (notifyOnError) {
          toast.error(`Failed to check for updates: ${getTauriErrorMessage(updateError)}`);
        }
      } finally {
        if (seq === checkSeqRef.current) {
          setCheckingUpdates(false);
        }
      }
    },
    [scanAddons]
  );

  const scanAndCheck = useCallback(
    async (path: string, notifyOnUpdateError = false) => {
      await scanAddons(path);
      await checkForUpdates(path, false, notifyOnUpdateError);
    },
    [checkForUpdates, scanAddons]
  );

  const runAutoLink = useCallback(
    async (path: string) => {
      if (autoLinkRan.current) return;
      autoLinkRan.current = true;

      const result = await invokeResult<{ linked: string[]; notFound: string[] }>(
        "auto_link_addons",
        {
          addonsPath: path,
        }
      );

      if (!result.ok) {
        toast.error(`Auto-link failed: ${result.error}`);
        return;
      }

      if (result.data.linked.length > 0) {
        toast.success(
          `Auto-linked ${result.data.linked.length} addon${result.data.linked.length > 1 ? "s" : ""} to ESOUI`
        );
        await scanAddons(path);
      }
    },
    [scanAddons]
  );

  const initializeApp = useCallback(async () => {
    const savedSort = await getSetting<SortMode>("sortMode", "name");
    const savedFilter = await getSetting<FilterMode>("filterMode", "all");
    setSortMode(savedSort);
    setFilterMode(savedFilter);

    const authResult = await invokeResult<AuthUser | null>("auth_get_user");
    if (authResult.ok) {
      setAuthUser(authResult.data ?? null);
    } else {
      toast.error(`Could not restore sign-in: ${authResult.error}`);
    }

    const savedPath = await getSetting<string>("addonsPath", "");

    try {
      const path = savedPath || (await invokeOrThrow<string>("detect_addons_folder"));
      setAddonsPath(path);
      await invokeOrThrow("set_addons_path", { addonsPath: path });
      await setSetting("addonsPath", path);
      await scanAddons(path);
      const autoUpdate = await getSetting<boolean>("autoUpdate", false);
      await checkForUpdates(path, autoUpdate, false);
      void runAutoLink(path);
    } catch (initError) {
      setError(
        `Could not detect ESO AddOns folder. Please set it in Settings. ${getTauriErrorMessage(initError)}`
      );
      setLoading(false);
    }
  }, [checkForUpdates, runAutoLink, scanAddons]);

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    void initializeApp();
  }, [initializeApp]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "r") {
        event.preventDefault();
        if (addonsPathRef.current) {
          void scanAndCheck(addonsPathRef.current, true);
        }
      }

      if (event.ctrlKey && event.key === "i") {
        event.preventDefault();
        setViewMode("discover");
        setDiscoverTab("url");
      }

      if (event.ctrlKey && event.key === "b") {
        event.preventDefault();
        setViewMode("discover");
        setDiscoverTab("search");
      }

      if (event.key === "Escape") {
        if (viewModeRef.current === "discover") {
          setViewMode("installed");
        }
        setSelectedFolders(new Set());
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [scanAndCheck]);

  const handleRefresh = useCallback(() => {
    if (addonsPathRef.current) {
      void scanAndCheck(addonsPathRef.current, true);
    }
  }, [scanAndCheck]);

  const handleTagsChange = useCallback(
    async (folderName: string, tags: string[]) => {
      try {
        await invokeOrThrow("set_addon_tags", { addonsPath, folderName, tags });
        setAddons((prev) =>
          prev.map((addon) => (addon.folderName === folderName ? { ...addon, tags } : addon))
        );
        setSelectedAddon((prev) => (prev?.folderName === folderName ? { ...prev, tags } : prev));
      } catch (tagsError) {
        toast.error(`Failed to save tags: ${getTauriErrorMessage(tagsError)}`);
      }
    },
    [addonsPath]
  );

  const handleAddonUpdated = useCallback(
    (esouiId: number) => {
      if (addonsPathRef.current) {
        void scanAddons(addonsPathRef.current);
      }
      setUpdateResults((prev) => prev.filter((result) => result.esouiId !== esouiId));
    },
    [scanAddons]
  );

  const handlePathChange = useCallback(
    async (newPath: string) => {
      const nextPath = newPath.trim();
      if (!nextPath) return;

      try {
        await invokeOrThrow("set_addons_path", { addonsPath: nextPath });
        await setSetting("addonsPath", nextPath);
        setAddonsPath(nextPath);
        setSelectedAddon(null);
        setUpdateResults([]);
        setError(null);
        await scanAndCheck(nextPath, true);
      } catch (pathError) {
        const message = getTauriErrorMessage(pathError);
        setError(`Could not set addons folder: ${message}`);
        toast.error(`Failed to update addons folder: ${message}`);
      }
    },
    [scanAndCheck]
  );

  const handleSortChange = useCallback((mode: SortMode) => {
    setSortMode(mode);
    void setSetting("sortMode", mode);
  }, []);

  const handleFilterChange = useCallback((mode: FilterMode) => {
    setFilterMode(mode);
    void setSetting("filterMode", mode);
  }, []);

  const { updatesAvailable, updatesSet } = useMemo(() => {
    const available = updateResults.filter((result) => result.hasUpdate);
    return {
      updatesAvailable: available,
      updatesSet: new Set(available.map((result) => result.folderName)),
    };
  }, [updateResults]);

  const runBatchUpdates = useCallback(
    async (updates: UpdateCheckResult[]) => {
      const path = addonsPathRef.current;
      if (!path || updates.length === 0) return;

      setUpdatingAll(true);
      setUpdateProgress({ completed: 0, failed: 0, total: updates.length });

      let completed = 0;
      let failed = 0;

      for (const update of updates) {
        const result = await invokeResult<InstallResult>("update_addon", {
          addonsPath: path,
          esouiId: update.esouiId,
          apiVersion: update.remoteVersion,
        });

        if (result.ok) {
          completed++;
        } else {
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

      await scanAddons(path);
      setUpdateResults((prev) => {
        const updatedIds = new Set(updates.map((update) => update.esouiId));
        return prev.filter((result) => !updatedIds.has(result.esouiId));
      });
    },
    [scanAddons]
  );

  const handleUpdateAll = useCallback(() => {
    void runBatchUpdates(updatesAvailable);
  }, [runBatchUpdates, updatesAvailable]);

  const handleToggleSelect = useCallback((folderName: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  }, []);

  const handleBatchRemove = useCallback(async () => {
    if (selectedFolders.size === 0) return;

    setBatchRemoving(true);
    try {
      const removed = await invokeOrThrow<string[]>("batch_remove_addons", {
        addonsPath,
        folderNames: Array.from(selectedFolders),
      });
      toast.success(`Removed ${removed.length} addon${removed.length !== 1 ? "s" : ""}`);
      setSelectedFolders(new Set());
      setSelectedAddon(null);
      handleRefresh();
    } catch (removeError) {
      toast.error(`Batch remove failed: ${getTauriErrorMessage(removeError)}`);
    } finally {
      setBatchRemoving(false);
    }
  }, [addonsPath, handleRefresh, selectedFolders]);

  const handleBatchUpdate = useCallback(async () => {
    const toUpdate = updatesAvailable.filter((update) => selectedFolders.has(update.folderName));
    if (toUpdate.length === 0) {
      toast.info("No selected addons have updates available");
      return;
    }

    await runBatchUpdates(toUpdate);
    setSelectedFolders(new Set());
  }, [runBatchUpdates, selectedFolders, updatesAvailable]);

  const filteredAddons = useMemo(
    () =>
      addons
        .filter((addon) => {
          if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const matchesSearch =
              addon.title.toLowerCase().includes(query) ||
              addon.folderName.toLowerCase().includes(query) ||
              addon.author.toLowerCase().includes(query) ||
              addon.tags.some((tag) => tag.toLowerCase().includes(query));
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
        .sort((left, right) => {
          switch (sortMode) {
            case "author":
              return left.author.toLowerCase().localeCompare(right.author.toLowerCase());
            case "name":
            default:
              return left.title.toLowerCase().localeCompare(right.title.toLowerCase());
          }
        }),
    [activeTagFilter, addons, filterMode, searchQuery, sortMode, updatesSet]
  );

  const selectedUpdateResult = useMemo(
    () =>
      selectedAddon
        ? (updateResults.find((result) => result.folderName === selectedAddon.folderName) ?? null)
        : null,
    [selectedAddon, updateResults]
  );

  const batchMode = selectedFolders.size > 0;

  const handleOpenDialog = useCallback((dialog: Exclude<ActiveDialog, null>) => {
    setActiveDialog(dialog);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setActiveDialog(null);
    setDeepLinkPackId(null);
    setDeepLinkShareCode(null);
  }, []);

  return (
    <div className="relative flex h-screen flex-col">
      <AppBackground />

      <AppHeader
        addonsCount={addons.length}
        batchMode={batchMode}
        batchRemoving={batchRemoving}
        checkingUpdates={checkingUpdates}
        loading={loading}
        selectedCount={selectedFolders.size}
        updatingAll={updatingAll}
        onBatchCancel={() => setSelectedFolders(new Set())}
        onBatchRemove={() => void handleBatchRemove()}
        onBatchUpdate={() => void handleBatchUpdate()}
        onOpenPacks={() => setActiveDialog("packs")}
        onOpenSettings={() => setActiveDialog("settings")}
        onRefresh={handleRefresh}
      />

      <StatusBanners
        error={error}
        isOffline={isOffline}
        appUpdateState={appUpdateState}
        onDownload={downloadAndInstall}
        onRestart={restartApp}
      />

      <UpdateBanner
        availableCount={updatesAvailable.length}
        updatingAll={updatingAll}
        updateProgress={updateProgress}
        onUpdateAll={handleUpdateAll}
      />

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

      <AppDialogs
        activeDialog={activeDialog}
        addons={addons}
        addonsPath={addonsPath}
        authUser={authUser}
        deepLinkPackId={deepLinkPackId}
        deepLinkShareCode={deepLinkShareCode}
        onAuthChange={setAuthUser}
        onCheckForAppUpdate={() => void checkForAppUpdate(false)}
        onCloseDialog={handleCloseDialog}
        onPathChange={(path) => void handlePathChange(path)}
        onRefresh={handleRefresh}
        onShowDialog={handleOpenDialog}
      />
    </div>
  );
}

export default App;
