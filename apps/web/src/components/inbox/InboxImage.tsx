import { useState } from "react";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useAssetUrlState } from "~/assets/assetUrls";

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
  if (failed || asset._tag === "Failure")
    return (
      <p className="text-2xs text-muted-foreground">
        Image unavailable: {name}. Check Slack file permissions or open the original message.
      </p>
    );
  if (asset._tag !== "Success")
    return <span className="text-2xs text-muted-foreground">Loading {name}…</span>;
  return (
    <a
      href={asset.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
    >
      <img
        src={asset.url}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="my-2 max-h-64 max-w-full rounded-md object-contain"
      />
    </a>
  );
}
