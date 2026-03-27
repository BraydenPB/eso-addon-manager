import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ApiCompatInfo } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { InfoPill } from "@/components/ui/info-pill";
import { SectionHeader } from "@/components/ui/section-header";

interface ApiCompatProps {
  addonsPath: string;
  onClose: () => void;
}

export function ApiCompat({ addonsPath, onClose }: ApiCompatProps) {
  const [info, setInfo] = useState<ApiCompatInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const result = await invoke<ApiCompatInfo>("check_api_compatibility", {
          addonsPath,
        });
        setInfo(result);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [addonsPath]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>API Compatibility</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="inline-block size-5 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
            <span className="ml-2 text-muted-foreground">Checking compatibility...</span>
          </div>
        ) : error ? (
          <Alert variant="destructive">{error}</Alert>
        ) : info ? (
          <div className="flex-1 overflow-y-auto space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground/60">Game API Version:</span>
              <InfoPill color="sky" className="font-mono">
                {info.gameApiVersion}
              </InfoPill>
            </div>

            {info.outdatedAddons.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <SectionHeader className="text-amber-400!">
                    Outdated API ({info.outdatedAddons.length})
                  </SectionHeader>
                  <span className="text-xs text-muted-foreground">
                    May need updates for current game version
                  </span>
                </div>
                <div className="space-y-1">
                  {info.outdatedAddons.map((name) => (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm bg-amber-500/[0.04] border border-amber-500/20"
                    >
                      <span className="text-yellow-400">!</span>
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {info.outdatedAddons.length > 0 && info.upToDateAddons.length > 0 && (
              <div className="border-t border-white/[0.06]" />
            )}

            {info.upToDateAddons.length > 0 && (
              <div>
                <SectionHeader className="text-emerald-400! mb-2">
                  Compatible ({info.upToDateAddons.length})
                </SectionHeader>
                <div className="space-y-1">
                  {info.upToDateAddons.map((name) => (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded px-3 py-1.5 text-sm text-muted-foreground"
                    >
                      <span className="text-emerald-400">{"\u2713"}</span>
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {info.outdatedAddons.length === 0 && (
              <div className="text-center py-4 text-emerald-400 text-sm">
                All addons are compatible with the current game version!
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
