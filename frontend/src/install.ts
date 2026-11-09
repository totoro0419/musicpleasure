import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let promptEvent: InstallPrompt | null = null;
const displayMode = window.matchMedia("(display-mode: standalone)");
const isStandalone = () =>
  displayMode.matches ||
  !!(navigator as Navigator & { standalone?: boolean }).standalone;
let state = { installed: isStandalone(), available: false, busy: false };
const listeners = new Set<() => void>();
function update(change: Partial<typeof state>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  promptEvent = event as InstallPrompt;
  update({ available: true, installed: isStandalone() });
});
window.addEventListener("appinstalled", () => {
  promptEvent = null;
  update({ installed: true, available: false, busy: false });
});
displayMode.addEventListener("change", () => {
  if (isStandalone()) update({ installed: true, available: false });
});
export function useInstallState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}
export async function requestInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const event = promptEvent;
  if (!event || state.busy) return "unavailable";
  promptEvent = null;
  update({ available: false, busy: true });
  try {
    // Call synchronously within the button's user activation, once per event.
    await event.prompt();
    return (await event.userChoice).outcome;
  } finally {
    update({ busy: false });
  }
}
