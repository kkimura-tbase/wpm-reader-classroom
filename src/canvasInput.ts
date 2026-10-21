// Finger touches may report force/pressure too. Only explicit device types
// qualify as a stylus; unknown input must not bypass pen-only mode.
export function isStylusTouch(touch: { touchType?: string; force?: number }) {
  return touch.touchType === "stylus" || touch.touchType === "pencil";
}
export function canDrawPointer(mode: "stylus" | "all", pointerType: string) {
  return pointerType === "pen" || pointerType === "mouse" || (mode === "all" && pointerType === "touch");
}
