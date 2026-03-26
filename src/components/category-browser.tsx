import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  EsouiCategory,
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
interface CategoryBrowserProps {
  addonsPath: string;
  onInstalled: () => void;
  onClose: () => void;
}

export function CategoryBrowser({
  addonsPath,
  onInstalled,
  onClose,
}: CategoryBrowserProps) {
  const [categories, setCategories] = useState<EsouiCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState("downloads");
  const [results, setResults] = useState<EsouiSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);

  // Detail view
  const [detail, setDetail] = useState<EsouiAddonDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Install
  const [installingId, setInstallingId] = useState<number | null>(null);

  useEffect(() => {
    invoke<EsouiCategory[]>("get_esoui_categories")
      .then(setCategories)
      .catch(() => {});
  }, []);

  const loadCategory = async (catId: number, p: number, sort: string) => {
    setLoading(true);
    setSelectedId(null);
    setDetail(null);
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

  const handleLoadDetail = async (id: number) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setDetail(null);
    try {
      const d = await invoke<EsouiAddonDetail>("fetch_esoui_detail", {
        esouiId: id,
      });
      setDetail(d);
    } catch {
      // ignore
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleInstall = async (id: number, downloadUrl?: string) => {
    setInstallingId(id);
    try {
      let url = downloadUrl;
      if (!url) {
        const info = await invoke<{
          id: number;
          downloadUrl: string;
        }>("resolve_esoui_addon", { input: String(id) });
        url = info.downloadUrl;
      }
      const res = await invoke<InstallResult>("install_addon", {
        addonsPath,
        downloadUrl: url,
        esouiId: id,
      });
      toast.success(`Installed ${res.installedFolders.join(", ")}`);
      onInstalled();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setInstallingId(null);
    }
  };

  const showDetail = selectedId !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {showDetail && detail ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedId(null);
                    setDetail(null);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  &larr; Back
                </button>
                <span>{detail.title}</span>
              </div>
            ) : (
              "Browse by Category"
            )}
          </DialogTitle>
        </DialogHeader>

        {!showDetail ? (
          <>
            <div className="flex gap-2">
              <Select onValueChange={handleCategoryChange}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={String(cat.id)}>
                      {cat.depth > 0
                        ? `${"  ".repeat(cat.depth)}${cat.name}`
                        : cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={handleSortChange}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="downloads">Most Popular</SelectItem>
                  <SelectItem value="newest">Recently Updated</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 overflow-y-auto -mx-4 px-4">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <span className="inline-block size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
                  <span className="ml-2">Loading...</span>
                </div>
              ) : results.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  {selectedCategory
                    ? "No addons in this category"
                    : "Select a category to browse"}
                </div>
              ) : (
                <div className="space-y-1">
                  {results.map((r) => (
                    <div key={r.id}>
                      <div
                        className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => handleLoadDetail(r.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-sm">
                            {r.title}
                          </span>
                          {r.category && (
                            <Badge
                              variant="secondary"
                              className="ml-2 text-[10px]"
                            >
                              {r.category}
                            </Badge>
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
                          {installingId === r.id ? "Installing..." : "Install"}
                        </Button>
                      </div>
                      <Separator />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {results.length > 0 && (
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0 || loading}
                  onClick={() => {
                    const p = page - 1;
                    setPage(p);
                    if (selectedCategory)
                      loadCategory(selectedCategory, p, sortBy);
                  }}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {page + 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => {
                    const p = page + 1;
                    setPage(p);
                    if (selectedCategory)
                      loadCategory(selectedCategory, p, sortBy);
                  }}
                >
                  Next
                </Button>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto -mx-4 px-4 space-y-4">
            {loadingDetail ? (
              <div className="flex items-center justify-center py-12">
                <span className="inline-block size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
                <span className="ml-3 text-muted-foreground">Loading...</span>
              </div>
            ) : detail ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-primary">
                      {detail.title}
                    </h3>
                    <div className="mt-1 text-sm text-muted-foreground">
                      by {detail.author}
                    </div>
                  </div>
                  <Button
                    onClick={() =>
                      handleInstall(detail.id, detail.downloadUrl)
                    }
                    disabled={installingId !== null}
                  >
                    {installingId === detail.id ? "Installing..." : "Install"}
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Version</span>
                    <div className="font-medium">{detail.version || "—"}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Compatibility</span>
                    <div className="font-medium">
                      {detail.compatibility || "—"}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Downloads</span>
                    <div className="font-medium">
                      {detail.totalDownloads || "—"}
                    </div>
                  </div>
                </div>

                {detail.screenshots.length > 0 && (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <img
                      src={detail.screenshots[0]}
                      alt="Screenshot"
                      className="w-full max-h-[250px] object-contain"
                    />
                  </div>
                )}

                {detail.description && (
                  <div className="whitespace-pre-line rounded-lg border border-border bg-background p-4 text-sm leading-relaxed max-h-[200px] overflow-y-auto">
                    {detail.description}
                  </div>
                )}

                <div className="flex justify-end pb-2">
                  <Button variant="outline" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
