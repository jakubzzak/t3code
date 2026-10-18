import { Image } from "expo-image";
import type { ColorValue } from "react-native";

import { T3_CODE_BRAND_MARK_SOURCE } from "./brandAssets";

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Image
      accessibilityLabel="Blackbird"
      accessibilityIgnoresInvertColors
      source={T3_CODE_BRAND_MARK_SOURCE}
      style={{ width: props.height, height: props.height }}
    />
  );
}
