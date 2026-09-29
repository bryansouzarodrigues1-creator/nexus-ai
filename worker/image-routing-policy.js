export function shouldPrioritizeImageFidelity({
  hasSourceImage = false,
  taskMode = "create",
  preservationLevel = "medium",
  requiresTextAccuracy = false,
} = {}) {
  const preservationHeavy =
    Boolean(hasSourceImage) &&
    ["high", "maximum"].includes(
      String(preservationLevel || "")
    );

  const precisionMode = [
    "strict_edit",
    "enhance",
    "identity_lock",
  ].includes(String(taskMode || ""));

  return (
    preservationHeavy ||
    precisionMode ||
    Boolean(requiresTextAccuracy)
  );
}
