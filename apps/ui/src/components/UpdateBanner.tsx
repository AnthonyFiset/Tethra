import { useEffect, useState } from "react";
import { updateCheck, updateInstall, type UpdateInfoDto } from "../lib/ipc";
import { Button } from "./ui/Button";

/// Checked once per launch against GitHub Releases (`latest.json`).
/// Skipped entirely in Vite/`tauri dev` — release installs only.
export function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfoDto>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    // Sync may not be configured, which is not worth surfacing as an error.
    void updateCheck()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  if (!info?.available || dismissed) return null;

  async function install(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await updateInstall();
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-micro text-fg">
      <span>
        Tethra {info.version} is available — you have {info.currentVersion}.
      </span>
      {error && <span className="text-danger">{error}</span>}
      <div className="ml-auto flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setDismissed(true)}
        >
          Later
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => void install()}
        >
          {busy ? "Installing…" : "Update and restart"}
        </Button>
      </div>
    </div>
  );
}
