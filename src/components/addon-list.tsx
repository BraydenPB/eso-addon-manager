import type { AddonManifest, UpdateCheckResult } from "../types";
import type { SortMode, FilterMode } from "../App";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface AddonListProps {
  addons: AddonManifest[];
  selectedAddon: AddonManifest | null;
  onSelect: (addon: AddonManifest) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  loading: boolean;
  updateResults: UpdateCheckResult[];
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  filterMode: FilterMode;
  onFilterChange: (mode: FilterMode) => void;
}

const FILTERS: [FilterMode, string][] = [
  ["all", "All"],
  ["addons", "Addons"],
  ["libraries", "Libs"],
  ["outdated", "Outdated"],
  ["missing-deps", "Issues"],
];

export function AddonList({
  addons,
  selectedAddon,
  onSelect,
  searchQuery,
  onSearchChange,
  loading,
  updateResults,
  sortMode,
  onSortChange,
  filterMode,
  onFilterChange,
}: AddonListProps) {
  const updatesMap = new Map(
    updateResults
      .filter((r) => r.hasUpdate)
      .map((r) => [r.folderName, r]),
  );

  return (
    <div className="flex w-[380px] min-w-[300px] flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3">
        <Input
          type="text"
          placeholder="Search addons..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="bg-background"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex gap-0.5">
          {FILTERS.map(([mode, label]) => (
            <button
              key={mode}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                filterMode === mode
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
              onClick={() => onFilterChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <Select value={sortMode} onValueChange={(v) => onSortChange(v as SortMode)}>
          <SelectTrigger size="sm" className="h-6 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="author">Author</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="border-b border-border px-4 py-1 text-[11px] text-muted-foreground">
        {addons.length} {addons.length === 1 ? "addon" : "addons"}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        ) : addons.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No addons found
          </div>
        ) : (
          addons.map((addon) => (
            <div
              key={addon.folderName}
              className={cn(
                "cursor-pointer border-l-3 border-transparent px-4 py-2.5 transition-colors hover:bg-background",
                selectedAddon?.folderName === addon.folderName &&
                  "border-l-primary bg-background",
              )}
              onClick={() => onSelect(addon)}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-medium">
                  {addon.title}
                </span>
                {updatesMap.has(addon.folderName) && (
                  <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400">
                    Update
                  </Badge>
                )}
                {addon.isLibrary && (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    LIB
                  </Badge>
                )}
                {addon.missingDependencies.length > 0 && (
                  <Badge variant="destructive">
                    {addon.missingDependencies.length} missing
                  </Badge>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {addon.version || `v${addon.addonVersion ?? "?"}`}
                </span>
              </div>
              {addon.author && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  by {addon.author}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
