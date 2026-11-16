# Record the Electron walkthrough

Verified on dminer2 with the installed Playwright 1.63.0 package and Electron 32.3.3. The recording captures the production Electron window. It does not require a separate browser recreation or system FFmpeg.

## Contract and sources

The installed first-party Playwright package defines `Electron.launch({ recordVideo })` in `node_modules/playwright-core/types/types.d.ts`, under `Electron`. Options include the destination directory, video dimensions, and optional action annotations. `Page.video()` returns the recording artifact.

`node_modules/playwright-core/lib/coreBundle.js` contains the implementation. Search for `startAutomaticVideoRecording`, `FfmpegVideoRecorder`, and `ElectronApplication`. Recording uses the Chromium screencast stream and the FFmpeg executable from Playwright's browser registry. `node_modules/playwright-core/browsers.json` pins FFmpeg revision 1011 for this installation.

On this machine the executable is `/home/dandapat/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux`. A direct prototype saved a WebM recording after real Create/Cancel clicks. The full walkthrough uses the same API through `test/harness.mjs`.

## Finalize before reading the video path

Close Electron before awaiting the final video artifact. Awaiting `video.path()` while recording is still active can wait for recording completion indefinitely.

```js
const app = await electron.launch({
  args: ['--no-sandbox', appPath],
  recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
  env: isolatedEnvironment,
})
const window = await app.firstWindow()
const video = window.video()
// Exercise the actual app through Playwright clicks and typing.
await app.close()
await video.saveAs(destination)
```

A full process restart creates a second context and recording. The walkthrough saves separate numbered videos and records chapter timestamps per segment in `result.json`. This preserves the real restart boundary.

The bundled FFmpeg is a minimal build. Its `-formats` output on dminer2 does not advertise the concat demuxer, so the walkthrough does not assume it can concatenate recordings. It saves both original segments.

## Run

Build the current source, then run with two real PDFs. The first PDF must be Attention Is All You Need, because the walkthrough checks its known text and citations.

```bash
npm run build
xvfb-run -a -s '-screen 0 1440x900x24' npm run demo:record -- /path/attention.pdf /path/second-paper.pdf
```

The Codex adapter must already be installed and signed in. This opt-in walkthrough sends real prompts through the first-party adapter. Standard offline CI gates do not send prompts.

Output includes two WebM segments, screenshots, console output, a chapter checklist, source revision/dirty-state information, and hashes of the built main entry and renderer HTML. Run from a committed checkout after rebuilding for final review evidence. The harness deletes its isolated paper/profile state even if video finalization fails.
