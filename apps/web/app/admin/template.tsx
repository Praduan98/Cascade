'use client'
import type { ReactNode } from 'react'
import styles from './admin.module.css'

// App Router `template.tsx` re-mounts on each navigation, so this replays a
// subtle entrance on every /admin route change — matching the tenant app's soft
// nav. `.main` is a plain block scroll container (no full-height grid page here),
// so a block wrapper is layout-transparent. Reduced motion is neutralised by the
// global reset in tokens.css.
export default function AdminTemplate({ children }: { children: ReactNode }) {
  return <div className={styles.routeIn}>{children}</div>
}
