import { useState, useEffect } from "react";
import { toast } from "sonner";
import type { EsouiSearchResult, EsouiAddonDetail, InstallResult } from "../types";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoPill } from "@/components/ui/info-pill";
import { getTauriErrorMessage, invokeOrThrow } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
  Download,
  Calendar,
  Star,
  FileDown,
  Clock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  HardDrive,
  Hash,
  Swords,
  Check,
} from "lucide-react";

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
    let cancelled = false;

    if (!result) {
      setDetail(null);
      setError(null);
      setInstallSuccess(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setDetail(null);
    setError(null);
    setInstallSuccess(null);
    setScreenshotIdx(0);

    void invokeOrThrow<EsouiAddonDetail>("fetch_esoui_detail", { esouiId: result.id })
      .then((detailResult) => {
        if (!cancelled) setDetail(detailResult);
      })
      .catch((e) => {
        if (!cancelled) setError(getTauriErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [result]);

  // Keyboard navigation for screenshots
  useEffect(() => {
    if (!detail || detail.screenshots.length <= 1) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        setScreenshotIdx((prev) => (prev > 0 ? prev - 1 : detail.screenshots.length - 1));
      } else if (e.key === "ArrowRight") {
        setScreenshotIdx((prev) => (prev < detail.screenshots.length - 1 ? prev + 1 : 0));
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [detail]);

  if (!result) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground px-8">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[200px] w-[200px] rounded-full bg-[#c4a44a]/[0.04] blur-[60px]" />
        <div className="relative rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 shadow-[0_0_30px_rgba(196,164,74,0.03)]">
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
        const info = await invokeOrThrow<{
          id: number;
          title: string;
          version: string;
          downloadUrl: string;
        }>("resolve_esoui_addon", { input: String(result.id) });
        url = info.downloadUrl;
        title = info.title;
        version = info.version;
      }
      const res = await invokeOrThrow<InstallResult>("install_addon", {
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
      toast.error(getTauriErrorMessage(e));
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="relative">
          <span className="inline-block size-6 animate-spin rounded-full border-2 border-white/[0.1] border-t-[#c4a44a]" />
          <span
            className="absolute inset-0 inline-block size-6 animate-spin rounded-full border-2 border-transparent border-b-[#c4a44a]/30"
            style={{ animationDirection: "reverse", animationDuration: "1.5s" }}
          />
        </div>
        <span className="text-muted-foreground text-sm">Loading details...</span>
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

  const safeIdx = Math.max(0, Math.min(screenshotIdx, detail.screenshots.length - 1));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="font-heading text-xl font-semibold bg-gradient-to-r from-[#c4a44a] to-[#d4b45a] bg-clip-text text-transparent">
            {detail.title}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground/60">
            <span>by {detail.author}</span>
            {result.category && (
              <>
                <span className="text-muted-foreground/20">&middot;</span>
                <InfoPill color="muted">{result.category}</InfoPill>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 items-end shrink-0">
          <Button
            onClick={() => handleInstall(detail.downloadUrl)}
            disabled={installingId !== null}
            className="min-w-[100px]"
          >
            {installingId === detail.id ? (
              <span className="flex items-center gap-2">
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-[#0b1220]/20 border-t-[#0b1220]" />
                Installing
              </span>
            ) : installSuccess ? (
              "Reinstall"
            ) : (
              <>
                <Download className="size-3.5" />
                Install
              </>
            )}
          </Button>
          <a
            href={`https://www.esoui.com/downloads/info${detail.id}.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors flex items-center gap-1"
          >
            <ExternalLink className="size-3" />
            View on ESOUI
          </a>
        </div>
      </div>

      {/* Install success */}
      {installSuccess && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-sm text-emerald-400 flex items-center gap-2">
          <Check className="size-4 shrink-0" />
          <span>
            Installed: {installSuccess.installedFolders.join(", ")}
            {installSuccess.installedDeps.length > 0 &&
              ` + deps: ${installSuccess.installedDeps.join(", ")}`}
          </span>
        </div>
      )}

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard
          icon={<Download className="size-3.5 text-sky-400" />}
          label="Downloads"
          value={detail.totalDownloads}
          accent="sky"
        />
        <StatCard
          icon={<FileDown className="size-3.5 text-emerald-400" />}
          label="Monthly"
          value={detail.monthlyDownloads}
          accent="emerald"
        />
        <StatCard
          icon={<Star className="size-3.5 text-[#c4a44a]" />}
          label="Favorites"
          value={detail.favorites}
          accent="gold"
        />
        <StatCard
          icon={<Clock className="size-3.5 text-violet-400" />}
          label="Updated"
          value={detail.updated}
          accent="violet"
        />
      </div>

      {/* Metadata grid */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-3">
          <MetaField icon={<Hash className="size-3" />} label="Version" value={detail.version} />
          <MetaField
            icon={<Swords className="size-3" />}
            label="Compatibility"
            value={detail.compatibility}
          />
          <MetaField
            icon={<HardDrive className="size-3" />}
            label="File Size"
            value={detail.fileSize}
          />
          <MetaField
            icon={<Calendar className="size-3" />}
            label="Created"
            value={detail.created}
          />
        </div>
      </div>

      {/* Screenshots */}
      {detail.screenshots.length > 0 && (
        <div>
          <SectionHeader className="mb-2">
            Screenshots ({detail.screenshots.length})
          </SectionHeader>
          <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] group/screenshot">
            <img
              src={detail.screenshots[safeIdx]}
              alt={`Screenshot ${safeIdx + 1}`}
              className="w-full max-h-[300px] object-contain"
              loading="lazy"
            />
            {detail.screenshots.length > 1 && (
              <>
                {/* Navigation arrows */}
                <button
                  className="absolute left-2 top-1/2 -translate-y-1/2 size-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/screenshot:opacity-100 transition-opacity hover:bg-black/70"
                  onClick={() =>
                    setScreenshotIdx((prev) =>
                      prev > 0 ? prev - 1 : detail.screenshots.length - 1
                    )
                  }
                  aria-label="Previous screenshot"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/screenshot:opacity-100 transition-opacity hover:bg-black/70"
                  onClick={() =>
                    setScreenshotIdx((prev) =>
                      prev < detail.screenshots.length - 1 ? prev + 1 : 0
                    )
                  }
                  aria-label="Next screenshot"
                >
                  <ChevronRight className="size-4" />
                </button>

                {/* Dot indicators */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-2 py-1">
                  {detail.screenshots.map((_, i) => (
                    <button
                      key={i}
                      className={cn(
                        "size-2 rounded-full transition-all duration-200",
                        i === safeIdx
                          ? "bg-[#c4a44a] scale-110"
                          : "bg-white/30 hover:bg-white/50"
                      )}
                      onClick={() => setScreenshotIdx(i)}
                      aria-label={`Screenshot ${i + 1}`}
                    />
                  ))}
                </div>

                {/* Counter */}
                <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm rounded-md px-2 py-0.5 text-[11px] text-white/70">
                  {safeIdx + 1} / {detail.screenshots.length}
                </div>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {detail.screenshots.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {detail.screenshots.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setScreenshotIdx(i)}
                  className={cn(
                    "shrink-0 overflow-hidden rounded-lg border-2 transition-all duration-200",
                    i === safeIdx
                      ? "border-[#c4a44a] shadow-[0_0_8px_rgba(196,164,74,0.3)]"
                      : "border-white/[0.06] hover:border-white/[0.15] opacity-60 hover:opacity-100"
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

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "sky" | "emerald" | "gold" | "violet";
}) {
  const borderColors = {
    sky: "border-sky-400/10 hover:border-sky-400/20",
    emerald: "border-emerald-400/10 hover:border-emerald-400/20",
    gold: "border-[#c4a44a]/10 hover:border-[#c4a44a]/20",
    violet: "border-violet-400/10 hover:border-violet-400/20",
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-white/[0.02] p-2.5 transition-colors",
        borderColors[accent]
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] font-heading font-bold uppercase tracking-[0.05em] text-muted-foreground/40">
          {label}
        </span>
      </div>
      <div className="text-sm font-semibold truncate">{value || "\u2014"}</div>
    </div>
  );
}

function MetaField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <span className="text-muted-foreground/50 font-heading text-[10px] uppercase tracking-wider flex items-center gap-1">
        {icon}
        {label}
      </span>
      <div className="font-medium mt-0.5">{value || "\u2014"}</div>
    </div>
  );
}
