export const ENABLE_DEBUG_LOGGING = false;

export function debugLog(...msg: any[]) {
  if (!ENABLE_DEBUG_LOGGING) {
    return;
  }
  console.debug(msg);
}
