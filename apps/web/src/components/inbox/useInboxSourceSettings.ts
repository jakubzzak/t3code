import type {
  EnvironmentId,
  InboxSourceConfigureInput,
  InboxSourceConnection,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { inboxEnvironment } from "~/state/inbox";
import { useAtomCommand } from "~/state/use-atom-command";

type Selection = Pick<InboxSourceConnection, "categories" | "accounts" | "initialLookbackDays">;
const selectionOf = ({
  categories,
  accounts,
  initialLookbackDays,
}: InboxSourceConnection): Selection => ({ categories, accounts, initialLookbackDays });

/** Serialize full source selections so rapid edits cannot overwrite one another. */
export function useInboxSourceSettings(
  environmentId: EnvironmentId,
  connection: InboxSourceConnection,
  refresh: () => void,
) {
  const configure = useAtomCommand(inboxEnvironment.configureSource, { reportFailure: true });
  const [selection, setSelection] = useState(() => selectionOf(connection));
  const [saving, setSaving] = useState(false);
  const latest = useRef(selection);
  const confirmed = useRef(selection);
  const revision = useRef(0);
  const queued = useRef(Promise.resolve());
  const outstanding = useRef(0);

  useEffect(() => {
    if (outstanding.current) return;
    latest.current = confirmed.current = selectionOf(connection);
    setSelection(latest.current);
  }, [connection]);

  function update(
    change: Partial<Selection> | ((current: Selection) => Partial<Selection>),
    token?: InboxSourceConfigureInput["token"],
  ) {
    const next = {
      ...latest.current,
      ...(typeof change === "function" ? change(latest.current) : change),
    };
    latest.current = next;
    setSelection(next);
    setSaving(true);
    const currentRevision = ++revision.current;
    outstanding.current++;
    const save = queued.current.then(async () => {
      try {
        const result = await configure({
          environmentId,
          input: {
            projectId: connection.projectId,
            source: connection.source,
            ...next,
            enabled: true,
            ...(token ? { token } : {}),
          },
        });
        if (result._tag === "Success") confirmed.current = selectionOf(result.value);
        return result._tag === "Success";
      } finally {
        outstanding.current--;
        if (currentRevision === revision.current) {
          latest.current = confirmed.current;
          setSelection(confirmed.current);
          setSaving(false);
          refresh();
        }
      }
    });
    queued.current = save.then(
      () => {},
      () => {},
    );
    return save;
  }

  return { selection, saving, update };
}
