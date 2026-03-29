import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  MinusIcon,
  PackageIcon,
  RefreshCwIcon,
  SettingsIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

interface AppHeaderProps {
  addonsCount: number;
  batchMode: boolean;
  batchRemoving: boolean;
  checkingUpdates: boolean;
  loading: boolean;
  selectedCount: number;
  updatingAll: boolean;
  onBatchCancel: () => void;
  onBatchRemove: () => void;
  onBatchUpdate: () => void;
  onOpenPacks: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
}

export function AppHeader({
  addonsCount,
  batchMode,
  batchRemoving,
  checkingUpdates,
  loading,
  selectedCount,
  updatingAll,
  onBatchCancel,
  onBatchRemove,
  onBatchUpdate,
  onOpenPacks,
  onOpenSettings,
  onRefresh,
}: AppHeaderProps) {
  return (
    <header
      data-tauri-drag-region
      className="relative flex items-center border-b border-white/[0.06] bg-[rgba(10,18,36,0.85)] px-4 py-2 select-none shadow-[0_4px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl backdrop-saturate-[1.2]"
    >
      <div className="absolute right-0 bottom-0 left-0 h-px bg-gradient-to-r from-transparent via-[#c4a44a]/30 to-transparent" />
      <div className="flex items-center gap-2">
        <Logo size={20} className="text-[#4dc2e6]" />
        <h1 className="bg-gradient-to-r from-[#c4a44a] to-[#d4b45a] bg-clip-text text-sm font-heading font-semibold tracking-wide text-transparent">
          ESOTK.COM - Addon Manager
        </h1>
      </div>
      <div className="flex-1" data-tauri-drag-region />
      <div className="flex items-center gap-2">
        {batchMode ? (
          <>
            <span className="mr-2 text-xs font-medium text-primary">{selectedCount} selected</span>
            <Button size="sm" variant="outline" onClick={onBatchUpdate} disabled={updatingAll}>
              {updatingAll ? "Updating..." : "Update Selected"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onBatchRemove}
              disabled={batchRemoving}
            >
              {batchRemoving ? "Removing..." : "Remove Selected"}
            </Button>
            <Button size="sm" variant="outline" onClick={onBatchCancel}>
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
              {addonsCount} addons
              {checkingUpdates && (
                <span className="ml-1 inline-flex items-center gap-1">
                  ·
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh addons"
              title="Refresh (Ctrl+R)"
            >
              <RefreshCwIcon className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenPacks}
              aria-label="Addon Packs"
              title="Addon Packs"
            >
              <PackageIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon />
            </Button>
          </>
        )}
      </div>
      <div className="ml-3 -mr-2 flex items-center">
        <button
          onClick={() => void getCurrentWindow().minimize()}
          className="flex h-8 w-8 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-white/[0.06] hover:text-foreground"
          aria-label="Minimize"
        >
          <MinusIcon className="size-3.5" />
        </button>
        <button
          onClick={() => void getCurrentWindow().toggleMaximize()}
          className="flex h-8 w-8 items-center justify-center text-muted-foreground/60 transition-colors hover:bg-white/[0.06] hover:text-foreground"
          aria-label="Maximize"
        >
          <SquareIcon className="size-3" />
        </button>
        <button
          onClick={() => void getCurrentWindow().close()}
          className="flex h-8 w-8 items-center justify-center rounded-tr-sm text-muted-foreground/60 transition-colors hover:bg-red-500/20 hover:text-foreground"
          aria-label="Close"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </header>
  );
}
