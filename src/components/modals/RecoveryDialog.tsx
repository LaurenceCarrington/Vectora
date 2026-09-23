import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { documentModel } from "../../document/DocumentModel";
import { history } from "../../document/History";
import { filePersistence } from "../../io/filePersistence";
import { recoveryController } from "../../recovery/recoveryController";
import { deleteRecovery, getRecovery, listRecoveries, type RecoveryCandidate } from "../../recovery/recoveryStore";
import { useVectorStore } from "../../store/useVectorStore";
import { toast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";

export function RecoveryDialog() {
  const [candidates, setCandidates] = useState<RecoveryCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let mounted = true;
    recoveryController.start((message) => toast.warning(message, 8_000));
    void listRecoveries().then((records) => {
      if (mounted) setCandidates(records);
    }).catch((error: unknown) => {
      console.error("Local recoveries could not be listed.", error);
      toast.warning("Local recovery is unavailable. Save your project manually to avoid losing changes.", 8_000);
    });
    return () => { mounted = false; recoveryController.stop(); };
  }, []);

  useEffect(() => {
    if (dismissed || candidates.length === 0) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [candidates.length, dismissed]);

  const recover = async (candidate: RecoveryCandidate) => {
    if (filePersistence.isDirty()) {
      toast.warning("Save or discard the current drawing before recovering another one.");
      return;
    }
    setBusy(true);
    try {
      // Read again: another tab or a later write may have changed this record.
      const latest = await getRecovery(candidate.documentId);
      if (!latest?.document) {
        toast.error("That local recovery copy is damaged. The current drawing was not changed.");
        setCandidates(await listRecoveries());
        return;
      }
      documentModel.replaceDocument(latest.document);
      history.clear();
      filePersistence.markImported(); // Recovery is unsaved; it is never a confirmed native file save.
      useVectorStore.getState().setActiveTool("select");
      setCandidates((records) => records.filter((record) => record.documentId !== candidate.documentId));
      toast.info(latest.source === "previous" ? "Recovered the previous valid local copy. Save a Vectora file to keep it." : "Unsaved drawing recovered locally. Save a Vectora file to keep it.", 8_000);
    } catch (error) {
      console.error("Local recovery could not be restored.", error);
      toast.error("The drawing could not be recovered. The current drawing was not changed.");
    } finally { setBusy(false); }
  };

  const discard = async (candidate: RecoveryCandidate) => {
    setBusy(true);
    try {
      await deleteRecovery(candidate.documentId);
      setCandidates((records) => records.filter((record) => record.documentId !== candidate.documentId));
    } catch (error) {
      console.error("Local recovery could not be discarded.", error);
      toast.error("That recovery copy could not be removed.");
    } finally { setBusy(false); }
  };

  if (dismissed || candidates.length === 0) return null;
  return <AnimatePresence><motion.div className="phase-modal-backdrop recovery-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section className="phase-modal surface unsaved-modal recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-dialog-title" aria-describedby="recovery-dialog-description" ref={dialogRef} tabIndex={-1}
      initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); setDismissed(true); return; }
        if (event.key !== "Tab") return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header>
        <div><span className="eyebrow">Local recovery</span><h2 id="recovery-dialog-title">Unsaved work found</h2></div>
        <Tooltip content="Continue without recovering" placement="left"><button className="panel-close" disabled={busy} onClick={() => setDismissed(true)} aria-label="Continue without recovering"><X size={20} /></button></Tooltip>
      </header>
      <div className="panel-rule" />
      <div className="recovery-dialog-body">
        <h3>Choose a drawing to recover</h3>
        <p id="recovery-dialog-description">These emergency copies are stored in this browser and are not saved project files.</p>
        <ul>{candidates.map((candidate) => <li key={candidate.documentId}>
          <div><strong>{candidate.documentName}</strong><small>{candidate.source === "corrupt"
            ? candidate.error
            : `${new Date(candidate.updatedAt).toLocaleString()} · ${candidate.documentId.slice(0, 12)}${candidate.source === "previous" ? " · previous valid copy" : ""}`}</small></div>
          <div className="recovery-row-actions">
            {candidate.document && <button type="button" className="primary" disabled={busy} onClick={() => void recover(candidate)}>Recover</button>}
            <button type="button" className="danger-subtle" disabled={busy} onClick={() => void discard(candidate)}>Discard</button>
          </div>
        </li>)}</ul>
      </div>
      <footer><button type="button" disabled={busy} onClick={() => setDismissed(true)}>Continue without recovering</button></footer>
    </motion.section>
  </motion.div></AnimatePresence>;
}
