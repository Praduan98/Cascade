import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { bricolage, hanken, jetbrains } from './fonts'
import { Providers } from './providers'
import '@cascade/ui/styles/globals.css'

export const metadata: Metadata = {
  title: 'Cascade — GTM Enrichment',
  description: 'A lean, operator-first GTM data enrichment & prospecting platform. Phase 1.',
}

// Applied before first paint so the chosen theme never flashes. Reads the same
// key the ThemeProvider writes; absence means "follow the OS preference".
const NO_FLASH_THEME = `try{var t=localStorage.getItem('cascade-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${hanken.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
