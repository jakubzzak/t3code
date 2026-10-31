import { useState } from "react";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useAssetUrlState } from "~/assets/assetUrls";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";

/** Signed environment URLs also work when Slack is connected on a remote host. */
export function InboxImage({
  environmentId,
  resource,
  name,
}: {
  environmentId: EnvironmentId;
  resource: AssetResource;
  name: string;
}) {
  const asset = useAssetUrlState(environmentId, resource);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (failed || asset._tag === "Failure")
    return (
      <p className="text-2xs text-muted-foreground">
        Image unavailable: {name}. Check Slack file permissions or open the original message.
      </p>
    );
  if (asset._tag !== "Success")
    return <span className="text-2xs text-muted-foreground">Loading {name}…</span>;
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Dialog portals still bubble through the notification's keyboard navigation.
        if (expanded) event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="block size-16 overflow-hidden rounded-lg border border-border/80"
        aria-label={`Preview ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(true);
        }}
      >
        <img
          src={asset.url}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      </button>
      {expanded && (
        <ExpandedImageDialog
          preview={{
            images: [
              {
                src: asset.url,
                name,
                actionsSource: {
                  kind: "image",
                  name,
                  src: asset.url,
                  asset: { environmentId, resource },
                },
              },
            ],
            index: 0,
          }}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
