import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  readonly content: ReactNode;
  readonly shortcut?: string | undefined;
  readonly placement?: "top" | "right" | "bottom" | "left";
  readonly delay?: number;
  readonly children: ReactElement;
}

type TooltipTriggerProps = {
  readonly ref?: Ref<HTMLElement>;
  readonly title?: string | undefined;
  readonly "aria-describedby"?: string | undefined;
  readonly onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onFocus?: (event: ReactFocusEvent<HTMLElement>) => void;
  readonly onBlur?: (event: ReactFocusEvent<HTMLElement>) => void;
  readonly onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
};

type TooltipPosition = Readonly<{ top: number; left: number; placement: TooltipProps["placement"] }>;
type OpenListener = (openId: string) => void;

const DEFAULT_DELAY_MS = 600;
const VIEWPORT_INSET_PX = 8;
const TRIGGER_GAP_PX = 8;
const openListeners = new Set<OpenListener>();

function announceOpen(openId: string): void {
  for (const listener of openListeners) listener(openId);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function mergeDescription(existing: string | undefined, tooltipId: string, visible: boolean): string | undefined {
  if (!visible) return existing;
  return [existing, tooltipId].filter(Boolean).join(" ");
}

export function Tooltip({
  content,
  shortcut,
  placement = "top",
  delay = DEFAULT_DELAY_MS,
  children,
}: TooltipProps) {
  const tooltipId = `vectora-tooltip-${useId().replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0, placement });
  const child = Children.only(children) as ReactElement<TooltipTriggerProps>;
  const childProps = child.props;

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  const open = useCallback((wait: number) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      announceOpen(tooltipId);
      setVisible(true);
    }, Math.max(0, wait));
  }, [clearTimer, tooltipId]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let resolvedPlacement = placement;

    const fits = {
      top: triggerRect.top - tooltipRect.height - TRIGGER_GAP_PX >= VIEWPORT_INSET_PX,
      right: triggerRect.right + tooltipRect.width + TRIGGER_GAP_PX <= window.innerWidth - VIEWPORT_INSET_PX,
      bottom: triggerRect.bottom + tooltipRect.height + TRIGGER_GAP_PX <= window.innerHeight - VIEWPORT_INSET_PX,
      left: triggerRect.left - tooltipRect.width - TRIGGER_GAP_PX >= VIEWPORT_INSET_PX,
    };
    if (!fits[resolvedPlacement]) {
      const opposite = { top: "bottom", right: "left", bottom: "top", left: "right" } as const;
      if (fits[opposite[resolvedPlacement]]) resolvedPlacement = opposite[resolvedPlacement];
    }

    let top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
    let left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
    if (resolvedPlacement === "top") top = triggerRect.top - tooltipRect.height - TRIGGER_GAP_PX;
    if (resolvedPlacement === "right") left = triggerRect.right + TRIGGER_GAP_PX;
    if (resolvedPlacement === "bottom") top = triggerRect.bottom + TRIGGER_GAP_PX;
    if (resolvedPlacement === "left") left = triggerRect.left - tooltipRect.width - TRIGGER_GAP_PX;

    setPosition({
      top: Math.max(VIEWPORT_INSET_PX, Math.min(top, window.innerHeight - tooltipRect.height - VIEWPORT_INSET_PX)),
      left: Math.max(VIEWPORT_INSET_PX, Math.min(left, window.innerWidth - tooltipRect.width - VIEWPORT_INSET_PX)),
      placement: resolvedPlacement,
    });
  }, [placement]);

  useLayoutEffect(() => {
    if (visible) updatePosition();
  }, [content, shortcut, updatePosition, visible]);

  useEffect(() => {
    const onAnotherOpen: OpenListener = (openId) => {
      if (openId !== tooltipId) close();
    };
    openListeners.add(onAnotherOpen);
    return () => {
      openListeners.delete(onAnotherOpen);
    };
  }, [close, tooltipId]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [close, updatePosition, visible]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const trigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(childProps.ref, node);
    },
    title: undefined,
    "aria-describedby": mergeDescription(childProps["aria-describedby"], tooltipId, visible),
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
      childProps.onPointerEnter?.(event);
      if (!event.defaultPrevented) open(delay);
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {
      childProps.onPointerLeave?.(event);
      close();
    },
    onFocus: (event: ReactFocusEvent<HTMLElement>) => {
      childProps.onFocus?.(event);
      if (!event.defaultPrevented && event.currentTarget.matches(":focus-visible")) open(0);
    },
    onBlur: (event: ReactFocusEvent<HTMLElement>) => {
      childProps.onBlur?.(event);
      close();
    },
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      childProps.onClick?.(event);
      close();
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      childProps.onKeyDown?.(event);
      if (event.key === "Escape") close();
    },
  });

  return (
    <>
      {trigger}
      {visible && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className="vectora-tooltip"
          data-placement={position.placement}
          role="tooltip"
          style={{ top: position.top, left: position.left }}
        >
          <span className="vectora-tooltip-content">{content}</span>
          {shortcut && <kbd className="vectora-tooltip-shortcut">{shortcut}</kbd>}
        </div>,
        document.body,
      )}
    </>
  );
}
