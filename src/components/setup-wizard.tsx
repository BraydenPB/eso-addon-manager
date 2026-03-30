import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { GlassPanel } from "@/components/ui/glass-panel";
import { InfoPill } from "@/components/ui/info-pill";
import { SectionHeader } from "@/components/ui/section-header";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import type { AddonsDetectionResult, DetectedCandidate } from "@/types";

interface SetupWizardProps {
  detection: AddonsDetectionResult;
  onSelect: (path: string) => void;
}

export function SetupWizard({ detection, onSelect }: SetupWizardProps) {
  const { primary, candidates, warnings } = detection;

  return (
    <div className="flex h-screen items-center justify-center p-8">
      <GlassPanel variant="primary" className="w-full max-w-lg p-6">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={32} />
          <div>
            <h1 className="font-heading text-lg font-bold text-white">Kalpa</h1>
            <p className="text-sm text-muted-foreground">Set up your AddOns folder</p>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="mb-4 space-y-2">
            {warnings.map((warning) => (
              <div
                key={warning}
                className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2 text-xs text-amber-400"
              >
                {warning}
              </div>
            ))}
          </div>
        )}

        {primary && candidates.length === 1 ? (
          <SingleCandidate candidate={candidates[0]} onSelect={onSelect} />
        ) : primary && candidates.length > 1 ? (
          <MultipleCandidates candidates={candidates} onSelect={onSelect} />
        ) : (
          <NoCandidates onSelect={onSelect} />
        )}
      </GlassPanel>
    </div>
  );
}

function SingleCandidate({
  candidate,
  onSelect,
}: {
  candidate: DetectedCandidate;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader>Detected AddOns folder</SectionHeader>

      <CandidateCard candidate={candidate} recommended />

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => onSelect(candidate.path)}>
          Use this folder
        </Button>
        <BrowseButton onSelect={onSelect} />
      </div>
    </div>
  );
}

function MultipleCandidates({
  candidates,
  onSelect,
}: {
  candidates: DetectedCandidate[];
  onSelect: (path: string) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader>Multiple folders detected</SectionHeader>
      <p className="text-xs text-muted-foreground">
        Select which ESO AddOns folder to manage. The recommended folder is shown first.
      </p>

      <div className="space-y-2">
        {candidates.map((candidate, i) => (
          <button
            key={candidate.path}
            type="button"
            className="w-full text-left"
            onClick={() => onSelect(candidate.path)}
          >
            <CandidateCard candidate={candidate} recommended={i === 0} />
          </button>
        ))}
      </div>

      <div className="flex justify-end">
        <BrowseButton onSelect={onSelect} />
      </div>
    </div>
  );
}

function NoCandidates({ onSelect }: { onSelect: (path: string) => void }) {
  return (
    <div className="space-y-4">
      <SectionHeader>No AddOns folder found</SectionHeader>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t automatically detect your ESO AddOns folder. It&apos;s usually located at:
      </p>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-xs text-muted-foreground">
        Documents\Elder Scrolls Online\live\AddOns
      </div>
      <p className="text-xs text-muted-foreground">
        Use the button below to browse to your AddOns folder manually.
      </p>
      <BrowseButton onSelect={onSelect} fullWidth />
    </div>
  );
}

function CandidateCard({
  candidate,
  recommended,
}: {
  candidate: DetectedCandidate;
  recommended?: boolean;
}) {
  return (
    <GlassPanel
      variant="subtle"
      className="p-3 transition-colors duration-150 hover:border-white/[0.12]"
    >
      <div className="mb-1 flex items-center gap-2">
        {recommended && <InfoPill color="gold">Recommended</InfoPill>}
        {candidate.serverEnv && <InfoPill color="sky">{candidate.serverEnv}</InfoPill>}
        {candidate.isOnedrive && <InfoPill color="amber">OneDrive</InfoPill>}
      </div>
      <p className="truncate font-mono text-xs text-white/80">{candidate.path}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {candidate.addonCount > 0
          ? `${candidate.addonCount} addon${candidate.addonCount !== 1 ? "s" : ""} detected`
          : "No addons detected"}
      </p>
    </GlassPanel>
  );
}

function BrowseButton({
  onSelect,
  fullWidth,
}: {
  onSelect: (path: string) => void;
  fullWidth?: boolean;
}) {
  const [browsing, setBrowsing] = useState(false);

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const selected = await open({
        directory: true,
        title: "Select ESO AddOns Folder",
      });
      if (selected) {
        onSelect(selected);
      }
    } catch (e) {
      toast.error(`Failed to open folder picker: ${e}`);
    } finally {
      setBrowsing(false);
    }
  };

  return (
    <Button
      variant="outline"
      className={fullWidth ? "w-full" : undefined}
      disabled={browsing}
      onClick={handleBrowse}
    >
      {browsing ? "Browsing..." : "Choose a different folder..."}
    </Button>
  );
}
