import type { ContextUsage } from "./contextUsage";
import type { UserQuestionPrompt } from "./userQuestion";
import type { HandoffComposerCard } from "./handoff";
import type { InboxComposerCard } from "./githubTasks";
import type { InboxAskContext } from "./inboxAsk";
import type { NoteCardMeta, NoteComposerCard } from "./notes";
import {
  defaultSessionChoice,
  hasLiveCatalog,
  mergeModelSettings,
  loadLastModelSettings,
  preferredModelId,
  preferredModelSettings,
  resolveModel,
} from "./models";

export type HarnessId =
  "claude" | "codex" | "cursor" | "grok" | "opencode" | "pi" | "omp" | "fx";

export const HARNESSES: HarnessId[] = [
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
];

export type BlockRole =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool"
  | "approval"
  | "tasks"
  | "plan"
  | "system"
  | "handoff";

export type TaskListItemStatus =
  "pending" | "in_progress" | "completed" | "cancelled";

export type TaskListItem = {
  /** Stable provider identity, when available, for merging status-only updates. */
  id?: string;
  text: string;
  status: TaskListItemStatus;
};

export type TaskListMeta = {
  /** Provider identity for replacing later snapshots of the same list. */
  key?: string;
  explanation?: string;
  items: TaskListItem[];
};

/** One-shot behavior selected in the composer for the next harness turn. */
export type TurnIntent = "default" | "plan" | "build";

export type PlanStatus = "streaming" | "ready" | "building" | "built";

export type PlanBlockMeta = {
  /** Provider or turn identity used to merge streamed snapshots. */
  key?: string;
  status: PlanStatus;
  /** Provider-authored plan before any user edits. */
  originalText?: string;
  /** Exact markdown the user approved with Build. */
  approvedText?: string;
  edited?: boolean;
};

export type PlanBuildTarget = {
  harness: HarnessId;
  model: string;
};

export type HandoffStatus = "preparing" | "ready";

export type HandoffMeta = {
  from: HarnessId;
  to: HarnessId;
  status: HandoffStatus;
  /** Inject this brief into prompts to `to` until that harness accepts a turn. */
  pending?: boolean;
};

/** Compact transcript card for a second-opinion or split-pane handoff turn. */
export type SecondOpinionMeta = {
  from: HarnessId;
  to: HarnessId;
  request?: string;
  files?: number;
  /** Split-pane continue. Default is a second-opinion review. */
  kind?: "handoff";
};

export type ToolPreviewKind = "read" | "write" | "shell" | "search";

export type ToolPreviewLineKind = "add" | "del" | "context";

export type ToolPreviewLine = {
  number?: number;
  kind: ToolPreviewLineKind;
  text: string;
};

export type ToolPreview = {
  kind: ToolPreviewKind;
  title?: string;
  path?: string;
  fileName?: string;
  startLine?: number;
  additions?: number;
  deletions?: number;
  query?: string;
  lines?: ToolPreviewLine[];
  output?: string;
};

export type AttachmentKind = "image" | "audio" | "file";

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
  /** Absolute path when the file lives on disk. */
  path?: string;
  /** Base64 payload for vision images (and pasted blobs) sent to the harness. */
  data?: string;
  /** Object URL for in-session thumbnails. Not persisted. */
  previewUrl?: string;
};

export type QueuedMessage = {
  id: string;
  text: string;
  attachments: Attachment[];
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  intent?: TurnIntent;
};

export type MessageQueueStatus = "active" | "paused" | "resuming";

export type TurnIdentity = {
  /** Local identity ID; steering messages share their dispatch ID. */
  id: string;
  harness: HarnessId;
  requestedModel?: string;
  modelSettings?: Record<string, string>;
  /** Provider evidence; time-correlated legacy evidence also carries recovery provenance. */
  providerModel?: string;
  providerTurnId?: string;
  providerSessionId?: string;
  recovery?: {
    source: "codex-rollout-time-match";
    providerSessionId: string;
    providerStartedAt: number;
  };
};

export type Block = {
  id: string;
  role: BlockRole;
  text: string;
  attachments?: Attachment[];
  streaming?: boolean;
  /** Epoch ms when this user turn started. */
  startedAt?: number;
  turnIdentity?: TurnIdentity;
  /** How long the agent worked on this user turn, in ms. */
  durationMs?: number;
  tool?: {
    callId?: string;
    title?: string;
    kind?: string;
    status?: string;
    detail?: string;
    preview?: ToolPreview;
  };
  approval?: {
    requestId: number;
    decided?: "allow" | "deny" | "cancelled";
  };
  taskList?: TaskListMeta;
  plan?: PlanBlockMeta;
  handoff?: HandoffMeta;
  secondOpinion?: SecondOpinionMeta;
  /** Note chip shown on this user turn. Body is not stored; the harness already received it. */
  noteCard?: NoteCardMeta;
};

export type RuntimeMode =
  "supervised" | "auto-accept-edits" | "auto" | "full-access";

/** One GitHub issue or pull request associated with a coding session. */
export type LinkedWorkItem = {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  url: string;
};

export const RUNTIME_MODES: RuntimeMode[] = [
  "supervised",
  "auto-accept-edits",
  "auto",
  "full-access",
];

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "supervised";

export const RUNTIME_MODE_LABEL: Record<RuntimeMode, string> = {
  supervised: "Supervised",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

export const RUNTIME_MODE_HINT: Record<RuntimeMode, string> = {
  supervised: "Ask before commands and file changes.",
  "auto-accept-edits": "Auto-approve edits, ask before other actions.",
  auto: "An AI reviewer approves routine actions; risky ones still ask.",
  "full-access": "Allow commands and edits without prompts.",
};

export type Session = {
  /** Only unused drafts created from Settings inherit later default changes. */
  followsDefault?: boolean;
  /** Temporary Inbox conversation: shares the runtime, never saved as a session. */
  inboxAsk?: InboxAskContext;
  id: string;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  title: string;
  /** Project / working directory for this session. */
  cwd: string;
  blocks: Block[];
  /** True while a harness turn is in flight. */
  busy?: boolean;
  /** Follow-ups waiting for current turn. In-memory only. */
  queuedMessages?: QueuedMessage[];
  /** Paused after user stops current turn; resuming waits for continued turn. */
  queueStatus?: MessageQueueStatus;
  /** Prevent auto-dispatch while this queued row is being edited. In-memory only. */
  editingQueuedMessageId?: string;
  /** Provider-side conversation id (Cursor ACP session id). */
  providerSessionId?: string;
  /** Context-window level reported by the harness. Absent until it reports. */
  context?: ContextUsage;
  /**
   * Composer switched providers, but the previous child is still live.
   * Handoff runs on the next send, not on picker change.
   */
  pendingSwitch?: PendingHarnessSwitch;
  /**
   * Last composer-pinned branch. Unused after session worktrees were removed;
   * kept so older session records still load.
   */
  branch?: string;
  /** Extra git worktree from the old session-branch feature. Unused. */
  worktreeCwd?: string;
  /** One-shot composer text when opening a session from Inbox. */
  composerSeed?: string;
  /** Inbox issue/PR chip shown above the composer. In-memory, one-shot. */
  inboxCard?: InboxComposerCard;
  /** GitHub issue or pull request shown on the persisted session card. */
  linkedWorkItem?: LinkedWorkItem;
  /** Note chip shown above the composer. In-memory, one-shot. */
  noteCard?: NoteComposerCard;
  /** Handoff chip shown above the composer. In-memory, one-shot. */
  handoffCard?: HandoffComposerCard;
  /**
   * Live clarifying questions from AskUserQuestion / ask_question / etc.
   * In-memory; request ids do not survive restarts.
   */
  pendingQuestion?: UserQuestionPrompt;
};

export type PendingHarnessSwitch = {
  from: HarnessId;
  fromModel: string;
  fromSettings: Record<string, string>;
  fromProviderSessionId?: string;
};

export const HARNESS_LABEL: Record<HarnessId, string> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  grok: "grok",
  opencode: "opencode",
  pi: "pi",
  omp: "omp",
  fx: "fx",
};

export const HARNESS_TITLE: Record<HarnessId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok Build",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "omp",
  fx: "fx",
};

/** fx ACP rejects attachment prompt blocks. */
export function harnessSupportsAttachments(id: HarnessId): boolean {
  return id !== "fx";
}

export function newSession(
  harness: HarnessId = "claude",
  cwd = "~",
  model?: string,
  runtimeMode: RuntimeMode = DEFAULT_RUNTIME_MODE,
  modelSettings?: Record<string, string>,
): Session {
  const resolved = resolveModel(harness, model ?? preferredModelId(harness));
  return {
    id: crypto.randomUUID(),
    harness,
    model: resolved.id,
    modelSettings:
      !hasLiveCatalog(harness) && !resolved.settings
        ? { ...modelSettings, ...loadLastModelSettings() }
        : preferredModelSettings(resolved, modelSettings),
    runtimeMode,
    title: HARNESS_LABEL[harness],
    cwd,
    blocks: [],
  };
}

/**
 * Fresh drafts inherit Settings until a model choice or their first submission.
 */
export function newDefaultSession(
  cwd = "~",
  runtimeMode: RuntimeMode = DEFAULT_RUNTIME_MODE,
): Session {
  const choice = defaultSessionChoice();
  return {
    ...newSession(choice.harness, cwd, choice.model, runtimeMode),
    followsDefault: true,
  };
}

/** Never infer inheritance for old records or revive it after a turn. */
export function followSessionDefaults(session: Session): Session {
  if (
    !session.followsDefault ||
    session.busy ||
    session.blocks.length > 0 ||
    session.providerSessionId ||
    session.pendingSwitch ||
    session.queuedMessages?.length
  )
    return session;
  const choice = defaultSessionChoice();
  const model = resolveModel(choice.harness, choice.model);
  const modelSettings =
    !hasLiveCatalog(choice.harness) && !model.settings
      ? loadLastModelSettings()
      : preferredModelSettings(model);
  if (
    session.harness === choice.harness &&
    session.model === model.id &&
    JSON.stringify(session.modelSettings) === JSON.stringify(modelSettings)
  )
    return session;
  return {
    ...session,
    harness: choice.harness,
    model: model.id,
    modelSettings,
    title:
      session.title === HARNESS_LABEL[session.harness]
        ? HARNESS_LABEL[choice.harness]
        : session.title,
  };
}

/** Reconcile draft preferences and catalogs before React commits queued updates. */
export function sealSessionDefaults(session: Session): Session {
  return {
    ...refreshSessionModel(followSessionDefaults(session)),
    followsDefault: false,
  };
}

/** Resolve deferred catalogs without rewriting active turns or saved history. */
export function refreshSessionModel(session: Session): Session {
  if (
    !hasLiveCatalog(session.harness) ||
    session.busy ||
    session.blocks.length > 0 ||
    session.providerSessionId ||
    session.pendingSwitch
  )
    return session;
  const resolved = resolveModel(session.harness, session.model || undefined);
  const modelSettings = mergeModelSettings(resolved, session.modelSettings);
  if (
    resolved.id === session.model &&
    JSON.stringify(modelSettings) === JSON.stringify(session.modelSettings)
  )
    return session;
  return { ...session, model: resolved.id, modelSettings };
}

/** First line of a prompt, truncated for the tab strip. */
export function titleFromPrompt(
  prompt: string,
  harness: HarnessId,
  attachments: Attachment[] = [],
): string {
  const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const fromFiles =
    !line && attachments.length > 0
      ? attachments
          .map((file) => file.name)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ")
      : "";
  const seed = line || fromFiles;
  if (!seed) return HARNESS_LABEL[harness];
  const max = 72;
  const short = seed.length > max ? `${seed.slice(0, max - 1)}…` : seed;
  return formatSessionTitle(harness, short);
}

export function formatSessionTitle(harness: HarnessId, title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return HARNESS_LABEL[harness];
  return `${HARNESS_LABEL[harness]} · ${trimmed}`;
}

/** True when the stored title is still a placeholder the LLM may replace. */
export function canReplaceSessionTitle(
  current: string,
  harness: HarnessId,
  seed: string,
): boolean {
  return (
    current === seed ||
    current === HARNESS_LABEL[harness] ||
    current === HARNESS_TITLE[harness]
  );
}

export function hasPendingApproval(blocks: Block[]): boolean {
  return blocks.some((block) => block.approval && !block.approval.decided);
}

export function sessionNeedsInput(session: Session): boolean {
  return hasPendingApproval(session.blocks) || session.pendingQuestion != null;
}

/** Title without the harness prefix stored for the tab strip. */
export function sessionDisplayTitle(title: string, harness: HarnessId): string {
  const prefix = `${HARNESS_LABEL[harness]} · `;
  if (title.startsWith(prefix)) return title.slice(prefix.length);
  if (title === HARNESS_LABEL[harness] || title === HARNESS_TITLE[harness]) {
    return "New session";
  }
  return title;
}

/** Working copy the agent and session git UIs should use. */
export function sessionWorkCwd(session: {
  cwd: string;
  worktreeCwd?: string;
}): string {
  return session.worktreeCwd || session.cwd;
}
