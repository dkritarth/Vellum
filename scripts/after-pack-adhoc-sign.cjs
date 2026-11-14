// electron-builder afterPack hook. Without a Developer ID certificate,
// electron-builder leaves Vellum.app with Electron's stale linker signature
// (arm64) or none at all (x64). Apple Silicon refuses such bundles as
// "damaged", so seal the whole bundle with an ad-hoc signature before the
// DMG and zip are built.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
}
