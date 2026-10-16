export function reserveComposerHeight(rawHeight) {
  const h = Number(rawHeight);
  return Number.isFinite(h) ? Math.max(0, Math.ceil(h)) : 0;
}

// Window scroll (not a nested container) is used by the existing chat layout.
export function isNearConversationBottom(scrollHeight, scrollY, viewportHeight, threshold = 140) {
  const values = [scrollHeight, scrollY, viewportHeight, threshold].map(Number);
  if (!values.every(Number.isFinite)) return false;
  const [total, top, height, distance] = values;
  return total - (top + height) <= Math.max(0, distance);
}
