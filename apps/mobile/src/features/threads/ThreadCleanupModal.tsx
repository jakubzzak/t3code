import { useAtomValue } from "@effect/atom-react";
import {
  getCleanupRequest,
  subscribeCleanupRequests,
  type CleanupRequest,
} from "@t3tools/client-runtime/state/thread-cleanup";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { THREAD_CLEANUP_OWNERSHIP_NOTICE, type ThreadCleanupSnapshot } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { AppText } from "../../components/AppText";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export function confirmCleanupAgent() {
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      "Stop the working agent?",
      "Resolve this chat and close all its tools.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Stop and resolve", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: false },
    ),
  );
}

export function ThreadCleanupModal() {
  const request = useSyncExternalStore(subscribeCleanupRequests, getCleanupRequest);
  return request ? (
    <Progress
      key={`${request.target.environmentId}:${request.target.threadId}`}
      request={request}
    />
  ) : null;
}

function Progress({ request }: { request: CleanupRequest }) {
  const { target } = request;
  const stream = useAtomValue(
    threadEnvironment.cleanupState({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    }),
  );
  const start = useAtomCommand(threadEnvironment.cleanupStart, { reportFailure: false });
  const [initial, setInitial] = useState<ThreadCleanupSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(true);
  const started = useRef(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);
  const retry = useCallback(async () => {
    const interruptAgent = confirmationRequired
      ? await confirmCleanupAgent()
      : request.interruptAgent;
    if (confirmationRequired && !interruptAgent) {
      request.done(false);
      return;
    }
    setError(null);
    setInitial(null);
    const result = await start({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, interruptAgent },
    });
    if (result._tag === "Success") setInitial(result.value);
    else {
      const failure = squashAtomCommandFailure(result);
      setConfirmationRequired(
        typeof failure === "object" &&
          failure !== null &&
          "confirmationRequired" in failure &&
          failure.confirmationRequired === true,
      );
      setError(failure instanceof Error ? failure.message : "Could not connect. Retry cleanup.");
    }
  }, [confirmationRequired, request, start, target]);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void retry();
    }
  }, [retry]);
  const progress =
    stream._tag === "Success" && stream.value?.operationId === initial?.operationId
      ? stream.value
      : initial;
  const complete = progress?.status === "complete";
  useEffect(() => {
    if (!complete) return;
    const hide = setTimeout(() => setVisible(false), 350);
    const finish = setTimeout(request.done, reduceMotion ? 350 : 650);
    return () => {
      clearTimeout(hide);
      clearTimeout(finish);
    };
  }, [complete, reduceMotion, request]);
  const failed = error !== null || progress?.status === "failed" || stream._tag === "Failure";
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={() => {}}
    >
      <View className="flex-1 items-center justify-center bg-black/50 p-6" accessibilityViewIsModal>
        <View className="w-full max-w-lg rounded-2xl bg-background p-6">
          <AppText className="mb-2 text-xl font-semibold" accessibilityRole="header">
            {complete ? "Chat resolved" : "Resolving chat"}
          </AppText>
          <AppText className="mb-5 text-muted-foreground">
            {failed
              ? "Some tools could not be closed. Retry to finish resolving."
              : "Closing this chat’s tools. Your conversation and code changes are kept."}
          </AppText>
          <AppText className="mb-4 text-xs text-muted-foreground">
            {THREAD_CLEANUP_OWNERSHIP_NOTICE}
          </AppText>
          <ScrollView style={{ maxHeight: 320 }} accessibilityLiveRegion="polite">
            {(
              progress?.resources ?? [
                { id: "inventory", label: "Find chat resources", status: "closing" },
              ]
            ).map((row) => (
              <View key={row.id} className="mb-4 flex-row items-start gap-3">
                <View className="flex-1">
                  <AppText>{row.label}</AppText>
                  {"error" in row && row.error && (
                    <AppText className="text-destructive">{row.error}</AppText>
                  )}
                </View>
                {row.status === "closing" && !reduceMotion ? (
                  <ActivityIndicator accessibilityLabel="Closing" />
                ) : (
                  <AppText
                    accessibilityLabel={
                      row.status === "closed"
                        ? "Closed"
                        : row.status === "failed"
                          ? "Failed"
                          : "Closing"
                    }
                  >
                    {row.status === "closed" ? "✓" : row.status === "failed" ? "!" : "…"}
                  </AppText>
                )}
              </View>
            ))}
            {error && (
              <AppText accessibilityRole="alert" className="text-destructive">
                {error}
              </AppText>
            )}
            {stream._tag === "Failure" && (
              <AppText>Connection interrupted. Reconnect and retry to check progress.</AppText>
            )}
          </ScrollView>
          {failed && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void retry()}
              className="mt-4 self-end rounded-lg bg-primary px-5 py-3"
            >
              <AppText className="text-primary-foreground">Retry</AppText>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}
