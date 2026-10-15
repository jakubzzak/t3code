import type { AnyRouter } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { buildThreadRouteParams } from "~/threadRoutes";

/** Creation may complete through an unmounted picker after the user returns to its draft. */
export async function promoteLinearDraftThread(
  router: Pick<AnyRouter, "state" | "navigate">,
  threadRef: ScopedThreadRef,
) {
  const draftId = useComposerDraftStore.getState().getDraftIdByRef(threadRef);
  if (!draftId) return;
  markPromotedDraftThreadByRef(threadRef);
  const params = router.state.matches.at(-1)?.params;
  if (params && "draftId" in params && params.draftId === draftId) {
    await router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      replace: true,
    });
  }
  finalizePromotedDraftThreadByRef(threadRef);
}
