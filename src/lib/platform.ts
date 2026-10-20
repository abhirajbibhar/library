/** Windows / Linux use Ctrl, macOS and iOS use ⌘. Used for the labels of keyboard shortcuts. */
export const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const modKey = isApple ? '⌘' : 'Ctrl';
/** True when the key combination is the platform's "command" key: Ctrl on Windows/Linux, ⌘ on macOS. */
export const hasMod = (e: KeyboardEvent) => (isApple ? e.metaKey : e.ctrlKey) || e.ctrlKey || e.metaKey;
