import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { BezierNodeType } from "../../document/types";
import type { NodeEditSelection } from "../../store/useVectorStore";
import { toast } from "./Toast";

export function NodeTypeMenu({ selectedNode, disabledReason, contextKey, onChange }: {
  readonly selectedNode: NodeEditSelection | null;
  readonly disabledReason: string | null;
  readonly contextKey: string;
  readonly onChange: (nodeType: BezierNodeType) => void;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => { menuRef.current?.hidePopover(); }, [contextKey]);
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current!;
    (menu.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLButtonElement>("button"))?.focus();
  }, [open]);

  const close = () => {
    menuRef.current?.hidePopover();
    triggerRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Do not let menu keys reach the canvas's node-edit shortcuts.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="node-type-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => menuRef.current?.togglePopover()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            menuRef.current?.showPopover();
          }
        }}
      >Node type <ChevronDown size={11} aria-hidden="true" /></button>
      <div
        ref={menuRef}
        id={id}
        className="node-type-menu"
        popover="auto"
        role="menu"
        aria-label="Node type"
        aria-describedby={`${id}-hint`}
        onToggle={(event) => setOpen(event.newState === "open")}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) menuRef.current?.hidePopover();
        }}
      >
        {(["corner", "smooth", "symmetric"] as const).map((nodeType) => (
          <button
            key={nodeType}
            type="button"
            role="menuitemradio"
            tabIndex={-1}
            aria-checked={selectedNode?.nodeType === nodeType}
            aria-disabled={Boolean(disabledReason)}
            onClick={() => {
              if (disabledReason) { toast.info(disabledReason); return; }
              onChange(nodeType);
              close();
            }}
          >
            {nodeType[0]!.toUpperCase() + nodeType.slice(1)}
            {selectedNode?.nodeType === nodeType && <Check size={13} aria-hidden="true" />}
          </button>
        ))}
        <p id={`${id}-hint`}>
          {disabledReason ?? `Applies to node ${selectedNode!.vertexIndex + 1}.`}
        </p>
      </div>
    </>
  );
}
