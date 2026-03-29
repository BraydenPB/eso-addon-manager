import type { AddonManifest, AuthUser } from "@/types";
import { ApiCompat } from "./api-compat";
import { Backups } from "./backups";
import { Characters } from "./characters";
import { Packs } from "./packs";
import { Profiles } from "./profiles";
import { Settings } from "./settings";

type ActiveDialog =
  | "settings"
  | "profiles"
  | "packs"
  | "backups"
  | "api-compat"
  | "characters"
  | null;

interface AppDialogsProps {
  activeDialog: ActiveDialog;
  addons: AddonManifest[];
  addonsPath: string;
  authUser: AuthUser | null;
  deepLinkPackId: string | null;
  onAuthChange: (user: AuthUser | null) => void;
  onCheckForAppUpdate: () => void;
  onCloseDialog: () => void;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  onShowDialog: (dialog: Exclude<ActiveDialog, null>) => void;
}

export function AppDialogs({
  activeDialog,
  addons,
  addonsPath,
  authUser,
  deepLinkPackId,
  onAuthChange,
  onCheckForAppUpdate,
  onCloseDialog,
  onPathChange,
  onRefresh,
  onShowDialog,
}: AppDialogsProps) {
  return (
    <>
      {activeDialog === "packs" && (
        <Packs
          addonsPath={addonsPath}
          installedAddons={addons}
          authUser={authUser}
          onAuthChange={onAuthChange}
          onClose={onCloseDialog}
          onRefresh={onRefresh}
          initialPackId={deepLinkPackId}
        />
      )}

      {activeDialog === "profiles" && (
        <Profiles addonsPath={addonsPath} onClose={onCloseDialog} onRefresh={onRefresh} />
      )}

      {activeDialog === "backups" && <Backups addonsPath={addonsPath} onClose={onCloseDialog} />}

      {activeDialog === "api-compat" && (
        <ApiCompat addonsPath={addonsPath} onClose={onCloseDialog} />
      )}

      {activeDialog === "characters" && (
        <Characters addonsPath={addonsPath} onClose={onCloseDialog} />
      )}

      {activeDialog === "settings" && (
        <Settings
          addonsPath={addonsPath}
          onPathChange={onPathChange}
          onClose={onCloseDialog}
          onRefresh={onRefresh}
          onShowBackups={() => onShowDialog("backups")}
          onShowApiCompat={() => onShowDialog("api-compat")}
          onShowCharacters={() => onShowDialog("characters")}
          onCheckForAppUpdate={onCheckForAppUpdate}
        />
      )}
    </>
  );
}
