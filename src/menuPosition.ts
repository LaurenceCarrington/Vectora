/** Keep toolbar flyouts flush with the rail and aligned to their own trigger. */
export function alignPopoutWithTrigger(panel:HTMLElement,trigger:HTMLElement):void {
  const toolbar=trigger.closest<HTMLElement>('.toolbar');
  if(!toolbar||panel.hidden)return;
  const rail=toolbar.getBoundingClientRect(),button=trigger.getBoundingClientRect();
  const docked=toolbar.classList.contains('left-toolbar');
  const workspace=toolbar.parentElement!.getBoundingClientRect();
  panel.style.maxHeight=docked?`${Math.max(0,rail.height)}px`:'';
  panel.style.maxWidth=docked?`${Math.max(0,workspace.right-rail.right)}px`:'';
  panel.style.top='0px';panel.style.left='0px';
  const origin=panel.getBoundingClientRect();
  const y=docked?Math.max(rail.top,Math.min(button.top,rail.bottom-origin.height)):button.top;
  panel.style.left=`${rail.right-origin.left}px`;
  panel.style.top=`${y-origin.top}px`;
}
