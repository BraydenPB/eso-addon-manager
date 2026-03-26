import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  EsouiSearchResult,
  EsouiAddonDetail,
  InstallResult,
} from "../types";
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
import { cn } from "@/lib/utils";

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

  // Detail view
  const [selectedResult, setSelectedResult] =
    useState<EsouiSearchResult | null>(null);
  const [detail, setDetail] = useState<EsouiAddonDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Install
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
  const searchIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSelectedResult(null);
    setDetail(null);
    const id = ++searchIdRef.current;
    try {
      const r = await invoke<EsouiSearchResult[]>("search_esoui_addons", {
        query: searchQuery.trim(),
      });
      if (searchIdRef.current === id) {
        setResults(r);
      }
    } catch (e) {
      if (searchIdRef.current === id) {
        setSearchError(String(e));
      }
    } finally {
      if (searchIdRef.current === id) {
        setSearching(false);
      }
    }
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(value), 500);
  };

  const handleSelectResult = async (result: EsouiSearchResult) => {
    setSelectedResult(result);
    setDetail(null);
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const d = await invoke<EsouiAddonDetail>("fetch_esoui_detail", {
        esouiId: result.id,
      });
      setDetail(d);
    } catch (e) {
      setDetailError(String(e));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleInstall = async (id: number, downloadUrl?: string) => {
    setInstallingId(id);
    setInstallResult(null);
    setInstallError(null);
    try {
      let url = downloadUrl;
      if (!url) {
        const info = await invoke<{
          id: number;
          title: string;
          version: string;
          downloadUrl: string;
        }>("resolve_esoui_addon", { input: String(id) });
        url = info.downloadUrl;
      }
      const res = await invoke<InstallResult>("install_addon", {
        addonsPath,
        downloadUrl: url,
        esouiId: id,
      });
      setInstallResult({ id, result: res });
      onInstalled();
    } catch (e) {
      setInstallError({ id, error: String(e) });
    } finally {
      setInstallingId(null);
    }
  };

  const showDetail = selectedResult !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {showDetail ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedResult(null);
                    setDetail(null);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  &larr; Back
                </button>
                <span>{selectedResult.title}</span>
              </div>
            ) : (
              "Browse ESOUI"
            )}
          </DialogTitle>
        </DialogHeader>

        {!showDetail ? (
          <>
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

            {searchError && (
              <Alert variant="destructive">{searchError}</Alert>
            )}

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
                        <div
                          className="flex items-start gap-3 rounded-lg p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => handleSelectResult(r)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {r.title}
                              </span>
                              <Badge
                                variant="secondary"
                                className="shrink-0 text-[10px]"
                              >
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
                                Installed:{" "}
                                {installResult.result.installedFolders.join(
                                  ", ",
                                )}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInstall(r.id);
                            }}
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
          </>
        ) : (
          <DetailView
            result={selectedResult}
            detail={detail}
            loading={loadingDetail}
            error={detailError}
            installingId={installingId}
            installResult={installResult}
            installError={installError}
            onInstall={handleInstall}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailView({
  result,
  detail,
  loading,
  error,
  installingId,
  installResult,
  installError,
  onInstall,
  onClose,
}: {
  result: EsouiSearchResult;
  detail: EsouiAddonDetail | null;
  loading: boolean;
  error: string | null;
  installingId: number | null;
  installResult: { id: number; result: InstallResult } | null;
  installError: { id: number; error: string } | null;
  onInstall: (id: number, downloadUrl?: string) => void;
  onClose: () => void;
}) {
  const [screenshotIdx, setScreenshotIdx] = useState(0);
  const safeIdx = detail ? Math.min(screenshotIdx, detail.screenshots.length - 1) : 0;
  const justInstalled = installResult?.id === result.id;
  const justFailed = installError?.id === result.id;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <span className="inline-block size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        <span className="ml-3 text-muted-foreground">
          Loading addon details...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1">
        <Alert variant="destructive">{error}</Alert>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex-1 overflow-y-auto -mx-4 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-primary">{detail.title}</h3>
          <div className="mt-1 text-sm text-muted-foreground">
            by {detail.author}
          </div>
        </div>
        <Button
          onClick={() => onInstall(detail.id, detail.downloadUrl)}
          disabled={installingId !== null}
        >
          {installingId === detail.id
            ? "Installing..."
            : justInstalled
              ? "Reinstall"
              : "Install"}
        </Button>
      </div>

      {justInstalled && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          Installed: {installResult.result.installedFolders.join(", ")}
          {installResult.result.installedDeps.length > 0 &&
            ` + deps: ${installResult.result.installedDeps.join(", ")}`}
        </div>
      )}
      {justFailed && (
        <Alert variant="destructive">{installError.error}</Alert>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <span className="text-muted-foreground">Version</span>
          <div className="font-medium">{detail.version || "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Compatibility</span>
          <div className="font-medium">{detail.compatibility || "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">File Size</span>
          <div className="font-medium">{detail.fileSize || "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Total Downloads</span>
          <div className="font-medium">{detail.totalDownloads || "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Monthly Downloads</span>
          <div className="font-medium">{detail.monthlyDownloads || "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Favorites</span>
          <div className="font-medium">{detail.favorites || "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Updated</span>
          <div className="font-medium">{detail.updated || "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Created</span>
          <div className="font-medium">{detail.created || "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Category</span>
          <div>
            <Badge variant="secondary">{result.category}</Badge>
          </div>
        </div>
      </div>

      <Separator />

      {/* Screenshots */}
      {detail.screenshots.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">
            Screenshots ({detail.screenshots.length})
          </h4>
          <div className="relative overflow-hidden rounded-lg border border-border bg-background">
            <img
              src={detail.screenshots[safeIdx]}
              alt={`Screenshot ${safeIdx + 1}`}
              className="w-full max-h-[300px] object-contain"
              loading="lazy"
            />
            {detail.screenshots.length > 1 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {detail.screenshots.map((_, i) => (
                  <button
                    key={i}
                    className={cn(
                      "size-2 rounded-full transition-colors",
                      i === safeIdx
                        ? "bg-primary"
                        : "bg-muted-foreground/40 hover:bg-muted-foreground",
                    )}
                    onClick={() => setScreenshotIdx(i)}
                  />
                ))}
              </div>
            )}
          </div>
          {detail.screenshots.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {detail.screenshots.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setScreenshotIdx(i)}
                  className={cn(
                    "shrink-0 overflow-hidden rounded border transition-colors",
                    i === safeIdx
                      ? "border-primary"
                      : "border-border hover:border-muted-foreground",
                  )}
                >
                  <img
                    src={src}
                    alt={`Thumb ${i + 1}`}
                    className="h-14 w-24 object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {detail.description && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">
            Description
          </h4>
          <div className="whitespace-pre-line rounded-lg border border-border bg-background p-4 text-sm leading-relaxed">
            {detail.description}
          </div>
        </div>
      )}

      <div className="flex justify-end pb-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
