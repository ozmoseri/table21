/**
 * Full screen (DECISIONS 12, brief stage 1). Installed, the manifest asks for "fullscreen" (falling back to
 * "standalone"), so there is no browser bar at all. In a plain browser tab the player can go full screen with one tap
 * (Fullscreen API, Android Chrome and desktop) and optionally lock landscape; iOS Safari has neither API, so it gets
 * the "Add to Home Screen" hint instead. Everything here fails quietly where unsupported.
 */
export const isStandalone = () =>
  (typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches)) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const canFullscreen = () => typeof document.documentElement.requestFullscreen === 'function' && !isIOS();
export const isFullscreen = () => !!document.fullscreenElement;

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

/** Must run from a tap. Returns whether the page is now full screen. */
export async function enterFullscreen(lockLandscape = false): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (lockLandscape) await (screen.orientation as LockableOrientation)?.lock?.('landscape');
  } catch {
    // Not allowed here (iOS, an iframe, a browser setting): the game simply stays in the page.
  }
  return isFullscreen();
}

export async function exitFullscreen() {
  try {
    (screen.orientation as LockableOrientation)?.unlock?.();
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {}
}
