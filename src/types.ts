export interface Dependency {
  name: string;
  min_version: number | null;
}

export interface AddonManifest {
  folderName: string;
  title: string;
  author: string;
  version: string;
  addonVersion: number | null;
  apiVersion: number[];
  description: string;
  isLibrary: boolean;
  dependsOn: Dependency[];
  optionalDependsOn: Dependency[];
  missingDependencies: string[];
  esouiId: number | null;
}

export interface EsouiAddonInfo {
  id: number;
  title: string;
  version: string;
  downloadUrl: string;
}

export interface InstallResult {
  installedFolders: string[];
  installedDeps: string[];
  failedDeps: string[];
  skippedDeps: string[];
}

export interface UpdateCheckResult {
  folderName: string;
  esouiId: number;
  currentVersion: string;
  remoteVersion: string;
  downloadUrl: string;
  hasUpdate: boolean;
}

export interface ImportResult {
  installed: string[];
  failed: string[];
  skipped: string[];
}

export interface EsouiSearchResult {
  id: number;
  title: string;
  author: string;
  category: string;
  downloads: string;
  updated: string;
}

export interface EsouiAddonDetail {
  id: number;
  title: string;
  version: string;
  author: string;
  description: string;
  compatibility: string;
  fileSize: string;
  totalDownloads: string;
  monthlyDownloads: string;
  favorites: string;
  updated: string;
  created: string;
  screenshots: string[];
  downloadUrl: string;
}
