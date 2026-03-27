import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { EsouiSearchResult, EsouiAddonDetail, InstallResult } from "../types";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoPill } from "@/components/ui/info-pill";
import { cn } from "@/lib/utils";

interface DiscoverDetailProps {
  result: EsouiSearchResult | null;
  addonsPath: string;
  onInstalled: () => void;
}

export function DiscoverDetail({ result, addonsPath, onInstalled }: DiscoverDetailProps) {
  const [detail, setDetail] = useState<EsouiAddonDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<number | null>(null);
  const [installSuccess, setInstallSuccess] = useState<InstallResult | null>(null);
  const [screenshotIdx, setScreenshotIdx] = useState(0);

  useEffect(() => {
    if (!result) {
      setDetail(null);
      setError(null);
      setInstallSuccess(null);
      return;
    }
    setLoading(true);
    setDetail(null);
    setError(null);
    setInstallSuccess(null);
    setScreenshotIdx(0);
    invoke<EsouiAddonDetail>("fetch_esoui_detail", { esouiId: result.id })
      .then(setDetail)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [result]);

  if (!result) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground px-8">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[200px] w-[200px] rounded-full bg-sky-500/[0.04] blur-[60px]" />
        <div className="relative rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 shadow-[0_0_30px_rgba(56,189,248,0.03)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground/30"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <div className="relative text-center">
          <p className="font-heading text-sm font-medium text-foreground/70">Discover Addons</p>
          <p className="mt-1 text-xs text-muted-foreground/40">
            Search or browse to see addon details here
          </p>
        </div>
      </div>
    );
  }

  const handleInstall = async (downloadUrl?: string) => {
    if (!result) return;
    setInstallingId(result.id);
    setInstallSuccess(null);
    try {
      let url = downloadUrl;
      let title = detail?.title ?? result.title;
      let version = detail?.version ?? "";
      if (!url) {
        const info = await invoke<{
          id: number;
          title: string;
          version: string;
          downloadUrl: string;
        }>("resolve_esoui_addon", { input: String(result.id) });
        url = info.downloadUrl;
        title = info.title;
        version = info.version;
      }
      const res = await invoke<InstallResult>("install_addon", {
        addonsPath,
        downloadUrl: url,
        esouiId: result.id,
        esouiTitle: title,
        esouiVersion: version,
      });
      setInstallSuccess(res);
      toast.success(`Installed ${res.installedFolders.join(", ")}`);
      onInstalled();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="inline-block size-6 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
        <span className="ml-3 text-muted-foreground">Loading details...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="rounded-xl border border-red-400/20 bg-red-400/[0.04] p-4 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const safeIdx = Math.min(screenshotIdx, detail.screenshots.length - 1);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold bg-gradient-to-r from-[#c4a44a] to-[#d4b45a] bg-clip-text text-transparent">
            {detail.title}
          </h2>
          <div className="mt-1 text-sm text-muted-foreground/60">by {detail.author}</div>
        </div>
        <Button onClick={() => handleInstall(detail.downloadUrl)} disabled={installingId !== null}>
          {installingId === detail.id ? "Installing..." : installSuccess ? "Reinstall" : "Install"}
        </Button>
      </div>

      {/* Install success */}
      {installSuccess && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-sm text-emerald-400">
          Installed: {installSuccess.installedFolders.join(", ")}
          {installSuccess.installedDeps.length > 0 &&
            ` + deps: ${installSuccess.installedDeps.join(", ")}`}
        </div>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 rounded-xl border border-white/[0.04] bg-white/[0.02] p-3">
        <MetaField label="Version" value={detail.version} />
        <MetaField label="Compatibility" value={detail.compatibility} />
        <MetaField label="File Size" value={detail.fileSize} />
        <MetaField label="Total Downloads" value={detail.totalDownloads} />
        <MetaField label="Monthly Downloads" value={detail.monthlyDownloads} />
        <MetaField label="Favorites" value={detail.favorites} />
        <MetaField label="Updated" value={detail.updated} />
        <MetaField label="Created" value={detail.created} />
        <div>
          <span className="text-muted-foreground/60 font-heading text-[10px] uppercase tracking-wider">
            Category
          </span>
          <div>
            <InfoPill color="muted">{result.category}</InfoPill>
          </div>
        </div>
      </div>

      {/* Screenshots */}
      {detail.screenshots.length > 0 && (
        <div>
          <SectionHeader className="mb-2">Screenshots ({detail.screenshots.length})</SectionHeader>
          <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
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
                      "size-2 rounded-full transition-all duration-150",
                      i === safeIdx ? "bg-[#c4a44a]" : "bg-white/20 hover:bg-white/40"
                    )}
                    onClick={() => setScreenshotIdx(i)}
                    aria-label={`Screenshot ${i + 1}`}
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
                    "shrink-0 overflow-hidden rounded-lg border transition-all duration-150",
                    i === safeIdx
                      ? "border-[#c4a44a]"
                      : "border-white/[0.06] hover:border-white/[0.15]"
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
          <SectionHeader className="mb-2">Description</SectionHeader>
          <div className="whitespace-pre-line rounded-xl border border-white/[0.04] bg-white/[0.02] p-4 text-sm leading-relaxed">
            {detail.description}
          </div>
        </div>
      )}
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground/60 font-heading text-[10px] uppercase tracking-wider">
        {label}
      </span>
      <div className="font-medium">{value || "\u2014"}</div>
    </div>
  );
}
