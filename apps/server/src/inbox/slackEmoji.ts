import { nameToEmoji } from "gemoji";

/** Local Unicode aliases only; unknown workspace emoji stay readable without remote images. */
export const slackEmojis: Readonly<Record<string, string>> = {
  ...nameToEmoji,
  "skin-tone-2": "🏻",
  "skin-tone-3": "🏼",
  "skin-tone-4": "🏽",
  "skin-tone-5": "🏾",
  "skin-tone-6": "🏿",
};
