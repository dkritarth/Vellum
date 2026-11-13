// Turn an error thrown across Electron IPC into a message fit for the UI.
//
// ipcRenderer.invoke rejects with "Error invoking remote method
// 'vellum:<channel>': Error: <fn>: <message>". The channel name, the nested
// "Error: " and the core function-name prefix are developer noise; users
// only need <message>.
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/
const ERROR_PREFIX = /^(?:[A-Z][A-Za-z]*Error|Error):\s*/
const FUNCTION_PREFIX = /^[a-z][A-Za-z0-9]*:\s+/

export function friendlyIpcError(err: unknown, fallback = 'Something went wrong.'): string {
  let message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  message = message.replace(IPC_WRAPPER, '').replace(ERROR_PREFIX, '')
  const hadFunctionPrefix = FUNCTION_PREFIX.test(message)
  message = message.replace(FUNCTION_PREFIX, '').trim()
  if (!message) return fallback
  // Core messages read "fn: lower-case detail"; once "fn: " is gone, start
  // the sentence with a capital. Leave other messages (e.g. "arXiv API: …")
  // exactly as written.
  return hadFunctionPrefix ? message.charAt(0).toUpperCase() + message.slice(1) : message
}
