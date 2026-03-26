import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { AddonList } from "./components/addon-list";
import { AddonDetail } from "./components/addon-detail";
import { InstallDialog } from "./components/install-dialog";
import { BrowseEsoui } from "./components/browse-esoui";
import { CategoryBrowser } from "./components/category-browser";
import { Profiles } from "./components/profiles";
import { Backups } from "./components/backups";
import { ApiCompat } from "./components/api-compat";
import { Settings } from "./components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { getSetting, setSetting } from "@/lib/store";
import type { AddonManifest, UpdateCheckResult, InstallResult } from "./types";

export type SortMode = "name" | "author" | "recent";
export type FilterMode = "all" | "addons" | "libraries" | "outdated" | "missing-deps";

function App() {
  const [addonsPath, setAddonsPath] = useState<string>("");
  const [addons, setAddons] = useState<AddonManifest[]>([]);
  const [selectedAddon, setSelectedAddon] = useState<AddonManifest | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [showApiCompat, setShowApiCompat] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [updateResults, setUpdateResults] = useState<UpdateCheckResult[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  // Batch selection
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [batchRemoving, setBatchRemoving] = useState(false);

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
        let updated = 0;
        for (const update of updates) {
          try {
            await invoke<InstallResult>("update_addon", {
              addonsPath: path,
              esouiId: update.esouiId,
            });
            updated++;
          } catch {
            // Continue
          }
        }
        if (updated > 0) {
          toast.success(`Auto-updated ${updated} addon${updated !== 1 ? "s" : ""}`);
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

  const scanAddons = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<AddonManifest[]>("scan_installed_addons", {
          addonsPath: path,
        });
        setAddons(result);
        if (selectedAddon) {
          const updated = result.find(
            (a) => a.folderName === selectedAddon.folderName,
          );
          setSelectedAddon(updated ?? null);
        }
      } catch (e) {
        setError(String(e));
        setAddons([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedAddon],
  );

  const scanAndCheck = useCallback(
    async (path: string) => {
      await scanAddons(path);
      checkForUpdates(path);
    },
    [scanAddons, checkForUpdates],
  );

  // Auto-link untracked addons on first load
  const autoLinkRan = useRef(false);
  const runAutoLink = useCallback(async (path: string) => {
    if (autoLinkRan.current) return;
    autoLinkRan.current = true;
    try {
      const result = await invoke<{ linked: string[]; notFound: string[] }>(
        "auto_link_addons",
        { addonsPath: path },
      );
      if (result.linked.length > 0) {
        toast.success(
          `Auto-linked ${result.linked.length} addon${result.linked.length > 1 ? "s" : ""} to ESOUI`,
        );
        // Re-scan to pick up new ESOUI IDs
        scanAndCheck(path);
      }
    } catch {
      // Non-critical
    }
  }, [scanAndCheck]);

  useEffect(() => {
    async function init() {
      const savedSort = await getSetting<SortMode>("sortMode", "name");
      const savedFilter = await getSetting<FilterMode>("filterMode", "all");
      setSortMode(savedSort);
      setFilterMode(savedFilter);

      const savedPath = await getSetting<string>("addonsPath", "");
      try {
        let path = savedPath;
        if (!path) {
          path = await invoke<string>("detect_addons_folder");
        }
        setAddonsPath(path);
        await setSetting("addonsPath", path);
        await scanAddons(path);
        const autoUpdate = await getSetting<boolean>("autoUpdate", false);
        checkForUpdates(path, autoUpdate);
        // Auto-link after initial scan
        runAutoLink(path);
      } catch {
        setError(
          "Could not detect ESO AddOns folder. Please set it in Settings.",
        );
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  const addonsPathRef = useRef(addonsPath);
  addonsPathRef.current = addonsPath;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "r") {
        e.preventDefault();
        if (addonsPathRef.current) scanAndCheck(addonsPathRef.current);
      }
      if (e.ctrlKey && e.key === "i") {
        e.preventDefault();
        setShowInstall(true);
      }
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        setShowBrowse(true);
      }
      if (e.key === "Escape") {
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

  const handlePathChange = (newPath: string) => {
    setAddonsPath(newPath);
    setSelectedAddon(null);
    setUpdateResults([]);
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

  const updatesAvailable = updateResults.filter((r) => r.hasUpdate);

  const handleUpdateAll = async () => {
    setUpdatingAll(true);
    let updated = 0;
    for (const update of updatesAvailable) {
      try {
        await invoke<InstallResult>("update_addon", {
          addonsPath,
          esouiId: update.esouiId,
        });
        updated++;
      } catch {
        // Continue updating others even if one fails
      }
    }
    setUpdatingAll(false);
    toast.success(`Updated ${updated} addon${updated !== 1 ? "s" : ""}`);
    scanAndCheck(addonsPath);
  };

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
    const toUpdate = updatesAvailable.filter((u) =>
      selectedFolders.has(u.folderName),
    );
    if (toUpdate.length === 0) {
      toast.info("No selected addons have updates available");
      return;
    }
    setUpdatingAll(true);
    let updated = 0;
    for (const update of toUpdate) {
      try {
        await invoke<InstallResult>("update_addon", {
          addonsPath,
          esouiId: update.esouiId,
        });
        updated++;
      } catch {
        // Continue
      }
    }
    setUpdatingAll(false);
    toast.success(`Updated ${updated} addon${updated !== 1 ? "s" : ""}`);
    setSelectedFolders(new Set());
    scanAndCheck(addonsPath);
  };

  const updatesSet = new Set(
    updateResults.filter((r) => r.hasUpdate).map((r) => r.folderName),
  );

  const filteredAddons = addons
    .filter((addon) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          addon.title.toLowerCase().includes(q) ||
          addon.folderName.toLowerCase().includes(q) ||
          addon.author.toLowerCase().includes(q);
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
    });

  const missingDepCount = addons.filter(
    (a) => a.missingDependencies.length > 0,
  ).length;

  const selectedUpdateResult = selectedAddon
    ? updateResults.find((r) => r.folderName === selectedAddon.folderName) ??
      null
    : null;

  const batchMode = selectedFolders.size > 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-3 select-none">
        <h1 className="text-lg font-semibold tracking-wide text-primary">
          ESO Addon Manager
        </h1>
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedFolders(new Set())}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="mr-2 text-xs text-muted-foreground">
                {addons.length} addons
                {missingDepCount > 0 && ` \u00b7 ${missingDepCount} with issues`}
                {checkingUpdates && (
                  <span className="ml-1 inline-flex items-center gap-1">
                    \u00b7{" "}
                    <span className="inline-block size-3 animate-spin rounded-full border-2 border-border border-t-primary" />{" "}
                    Checking updates...
                  </span>
                )}
              </span>
              {updatesAvailable.length > 0 && (
                <Button
                  onClick={handleUpdateAll}
                  disabled={updatingAll}
                  size="sm"
                >
                  {updatingAll
                    ? "Updating..."
                    : `Update All (${updatesAvailable.length})`}
                </Button>
              )}
              <Button size="sm" onClick={() => setShowBrowse(true)}>
                Search
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCategories(true)}
              >
                Categories
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowInstall(true)}
              >
                Install URL
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowProfiles(true)}
              >
                Profiles
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={loading}
              >
                {loading ? "Scanning..." : "Refresh"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(true)}
              >
                Settings
              </Button>
            </>
          )}
        </div>
      </header>

      {error && (
        <Alert
          variant="destructive"
          className="rounded-none border-x-0 border-t-0"
        >
          {error}
        </Alert>
      )}

      <div className="flex flex-1 overflow-hidden">
        <AddonList
          addons={filteredAddons}
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
          selectedFolders={selectedFolders}
          onToggleSelect={handleToggleSelect}
        />
        <AddonDetail
          addon={selectedAddon}
          installedAddons={addons}
          addonsPath={addonsPath}
          onRemove={() => {
            setSelectedAddon(null);
            handleRefresh();
          }}
          updateResult={selectedUpdateResult}
          onUpdated={handleRefresh}
        />
      </div>

      {showBrowse && (
        <BrowseEsoui
          addonsPath={addonsPath}
          onInstalled={handleRefresh}
          onClose={() => setShowBrowse(false)}
        />
      )}

      {showInstall && (
        <InstallDialog
          addonsPath={addonsPath}
          onInstalled={handleRefresh}
          onClose={() => setShowInstall(false)}
        />
      )}

      {showCategories && (
        <CategoryBrowser
          addonsPath={addonsPath}
          onInstalled={handleRefresh}
          onClose={() => setShowCategories(false)}
        />
      )}

      {showProfiles && (
        <Profiles
          addonsPath={addonsPath}
          onClose={() => setShowProfiles(false)}
          onRefresh={handleRefresh}
        />
      )}

      {showBackups && (
        <Backups
          addonsPath={addonsPath}
          onClose={() => setShowBackups(false)}
        />
      )}

      {showApiCompat && (
        <ApiCompat
          addonsPath={addonsPath}
          onClose={() => setShowApiCompat(false)}
        />
      )}

      {showSettings && (
        <Settings
          addonsPath={addonsPath}
          onPathChange={handlePathChange}
          onClose={() => setShowSettings(false)}
          onRefresh={handleRefresh}
          onShowBackups={() => {
            setShowSettings(false);
            setShowBackups(true);
          }}
          onShowApiCompat={() => {
            setShowSettings(false);
            setShowApiCompat(true);
          }}
        />
      )}
    </div>
  );
}

export default App;
