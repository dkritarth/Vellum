// Vite's `?url` import suffix (Reader.tsx uses it to get a bundled URL for
// the pdf.js worker asset) resolves to a plain string at build time — same
// ambient shape as vite/client's own declaration. Colocated with Reader.tsx,
// the only consumer.
declare module '*?url' {
  const src: string
  export default src
}
