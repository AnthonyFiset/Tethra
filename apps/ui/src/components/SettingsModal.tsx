import { useEffect, useState } from "react";
import {
  Bot,
  Keyboard,
  KeyRound,
  Monitor,
  Palette,
  RefreshCw,
  Settings2,
  Sparkles,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import {
  identityDelete,
  identityRename,
  identitySetSyncSecret,
  listIdentities,
  updateCheck,
  vaultSetIdleLockSecs,
  type AgentSpecDto,
  type IdentitySummaryDto,
} from "../lib/ipc";
import { useChrome } from "../lib/ChromeContext";
import { modKeyLabel, shiftModLabel, type ChromeStyle } from "../lib/chrome";
import {
  DEFAULTS,
  getChromeOpacity,
  getDefaultShell,
  getIdleLockSecs,
  getLandingPref,
  getLoginShell,
  getMaterialPref,
  getTerminalBell,
  getTerminalCopyOnSelect,
  getTerminalCursorBlink,
  getTerminalCursorStyle,
  getTerminalFontFamily,
  getTerminalFontSize,
  getTerminalLigatures,
  getTerminalLineHeight,
  getTerminalOpacity,
  getTerminalScrollback,
  IDLE_LOCK_OPTIONS,
  resetTerminalPrefs,
  setChromeOpacity,
  setDefaultShell,
  setIdleLockSecs,
  setLandingPref,
  setLoginShell,
  setMaterialPref,
  setTerminalBell,
  setTerminalCopyOnSelect,
  setTerminalCursorBlink,
  setTerminalCursorStyle,
  setTerminalFontFamily,
  setTerminalFontSize,
  setTerminalLigatures,
  setTerminalLineHeight,
  setTerminalOpacity,
  setTerminalScrollback,
  type CursorStylePref,
  type LandingPref,
  type MaterialPref,
} from "../lib/prefs";
import { cn } from "../lib/cn";
import {
  applyWindowMaterial,
  loadMaterialCapabilities,
} from "../lib/materials";
import type { MaterialCapabilities } from "../lib/ipc";
import { AssistSettingsPanel } from "./AssistSettingsModal";
import { SyncSettingsPanel } from "./SyncSettingsModal";
import { ChangePasswordPanel } from "../vault/ChangePasswordModal";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { ErrorBanner, Field } from "./ui/Field";
import { applyTerminalPrefs } from "../terminal/registry";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "terminal"
  | "shell"
  | "vault"
  | "sync"
  | "ai"
  | "agents"
  | "keyboard"
  | "advanced";

const SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  icon: React.ReactNode;
  keywords: string;
}> = [
  {
    id: "general",
    label: "General",
    icon: <Settings2 size={14} />,
    keywords: "startup landing updates",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: <Palette size={14} />,
    keywords: "theme sidebar density chrome",
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: <TerminalSquare size={14} />,
    keywords: "font size ligature cursor scrollback copy",
  },
  {
    id: "shell",
    label: "Shell",
    icon: <Monitor size={14} />,
    keywords: "shell integration osc login env",
  },
  {
    id: "vault",
    label: "Vault",
    icon: <KeyRound size={14} />,
    keywords: "password lock master recovery idle auto-lock identity ssh key",
  },
  {
    id: "sync",
    label: "Sync",
    icon: <RefreshCw size={14} />,
    keywords: "backend sync host join reset",
  },
  {
    id: "ai",
    label: "AI providers",
    icon: <Sparkles size={14} />,
    keywords: "assist anthropic openai azure api key model",
  },
  {
    id: "agents",
    label: "Agents",
    icon: <Bot size={14} />,
    keywords: "claude codex aider catalog byok inject",
  },
  {
    id: "keyboard",
    label: "Keyboard",
    icon: <Keyboard size={14} />,
    keywords: "shortcuts keymap search palette",
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: <Wrench size={14} />,
    keywords: "diagnostics reset layout version catalog",
  },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSectionId;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onHostsMayHaveChanged: () => void;
  onVaultReplaced: () => void;
  onAssistChanged?: () => void;
  agents: AgentSpecDto[];
  appVersion?: string;
}

export function SettingsModal({
  open,
  onClose,
  initialSection = "general",
  sidebarCollapsed,
  onSidebarCollapsedChange,
  onHostsMayHaveChanged,
  onVaultReplaced,
  onAssistChanged,
  agents,
  appVersion,
}: SettingsModalProps): React.JSX.Element | null {
  const chrome = useChrome();
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const pageShell = chrome !== "mac";

  useEffect(() => {
    if (open) setSection(initialSection);
  }, [open, initialSection]);

  useEffect(() => {
    if (!open || !pageShell) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pageShell, onClose]);

  if (!open) return null;

  const body = (
    <SettingsBody
      section={section}
      setSection={setSection}
      sidebarCollapsed={sidebarCollapsed}
      onSidebarCollapsedChange={onSidebarCollapsedChange}
      onHostsMayHaveChanged={onHostsMayHaveChanged}
      onVaultReplaced={onVaultReplaced}
      onAssistChanged={onAssistChanged}
      agents={agents}
      appVersion={appVersion}
      onClose={onClose}
      chrome={chrome}
      tall={pageShell}
    />
  );

  if (pageShell) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="fixed inset-0 z-50 flex flex-col bg-base"
      >
        <div className="titlebar flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface px-3">
          <span className="text-[15px] font-semibold text-fg">Settings</span>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Settings"
      titleSrOnly
      width="xl"
      contentClassName="!p-0 overflow-hidden"
    >
      {body}
    </Dialog>
  );
}

function SettingsBody({
  section,
  setSection,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  onHostsMayHaveChanged,
  onVaultReplaced,
  onAssistChanged,
  agents,
  appVersion,
  onClose,
  chrome,
  tall,
}: {
  section: SettingsSectionId;
  setSection: (id: SettingsSectionId) => void;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onHostsMayHaveChanged: () => void;
  onVaultReplaced: () => void;
  onAssistChanged?: () => void;
  agents: AgentSpecDto[];
  appVersion?: string;
  onClose: () => void;
  chrome: ChromeStyle;
  tall: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex h-full",
        tall ? "min-h-0" : "min-h-[420px] max-h-[min(72vh,640px)]",
      )}
    >
      <nav
        aria-label="Settings sections"
        className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface p-2"
      >
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSection(entry.id)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
              section === entry.id
                ? "bg-hover text-fg"
                : "text-fg-muted hover:bg-hover/60 hover:text-fg",
            )}
          >
            <span className="text-fg-subtle">{entry.icon}</span>
            {entry.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        <SectionHeading section={section} />
        {section === "general" && <GeneralSection appVersion={appVersion} />}
        {section === "appearance" && (
          <AppearanceSection
            sidebarCollapsed={sidebarCollapsed}
            onSidebarCollapsedChange={onSidebarCollapsedChange}
            chrome={chrome}
          />
        )}
        {section === "terminal" && <TerminalSection />}
        {section === "shell" && <ShellSection />}
        {section === "vault" && <VaultSection onPasswordDone={onClose} />}
        {section === "sync" && (
          <SyncSettingsPanel
            onHostsMayHaveChanged={onHostsMayHaveChanged}
            onVaultReplaced={onVaultReplaced}
          />
        )}
        {section === "ai" && (
          <AssistSettingsPanel embedded onChanged={onAssistChanged} />
        )}
        {section === "agents" && <AgentsSection agents={agents} />}
        {section === "keyboard" && <KeyboardSection chrome={chrome} />}
        {section === "advanced" && (
          <AdvancedSection
            onResetSidebar={() => onSidebarCollapsedChange(false)}
            appVersion={appVersion}
          />
        )}
      </div>
    </div>
  );
}

/** Map palette search terms → settings section. */
export function settingsSectionForQuery(
  query: string,
): SettingsSectionId | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  for (const entry of SECTIONS) {
    if (
      entry.label.toLowerCase().includes(q) ||
      entry.keywords.includes(q) ||
      entry.id.includes(q)
    ) {
      return entry.id;
    }
  }
  return undefined;
}

export const SETTINGS_PALETTE_ENTRIES = SECTIONS.map((entry) => ({
  id: entry.id,
  label: entry.label,
  value: `settings ${entry.label} ${entry.keywords}`,
}));

function SectionHeading({
  section,
}: {
  section: SettingsSectionId;
}): React.JSX.Element {
  const entry = SECTIONS.find((item) => item.id === section);
  return (
    <h3 className="mt-0 mb-4 text-[15px] font-semibold text-fg">
      {entry?.label ?? "Settings"}
    </h3>
  );
}

function GeneralSection({
  appVersion,
}: {
  appVersion?: string;
}): React.JSX.Element {
  const [landing, setLanding] = useState<LandingPref>(() => getLandingPref());
  const [updateMsg, setUpdateMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <PrefRow
        title="Default landing"
        detail="Where the main window opens after unlock"
        defaultLabel="Launcher"
      >
        <select
          className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
          value={landing}
          onChange={(event) => {
            const next = event.target.value as LandingPref;
            setLanding(next);
            setLandingPref(next);
          }}
        >
          <option value="launcher">Launcher</option>
          <option value="workspace">Last workspace</option>
        </select>
      </PrefRow>
      <PrefRow
        title="Check for updates"
        detail={appVersion ? `Current ${appVersion}` : "Ask the sync host"}
      >
        <Button
          variant="subtle"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setUpdateMsg(undefined);
            void updateCheck()
              .then((info) => {
                setUpdateMsg(
                  info.available
                    ? `Update available: ${info.version ?? "new version"}`
                    : "You're on the latest version.",
                );
              })
              .catch((reason: unknown) => setUpdateMsg(String(reason)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Checking…" : "Check now"}
        </Button>
      </PrefRow>
      {updateMsg && (
        <p className="m-0 text-micro text-fg-muted">{updateMsg}</p>
      )}
    </div>
  );
}

function AppearanceSection({
  sidebarCollapsed,
  onSidebarCollapsedChange,
  chrome,
}: {
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  chrome: ChromeStyle;
}): React.JSX.Element {
  const [material, setMaterial] = useState<MaterialPref>(() => getMaterialPref());
  const [chromeOpacity, setChromeOpacityState] = useState(() =>
    getChromeOpacity(),
  );
  const [terminalOpacity, setTerminalOpacityState] = useState(() =>
    getTerminalOpacity(),
  );
  const [caps, setCaps] = useState<MaterialCapabilities>();
  const [statusMsg, setStatusMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadMaterialCapabilities().then(setCaps);
  }, []);

  async function commitMaterial(next: MaterialPref): Promise<void> {
    setMaterial(next);
    setMaterialPref(next);
    setBusy(true);
    setStatusMsg(undefined);
    try {
      const result = await applyWindowMaterial(next);
      if (result?.message) setStatusMsg(result.message);
      else if (result?.applied && result.applied !== "none") {
        setStatusMsg(`Applied ${result.applied}.`);
      } else if (next === "opaque") {
        setStatusMsg(undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PrefRow
        title="Sidebar"
        detail="Expanded shows labels; rail is icon-only"
        defaultLabel="Expanded"
      >
        <select
          className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
          value={sidebarCollapsed ? "rail" : "expanded"}
          onChange={(event) => {
            onSidebarCollapsedChange(event.target.value === "rail");
          }}
        >
          <option value="expanded">Expanded</option>
          <option value="rail">Rail</option>
        </select>
      </PrefRow>
      <PrefRow title="Chrome style" detail="Resolved from the host OS">
        <span className="font-mono text-micro text-fg-muted uppercase">
          {chrome}
        </span>
      </PrefRow>
      <PrefRow
        title="Window material"
        detail={
          caps?.note ??
          "Opaque keeps the WebGL terminal solid. Vibrant is chrome-only translucency."
        }
        defaultLabel="Opaque"
        onReset={() => {
          setChromeOpacityState(DEFAULTS.chromeOpacity);
          setChromeOpacity(DEFAULTS.chromeOpacity);
          void commitMaterial(DEFAULTS.material);
        }}
      >
        <select
          className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
          value={material}
          disabled={busy}
          onChange={(event) => {
            void commitMaterial(event.target.value as MaterialPref);
          }}
        >
          <option value="opaque">Opaque</option>
          <option value="vibrant">Vibrant</option>
          <option value="custom">Custom opacity</option>
          {(caps?.acrylic || chrome === "win") && (
            <option value="acrylic">Acrylic (may stutter)</option>
          )}
        </select>
      </PrefRow>
      {(material === "custom" || material === "vibrant" || material === "acrylic") && (
        <>
          <PrefRow
            title="Chrome opacity"
            detail="Sidebar, titlebar, launcher — not the terminal"
            defaultLabel={`${DEFAULTS.chromeOpacity}%`}
            onReset={() => {
              setChromeOpacityState(DEFAULTS.chromeOpacity);
              setChromeOpacity(DEFAULTS.chromeOpacity);
              void applyWindowMaterial(material);
            }}
          >
            <input
              type="range"
              min={85}
              max={100}
              value={chromeOpacity}
              onChange={(event) => {
                const next = Number(event.target.value);
                setChromeOpacityState(next);
                setChromeOpacity(next);
                void applyWindowMaterial(material);
              }}
            />
            <span className="w-10 text-right font-mono text-micro text-fg-muted">
              {chromeOpacity}%
            </span>
          </PrefRow>
          <PrefRow
            title="Terminal opacity"
            detail="Kept opaque for WebGL stability (reserved)"
            defaultLabel="100%"
          >
            <input
              type="range"
              min={85}
              max={100}
              value={terminalOpacity}
              disabled
              onChange={(event) => {
                const next = Number(event.target.value);
                setTerminalOpacityState(next);
                setTerminalOpacity(next);
              }}
            />
            <span className="w-10 text-right font-mono text-micro text-fg-muted">
              {terminalOpacity}%
            </span>
          </PrefRow>
        </>
      )}
      {statusMsg && (
        <p className="m-0 text-micro text-fg-muted">{statusMsg}</p>
      )}
      <p className="m-0 text-micro text-fg-subtle">
        On Windows the accent follows the system color. macOSPrivateApi is
        enabled for vibrancy (signed .dmg distribution, not Mac App Store).
      </p>
    </div>
  );
}

function TerminalSection(): React.JSX.Element {
  const [fontSize, setFontSize] = useState(() => getTerminalFontSize());
  const [fontFamily, setFontFamily] = useState(() => getTerminalFontFamily());
  const [lineHeight, setLineHeight] = useState(() => getTerminalLineHeight());
  const [ligatures, setLigatures] = useState(() => getTerminalLigatures());
  const [cursorBlink, setCursorBlink] = useState(() =>
    getTerminalCursorBlink(),
  );
  const [cursorStyle, setCursorStyle] = useState<CursorStylePref>(() =>
    getTerminalCursorStyle(),
  );
  const [scrollback, setScrollback] = useState(() => getTerminalScrollback());
  const [copyOnSelect, setCopyOnSelect] = useState(() =>
    getTerminalCopyOnSelect(),
  );
  const [bell, setBell] = useState(() => getTerminalBell());

  function apply(): void {
    applyTerminalPrefs();
  }

  return (
    <div className="flex flex-col gap-4">
      <PrefRow
        title="Font family"
        detail="Monospace stack for the terminal"
        defaultLabel={DEFAULTS.fontFamily}
        onReset={() => {
          setFontFamily(DEFAULTS.fontFamily);
          setTerminalFontFamily(DEFAULTS.fontFamily);
          apply();
        }}
      >
        <select
          className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
          value={fontFamily}
          onChange={(event) => {
            setFontFamily(event.target.value);
            setTerminalFontFamily(event.target.value);
            apply();
          }}
        >
          <option value="JetBrains Mono">JetBrains Mono</option>
          <option value="SF Mono">SF Mono</option>
          <option value="Menlo">Menlo</option>
          <option value="Cascadia Code">Cascadia Code</option>
          <option value="Consolas">Consolas</option>
        </select>
      </PrefRow>
      <PrefRow
        title="Font size"
        detail="Live terminals update immediately"
        defaultLabel={`${DEFAULTS.fontSize}px`}
        onReset={() => {
          setFontSize(DEFAULTS.fontSize);
          setTerminalFontSize(DEFAULTS.fontSize);
          apply();
        }}
      >
        <input
          type="range"
          min={10}
          max={20}
          value={fontSize}
          onChange={(event) => {
            const next = Number(event.target.value);
            setFontSize(next);
            setTerminalFontSize(next);
            apply();
          }}
        />
        <span className="w-8 text-right font-mono text-micro text-fg-muted">
          {fontSize}
        </span>
      </PrefRow>
      <PrefRow
        title="Line height"
        detail="Spacing between terminal rows"
        defaultLabel={String(DEFAULTS.lineHeight)}
        onReset={() => {
          setLineHeight(DEFAULTS.lineHeight);
          setTerminalLineHeight(DEFAULTS.lineHeight);
          apply();
        }}
      >
        <input
          type="range"
          min={100}
          max={160}
          value={Math.round(lineHeight * 100)}
          onChange={(event) => {
            const next = Number(event.target.value) / 100;
            setLineHeight(next);
            setTerminalLineHeight(next);
            apply();
          }}
        />
        <span className="w-10 text-right font-mono text-micro text-fg-muted">
          {lineHeight.toFixed(2)}
        </span>
      </PrefRow>
      <ToggleRow
        title="Ligatures"
        detail="Coding ligatures in JetBrains Mono"
        defaultOn={DEFAULTS.ligatures}
        checked={ligatures}
        onChange={(on) => {
          setLigatures(on);
          setTerminalLigatures(on);
          apply();
        }}
      />
      <PrefRow
        title="Cursor style"
        detail="Block, underline, or bar"
        defaultLabel={DEFAULTS.cursorStyle}
        onReset={() => {
          setCursorStyle(DEFAULTS.cursorStyle);
          setTerminalCursorStyle(DEFAULTS.cursorStyle);
          apply();
        }}
      >
        <select
          className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
          value={cursorStyle}
          onChange={(event) => {
            const next = event.target.value as CursorStylePref;
            setCursorStyle(next);
            setTerminalCursorStyle(next);
            apply();
          }}
        >
          <option value="bar">Bar</option>
          <option value="block">Block</option>
          <option value="underline">Underline</option>
        </select>
      </PrefRow>
      <ToggleRow
        title="Cursor blink"
        detail="Blinking cursor"
        defaultOn={DEFAULTS.cursorBlink}
        checked={cursorBlink}
        onChange={(on) => {
          setCursorBlink(on);
          setTerminalCursorBlink(on);
          apply();
        }}
      />
      <PrefRow
        title="Scrollback"
        detail="Lines retained above the viewport"
        defaultLabel={`${DEFAULTS.scrollback.toLocaleString()} lines`}
        onReset={() => {
          setScrollback(DEFAULTS.scrollback);
          setTerminalScrollback(DEFAULTS.scrollback);
          apply();
        }}
      >
        <select
          className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
          value={scrollback}
          onChange={(event) => {
            const next = Number(event.target.value);
            setScrollback(next);
            setTerminalScrollback(next);
            apply();
          }}
        >
          <option value={5000}>5,000</option>
          <option value={10000}>10,000</option>
          <option value={25000}>25,000</option>
          <option value={50000}>50,000</option>
        </select>
      </PrefRow>
      <ToggleRow
        title="Copy on select"
        detail="Copy selection to the clipboard automatically"
        defaultOn={DEFAULTS.copyOnSelect}
        checked={copyOnSelect}
        onChange={(on) => {
          setCopyOnSelect(on);
          setTerminalCopyOnSelect(on);
          apply();
        }}
      />
      <ToggleRow
        title="Audible bell"
        detail="Stored preference — visual BEL handling comes with notifications"
        defaultOn={DEFAULTS.bell}
        checked={bell}
        onChange={(on) => {
          setBell(on);
          setTerminalBell(on);
        }}
      />
      <p className="m-0 text-micro text-fg-subtle">
        Option-as-Meta is on for macOS readline / agent keybindings.
      </p>
      <Button
        variant="ghost"
        onClick={() => {
          resetTerminalPrefs();
          setFontSize(DEFAULTS.fontSize);
          setFontFamily(DEFAULTS.fontFamily);
          setLineHeight(DEFAULTS.lineHeight);
          setLigatures(DEFAULTS.ligatures);
          setCursorBlink(DEFAULTS.cursorBlink);
          setCursorStyle(DEFAULTS.cursorStyle);
          setScrollback(DEFAULTS.scrollback);
          setCopyOnSelect(DEFAULTS.copyOnSelect);
          setBell(DEFAULTS.bell);
          apply();
        }}
      >
        Reset terminal defaults
      </Button>
    </div>
  );
}

function ShellSection(): React.JSX.Element {
  const [shell, setShell] = useState(() => getDefaultShell());
  const [login, setLogin] = useState(() => getLoginShell());

  return (
    <div className="flex flex-col gap-4">
      <PrefRow
        title="Default local shell"
        detail="Empty uses $SHELL / system default. Applies to new local terminals."
        defaultLabel="System"
        onReset={() => {
          setShell(DEFAULTS.defaultShell);
          setDefaultShell(DEFAULTS.defaultShell);
        }}
      >
        <input
          className="h-8 w-48 rounded-md border border-line bg-base px-2 font-mono text-ui text-fg"
          value={shell}
          placeholder="/bin/zsh"
          onChange={(event) => {
            setShell(event.target.value);
            setDefaultShell(event.target.value);
          }}
        />
      </PrefRow>
      <ToggleRow
        title="Login shell"
        detail="Pass -l when spawning the local shell"
        defaultOn={DEFAULTS.loginShell}
        checked={login}
        onChange={(on) => {
          setLogin(on);
          setLoginShell(on);
        }}
      />
      <p className="m-0 text-micro text-fg-muted">
        Remote OSC 133 / OSC 7 shell integration is configured{" "}
        <strong className="font-medium text-fg">per host</strong> in the host
        editor.
      </p>
    </div>
  );
}

function AgentsSection({
  agents,
}: {
  agents: AgentSpecDto[];
}): React.JSX.Element {
  const active = agents.filter((agent) => agent.status !== "deprecated");
  const deprecated = agents.filter((agent) => agent.status === "deprecated");
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-micro text-fg-muted">
        Bundled catalog. Bind an Assist key on a project to inject{" "}
        <code className="font-mono">byokEnv</code> at launch.
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {active.map((agent) => (
          <li
            key={agent.id}
            className="flex items-center gap-2 rounded-md border border-line bg-base px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-ui text-fg">
              {agent.name}
            </span>
            <span className="shrink-0 font-mono text-micro text-fg-subtle">
              {agent.command || "—"}
            </span>
            {(agent.byokEnv?.length ?? 0) > 0 && (
              <span className="shrink-0 text-micro text-fg-subtle">
                BYOK
              </span>
            )}
          </li>
        ))}
      </ul>
      {deprecated.length > 0 && (
        <div>
          <span className="text-micro font-medium text-fg-subtle">
            Deprecated
          </span>
          <ul className="mt-1 flex list-none flex-col gap-1 p-0">
            {deprecated.map((agent) => (
              <li
                key={agent.id}
                className="rounded-md border border-line px-3 py-2 text-micro text-fg-subtle"
              >
                {agent.name}
                {agent.successor ? ` → ${agent.successor}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="m-0 text-micro text-fg-subtle">
        Catalog edits:{" "}
        <code className="font-mono">crates/core/data/agents.json</code>. Custom
        presets land in a later release.
      </p>
    </div>
  );
}

function VaultSection({
  onPasswordDone,
}: {
  onPasswordDone: () => void;
}): React.JSX.Element {
  const [idleSecs, setIdleSecs] = useState(() => getIdleLockSecs());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <div className="flex flex-col gap-5">
      <PrefRow
        title="Auto-lock"
        detail="Lock the vault after idle time with no vault activity"
        defaultLabel="15 minutes"
        onReset={() => {
          setIdleSecs(DEFAULTS.idleLockSecs);
          setIdleLockSecs(DEFAULTS.idleLockSecs);
          setBusy(true);
          void vaultSetIdleLockSecs(DEFAULTS.idleLockSecs)
            .then((applied) => setIdleSecs(applied))
            .catch((reason: unknown) => setError(String(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <select
          className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
          value={idleSecs}
          disabled={busy}
          onChange={(event) => {
            const next = Number(event.target.value);
            setIdleSecs(next);
            setIdleLockSecs(next);
            setError(undefined);
            setBusy(true);
            void vaultSetIdleLockSecs(next)
              .then((applied) => setIdleSecs(applied))
              .catch((reason: unknown) => setError(String(reason)))
              .finally(() => setBusy(false));
          }}
        >
          {IDLE_LOCK_OPTIONS.map((option) => (
            <option key={option.secs} value={option.secs}>
              {option.label}
            </option>
          ))}
        </select>
      </PrefRow>
      {error && <p className="m-0 text-micro text-danger">{error}</p>}
      <IdentitiesPanel />
      <div>
        <h4 className="mt-0 mb-3 text-ui font-medium text-fg">
          Change master password
        </h4>
        <ChangePasswordPanel onDone={onPasswordDone} />
      </div>
    </div>
  );
}

function IdentitiesPanel(): React.JSX.Element {
  const [identities, setIdentities] = useState<IdentitySummaryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [renaming, setRenaming] = useState<IdentitySummaryDto>();
  const [renameLabel, setRenameLabel] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{
    identity: IdentitySummaryDto;
    dependents: { id: string; label: string }[];
  }>();

  async function refresh(): Promise<void> {
    setIdentities(await listIdentities());
  }

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(String(reason)));
  }, []);

  async function saveRename(): Promise<void> {
    if (!renaming) return;
    setBusy(true);
    setError(undefined);
    try {
      await identityRename(renaming.id, renameLabel);
      setRenaming(undefined);
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove(
    identity: IdentitySummaryDto,
    force: boolean,
  ): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await identityDelete(identity.id, force);
      if (!result.deleted) {
        setPendingDelete({
          identity,
          dependents: result.dependentHosts,
        });
        return;
      }
      setPendingDelete(undefined);
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="mt-0 mb-1 text-ui font-medium text-fg">Identities</h4>
        <p className="m-0 text-micro text-fg-subtle">
          Password and SSH key identities stored in the vault. Keys sync only if
          you turn it on per key (same opt-in as passwords).
        </p>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {identities.map((identity) => (
          <li
            key={identity.id}
            className="flex flex-col gap-2 rounded-md border border-line bg-base px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-fg">
                  {identity.label}
                </span>
                <span className="block truncate text-micro text-fg-subtle">
                  {identity.kind === "sshKey" ? "SSH key" : "Password"}
                  {identity.fingerprint ? ` · ${identity.fingerprint}` : ""}
                  {` · used by ${identity.usageCount}`}
                  {identity.syncSecret ? " · syncs" : " · local only"}
                </span>
              </span>
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => {
                  setRenaming(identity);
                  setRenameLabel(identity.label);
                }}
              >
                Rename
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void remove(identity, false)}
              >
                Delete
              </Button>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={identity.syncSecret}
                disabled={busy}
                onChange={(event) =>
                  void (async () => {
                    setBusy(true);
                    setError(undefined);
                    try {
                      await identitySetSyncSecret(
                        identity.id,
                        event.target.checked,
                      );
                      await refresh();
                    } catch (reason) {
                      setError(String(reason));
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-fg">
                  {identity.kind === "sshKey"
                    ? "Sync this key to other devices"
                    : "Sync this password to other devices"}
                </span>
                <span className="text-micro text-fg-subtle">
                  Off by default. When on, encrypted credentials ride vault
                  sync. Turning off stops future sync; devices that already
                  have a copy keep it.
                </span>
              </span>
            </label>
          </li>
        ))}
        {identities.length === 0 && (
          <li className="rounded-md border border-dashed border-line px-3 py-4 text-center text-micro text-fg-subtle">
            No identities yet. Import an SSH key when adding a host, or save a
            host with a password.
          </li>
        )}
      </ul>

      {renaming && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setRenaming(undefined);
          }}
          kicker="Identity"
          title="Rename identity"
          description="Update the label shown in host forms and settings."
          footer={
            <>
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => setRenaming(undefined)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy || !renameLabel.trim()}
                onClick={() => void saveRename()}
              >
                Save
              </Button>
            </>
          }
        >
          <Field
            label="Label"
            value={renameLabel}
            onChange={(event) => setRenameLabel(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </Dialog>
      )}

      {pendingDelete && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingDelete(undefined);
          }}
          kicker="Identity"
          title="Delete identity?"
          description="This identity is still attached to hosts. Force delete clears those links."
          footer={
            <>
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => setPendingDelete(undefined)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void remove(pendingDelete.identity, true)}
              >
                Delete anyway
              </Button>
            </>
          }
        >
          <p className="m-0 text-ui text-fg-muted">
            Used by:
          </p>
          <ul className="mt-2 mb-0 flex list-none flex-col gap-1 p-0">
            {pendingDelete.dependents.map((host) => (
              <li
                key={host.id}
                className="rounded-md border border-line px-3 py-2 text-ui text-fg"
              >
                {host.label}
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

function KeyboardSection({
  chrome,
}: {
  chrome: ChromeStyle;
}): React.JSX.Element {
  const mod = modKeyLabel(chrome);
  const shiftMod = shiftModLabel(chrome);
  const [query, setQuery] = useState("");
  const rows = [
    ["Command palette", `${mod}K`],
    ["Settings", chrome === "mac" ? "⌘," : "Ctrl+,"],
    ["Assist", `${mod}I`],
    ["Toggle sidebar", `${mod}B`],
    ["Launcher ↔ Workspace", chrome === "mac" ? "⌘Esc" : "Ctrl+Esc"],
    ["Clear terminal", `${shiftMod}K`],
    ["Close tab", `${mod}W`],
    ["New tab", `${mod}T`],
    ["Split right", chrome === "mac" ? "⌘\\" : "Ctrl+\\"],
    ["Split down", chrome === "mac" ? "⇧⌘\\" : "Ctrl+Shift+\\"],
    ["Zoom pane", chrome === "mac" ? "⇧⌘↩" : "Ctrl+Shift+Enter"],
    ["Copy", chrome === "mac" ? "⌘C" : "Ctrl+Shift+C"],
    ["Paste", chrome === "mac" ? "⌘V" : "Ctrl+Shift+V"],
  ];
  const filtered = rows.filter(([label, shortcut]) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      label.toLowerCase().includes(q) || shortcut.toLowerCase().includes(q)
    );
  });
  return (
    <div className="flex flex-col gap-3">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search shortcuts"
        className="h-8 rounded-md border border-line bg-base px-2 text-ui text-fg"
      />
      <div className="flex flex-col gap-1">
        {filtered.map(([label, shortcut]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-ui"
          >
            <span className="text-fg-muted">{label}</span>
            <kbd className="rounded border border-line bg-base px-1.5 py-0.5 font-mono text-micro text-fg">
              {shortcut}
            </kbd>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="m-0 px-2 text-micro text-fg-subtle">No matches.</p>
        )}
      </div>
    </div>
  );
}

function AdvancedSection({
  onResetSidebar,
  appVersion,
}: {
  onResetSidebar: () => void;
  appVersion?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <PrefRow title="Reset sidebar" detail="Expand the sidebar and clear rail mode">
        <Button variant="subtle" onClick={onResetSidebar}>
          Reset
        </Button>
      </PrefRow>
      <div className="rounded-md border border-line bg-base px-3 py-2 text-micro text-fg-muted">
        <div className="flex justify-between gap-2">
          <span>Version</span>
          <span className="font-mono text-fg">{appVersion ?? "—"}</span>
        </div>
        <div className="mt-1 flex justify-between gap-2">
          <span>Build</span>
          <span className="font-mono text-fg">
            {import.meta.env.DEV ? "dev" : "release"}
          </span>
        </div>
        <div className="mt-1 flex justify-between gap-2">
          <span>Catalog</span>
          <span className="font-mono text-fg">bundled</span>
        </div>
      </div>
      <PrefRow
        title="Export diagnostics"
        detail="Copies version and platform info to the clipboard"
      >
        <Button
          variant="subtle"
          onClick={() => {
            const payload = [
              `Tethra ${appVersion ?? "?"}`,
              `build=${import.meta.env.DEV ? "dev" : "release"}`,
              `ua=${navigator.userAgent}`,
              `platform=${navigator.platform}`,
            ].join("\n");
            void navigator.clipboard.writeText(payload);
          }}
        >
          Copy
        </Button>
      </PrefRow>
    </div>
  );
}

function PrefRow({
  title,
  detail,
  defaultLabel,
  onReset,
  children,
}: {
  title: string;
  detail: string;
  defaultLabel?: string;
  onReset?: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-ui text-fg">{title}</div>
        <div className="text-micro text-fg-subtle">{detail}</div>
        {defaultLabel && (
          <button
            type="button"
            disabled={!onReset}
            onClick={onReset}
            className={cn(
              "mt-0.5 text-micro",
              onReset
                ? "cursor-pointer text-accent hover:underline"
                : "text-fg-subtle",
            )}
          >
            Default: {defaultLabel}
            {onReset ? " · Reset" : ""}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function ToggleRow({
  title,
  detail,
  defaultOn,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  defaultOn: boolean;
  checked: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <PrefRow
      title={title}
      detail={detail}
      defaultLabel={defaultOn ? "On" : "Off"}
      onReset={() => onChange(defaultOn)}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-10 cursor-pointer rounded-full border transition-colors",
          checked ? "border-accent bg-accent" : "border-line bg-base",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-fg transition-transform",
            checked ? "left-5" : "left-0.5",
          )}
        />
      </button>
    </PrefRow>
  );
}
