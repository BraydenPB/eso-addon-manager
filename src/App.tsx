import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AddonList } from "./components/addon-list";
import { AddonDetail } from "./components/addon-detail";
import { InstallDialog } from "./components/install-dialog";
import { Settings } from "./components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [updateResults, setUpdateResults] = useState<UpdateCheckResult[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const checkForUpdates = useCallback(async (path: string) => {
    setCheckingUpdates(true);
    try {
      const results = await invoke<UpdateCheckResult[]>("check_for_updates", {
        addonsPath: path,
      });
      setUpdateResults(results);
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

  useEffect(() => {
    async function init() {
      try {
        const path = await invoke<string>("detect_addons_folder");
        setAddonsPath(path);
        await scanAddons(path);
        checkForUpdates(path);
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
    scanAndCheck(newPath);
  };

  const updatesAvailable = updateResults.filter((r) => r.hasUpdate);

  const handleUpdateAll = async () => {
    setUpdatingAll(true);
    for (const update of updatesAvailable) {
      try {
        await invoke<InstallResult>("update_addon", {
          addonsPath,
          esouiId: update.esouiId,
        });
      } catch {
        // Continue updating others even if one fails
      }
    }
    setUpdatingAll(false);
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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-3 select-none">
        <h1 className="text-lg font-semibold tracking-wide text-primary">
          ESO Addon Manager
        </h1>
        <div className="flex items-center gap-2">
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
          <Button size="sm" onClick={() => setShowInstall(true)}>
            Install
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
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
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
          onSortChange={setSortMode}
          filterMode={filterMode}
          onFilterChange={setFilterMode}
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

      {showInstall && (
        <InstallDialog
          addonsPath={addonsPath}
          onInstalled={handleRefresh}
          onClose={() => setShowInstall(false)}
        />
      )}

      {showSettings && (
        <Settings
          addonsPath={addonsPath}
          onPathChange={handlePathChange}
          onClose={() => setShowSettings(false)}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}

export default App;
