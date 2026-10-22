"use client";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  discardPrivateSession,
  isSessionChangeHint,
  SESSION_CHANNEL,
  SESSION_CHANGE_EVENT,
  SESSION_UNAUTHORIZED_EVENT,
  type SessionChangeHint,
} from "@/session-lifecycle";
import { clearContinuation } from "@/verification-continuation-browser";
import { isGuestRoute, routeAccessPolicy } from "@/route-access-policy";

interface SessionLifecycleState {
  generation: number;
  suspended: boolean;
  unauthorized: boolean;
}
interface SessionLifecycleValue extends SessionLifecycleState {
  acknowledgeFreshAuthenticatedContext: () => void;
}
const SessionLifecycleContext = createContext<SessionLifecycleValue>({
  generation: 0,
  suspended: false,
  unauthorized: false,
  acknowledgeFreshAuthenticatedContext: () => {},
});
export function useSessionLifecycle() {
  return useContext(SessionLifecycleContext);
}

export function SessionLifecycleProvider({
  children,
}: {
  children: ReactNode;
}) {
  const client = useQueryClient();
  const pathname = usePathname();
  const guestRouteRef = useRef(isGuestRoute(routeAccessPolicy(pathname)));
  guestRouteRef.current = isGuestRoute(routeAccessPolicy(pathname));
  const [state, setState] = useState<SessionLifecycleState>({
    generation: 0,
    suspended: false,
    unauthorized: false,
  });
  const suspended = useRef(false);
  const acknowledgeFreshAuthenticatedContext = useCallback(() => {
    // Clear the 401 recovery latch only after a fresh authenticated
    // access-context response has been validated by the guest-entry guard.
    setState((previous) =>
      previous.unauthorized ? { ...previous, unauthorized: false } : previous,
    );
  }, []);
  useEffect(() => {
    let channel: BroadcastChannel | undefined;
    let lastHint: string | undefined;
    let lostFocus = false;
    // Initial focus is not a session transition. Do not throw away an
    // in-flight/failed first access-context request just because the new tab focused.
    let lastResume = performance.now();
    try {
      channel = new BroadcastChannel(SESSION_CHANNEL);
    } catch {
      /* Storage/focus fallback. */
    }

    const reset = (unauthorized = false) => {
      discardPrivateSession(client);
      flushSync(() =>
        setState((previous) => ({
          generation: previous.generation + 1,
          suspended: suspended.current,
          unauthorized,
        })),
      );
    };
    const receive = (value: unknown) => {
      if (!isSessionChangeHint(value) || value.id === lastHint) return;
      lastHint = value.id;
      clearContinuation();
      // A received hint is never rebroadcast or treated as authenticated state.
      reset();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_CHANNEL || !event.newValue) return;
      try {
        receive(JSON.parse(event.newValue));
      } catch {
        /* Ignore malformed hints. */
      }
    };
    const onMessage = (event: MessageEvent<unknown>) => receive(event.data);
    const onChange = () => {
      const hint: SessionChangeHint = {
        version: 1,
        type: "session-change",
        id: crypto.randomUUID(),
      };
      lastHint = hint.id;
      reset();
      try {
        channel?.postMessage(hint);
      } catch {
        /* Storage/focus fallback. */
      }
      try {
        localStorage.setItem(SESSION_CHANNEL, JSON.stringify(hint));
      } catch {
        /* Focus remains available without storage. */
      }
    };
    const onUnauthorized = () => {
      clearContinuation();
      reset(true);
    };
    const suspend = () => {
      if (suspended.current) return;
      suspended.current = true;
      // Anonymous auth drafts are not private session data. Do not remount
      // their forms simply because the user opened a different window.
      if (!guestRouteRef.current) reset();
    };
    const resume = (force = false) => {
      if (document.visibilityState === "hidden") return;
      const wasSuspended = suspended.current;
      suspended.current = false;
      // Coalesce the focus/visibility/pageshow burst, not session-change hints.
      if (
        !wasSuspended &&
        !force &&
        (performance.now() - lastResume < 500 ||
          client.isFetching({ queryKey: ["access-context"] }) > 0)
      )
        return;
      lastResume = performance.now();
      if (guestRouteRef.current) {
        // Discard old private responses without resetting the rendered
        // guest form. Authority is still checked against the backend.
        discardPrivateSession(client);
        flushSync(() =>
          setState((previous) => ({ ...previous, suspended: false })),
        );
        return;
      }
      reset();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted || suspended.current) resume(event.persisted);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") suspend();
      else resume();
    };
    const onBlur = () => {
      lostFocus = true;
    };
    const onFocus = () => {
      // Browsers fire an initial focus event as the document mounts. Only a
      // real blur -> focus transition implies possible cookie/actor changes.
      if (!lostFocus) return;
      lostFocus = false;
      resume(true);
    };
    channel?.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    window.addEventListener(SESSION_CHANGE_EVENT, onChange);
    window.addEventListener(SESSION_UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SESSION_CHANGE_EVENT, onChange);
      window.removeEventListener(SESSION_UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      // StrictMode replays effect cleanup during initial mount. Purging the
      // shared QueryClient here would cancel the first access-context request
      // and silently issue another request before the guest can retry.
      // Explicit session events and pagehide still purge private authority.
    };
  }, [client]);
  return (
    <SessionLifecycleContext.Provider
      value={{ ...state, acknowledgeFreshAuthenticatedContext }}
    >
      {children}
    </SessionLifecycleContext.Provider>
  );
}
