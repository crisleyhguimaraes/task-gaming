export type PageWidth = 'full' | 'wide' | 'standard' | 'narrow'

const WIDTH_CLASS: Record<PageWidth, string> = {
  full: '',
  wide: 'mx-auto max-w-[1680px]',
  standard: 'mx-auto max-w-[1180px]',
  narrow: 'mx-auto max-w-[880px]',
}

export const DEFAULT_PAGE_WIDTH: PageWidth = 'standard'

export const pageWidthClass = (width: PageWidth) => WIDTH_CLASS[width]

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    pageWidth?: PageWidth
  }
}
