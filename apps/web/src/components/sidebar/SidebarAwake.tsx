import { CoffeeIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useDesktopAwakeState, awakeStatusText } from "../../lib/desktopAwake";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export function SidebarAwake() {
  const [state] = useDesktopAwakeState();
  if (!state?.supported || state.status !== "active") return null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={awakeStatusText(state)}
        render={<Link to="/settings/awake" />}
        aria-label={awakeStatusText(state)}
      >
        <CoffeeIcon />
        <span className="sr-only">Keep awake</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
