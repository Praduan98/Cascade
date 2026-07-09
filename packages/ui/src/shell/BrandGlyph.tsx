import { useId } from 'react'

// The Cascade cascading-lines mark from the design headers.
export function BrandGlyph({ className, size = 26 }: { className?: string; size?: number }) {
  const gid = useId().replace(/[:]/g, '')
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M4 7h24M7 13.5h18M10 20h12M13 26.5h6"
        stroke={`url(#${gid})`}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id={gid} x1="4" y1="7" x2="28" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2fe6c8" />
          <stop offset="1" stopColor="#6c9bff" />
        </linearGradient>
      </defs>
    </svg>
  )
}
