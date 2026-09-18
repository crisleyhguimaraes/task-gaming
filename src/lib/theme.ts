export type Theme = 'dark' | 'light'

/** Aplicado antes da hidratação por um script inline no <head> (sem flash). */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem('theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}`

export const getTheme = (): Theme => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

export function setTheme(t: Theme) {
  if (t === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  try {
    localStorage.setItem('theme', t)
  } catch {
    /* modo privado: só não persiste */
  }
}
