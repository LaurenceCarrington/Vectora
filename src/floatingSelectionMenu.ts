import type { CADEditor } from './editor';
import { SelectionPopouts } from './selectionPopouts';

/** The shared contextual menu, visible only while the document has a selection. */
export class FloatingSelectionMenu {
  readonly popouts:SelectionPopouts;
  private readonly stage: HTMLElement;
  private readonly grip: HTMLButtonElement;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;
  private readonly inset: number;
  private readonly step: number;
  private readonly largeStep: number;
  private positioned = false;
  private drag: { id: number; x: number; y: number; left: number; top: number; positioned: boolean } | null = null;

  constructor(private menu: HTMLElement, private editor: CADEditor, beforePopout:()=>void=()=>{}) {
    this.popouts=new SelectionPopouts(menu,beforePopout);
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
      this.popouts.close();
      event.preventDefault();
      this.place();
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
    const observer = new ResizeObserver(() => this.place());
    observer.observe(this.stage);observer.observe(this.menu);
    for(const element of this.stage.querySelectorAll<HTMLElement>('.top-toolbar,.document-tabs,.left-toolbar,.right-toolbar,.ruler-left,.ruler-bottom,.workspace-footer,.layers-panel')) observer.observe(element);
    window.addEventListener('resize',()=>this.place());
    window.visualViewport?.addEventListener('resize',()=>this.place());
    window.visualViewport?.addEventListener('scroll',()=>this.place());
  }

  render(suppressed=false): void {
    const count = this.editor.selectedItems.length;
    if (!count || suppressed) {
      this.finishDrag(true);
      if (this.menu.contains(document.activeElement)) this.editor.canvas.focus({ preventScroll: true });
    }
    this.menu.hidden = suppressed || count === 0 || this.editor.patterns.active;
    const label = `${count} selected`;
    if (this.count.textContent !== label) this.count.textContent = label;
    this.place();
    this.popouts.refresh();
  }

  private place(): void {
    if (this.menu.hidden) return;
    if (this.drag || this.positioned) this.moveTo(this.menu.offsetLeft, this.menu.offsetTop);
    else this.moveTo((this.stage.clientWidth - this.menu.offsetWidth) / 2, this.stage.clientHeight - this.menu.offsetHeight - 64);
  }

  private moveTo(x: number, y: number): void {
    const stage=this.stage.getBoundingClientRect(),viewport=window.visualViewport;
    const originX=stage.left+this.stage.clientLeft,originY=stage.top+this.stage.clientTop;
    let left=Math.max(0,(viewport?.offsetLeft??0)-originX),top=Math.max(0,(viewport?.offsetTop??0)-originY);
    let right=Math.min(this.stage.clientWidth,(viewport?viewport.offsetLeft+viewport.width:window.innerWidth)-originX);
    let bottom=Math.min(this.stage.clientHeight,(viewport?viewport.offsetTop+viewport.height:window.innerHeight)-originY);
    // The Paper canvas extends behind the chrome; only the exposed drawing area is usable.
    for(const element of this.stage.querySelectorAll<HTMLElement>('.top-toolbar,.document-tabs,.left-toolbar,.right-toolbar,.ruler-left,.ruler-bottom,.workspace-footer')){
      const rect=element.getBoundingClientRect();if(!rect.width||!rect.height)continue;
      if(element.matches('.left-toolbar,.ruler-left'))left=Math.max(left,rect.right-originX);
      if(element.matches('.right-toolbar'))right=Math.min(right,rect.left-originX);
      if(element.matches('.top-toolbar,.document-tabs'))top=Math.max(top,rect.bottom-originY);
      if(element.matches('.workspace-footer,.ruler-bottom'))bottom=Math.min(bottom,rect.top-originY);
    }
    let overDock=false;
    for(const panel of this.stage.querySelectorAll<HTMLElement>('.layers-panel:not([hidden])')){
      const edge=panel.getBoundingClientRect().left-originX;
      // On narrow screens a dock can cover almost the entire canvas. Keep the menu reachable above it.
      if(edge-left>=220+2*this.inset)right=Math.min(right,edge);else overDock=true;
    }
    this.menu.classList.toggle('is-over-dock',overDock);
    const gapX=Math.min(this.inset,Math.max(0,(right-left-80)/2));
    const gapY=Math.min(this.inset,Math.max(0,(bottom-top-40)/2));
    left+=gapX;right-=gapX;top+=gapY;bottom-=gapY;
    this.menu.style.maxWidth=`${Math.max(0,right-left)}px`;
    this.menu.style.maxHeight=`${Math.max(0,bottom-top)}px`;
    const maxX=Math.max(left,right-this.menu.offsetWidth),maxY=Math.max(top,bottom-this.menu.offsetHeight);
    const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,Math.round(value/this.step)*this.step));
    this.menu.style.left=`${clamp(x,left,maxX)}px`;
    this.menu.style.top=`${clamp(y,top,maxY)}px`;
  }

  private finishDrag(cancel = false): void {
    const drag = this.drag;this.drag = null;
    if (!drag) return;
    if (cancel) { this.positioned = drag.positioned;this.moveTo(drag.left, drag.top); }
    this.menu.classList.remove('is-dragging');
    if (this.grip.hasPointerCapture(drag.id)) this.grip.releasePointerCapture(drag.id);
    this.place();
    this.status.textContent = cancel ? 'Menu move cancelled.' : 'Selection menu moved.';
  }
}
