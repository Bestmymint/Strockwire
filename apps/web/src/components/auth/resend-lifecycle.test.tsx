// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resendVerification } from "@/api-client";
import { LanguageProvider } from "@/providers/language-provider";
import {
  clearContinuation,
  loadContinuation,
  saveContinuation,
} from "@/verification-continuation-browser";
import type * as AuthApi from "@/api-client";
import { VerificationResendForm } from "./verification-resend-form";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
const email = "person@example.com";
const key = "stockwise_verification_continuation";
type ResendResult = {
  data: {
    status: "accepted";
    verification: { challengeId: string };
  };
};
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthApi>()),
  resendVerification: vi.fn(),
}));

const challengeId = "11111111-1111-4111-8111-111111111111";
const replacementChallengeId = "22222222-2222-4222-8222-222222222222";
function deferred() {
  return Promise.withResolvers<ResendResult>();
}
function result(selector: string): ResendResult {
  return {
    data: { status: "accepted", verification: { challengeId: selector } },
  };
}
function save(canonicalEmail = email, selector: string | null = challengeId) {
  saveContinuation({
    version: 1,
    canonicalEmail,
    challengeId: selector,
    savedAt: Date.now(),
  });
}
function setup() {
  return render(
    <LanguageProvider>
      <VerificationResendForm />
    </LanguageProvider>,
  );
}
function submit() {
  fireEvent.submit(
    screen.getByRole("textbox", { name: "Email address" }).closest("form")!,
  );
}

beforeEach(() => {
  push.mockReset();
  sessionStorage.clear();
  vi.mocked(resendVerification).mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("verification resend lifecycle", () => {
  it("ignores a response after back navigation clears the continuation", async () => {
    save();
    const request = deferred();
    vi.mocked(resendVerification).mockReturnValue(request.promise);
    setup();
    submit();

    fireEvent.click(screen.getByRole("link", { name: "Back to sign in" }));
    await act(async () => request.resolve(result(replacementChallengeId)));

    expect(push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("ignores completion after explicit continuation clearing without unmount", async () => {
    save();
    const request = deferred();
    vi.mocked(resendVerification).mockReturnValue(request.promise);
    setup();
    submit();
    clearContinuation();
    await act(async () => request.resolve(result(replacementChallengeId)));
    expect(push).not.toHaveBeenCalled();
    expect(loadContinuation().continuation).toBeNull();
  });

  it("rejects explicit clear and identical-continuation ABA replacement", async () => {
    save();
    const original = loadContinuation().continuation!;
    const request = deferred();
    vi.mocked(resendVerification).mockReturnValue(request.promise);
    setup();
    submit();

    clearContinuation();
    saveContinuation(original);
    await act(async () => request.resolve(result(replacementChallengeId)));

    expect(push).not.toHaveBeenCalled();
    expect(loadContinuation().continuation).toEqual(original);
  });

  it("does not replace account B when account A's response arrives", async () => {
    save();
    const request = deferred();
    vi.mocked(resendVerification).mockReturnValue(request.promise);
    setup();
    submit();
    const accountB = {
      version: 1 as const,
      canonicalEmail: "other@example.com",
      challengeId: replacementChallengeId,
      savedAt: Date.now(),
    };
    saveContinuation(accountB);

    await act(async () => request.resolve(result(challengeId)));

    expect(push).not.toHaveBeenCalled();
    expect(loadContinuation().continuation).toEqual(accountB);
  });

  it("deduplicates overlapping submissions and applies the current successful selector", async () => {
    save(email, null);
    const savedAt = loadContinuation().continuation!.savedAt;
    const request = deferred();
    vi.mocked(resendVerification).mockReturnValue(request.promise);
    setup();
    submit();
    submit();
    expect(resendVerification).toHaveBeenCalledTimes(1);

    await act(async () => request.resolve(result(replacementChallengeId)));

    expect(push).toHaveBeenCalledWith("/verify-email");
    expect(loadContinuation().continuation).toEqual({
      version: 1,
      canonicalEmail: email,
      challengeId: replacementChallengeId,
      savedAt,
    });
  });

  it("aborts and ignores a response after unmount", async () => {
    save();
    const request = deferred();
    vi.mocked(resendVerification).mockReturnValue(request.promise);
    const view = setup();
    submit();
    const options = vi.mocked(resendVerification).mock.calls[0]?.[1];
    view.unmount();

    expect(options?.signal?.aborted).toBe(true);
    await act(async () => request.resolve(result(replacementChallengeId)));

    expect(push).not.toHaveBeenCalled();
    expect(loadContinuation().continuation?.challengeId).toBe(challengeId);
  });
});
