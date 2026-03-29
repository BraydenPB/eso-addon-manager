import { Alert } from "@/components/ui/alert";
import { AppUpdateBanner, useAppUpdate } from "./app-update";

interface StatusBannersProps {
  error: string | null;
  isOffline: boolean;
  appUpdateState: ReturnType<typeof useAppUpdate>["state"];
  onDownload: () => void;
  onRestart: () => void;
}

export function StatusBanners({
  error,
  isOffline,
  appUpdateState,
  onDownload,
  onRestart,
}: StatusBannersProps) {
  return (
    <>
      {error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          {error}
        </Alert>
      )}

      {isOffline && (
        <Alert className="rounded-none border-x-0 border-t-0 bg-muted/50 text-muted-foreground">
          You&apos;re offline - some features may be unavailable
        </Alert>
      )}

      <AppUpdateBanner state={appUpdateState} onDownload={onDownload} onRestart={onRestart} />
    </>
  );
}
