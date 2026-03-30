import { FileText, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";

interface EmptyLogsStateProps {
  onSetLogsPath: (path: string) => void;
}

export function EmptyLogsState({ onSetLogsPath }: EmptyLogsStateProps) {
  const handlePickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      onSetLogsPath(selected);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <GlassPanel variant="primary" className="max-w-md p-8 text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-[#c4a44a]/10 text-[#c4a44a]">
            <FileText className="size-8" />
          </div>
        </div>
        <h2 className="font-heading mb-2 text-lg font-bold text-foreground">
          ESO Logs Workspace
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Select your ESO log directory to get started. Logs are usually located
          next to your AddOns folder.
        </p>
        <Button onClick={() => void handlePickFolder()}>
          <FolderOpen className="mr-2 size-4" data-icon="inline-start" />
          Set Log Folder
        </Button>
      </GlassPanel>
    </div>
  );
}
