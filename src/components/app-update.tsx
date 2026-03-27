import { useState, useEffect, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";

type AppUpdateState =
  | { status: "idle" }
  | { status: "available"; update: Update }
  | { status: "downloading"; progress: number }
  | { status: "ready" };

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({ status: "idle" });

  const checkForAppUpdate = useCallback(async (silent = true) => {
    try {
      const update = await check();
      if (update) {
        setState({ status: "available", update });
        if (silent) {
          toast(`App update ${update.version} available`, {
            description: "A new version is ready to download.",
            action: {
              label: "View",
              onClick: () => {},
            },
            duration: 8000,
          });
        }
      } else if (!silent) {
        toast.info("You're on the latest version.");
      }
    } catch (e) {
      if (!silent) {
        toast.error(`Update check failed: ${e}`);
      }
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (state.status !== "available") return;
    const { update } = state;

    setState({ status: "downloading", progress: 0 });

    try {
      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setState({
                status: "downloading",
                progress: Math.round((downloaded / contentLength) * 100),
              });
            }
            break;
          case "Finished":
            break;
        }
      });

      setState({ status: "ready" });
      toast.success("Update installed. Restart to apply.", {
        action: {
          label: "Restart Now",
          onClick: () => relaunch(),
        },
        duration: Infinity,
      });
    } catch (e) {
      setState({ status: "available", update });
      toast.error(`Update failed: ${e}`);
    }
  }, [state]);

  const restartApp = useCallback(async () => {
    await relaunch();
  }, []);

  // Check on mount (silent) — scheduled to avoid synchronous setState in effect
  useEffect(() => {
    const id = setTimeout(() => checkForAppUpdate(true), 0);
    return () => clearTimeout(id);
  }, [checkForAppUpdate]);

  return { state, checkForAppUpdate, downloadAndInstall, restartApp };
}

interface AppUpdateBannerProps {
  state: AppUpdateState;
  onDownload: () => void;
  onRestart: () => void;
}

export function AppUpdateBanner({ state, onDownload, onRestart }: AppUpdateBannerProps) {
  if (state.status === "idle") return null;

  return (
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#c4a44a]/[0.08] px-3 py-1.5 text-xs">
      {state.status === "available" && (
        <>
          <DownloadIcon className="h-3.5 w-3.5 text-[#c4a44a]" />
          <span className="text-[#c4a44a]">Version {state.update.version} available</span>
          <button
            onClick={onDownload}
            className="ml-auto rounded-md bg-[#c4a44a]/20 px-2 py-0.5 text-[#c4a44a] transition-colors hover:bg-[#c4a44a]/30"
          >
            Update Now
          </button>
        </>
      )}
      {state.status === "downloading" && (
        <>
          <RefreshCwIcon className="h-3.5 w-3.5 animate-spin text-[#c4a44a]" />
          <span className="text-[#c4a44a]">Downloading update...</span>
          <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.1]">
            <div
              className="h-full rounded-full bg-[#c4a44a] transition-all"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <span className="text-[#c4a44a]/70">{state.progress}%</span>
        </>
      )}
      {state.status === "ready" && (
        <>
          <DownloadIcon className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-emerald-400">Update ready</span>
          <button
            onClick={onRestart}
            className="ml-auto rounded-md bg-emerald-400/20 px-2 py-0.5 text-emerald-400 transition-colors hover:bg-emerald-400/30"
          >
            Restart Now
          </button>
        </>
      )}
    </div>
  );
}
