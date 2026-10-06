import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import script from "@t3tools/mobile-mermaid";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";

export default function MermaidDiagram(props: { code: string; children: ReactNode }) {
  const theme = useAppearancePreferences().themeAppearance;
  return (
    <DiagramDocument key={`${theme}:${props.code}`} code={props.code} theme={theme}>
      {props.children}
    </DiagramDocument>
  );
}

function DiagramDocument(props: { code: string; theme: "dark" | "light"; children: ReactNode }) {
  const [height, setHeight] = useState(160);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const foreground = props.theme === "dark" ? "#ddd" : "#333";
  const source = useMemo(
    () => ({
      html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>body{margin:0;padding:12px;color:${foreground};font-family:system-ui}svg{display:block;margin:auto}</style></head><body><script>${script.replaceAll("</script", "<\\/script")}</script><script>window.renderDiagram(${JSON.stringify(props.code).replaceAll("<", "\\u003c")},${JSON.stringify(props.theme)});</script></body></html>`,
    }),
    [props.code, props.theme, foreground],
  );
  if (failed)
    return (
      <>
        <Text accessibilityRole="alert" style={{ color: foreground, padding: 12 }}>
          Could not render this diagram. Its source is shown below.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry diagram"
          onPress={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          <Text style={{ color: foreground, padding: 12 }}>Retry</Text>
        </Pressable>
        {props.children}
      </>
    );
  return (
    <View style={{ height, width: "100%" }}>
      <WebView
        key={attempt}
        accessibilityLabel="Mermaid diagram"
        source={source}
        originWhitelist={["*"]}
        scrollEnabled={height >= 800}
        nestedScrollEnabled
        style={{ backgroundColor: "transparent" }}
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
        onError={() => setFailed(true)}
        onContentProcessDidTerminate={() => setFailed(true)}
        onRenderProcessGone={() => setFailed(true)}
        onMessage={(event) => {
          try {
            const message: unknown = JSON.parse(event.nativeEvent.data);
            if (!message || typeof message !== "object") return;
            if ("error" in message) setFailed(true);
            else if (
              "height" in message &&
              typeof message.height === "number" &&
              Number.isFinite(message.height)
            )
              setHeight(Math.min(800, Math.max(80, message.height + 24)));
          } catch {
            setFailed(true);
          }
        }}
      />
    </View>
  );
}
