import { lazy, Suspense } from "react";
import type { AddonManifest, AuthUser } from "@/types";

const Packs = lazy(() => import("./packs").then((m) => ({ default: m.Packs })));
const Profiles = lazy(() => import("./profiles").then((m) => ({ default: m.Profiles })));
const Backups = lazy(() => import("./backups").then((m) => ({ default: m.Backups })));
const ApiCompat = lazy(() => import("./api-compat").then((m) => ({ default: m.ApiCompat })));
const Characters = lazy(() => import("./characters").then((m) => ({ default: m.Characters })));
const Settings = lazy(() => import("./settings").then((m) => ({ default: m.Settings })));

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
  deepLinkShareCode: string | null;
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
  deepLinkShareCode,
  onAuthChange,
  onCheckForAppUpdate,
  onCloseDialog,
  onPathChange,
  onRefresh,
  onShowDialog,
}: AppDialogsProps) {
  if (!activeDialog) return null;

  return (
    <Suspense fallback={null}>
      {activeDialog === "packs" && (
        <Packs
          addonsPath={addonsPath}
          installedAddons={addons}
          authUser={authUser}
          onAuthChange={onAuthChange}
          onClose={onCloseDialog}
          onRefresh={onRefresh}
          initialPackId={deepLinkPackId}
          initialShareCode={deepLinkShareCode}
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
    </Suspense>
  );
}
