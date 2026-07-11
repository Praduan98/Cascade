'use client'
import type { ReactNode } from 'react'
import styles from './template.module.css'

// App Router `template.tsx` re-mounts on every navigation (unlike layout.tsx),
// so this wrapper replays a subtle entrance on each route change — soft nav now
// fades/settles in instead of hard-cutting. The wrapper mirrors <main>'s
// flex-column context so it's layout-transparent (the full-height grid page and
// scrollable pages behave exactly as before). Reduced motion is neutralised by
// the global reset in tokens.css.
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <div className={styles.routeIn}>{children}</div>
}
