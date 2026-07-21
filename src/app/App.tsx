import { useEffect, useState } from 'react'

// Vellum shell skeleton.
//
// The real anara-style layout is built here per the Phase-1 wiki task cards:
//   - top tab strip (open papers as tabs)
//   - left sidebar (Create / Home / Library / Search, folder tree)
//   - center: PDF reader (render, page nav, zoom, TOC, in-doc search)
//   - right panel: Ask | Notes | Details | Annotations, model selector (ACP switch)
//
// This placeholder just proves the renderer + preload IPC bridge boot.
export function App(): JSX.Element {
  const [pong, setPong] = useState<string>('…')

  useEffect(() => {
    window.vellum?.ping().then(setPong).catch(() => setPong('no-bridge'))
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Vellum</h1>
      <p>Local-first AI paper workspace. Shell scaffold — features land per the wiki backlog.</p>
      <p>IPC bridge: {pong}</p>
    </main>
  )
}
