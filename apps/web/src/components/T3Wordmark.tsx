import type { SVGProps } from "react";
import blackbirdIcon from "../../../../assets/blackbird-icon.png";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
      <image href={blackbirdIcon} width="180" height="180" />
    </svg>
  );
}
