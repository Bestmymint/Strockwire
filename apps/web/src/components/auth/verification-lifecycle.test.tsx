// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  verificationPasswordProof,
  verifyEmail,
  verifyEmailCode,
} from "@/api-client";
import type * as AuthApi from "@/api-client";
import {
  clearContinuation,
  loadContinuation,
  saveContinuation,
} from "@/verification-continuation-browser";
import { VerificationForm } from "./verification-form";

vi.mock("@/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthApi>()),
  verificationPasswordProof: vi.fn(),
  verifyEmail: vi.fn(),
  verifyEmailCode: vi.fn(),
}));
const accountA = {
  version: 1 as const,
  canonicalEmail: "a@example.com",
  challengeId: "11111111-1111-4111-8111-111111111111",
  savedAt: 0,
};
const accountB = {
  ...accountA,
  canonicalEmail: "b@example.com",
  challengeId: "22222222-2222-4222-8222-222222222222",
};
const token = "synthetic_" + "a".repeat(34);
function submit(name: string) {
  const accessibleName =
    name === "Verify" &&
    screen.queryByRole("button", { name: "Check verification link" })
      ? "Check verification link"
      : name;
  fireEvent.submit(
    screen.getByRole("button", { name: accessibleName }).closest("form")!,
  );
}
beforeEach(() => {
  sessionStorage.clear();
  accountA.savedAt = Date.now();
  accountB.savedAt = accountA.savedAt;
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  sessionStorage.clear();
  Reflect.deleteProperty(window, "__stockwiseTakeVerificationLink");
});

describe("verification abandonment and continuation identity", () => {
  for (const kind of ["code", "link"] as const) {
    for (const stage of ["verification", "proof"] as const) {
      for (const abandonment of [
        "unmount",
        "pagehide",
        "replacement",
        "ABA",
      ] as const) {
        it.each(["success", "failure"])(
          `${kind} ${stage}: ignores late %s after ${abandonment}`,
          async (outcome) => {
            const delayed = Promise.withResolvers<void>();
            async function waitForCompletion() {
              await delayed.promise;
              if (outcome === "failure")
                throw new AuthApiError(
                  stage === "proof"
                    ? "invalid_credentials"
                    : "verification_password_proof_required",
                );
            }
            const verify =
              kind === "link"
                ? vi.mocked(verifyEmail)
                : vi.mocked(verifyEmailCode);
            if (kind === "link") {
              Object.assign(window, {
                __stockwiseTakeVerificationLink: () => {
                  Reflect.deleteProperty(
                    window,
                    "__stockwiseTakeVerificationLink",
                  );
                  return { token };
                },
              });
            } else saveContinuation(accountA);
            if (stage === "proof") {
              verify.mockRejectedValueOnce(
                new AuthApiError("verification_password_proof_required"),
              );
              vi.mocked(verificationPasswordProof).mockImplementation(
                async () => {
                  await waitForCompletion();
                  return { data: { status: "accepted" } };
                },
              );
            } else
              verify.mockImplementation(async () => {
                await waitForCompletion();
                return { data: { status: "verified" } };
              });
            const view = render(<VerificationForm />);
            if (kind === "code")
              fireEvent.change(
                screen.getByLabelText("6-digit verification code"),
                { target: { value: "012345" } },
              );
            submit("Verify");
            if (stage === "proof") {
              await screen.findByLabelText("Password");
              if (kind === "link")
                fireEvent.change(screen.getByLabelText("Email address"), {
                  target: { value: accountA.canonicalEmail },
                });
              fireEvent.change(screen.getByLabelText("Password"), {
                target: { value: "synthetic password only" },
              });
              submit("Confirm password");
            }
            const options =
              stage === "proof"
                ? vi.mocked(verificationPasswordProof).mock.calls[0]![1]
                : verify.mock.calls[0]![1];
            if (abandonment === "unmount") view.unmount();
            if (abandonment === "pagehide")
              fireEvent(window, new Event("pagehide"));
            if (abandonment === "ABA") {
              const identical = loadContinuation().continuation;
              clearContinuation();
              if (identical !== null) saveContinuation(identical);
            } else saveContinuation(accountB);
            const successor = sessionStorage.getItem(
              "stockwise_verification_continuation",
            );
            await act(async () => {
              // The mock deliberately ignores AbortSignal: logical isolation must stand alone.
              delayed.resolve();
            });
            expect(verify).toHaveBeenCalledTimes(1);
            expect(
              sessionStorage.getItem("stockwise_verification_continuation"),
            ).toBe(successor);
            expect(screen.queryByRole("alert")).toBeNull();
            expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
            if (abandonment === "unmount" || abandonment === "pagehide")
              expect(options?.signal?.aborted).toBe(true);
            if (abandonment !== "unmount") {
              // Neither an old confirmation nor an old proof can be submitted again.
              const button = screen.queryByRole("button", {
                name: /^(Verify|Confirm password)$/,
              });
              if (button) fireEvent.submit(button.closest("form")!);
              expect(verify).toHaveBeenCalledTimes(1);
              expect(verificationPasswordProof).toHaveBeenCalledTimes(
                stage === "proof" ? 1 : 0,
              );
            }
          },
        );
      }
    }
  }
});

it("restores the canonical OTP continuation after BFCache without accepting abandoned work", async () => {
  saveContinuation(accountA);
  const delayed = Promise.withResolvers<{
    data: { status: "verified" };
  }>();
  vi.mocked(verifyEmailCode).mockReturnValueOnce(delayed.promise);
  render(<VerificationForm />);
  fireEvent.change(screen.getByLabelText("6-digit verification code"), {
    target: { value: "012345" },
  });
  submit("Verify");
  fireEvent(window, new PageTransitionEvent("pagehide", { persisted: true }));
  fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
  await act(async () => delayed.resolve({ data: { status: "verified" } }));
  expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  expect(loadContinuation().continuation).toEqual(accountA);
  const input = screen.getByLabelText("6-digit verification code");
  expect((input as HTMLInputElement).value).toBe("");
  vi.mocked(verifyEmailCode).mockResolvedValueOnce({
    data: { status: "verified" },
  });
  fireEvent.change(input, { target: { value: "654321" } });
  submit("Verify");
  await screen.findByRole("link", { name: "Sign in" });
  expect(vi.mocked(verifyEmailCode).mock.calls[1]?.[0]).toEqual({
    email: accountA.canonicalEmail,
    challengeId: accountA.challengeId,
    code: "654321",
  });
  expect(loadContinuation().continuation).toBeNull();
});
