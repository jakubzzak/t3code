import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { observeResize } from "~/lib/observeResize";
import styles from "./inboxNotificationContent.module.css";

/** Measure rendered Markdown so short bodies never get an unnecessary disclosure. */
export function InboxContentPreview({ children, lines }: { children: ReactNode; lines: 4 | 8 }) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const outer = viewport.current;
    const inner = content.current;
    if (!outer || !inner) return;
    const measure = () => {
      if (!inner.getBoundingClientRect().width) return;
      const lineHeight = Number.parseFloat(getComputedStyle(outer).lineHeight);
      setOverflows(inner.getBoundingClientRect().height > lineHeight * lines + 0.5);
    };
    measure();
    return observeResize([inner, outer], measure);
  }, [lines]);
  return (
    <div>
      <div
        id={id}
        ref={viewport}
        className={styles.contentPreview}
        data-lines={lines}
        data-expanded={expanded}
        onFocusCapture={(event) => {
          const target = event.target.getBoundingClientRect();
          const bounds = event.currentTarget.getBoundingClientRect();
          if (!expanded && overflows && target.bottom > bounds.bottom) setExpanded(true);
        }}
      >
        <div ref={content} className={styles.contentPreviewInner}>
          {children}
        </div>
      </div>
      {overflows && (
        <button
          type="button"
          className={styles.readMore}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
