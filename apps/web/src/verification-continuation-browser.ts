import {
  clearVerificationContinuation,
  loadVerificationContinuation,
  saveVerificationContinuation,
  type VerificationContinuation,
  type VerificationContinuationState,
} from "./verification-continuation";

function sessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

let continuationRevision = 0;

export function getContinuationRevision(): number {
  return continuationRevision;
}

export function loadContinuation(): VerificationContinuationState {
  return loadVerificationContinuation(sessionStorage());
}

export function saveContinuation(
  continuation: VerificationContinuation,
): boolean {
  continuationRevision += 1;
  return saveVerificationContinuation(sessionStorage(), continuation);
}

export function clearContinuation(): void {
  continuationRevision += 1;
  clearVerificationContinuation(sessionStorage());
}
