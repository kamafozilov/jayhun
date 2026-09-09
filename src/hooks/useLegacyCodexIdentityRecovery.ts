import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Session } from "../lib/session";
import {
  applyLegacyCodexIdentity,
  legacyCodexRecoveryInput,
  recoverLegacyCodexIdentity,
} from "../lib/codexIdentityRecovery";

/** Recover idle history without delaying restore or reading provider logs during rendering. */
export function useLegacyCodexIdentityRecovery(
  sessions: Session[],
  setSessions: Dispatch<SetStateAction<Session[]>>,
) {
  const attempted = useRef(new WeakSet<Session>());
  useEffect(() => {
    for (const snapshot of sessions) {
      const input = legacyCodexRecoveryInput(snapshot);
      if (!input || attempted.current.has(snapshot)) continue;
      attempted.current.add(snapshot);
      void recoverLegacyCodexIdentity(input)
        .then((result) => {
          setSessions((current) =>
            current.map((session) => {
              if (session !== snapshot) return session;
              const recovered = applyLegacyCodexIdentity(
                session,
                snapshot,
                result,
              );
              attempted.current.add(recovered);
              return recovered;
            }),
          );
        })
        .catch(() => undefined);
    }
  }, [sessions, setSessions]);
}
