// Type shape for CSS module imports (vite/electron-vite handles the
// transform at build/test time; this just satisfies tsc --noEmit).
declare module '*.module.css' {
  const classes: { readonly [className: string]: string }
  export default classes
}
