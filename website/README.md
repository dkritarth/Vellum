# Website

Build the static Pages artifact from the repository root:

```bash
npm run site:build
npx vite site-dist
```

`website/index.html` uses release placeholders that the build fills from `package.json`. The build copies the existing committed walkthroughs from `docs/evidence/` into `site-dist/assets/videos/`; video blobs are not duplicated in source control. The players use `preload="none"` and do not autoplay.

The stylesheet filename contains the first 12 hex digits of its SHA-256 content hash. After editing CSS, rename it using its new hash and update the link in `index.html`.

Pages keeps the previous site live until the configured release has published arm64 DMG/ZIP assets and checksums. A successful trusted Mac tag workflow then triggers deployment. Manual deployment remains available from Actions.

Screenshot provenance is in `assets/screenshots/README.md`.
