import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LightbulbIcon, RotateCwIcon } from "lucide-react";
import type { InboxNotification } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { inboxResearchPhrases, nextResearchPhrase } from "./inboxResearchPresentation";
import styles from "./inboxNotificationContent.module.css";

function ResearchProgress() {
  const gradient = `inbox-research-${useId()}`;
  const element = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [cycle, setCycle] = useState(() => nextResearchPhrase({ phrase: "", remaining: [] }));
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let visible = true;
    const sync = () => {
      setActive(visible && document.visibilityState !== "hidden");
      setReducedMotion(media?.matches ?? false);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? false;
            sync();
          });
    if (element.current) observer?.observe(element.current);
    sync();
    document.addEventListener("visibilitychange", sync);
    media?.addEventListener("change", sync);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      media?.removeEventListener("change", sync);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setCycle(nextResearchPhrase), 3000);
    return () => window.clearInterval(timer);
  }, [active]);
  return (
    <span
      ref={element}
      className={styles.researchProgress}
      data-animated={active && !reducedMotion}
    >
      <span className="sr-only" role="status">
        Researching suggestion
      </span>
      <LightbulbIcon
        aria-hidden="true"
        className={styles.researchBulb}
        stroke={`url(#${gradient})`}
      >
        <defs>
          <linearGradient id={gradient} x1="0%" x2="100%" spreadMethod="reflect">
            <stop offset="0%" className={styles.gradientStart} />
            <stop offset="45%" className={styles.gradientMiddle} />
            <stop offset="75%" className={styles.gradientEnd} />
            <stop offset="100%" className={styles.gradientStart} />
            {active && !reducedMotion && (
              <>
                <animate attributeName="x1" values="0%;100%;0%" dur="8s" repeatCount="indefinite" />
                <animate
                  attributeName="x2"
                  values="100%;200%;100%"
                  dur="8s"
                  repeatCount="indefinite"
                />
              </>
            )}
          </linearGradient>
        </defs>
      </LightbulbIcon>
      <span className={styles.researchLabel} aria-hidden="true">
        {inboxResearchPhrases.map((phrase) => (
          <span key={phrase} className={styles.phraseSizer}>
            {phrase}
          </span>
        ))}
        <span className={styles.researchPhrase}>{cycle.phrase}</span>
      </span>
    </span>
  );
}

export function InboxSuggestionStatus({
  status,
  onRetry,
}: {
  status: NonNullable<InboxNotification["suggestionResearch"]>["status"] | undefined;
  onRetry?: (() => void) | undefined;
}) {
  if (!status || status === "ready") return null;
  return (
    <span className={styles.suggestionStatus}>
      <span aria-hidden="true">·</span>
      {status === "researching" ? (
        <ResearchProgress />
      ) : (
        <>
          <span
            className={
              status === "unavailable" ? styles.suggestionUnavailable : styles.suggestionEmpty
            }
            role="status"
          >
            <LightbulbIcon aria-hidden="true" className="size-3" />
            {status === "unavailable" ? "Unavailable" : "No suggestion"}
          </span>
          {status === "unavailable" && (
            <Button
              variant="ghost"
              size="icon-tiny"
              aria-label="Retry suggestion research"
              disabled={!onRetry}
              onClick={(event) => {
                event.stopPropagation();
                onRetry?.();
              }}
            >
              <RotateCwIcon />
            </Button>
          )}
        </>
      )}
    </span>
  );
}

/** Keep the last content through collapse so disappearing and reversing have real geometry. */
export function InboxSuggestionCallout({
  visible,
  suggestions,
  children,
}: {
  visible: boolean;
  suggestions: ReadonlyArray<string>;
  children: (suggestions: ReadonlyArray<string>) => ReactNode;
}) {
  const [retained, setRetained] = useState({ input: suggestions, content: suggestions });
  if (retained.input !== suggestions)
    setRetained({
      input: suggestions,
      content: suggestions.length ? suggestions : retained.content,
    });
  return (
    <div
      className={styles.suggestionReveal}
      data-open={visible}
      aria-hidden={!visible}
      inert={!visible}
    >
      <div>
        <section aria-label="Suggestion" className={styles.suggestionCallout}>
          <p className="mb-1 flex items-center gap-1 text-2xs text-muted-foreground">
            <LightbulbIcon aria-hidden="true" className="size-3" />
            Suggestion
          </p>
          {children(suggestions.length ? suggestions : retained.content)}
        </section>
      </div>
    </div>
  );
}
