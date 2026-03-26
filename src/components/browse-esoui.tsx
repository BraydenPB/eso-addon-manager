import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EsouiSearchResult, InstallResult } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

interface BrowseEsouiProps {
  addonsPath: string;
  onInstalled: () => void;
  onClose: () => void;
}

export function BrowseEsoui({
  addonsPath,
  onInstalled,
  onClose,
}: BrowseEsouiProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EsouiSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<number | null>(null);
  const [installResult, setInstallResult] = useState<{
    id: number;
    result: InstallResult;
  } | null>(null);
  const [installError, setInstallError] = useState<{
    id: number;
    error: string;
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const r = await invoke<EsouiSearchResult[]>("search_esoui_addons", {
        query: searchQuery.trim(),
      });
      setResults(r);
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(value), 500);
  };

  const handleInstall = async (result: EsouiSearchResult) => {
    setInstallingId(result.id);
    setInstallResult(null);
    setInstallError(null);
    try {
      // First resolve to get download URL
      const info = await invoke<{ id: number; title: string; version: string; downloadUrl: string }>(
        "resolve_esoui_addon",
        { input: String(result.id) },
      );
      // Then install
      const installRes = await invoke<InstallResult>("install_addon", {
        addonsPath,
        downloadUrl: info.downloadUrl,
        esouiId: result.id,
      });
      setInstallResult({ id: result.id, result: installRes });
      onInstalled();
    } catch (e) {
      setInstallError({ id: result.id, error: String(e) });
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Browse ESOUI</DialogTitle>
        </DialogHeader>

        <div>
          <Input
            placeholder="Search ESOUI addons..."
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch(query);
            }}
            autoFocus
          />
        </div>

        {searchError && <Alert variant="destructive">{searchError}</Alert>}

        <div className="flex-1 overflow-y-auto -mx-4 px-4">
          {searching ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <span className="inline-block size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
              <span className="ml-2">Searching ESOUI...</span>
            </div>
          ) : results.length === 0 && query.trim() ? (
            <div className="py-8 text-center text-muted-foreground">
              No results found
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((r) => {
                const justInstalled = installResult?.id === r.id;
                const justFailed = installError?.id === r.id;

                return (
                  <div key={r.id}>
                    <div className="flex items-start gap-3 rounded-lg p-3 hover:bg-muted/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {r.title}
                          </span>
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {r.category}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span>by {r.author}</span>
                          <span>{r.downloads} downloads</span>
                          <span>Updated {r.updated}</span>
                        </div>
                        {justInstalled && (
                          <div className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">
                            Installed: {installResult.result.installedFolders.join(", ")}
                            {installResult.result.installedDeps.length > 0 &&
                              ` + deps: ${installResult.result.installedDeps.join(", ")}`}
                          </div>
                        )}
                        {justFailed && (
                          <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                            {installError.error}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleInstall(r)}
                        disabled={installingId !== null}
                        className="shrink-0"
                      >
                        {installingId === r.id
                          ? "Installing..."
                          : justInstalled
                            ? "Reinstall"
                            : "Install"}
                      </Button>
                    </div>
                    <Separator />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
