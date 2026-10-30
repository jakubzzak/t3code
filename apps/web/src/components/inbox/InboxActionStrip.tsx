import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { EllipsisVerticalIcon, type LucideIcon } from "lucide-react";
import { observeResize } from "~/lib/observeResize";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

interface InboxAction {
  label: string;
  hint: string;
  Icon: LucideIcon;
  primary?: boolean | undefined;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  button?: ReactNode;
}

export function InboxActionStrip({
  actions,
  agentCount,
  hints,
}: {
  actions: readonly InboxAction[];
  agentCount: number;
  hints: boolean;
}) {
  const [slots, setSlots] = useState(Infinity);
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const measure = () => {
      const buttonWidth = node.querySelector("button")?.getBoundingClientRect().width;
      if (!buttonWidth) return;
      const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
      setSlots(
        Math.max(0, Math.floor((node.getBoundingClientRect().width + gap) / (buttonWidth + gap))),
      );
    };
    measure();
    return observeResize(node, measure);
  }, []);
  // Once overflow is needed, reserve one of the available slots for the menu.
  const visibleCount = slots >= actions.length ? actions.length : Math.max(0, slots - 1);
  const hidden = actions.slice(visibleCount);
  return (
    <div
      ref={attach}
      data-inbox-actions
      className="mt-2 flex items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {actions
        .slice(0, visibleCount)
        .map(({ label, hint, Icon, primary, disabled, onClick, button }, index) => (
          <span
            key={label}
            className={`relative shrink-0 ${index === agentCount ? "ml-auto" : ""}`}
          >
            {button ?? (
              <>
                <Button
                  size="icon-xs"
                  variant={primary ? "default" : "ghost"}
                  disabled={disabled}
                  aria-label={label}
                  title={label}
                  onClick={onClick}
                >
                  <Icon className="size-3.5" />
                </Button>
                {hints && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-2 right-0 rounded bg-popover px-1 text-3xs text-popover-foreground shadow-sm"
                  >
                    {hint}
                  </span>
                )}
              </>
            )}
          </span>
        ))}
      {hidden.length > 0 && (
        <div className={`shrink-0 ${visibleCount <= agentCount ? "ml-auto" : ""}`}>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="More actions"
                  title="More actions"
                />
              }
              onKeyDown={(event) => event.stopPropagation()}
            >
              <EllipsisVerticalIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" onKeyDown={(event) => event.stopPropagation()}>
              {hidden.map(({ label, Icon, disabled, onClick }) => (
                <MenuItem key={label} disabled={disabled} onClick={onClick}>
                  <Icon />
                  {label}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </div>
      )}
    </div>
  );
}
