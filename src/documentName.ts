/** Borderless, single-line project naming shared by the editor and reference. */
export class DocumentName {
  private value: string;
  constructor(private element: HTMLElement, private rename: (name: string) => void,
    private canEdit: () => boolean = () => true, private save?: (as: boolean) => void) {
    this.value = element.textContent ?? 'Untitled.vectora';
    element.addEventListener('pointerdown', event => {
      if (document.activeElement !== element) { event.preventDefault(); element.focus(); }
    });
    element.addEventListener('focus', () => {
      if (!this.canEdit()) { element.blur(); return; }
      const range = document.createRange();
      range.setStart(element.firstChild!, 0);
      range.setEnd(element.firstChild!, this.value.replace(/\.vectora$/i, '').length);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    });
    element.addEventListener('blur', () => this.commit());
    element.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); element.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); this.setName(this.value); element.blur(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && this.save) {
        event.preventDefault(); element.blur(); this.save(event.shiftKey);
      }
    });
    element.addEventListener('beforeinput', event => {
      if ((event as InputEvent).inputType.startsWith('insertParagraph') || (event as InputEvent).inputType === 'insertLineBreak') event.preventDefault();
    });
    element.addEventListener('paste', event => {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!element.contains(range.commonAncestorContainer)) return;
      const text = document.createTextNode((event.clipboardData?.getData('text/plain') ?? '').replace(/[\r\n\t]+/g, ' ').slice(0,200));
      range.deleteContents(); range.insertNode(text); range.setStartAfter(text); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
    });
    element.addEventListener('drop', event => event.preventDefault());
  }
  setName(value: string): void {
    this.value = value; this.element.textContent = value; this.element.title = 'Click to rename project';
  }
  commit(): void {
    const base = (this.element.textContent ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().replace(/(?:\.vectora)+$/i, '').replace(/[. ]+$/g, '');
    const name = base ? `${Array.from(base).slice(0,180).join('')}.vectora` : this.value;
    const changed = name !== this.value;
    this.setName(name);
    if (changed) this.rename(name);
  }
}
