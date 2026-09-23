import { useEffect, useRef } from "react";
import { documentModel } from "../document/DocumentModel";
import { AddEntitiesCommand, executeCommand } from "../document/History";
import { copySelectedObjects, OBJECT_CLIPBOARD_PREFIX, prepareObjectPaste } from "../io/objectClipboard";
import { useVectorStore } from "../store/useVectorStore";
import { toast } from "../components/ui/Toast";

export function useObjectClipboard(blocked: boolean): void {
  const lastPaste = useRef({ text: "", documentId: "", count: 0 });
  useEffect(() => {
    const skip = (event: ClipboardEvent) => {
      const target = event.target;
      return blocked || event.defaultPrevented
        || Boolean(document.querySelector('[aria-modal="true"]'))
        || (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select"))));
    };
    const onCopy = (event: ClipboardEvent) => {
      if (skip(event) || !event.clipboardData || !window.getSelection()?.isCollapsed) return;
      try {
        const text = copySelectedObjects();
        if (!text) return;
        // Native copy/paste events work on Cmd/Ctrl shortcuts without clipboard permission prompts.
        event.clipboardData.setData("text/plain", text);
        event.preventDefault();
        lastPaste.current = { text: "", documentId: "", count: 0 };
        const count = documentModel.getDocument().selection.size;
        toast.success(`Copied ${count} object${count === 1 ? "" : "s"}.`);
      } catch (error) {
        event.preventDefault();
        toast.error(error instanceof Error ? error.message : "The selected objects could not be copied.");
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (skip(event) || !event.clipboardData) return;
      const text = event.clipboardData.getData("text/plain");
      if (!text.startsWith(OBJECT_CLIPBOARD_PREFIX)) return;
      event.preventDefault();
      try {
        const target = documentModel.getDocument();
        const { viewport, setActiveTool } = useVectorStore.getState();
        const count = lastPaste.current.text === text && lastPaste.current.documentId === target.id ? lastPaste.current.count + 1 : 1;
        const distance = 16 * count / viewport.zoom;
        const entities = prepareObjectPaste(text, target, { x: distance, y: -distance }, {
          x: -viewport.x / viewport.zoom, y: viewport.y / viewport.zoom,
        });
        setActiveTool("select");
        executeCommand(new AddEntitiesCommand(entities, `Paste ${entities.length} object${entities.length === 1 ? "" : "s"}`));
        lastPaste.current = { text, documentId: target.id, count };
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The copied objects could not be pasted.");
      }
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, [blocked]);
}
