import { useState } from "react";

/** Holds automatic refreshes during agent work, then catches up to the latest revision. */
export function useSettledRefreshToken<Token extends string | number | null>(input: {
  readonly resourceKey: string | null;
  readonly refreshToken: Token;
  readonly isWorking: boolean;
}): Token {
  const [settled, setSettled] = useState(() => ({
    resourceKey: input.resourceKey,
    refreshToken: input.refreshToken,
  }));
  if (
    settled.resourceKey !== input.resourceKey ||
    (!input.isWorking && settled.refreshToken !== input.refreshToken)
  ) {
    setSettled({ resourceKey: input.resourceKey, refreshToken: input.refreshToken });
    return input.refreshToken;
  }
  return settled.refreshToken;
}
