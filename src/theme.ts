export type Theme = 'dark' | 'light' | 'high-contrast';
export function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return theme === 'light' || theme === 'high-contrast' ? theme : 'dark';
}
export function initializeThemeControls(onChange: () => void = () => {}): void {
  const controls = [...document.querySelectorAll<HTMLInputElement>('[name="appearance-theme"]')];
  for (const control of controls) {
    control.checked = control.value === currentTheme();
    control.addEventListener('change', () => {
      if (!control.checked) return;
      document.documentElement.dataset.theme = control.value;
      try { localStorage.setItem('vectora.theme', control.value); } catch { /* Keep the session preference. */ }
      onChange();
    });
  }
}
