import { Button } from "@/components/ui/button";

interface UpdateBannerProps {
  availableCount: number;
  updatingAll: boolean;
  updateProgress: {
    completed: number;
    failed: number;
    total: number;
  } | null;
  onUpdateAll: () => void;
}

export function UpdateBanner({
  availableCount,
  updatingAll,
  updateProgress,
  onUpdateAll,
}: UpdateBannerProps) {
  if (availableCount === 0 && !updatingAll) return null;

  return (
    <div className="animate-[slide-down_0.3s_ease-out] border-b border-[#c4a44a]/15 bg-gradient-to-r from-[#c4a44a]/[0.06] via-[#c4a44a]/[0.03] to-transparent backdrop-blur-sm">
      <div className="flex items-center justify-between px-5 py-2">
        {updatingAll && updateProgress ? (
          <span className="text-sm font-medium text-[#c4a44a]">
            Updating {updateProgress.completed + updateProgress.failed}/{updateProgress.total}
            {updateProgress.failed > 0 && (
              <span className="ml-1 text-red-400">({updateProgress.failed} failed)</span>
            )}
          </span>
        ) : (
          <span className="text-sm font-medium text-[#c4a44a]">
            {availableCount} update{availableCount > 1 ? "s" : ""} available
          </span>
        )}
        <Button onClick={onUpdateAll} size="sm" disabled={updatingAll}>
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
  );
}
