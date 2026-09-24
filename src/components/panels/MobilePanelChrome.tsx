import { useEffect, useRef, useSyncExternalStore } from "react";
import { useVectorStore } from "../../store/useVectorStore";

type Panel = "layers" | "properties";
const MOBILE_QUERY = "(max-width: 767px)";

function subscribeToViewport(onChange: () => void): () => void {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function mobileViewport(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useMobilePanelChrome(panel: Panel) {
  const mobile = useSyncExternalStore(subscribeToViewport, mobileViewport, () => false);
  const open = useVectorStore((state) => panel === "layers" ? state.layersOpen : state.propertiesOpen);
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mobile || !open) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panelTrigger = document.querySelector<HTMLButtonElement>(`[aria-controls="${panel}-panel"]`);
    openerRef.current = focused?.matches(`[aria-controls="${panel}-panel"]`) ||
      focused?.closest(".mobile-panel-navigation") ? focused : panelTrigger;
    const focusFrame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>(".panel-close")?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [mobile, open]);

  useEffect(() => {
    if (!mobile || open) return;
    const { layersOpen, propertiesOpen } = useVectorStore.getState();
    if (layersOpen || propertiesOpen) return;
    const focusFrame = requestAnimationFrame(() => {
      const opener = openerRef.current;
      const trigger = opener?.isConnected
        ? opener
        : document.querySelector<HTMLButtonElement>(`[aria-controls="${panel}-panel"]`);
      trigger?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [mobile, open, panel]);

  return { mobile, panelRef };
}

export function MobilePanelNavigation({ active }: { readonly active: Panel }) {
  const togglePanel = useVectorStore((state) => state.togglePanel);
  return (
    <div className="mobile-panel-navigation" role="group" aria-label="Document panels">
      <button type="button" aria-pressed={active === "layers"} className={active === "layers" ? "is-active" : ""}
        onClick={() => togglePanel("layers", true)}>Layers</button>
      <button type="button" aria-pressed={active === "properties"} className={active === "properties" ? "is-active" : ""}
        onClick={() => togglePanel("properties", true)}>Properties</button>
    </div>
  );
}
