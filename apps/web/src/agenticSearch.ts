import * as Schema from "effect/Schema";

/** Captures the template at launch so later Settings edits cannot change a draft. */
export const AgenticSearchDraft = Schema.Struct({
  scope: Schema.Literals(["chats", "everywhere"]),
  template: Schema.String,
  presentation: Schema.Literals(["explicit", "implicit"]),
  autoSubmit: Schema.Boolean,
});
export type AgenticSearchDraft = typeof AgenticSearchDraft.Type;

export function prepareAgenticSearchPrompt(
  search: AgenticSearchDraft,
  prompt: string,
): string | null {
  const trimmed = prompt.trim();
  if (
    !trimmed ||
    trimmed === search.template.trim() ||
    trimmed === `${search.template.trim()}\n\nQuestion:`
  )
    return null;
  return search.presentation === "explicit" ? prompt : `${search.template}\n\nQuestion:\n${prompt}`;
}

export const AGENTIC_SEARCH_SCOPES = ["chats", "everywhere"] as const;
export type AgenticSearchScope = (typeof AGENTIC_SEARCH_SCOPES)[number];
export const AGENTIC_SEARCH_LABELS = {
  chats: "Search in all chats",
  everywhere: "Search everywhere",
} as const;
export const AGENTIC_SEARCH_COMMANDS = {
  chats: "search.allChats",
  everywhere: "search.everywhere",
} as const;

const CHAT_SEARCH_INSTRUCTIONS =
  "For Blackbird chats, search across all projects, including projectless and retained archived chats. Use t3_thread_search with scope=environment and includeArchived=true, refine keyword queries as needed, and read relevant threads with t3_thread_read before drawing conclusions. Search only the environment hosting this chat; other connected machines are outside this search. Disclose any search limits. Use only authorized read/search operations, never modify sources or send messages.";
const ANSWER_INSTRUCTIONS =
  "Return a very concise answer (normally 2–4 short bullets) with working citations or source links. End with one compact Sources: line listing what was actually searched and any unavailable or incomplete sources. Label chat coverage as Blackbird chats (hosting environment only). If no evidence is found, say so briefly. Never invent findings or imply exhaustive coverage.";
export const DEFAULT_AGENTIC_SEARCH_PROMPTS = {
  chats: `Research the question below using Blackbird chats. ${CHAT_SEARCH_INSTRUCTIONS} Do not search external integrations. ${ANSWER_INSTRUCTIONS}`,
  everywhere: `Research the question below across Blackbird chats and every connected integration that exposes search/read tools, without prioritizing any source type. Discover available tools and start independent searches concurrently across chats and integrations. Do not wait for chat results before searching connected tools, or skip other sources because one already answers the question. ${CHAT_SEARCH_INSTRUCTIONS} Follow relevant references, refine searches as needed, and report unavailable sources without discarding other findings. ${ANSWER_INSTRUCTIONS}`,
} as const;

export function agenticSearchTemplate(
  settings: { agenticSearchChatsPrompt: string; agenticSearchEverywherePrompt: string },
  scope: AgenticSearchScope,
) {
  const custom =
    scope === "chats" ? settings.agenticSearchChatsPrompt : settings.agenticSearchEverywherePrompt;
  return custom.trim() || DEFAULT_AGENTIC_SEARCH_PROMPTS[scope];
}
