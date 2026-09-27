import type { CADEditor } from './editor';

/** The shared contextual menu, visible only while the document has a selection. */
export class FloatingSelectionMenu {
  private readonly stage: HTMLElement;
  private readonly grip: HTMLButtonElement;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;
  private readonly inset: number;
  private readonly step: number;
  private readonly largeStep: number;
  private positioned = false;
  private drag: { id: number; x: number; y: number; left: number; top: number; positioned: boolean } | null = null;

  constructor(private menu: HTMLElement, private editor: CADEditor) {
    this.stage = menu.parentElement!;
    this.grip = menu.querySelector('.drag-handle')!;
    this.count = menu.querySelector('.selection-count')!;
    this.status = menu.querySelector('[role="status"]')!;
    const tokens = getComputedStyle(document.documentElement);
    this.inset = parseInt(tokens.getPropertyValue('--floating-edge-inset'), 10);
    this.step = parseInt(tokens.getPropertyValue('--drag-step'), 10);
    this.largeStep = parseInt(tokens.getPropertyValue('--drag-step-large'), 10);
    this.grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      this.grip.focus({ preventScroll: true });
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: menu.offsetLeft, top: menu.offsetTop, positioned: this.positioned };
      this.grip.setPointerCapture(event.pointerId);
      menu.classList.add('is-dragging');
    });
    this.grip.addEventListener('pointermove', event => {
      if (this.drag?.id !== event.pointerId) return;
      this.positioned = true;
      this.moveTo(this.drag.left + event.clientX - this.drag.x, this.drag.top + event.clientY - this.drag.y);
    });
    this.grip.addEventListener('pointerup', () => this.finishDrag());
    this.grip.addEventListener('pointercancel', () => this.finishDrag(true));
    this.grip.addEventListener('lostpointercapture', () => this.finishDrag(true));
    window.addEventListener('blur', () => this.finishDrag(true));
    this.grip.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.drag) {
        event.preventDefault();event.stopPropagation();this.finishDrag(true);return;
      }
      const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
      if (!direction) return;
      event.preventDefault();event.stopPropagation();
      if (this.drag) return;
      this.positioned = true;
      const distance = event.shiftKey ? this.largeStep : this.step;
      this.moveTo(menu.offsetLeft + direction[0] * distance, menu.offsetTop + direction[1] * distance);
      this.status.textContent = 'Selection menu moved.';
    });
    new ResizeObserver(() => this.place()).observe(this.stage);
  }

  render(): void {
    const count = this.editor.selectedItems.length;
    if (!count) {
      this.finishDrag(true);
      if (this.menu.contains(document.activeElement)) this.editor.canvas.focus({ preventScroll: true });
    }
    this.menu.hidden = count === 0;
    const label = `${count} selected`;
    if (this.count.textContent !== label) this.count.textContent = label;
    this.place();
  }

  private place(): void {
    if (this.menu.hidden || this.drag) return;
    if (this.positioned) this.moveTo(this.menu.offsetLeft, this.menu.offsetTop);
    else this.moveTo((this.stage.clientWidth - this.menu.offsetWidth) / 2, this.stage.clientHeight - this.menu.offsetHeight - 64);
  }

  private moveTo(x: number, y: number): void {
    const maxX = Math.max(this.inset, this.stage.clientWidth - this.menu.offsetWidth - this.inset);
    const maxY = Math.max(this.inset, this.stage.clientHeight - this.menu.offsetHeight - this.inset);
    this.menu.style.left = `${Math.min(maxX, Math.max(this.inset, Math.round(x / this.step) * this.step))}px`;
    this.menu.style.top = `${Math.min(maxY, Math.max(this.inset, Math.round(y / this.step) * this.step))}px`;
  }

  private finishDrag(cancel = false): void {
    const drag = this.drag;this.drag = null;
    if (!drag) return;
    if (cancel) { this.positioned = drag.positioned;this.moveTo(drag.left, drag.top); }
    this.menu.classList.remove('is-dragging');
    if (this.grip.hasPointerCapture(drag.id)) this.grip.releasePointerCapture(drag.id);
    this.status.textContent = cancel ? 'Menu move cancelled.' : 'Selection menu moved.';
  }
}
