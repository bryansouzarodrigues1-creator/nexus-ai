export function allocateImageReferenceSlots({
  hasSourceImage = false,
  hasRootReference = false,
  requestedExtraCount = 0,
} = {}) {
  if (!hasSourceImage) {
    return {
      sourceIndex: null,
      rootIndex: null,
      extraStartIndex: null,
      extraCount: 0,
      totalReferences: 0,
      maxReferences: 4,
    };
  }

  const rootEnabled = Boolean(hasRootReference);
  const rootIndex = rootEnabled ? 1 : null;
  const extraStartIndex = rootEnabled ? 2 : 1;
  const capacityForExtras = Math.max(
    0,
    4 - 1 - (rootEnabled ? 1 : 0)
  );
  const extraCount = Math.max(
    0,
    Math.min(
      capacityForExtras,
      Math.floor(Number(requestedExtraCount) || 0)
    )
  );

  return {
    sourceIndex: 0,
    rootIndex,
    extraStartIndex:
      extraCount > 0 ? extraStartIndex : null,
    extraCount,
    totalReferences:
      1 + (rootEnabled ? 1 : 0) + extraCount,
    maxReferences: 4,
  };
}
