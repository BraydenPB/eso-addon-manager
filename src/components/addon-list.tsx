import type { AddonManifest, UpdateCheckResult } from "../types";
import type { SortMode, FilterMode } from "../App";

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
    <div className="addon-list-panel">
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search addons..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="list-toolbar">
        <div className="filter-tabs">
          {(
            [
              ["all", "All"],
              ["addons", "Addons"],
              ["libraries", "Libs"],
              ["outdated", "Outdated"],
              ["missing-deps", "Issues"],
            ] as [FilterMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              className={`filter-tab ${filterMode === mode ? "active" : ""}`}
              onClick={() => onFilterChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="sort-select"
          value={sortMode}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
        >
          <option value="name">Name</option>
          <option value="author">Author</option>
        </select>
      </div>
      <div className="list-count">
        {addons.length} {addons.length === 1 ? "addon" : "addons"}
      </div>
      <div className="addon-list">
        {loading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : addons.length === 0 ? (
          <div className="loading">No addons found</div>
        ) : (
          addons.map((addon) => (
            <div
              key={addon.folderName}
              className={`addon-item ${
                selectedAddon?.folderName === addon.folderName ? "selected" : ""
              }`}
              onClick={() => onSelect(addon)}
            >
              <div className="addon-item-header">
                <span className="addon-item-title">{addon.title}</span>
                {updatesMap.has(addon.folderName) && (
                  <span className="badge badge-update">Update</span>
                )}
                {addon.isLibrary && (
                  <span className="badge badge-lib">LIB</span>
                )}
                {addon.missingDependencies.length > 0 && (
                  <span className="badge badge-warning">
                    {addon.missingDependencies.length} missing
                  </span>
                )}
                <span className="addon-item-version">
                  {addon.version || `v${addon.addonVersion ?? "?"}`}
                </span>
              </div>
              {addon.author && (
                <div className="addon-item-author">by {addon.author}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
