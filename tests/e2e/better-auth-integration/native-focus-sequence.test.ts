import { expect, test } from "vitest";
import {
  hasCompletedNativeCycle,
  type NativeFocusEvent,
  type NativeFocusState,
} from "./native-focus-sequence";

const validCycle: [NativeFocusEvent, NativeFocusEvent, NativeFocusEvent] = [
  { kind: "alt-key", at: 110, trusted: true, focused: true },
  { kind: "blur", at: 120, trusted: true, focused: false },
  { kind: "focus", at: 1120, trusted: true, focused: true },
];
function observation(
  events: NativeFocusEvent[] = validCycle,
  epochStartedAt: number | null = 100,
): NativeFocusState {
  return { clicked: true, epochStartedAt, events };
}

test("a completed pre-draft cycle cannot satisfy a fresh post-draft epoch", () => {
  expect(hasCompletedNativeCycle(observation(validCycle, 2000), true)).toBe(
    false,
  );
});
test("accepts a trusted ordered cycle entirely after draft preparation", () => {
  expect(hasCompletedNativeCycle(observation(), true)).toBe(true);
});
test("does not accept pre-epoch Alt combined with post-epoch blur and focus", () => {
  expect(
    hasCompletedNativeCycle(
      observation([
        { kind: "alt-key", at: 99, trusted: true, focused: true },
        ...validCycle.slice(1),
      ]),
      true,
    ),
  ).toBe(false);
});
test("requires an observation epoch rather than acquisition-only evidence", () => {
  expect(hasCompletedNativeCycle(observation(validCycle, null), true)).toBe(
    false,
  );
});
for (const kind of ["alt-key", "blur", "focus"]) {
  test(`rejects a cycle missing ${kind}`, () => {
    expect(
      hasCompletedNativeCycle(
        observation(validCycle.filter((event) => event.kind !== kind)),
        true,
      ),
    ).toBe(false);
  });
  test(`rejects synthetic ${kind} evidence`, () => {
    expect(
      hasCompletedNativeCycle(
        observation(
          validCycle.map((event) =>
            event.kind === kind ? { ...event, trusted: false } : event,
          ),
        ),
        true,
      ),
    ).toBe(false);
  });
}
test("rejects focus return before native blur", () => {
  expect(
    hasCompletedNativeCycle(
      observation([validCycle[0], validCycle[2], validCycle[1]]),
      true,
    ),
  ).toBe(false);
});
test("rejects blur that still reports document focus", () => {
  expect(
    hasCompletedNativeCycle(
      observation(
        validCycle.map((event) =>
          event.kind === "blur" ? { ...event, focused: true } : event,
        ),
      ),
      true,
    ),
  ).toBe(false);
});
test("rejects focus return that still reports no document focus", () => {
  expect(
    hasCompletedNativeCycle(
      observation(
        validCycle.map((event) =>
          event.kind === "focus" ? { ...event, focused: false } : event,
        ),
      ),
      true,
    ),
  ).toBe(false);
});
test("rejects a completed cycle while the document is currently unfocused", () => {
  expect(hasCompletedNativeCycle(observation(), false)).toBe(false);
});
test("requires the bounded-away minimum duration", () => {
  expect(
    hasCompletedNativeCycle(
      observation(
        validCycle.map((event) =>
          event.kind === "focus" ? { ...event, at: 1119 } : event,
        ),
      ),
      true,
    ),
  ).toBe(false);
});
