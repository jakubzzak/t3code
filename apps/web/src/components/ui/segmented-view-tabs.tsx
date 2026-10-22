import { Tabs } from "@base-ui/react/tabs";
import { useState, type ReactNode } from "react";
import styles from "./segmented-view-tabs.module.css";

/** Shared with the Linear view: adjacent segments follow the same glass indicator and settling motion. */
export function SegmentedViewTabs({
  value,
  label,
  items,
}: {
  value: string;
  label: string;
  items: ReadonlyArray<{ value: string; label: ReactNode; icon: ReactNode; count?: number }>;
}) {
  const [initial] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!changed && value !== initial) setChanged(true);
  return (
    <Tabs.List
      aria-label={label}
      className="relative isolate flex shrink-0 rounded-full bg-muted/50 p-1"
    >
      <Tabs.Indicator className={styles.indicator} aria-hidden="true">
        <span
          key={value}
          className={changed ? `${styles.bubble} ${styles.moving}` : styles.bubble}
        />
      </Tabs.Indicator>
      {items.map((item) => (
        <Tabs.Tab
          key={item.value}
          value={item.value}
          className="relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs whitespace-nowrap text-muted-foreground outline-none data-active:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {item.icon}
          <span className="inline-flex items-baseline gap-1">
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="text-muted-foreground tabular-nums">{item.count}</span>
            )}
          </span>
        </Tabs.Tab>
      ))}
    </Tabs.List>
  );
}
