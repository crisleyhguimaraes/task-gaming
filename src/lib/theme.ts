export type Theme = 'dark' | 'light'

/** Aplicado antes da hidratação por um script inline no <head> (sem flash). O servidor sempre renderiza claro. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem('theme')==='dark')delete document.documentElement.dataset.theme}catch(e){}`

export const getTheme = (): Theme => (typeof document === 'undefined' || document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

export function setTheme(t: Theme) {
  if (t === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  try {
    localStorage.setItem('theme', t)
  } catch {
    /* modo privado: só não persiste */
  }
}
