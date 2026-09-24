type Side = "top" | "right" | "bottom" | "left";
type Alignment = "start" | "center" | "end";

interface MenuPlacement {
  readonly side: Side;
  readonly align?: Alignment;
  readonly gap?: number;
}

interface MenuTarget extends MenuPlacement {
  readonly selector: string;
  readonly anchor: (menu: HTMLElement) => HTMLElement | null;
}

const EDGE_GAP = 8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function placeMenu(menu: HTMLElement, anchor: HTMLElement, placement: MenuPlacement, safe: CSSStyleDeclaration): void {
  const visual = window.visualViewport;
  const left = (visual?.offsetLeft ?? 0) + Number.parseFloat(safe.paddingLeft) + EDGE_GAP;
  const top = (visual?.offsetTop ?? 0) + Number.parseFloat(safe.paddingTop) + EDGE_GAP;
  const right = (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth)
    - Number.parseFloat(safe.paddingRight) - EDGE_GAP;
  const bottom = (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight)
    - Number.parseFloat(safe.paddingBottom) - EDGE_GAP;
  const gap = placement.gap ?? 8;
  const anchorRect = anchor.getBoundingClientRect();

  menu.style.maxWidth = `${Math.max(1, right - left)}px`;
  menu.style.maxHeight = "";
  const width = Math.min(menu.offsetWidth, right - left);
  const naturalHeight = menu.scrollHeight;
  const available: Record<Side, number> = {
    top: anchorRect.top - top - gap,
    right: right - anchorRect.right - gap,
    bottom: bottom - anchorRect.bottom - gap,
    left: anchorRect.left - left - gap,
  };
  const opposite: Record<Side, Side> = { top: "bottom", right: "left", bottom: "top", left: "right" };
  const needed = placement.side === "top" || placement.side === "bottom" ? naturalHeight : width;
  const alternate = opposite[placement.side];
  const side = available[placement.side] < needed && available[alternate] > available[placement.side]
    ? alternate : placement.side;
  const vertical = side === "top" || side === "bottom";
  const height = Math.min(naturalHeight, Math.max(1, vertical ? available[side] : bottom - top));
  menu.style.maxHeight = `${height}px`;
  menu.style.overflowY = "auto";

  const align = placement.align ?? "start";
  let menuLeft: number;
  let menuTop: number;
  if (vertical) {
    menuLeft = align === "end" ? anchorRect.right - width
      : align === "center" ? (anchorRect.left + anchorRect.right - width) / 2 : anchorRect.left;
    menuTop = side === "bottom" ? anchorRect.bottom + gap : anchorRect.top - height - gap;
  } else {
    menuLeft = side === "right" ? anchorRect.right + gap : anchorRect.left - width - gap;
    menuTop = align === "end" ? anchorRect.bottom - height
      : align === "center" ? (anchorRect.top + anchorRect.bottom - height) / 2 : anchorRect.top;
  }
  menuLeft = clamp(menuLeft, left, right - width);
  menuTop = clamp(menuTop, top, bottom - height);

  const fixed = getComputedStyle(menu).position === "fixed";
  const parent = fixed ? null : menu.offsetParent as HTMLElement | null;
  const parentRect = parent?.getBoundingClientRect();
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  menu.style.left = `${menuLeft - (parentRect?.left ?? 0) - (parent?.clientLeft ?? 0)}px`;
  menu.style.top = `${menuTop - (parentRect?.top ?? 0) - (parent?.clientTop ?? 0)}px`;
}

/** Repositions only open menus; commands, focus, and dismissal stay with their owners. */
export function observeWorkspaceMenus(root: HTMLElement): () => void {
  const targets: readonly MenuTarget[] = [
    { selector: ".file-menu", anchor: (menu) => menu.closest(".file-menu-wrap")?.querySelector('[aria-label="File menu"]') ?? null, side: "bottom" },
    { selector: ".edit-menu", anchor: (menu) => menu.closest(".file-menu-wrap")?.querySelector('[aria-label="Edit menu"]') ?? null, side: "bottom" },
    { selector: ".mobile-more-menu", anchor: (menu) => menu.closest(".mobile-more-wrap")?.querySelector('[aria-label="More"]') ?? null, side: "bottom", align: "end" },
    { selector: ".select-menu, .line-menu, .shape-menu, .dimension-menu, .fill-tool-menu",
      anchor: (menu) => menu.closest(".shape-trigger-wrap")?.querySelector("button") ?? null,
      side: "right" },
    { selector: ".mobile-tool-menu", anchor: (menu) => menu.closest(".mobile-tool-group")?.querySelector("[data-mobile-tool-group]") ?? null,
      side: "top", align: "center" },
    { selector: ".join-tolerance-popover", anchor: () => root.querySelector('[data-menu-anchor="join"]'), side: "top", align: "center" },
    { selector: ".node-type-menu:popover-open", anchor: (menu) => menu.parentElement?.querySelector(".node-type-trigger") ?? null,
      side: "top" },
  ];
  const safeProbe = document.createElement("div");
  safeProbe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(safeProbe);
  let frame = 0;
  const observed = new Set<Element>();
  const sizes = new ResizeObserver(() => schedule());
  const position = () => {
    frame = 0;
    for (const element of observed) {
      if (!element.isConnected) {
        sizes.unobserve(element);
        observed.delete(element);
      }
    }
    const safe = getComputedStyle(safeProbe);
    for (const target of targets) {
      for (const menu of root.querySelectorAll<HTMLElement>(target.selector)) {
        if (!menu.offsetWidth || !menu.offsetHeight) continue;
        const anchor = target.anchor(menu);
        if (!anchor) continue;
        if (!observed.has(menu)) { sizes.observe(menu); observed.add(menu); }
        if (!observed.has(anchor)) { sizes.observe(anchor); observed.add(anchor); }
        const placement = target.selector.includes("select-menu") &&
          window.innerWidth >= 768 && window.innerHeight <= 500
          ? { ...target, side: "bottom" as const } : target;
        placeMenu(menu, anchor, placement, safe);
      }
    }
  };
  const schedule = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(root, { childList: true, subtree: true });
  root.addEventListener("toggle", schedule, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  schedule();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    mutations.disconnect();
    sizes.disconnect();
    root.removeEventListener("toggle", schedule, true);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
    safeProbe.remove();
  };
}
