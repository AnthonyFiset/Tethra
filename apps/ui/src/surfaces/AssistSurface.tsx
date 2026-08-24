import { AssistSettingsPanel } from "../components/AssistSettingsModal";
import { SurfaceShell } from "./SurfaceShell";

export function AssistSurface({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: () => void;
}): React.JSX.Element {
  return (
    <SurfaceShell
      title="Assist"
      description="Provider presets, API keys (by ID only), and connection tests for Assist propose/explain."
      onClose={onClose}
    >
      <AssistSettingsPanel embedded onChanged={onChanged} />
    </SurfaceShell>
  );
}
