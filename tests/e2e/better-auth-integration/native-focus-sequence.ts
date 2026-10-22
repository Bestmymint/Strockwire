export type NativeFocusEvent = {
  kind: string;
  at: number;
  trusted: boolean;
  focused: boolean;
};
export type NativeFocusState = {
  clicked: boolean;
  epochStartedAt: number | null;
  events: NativeFocusEvent[];
};

export function hasCompletedNativeCycle(
  state: NativeFocusState | undefined,
  focused: boolean,
): boolean {
  if (
    state === undefined ||
    state.epochStartedAt === null ||
    !Number.isFinite(state.epochStartedAt) ||
    !focused
  )
    return false;
  let previousAt = state.epochStartedAt;
  let expected: "alt-key" | "blur" | "focus" = "alt-key";
  let blurAt = 0;
  for (const event of state.events) {
    if (!Number.isFinite(event.at) || event.at <= previousAt) return false;
    previousAt = event.at;
    if (event.kind === "input-click") continue;
    if (!event.trusted) return false;
    if (event.kind === "alt-key") {
      if (!event.focused) return false;
      expected = "blur";
    } else if (expected === "alt-key") {
      // Initial focus acquisition is not a completed Alt/blur/focus cycle.
      continue;
    } else if (event.kind === "blur" && expected === "blur" && !event.focused) {
      blurAt = event.at;
      expected = "focus";
    } else if (
      event.kind === "focus" &&
      expected === "focus" &&
      event.focused
    ) {
      return event.at - blurAt >= 1_000;
    } else {
      return false;
    }
  }
  return false;
}
