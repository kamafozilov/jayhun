import type { Session, TurnIdentity } from "./session";
import { modelIdentityName } from "./models";

export function requestedTurnIdentity(
  session: Session,
): TurnIdentity & { requestedModel: string } {
  return {
    id: crypto.randomUUID(),
    harness: session.harness,
    requestedModel: session.model,
    modelSettings: { ...session.modelSettings },
  };
}

export function activeTurnIdentity(session: Session): TurnIdentity | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "user" && block.startedAt != null)
      return block.turnIdentity;
  }
  return undefined;
}

export function turnModelName(identity?: TurnIdentity): string {
  if (!identity) return "Unknown model";
  if (identity.providerModel) {
    const name = modelIdentityName(identity.harness, identity.providerModel);
    return identity.recovery ? `${name} (recovered)` : name;
  }
  return identity.requestedModel
    ? `${modelIdentityName(identity.harness, identity.requestedModel)} (requested)`
    : "Unknown model";
}
