import type { PageWidth } from '#/lib/page-width'
import { pageWidthClass } from '#/lib/page-width'

export function PageContainer({ width, children }: { width: PageWidth; children: React.ReactNode }) {
  return <div className={pageWidthClass(width)}>{children}</div>
}
