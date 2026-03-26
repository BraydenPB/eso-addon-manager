import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AddonManifest, UpdateCheckResult, InstallResult } from "../types";

interface AddonDetailProps {
  addon: AddonManifest | null;
  installedAddons: AddonManifest[];
  addonsPath: string;
  onRemove: () => void;
  updateResult: UpdateCheckResult | null;
  onUpdated: () => void;
}

export function AddonDetail({
  addon,
  installedAddons,
  addonsPath,
  onRemove,
  updateResult,
  onUpdated,
}: AddonDetailProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  if (!addon) {
    return (
      <div className="detail-panel">
        <div className="detail-empty">Select an addon to view details</div>
      </div>
    );
  }

  const installedSet = new Set(installedAddons.map((a) => a.folderName));

  const dependents = installedAddons.filter((a) =>
    a.dependsOn.some((dep) => dep.name === addon.folderName),
  );

  const handleRemove = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await invoke("remove_addon", {
        addonsPath,
        folderName: addon.folderName,
      });
      setConfirmingRemove(false);
      onRemove();
    } catch (e) {
      setRemoveError(String(e));
      setRemoving(false);
    }
  };

  const handleUpdate = async () => {
    if (!updateResult) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      await invoke<InstallResult>("update_addon", {
        addonsPath,
        esouiId: updateResult.esouiId,
      });
      onUpdated();
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="detail-panel">
      <h2 className="detail-title">{addon.title}</h2>
      <div className="detail-folder">
        {addon.folderName}/
        {addon.esouiId && (
          <span className="detail-esoui-id">
            {" "}&middot;{" "}
            <a
              className="esoui-link"
              href={`https://www.esoui.com/downloads/info${addon.esouiId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              ESOUI #{addon.esouiId}
            </a>
          </span>
        )}
      </div>

      {updateResult?.hasUpdate && (
        <div className="update-available">
          <div className="update-version-info">
            Update available: {updateResult.currentVersion} &rarr;{" "}
            {updateResult.remoteVersion}
          </div>
          <button
            className="btn btn-accent"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? "Updating..." : "Update"}
          </button>
        </div>
      )}

      {updateError && <div className="install-error">{updateError}</div>}

      <dl className="detail-meta">
        {addon.author && (
          <>
            <dt>Author</dt>
            <dd>{addon.author}</dd>
          </>
        )}
        <dt>Version</dt>
        <dd>{addon.version || addon.addonVersion || "Unknown"}</dd>
        {addon.apiVersion.length > 0 && (
          <>
            <dt>API Version</dt>
            <dd>{addon.apiVersion.join(", ")}</dd>
          </>
        )}
        <dt>Type</dt>
        <dd>{addon.isLibrary ? "Library" : "Addon"}</dd>
      </dl>

      {addon.description && (
        <div className="detail-section">
          <h3>Description</h3>
          <p>{addon.description}</p>
        </div>
      )}

      {addon.dependsOn.length > 0 && (
        <div className="detail-section">
          <h3>Required Dependencies</h3>
          <ul className="dep-list">
            {addon.dependsOn.map((dep) => {
              const installed = installedSet.has(dep.name);
              return (
                <li key={dep.name}>
                  <span className={installed ? "dep-ok" : "dep-missing"}>
                    {installed ? "\u2713" : "\u2717"}
                  </span>
                  <span>{dep.name}</span>
                  {dep.min_version !== null && (
                    <span className="addon-item-version">
                      {" "}
                      &gt;={dep.min_version}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {addon.optionalDependsOn.length > 0 && (
        <div className="detail-section">
          <h3>Optional Dependencies</h3>
          <ul className="dep-list">
            {addon.optionalDependsOn.map((dep) => {
              const installed = installedSet.has(dep.name);
              return (
                <li key={dep.name} className="dep-optional">
                  <span className={installed ? "dep-ok" : ""}>
                    {installed ? "\u2713" : "\u25CB"}
                  </span>
                  <span>{dep.name}</span>
                  {dep.min_version !== null && (
                    <span className="addon-item-version">
                      {" "}
                      &gt;={dep.min_version}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="detail-actions">
        {!confirmingRemove ? (
          <button
            className="btn btn-danger"
            onClick={() => {
              setConfirmingRemove(true);
              setRemoveError(null);
            }}
          >
            Remove Addon
          </button>
        ) : (
          <div className="confirm-remove">
            <p className="confirm-text">
              Remove <strong>{addon.title}</strong>?
            </p>
            {dependents.length > 0 && (
              <p className="confirm-warning">
                Warning: {dependents.map((d) => d.title).join(", ")}{" "}
                {dependents.length === 1 ? "depends" : "depend"} on this addon.
              </p>
            )}
            {removeError && <p className="install-error">{removeError}</p>}
            <div className="confirm-actions">
              <button
                className="btn"
                onClick={() => setConfirmingRemove(false)}
                disabled={removing}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleRemove}
                disabled={removing}
              >
                {removing ? "Removing..." : "Confirm Remove"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
