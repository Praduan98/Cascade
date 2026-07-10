// Real brand logos for the seeded workspaces, served from /public/logos.
// Matched by workspace id first, then by name, so demo workspaces created at
// runtime fall back to the brand gradient glyph.

const BY_ID: Record<string, string> = {
  ws_insightstap: '/logos/insightstap.webp',
  ws_sdtc: '/logos/sdtc.png',
}

const BY_NAME: Record<string, string> = {
  insightstap: '/logos/insightstap.webp',
  'sdtc digital': '/logos/sdtc.png',
}

/** The logo src for a workspace, or undefined to use the gradient fallback. */
export function workspaceLogo(ws?: { id?: string; name?: string } | null): string | undefined {
  if (!ws) return undefined
  if (ws.id && BY_ID[ws.id]) return BY_ID[ws.id]
  if (ws.name && BY_NAME[ws.name.trim().toLowerCase()]) return BY_NAME[ws.name.trim().toLowerCase()]
  return undefined
}
