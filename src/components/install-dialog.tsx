import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EsouiAddonInfo, InstallResult } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type InstallState =
  | "idle"
  | "resolving"
  | "resolved"
  | "installing"
  | "installed"
  | "error";

interface InstallDialogProps {
  addonsPath: string;
  onInstalled: () => void;
  onClose: () => void;
}

export function InstallDialog({
  addonsPath,
  onInstalled,
  onClose,
}: InstallDialogProps) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<InstallState>("idle");
  const [addonInfo, setAddonInfo] = useState<EsouiAddonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);

  const handleResolve = async () => {
    if (!input.trim()) return;
    setState("resolving");
    setError(null);
    try {
      const info = await invoke<EsouiAddonInfo>("resolve_esoui_addon", {
        input: input.trim(),
      });
      setAddonInfo(info);
      setState("resolved");
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  };

  const handleInstall = async () => {
    if (!addonInfo) return;
    setState("installing");
    setError(null);
    try {
      const installResult = await invoke<InstallResult>("install_addon", {
        addonsPath,
        downloadUrl: addonInfo.downloadUrl,
        esouiId: addonInfo.id,
      });
      setResult(installResult);
      setState("installed");
      onInstalled();
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && state === "idle") handleResolve();
  };

  const busy = state === "resolving" || state === "installing";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle>Install Addon</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="esoui-input"
              className="mb-1 block text-sm text-muted-foreground"
            >
              ESOUI URL or Addon ID
            </label>
            <Input
              id="esoui-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (state !== "idle" && state !== "error") {
                  setState("idle");
                  setAddonInfo(null);
                  setResult(null);
                }
              }}
              placeholder="https://www.esoui.com/downloads/info123 or 123"
              disabled={busy}
              autoFocus
            />
          </div>

          {addonInfo && state === "resolved" && (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="font-medium text-primary">{addonInfo.title}</div>
              <div className="text-xs text-muted-foreground">
                ESOUI #{addonInfo.id}
                {addonInfo.version && ` \u00b7 v${addonInfo.version}`}
              </div>
            </div>
          )}

          {state === "installed" && result && (
            <div className="space-y-2">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                Installed: {result.installedFolders.join(", ")}
              </div>
              {result.installedDeps.length > 0 && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                  Auto-installed dependencies: {result.installedDeps.join(", ")}
                </div>
              )}
              {result.failedDeps.length > 0 && (
                <Alert variant="destructive">
                  Failed to install: {result.failedDeps.join(", ")}
                </Alert>
              )}
              {result.skippedDeps.length > 0 && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-400">
                  Not found on ESOUI: {result.skippedDeps.join(", ")}
                </div>
              )}
            </div>
          )}

          {error && <Alert variant="destructive">{error}</Alert>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {state === "installed" ? "Close" : "Cancel"}
          </Button>

          {(state === "idle" || state === "error") && (
            <Button onClick={handleResolve} disabled={!input.trim()}>
              Resolve
            </Button>
          )}

          {state === "resolving" && (
            <Button disabled>Resolving...</Button>
          )}

          {state === "resolved" && (
            <Button onClick={handleInstall}>Install</Button>
          )}

          {state === "installing" && (
            <Button disabled>Installing &amp; resolving deps...</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
