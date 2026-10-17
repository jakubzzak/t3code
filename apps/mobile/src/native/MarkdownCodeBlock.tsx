import {
  CODE_LANGUAGES,
  type markdownCodeBlocks,
  type MarkdownCodeLanguageChange,
} from "@t3tools/shared/markdownCode";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { CopyTextButton } from "../components/CopyTextButton";
import MermaidDiagram from "../features/markdown/MermaidDiagram";
import { MobileEnrichedMarkdownText } from "./EnrichedMarkdownText";
import type { SelectableMarkdownTextProps } from "./SelectableMarkdownText.types";

export function MarkdownCodeBlock({
  block,
  textStyle,
  isStreaming,
  onCodeLanguageChange,
  renderDiagram,
}: {
  block: ReturnType<typeof markdownCodeBlocks>[number];
  textStyle: SelectableMarkdownTextProps["textStyle"];
  isStreaming: boolean | undefined;
  onCodeLanguageChange: ((change: MarkdownCodeLanguageChange) => Promise<void>) | undefined;
  renderDiagram: SelectableMarkdownTextProps["renderDiagram"];
}) {
  const [source, setSource] = useState(false);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diagram = block.language.toLowerCase() === "mermaid";
  // A longer fence keeps embedded Markdown fences inside the displayed source.
  const fence = "`".repeat(
    Math.max(3, ...[...block.code.matchAll(/`+/g)].map((match) => match[0].length + 1)),
  );
  const code = (
    <MobileEnrichedMarkdownText
      markdown={`${fence}${block.language}\n${block.code}\n${fence}`}
      textStyle={textStyle}
    />
  );
  return (
    <View
      style={{
        borderColor: textStyle.dividerColor,
        borderWidth: 1,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
          backgroundColor: textStyle.codeBlockBackgroundColor,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change code language"
          disabled={!onCodeLanguageChange || isStreaming || !block.closed || saving}
          onPress={() => setPicker(true)}
          style={{ flex: 1, paddingVertical: 10 }}
        >
          <Text style={{ color: textStyle.mutedColor }}>
            {saving ? "Saving…" : block.language || "text"}
          </Text>
        </Pressable>
        {diagram && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={source ? "Show diagram" : "Show source"}
            onPress={() => setSource(!source)}
            style={{ padding: 10 }}
          >
            <Text style={{ color: textStyle.linkColor }}>{source ? "Diagram" : "Source"}</Text>
          </Pressable>
        )}
        <CopyTextButton
          accessibilityLabel="Copy code"
          text={block.code}
          tintColor={textStyle.mutedColor}
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" style={{ color: textStyle.color, padding: 12 }}>
          {error}
        </Text>
      )}
      {diagram && !source && block.closed ? (
        renderDiagram ? (
          renderDiagram({ code: block.code, children: code })
        ) : (
          <MermaidDiagram code={block.code}>{code}</MermaidDiagram>
        )
      ) : (
        code
      )}
      <Modal
        visible={picker}
        transparent
        animationType="slide"
        onRequestClose={() => setPicker(false)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}>
          <Pressable
            accessibilityLabel="Close language picker"
            onPress={() => setPicker(false)}
            style={{ flex: 1 }}
          />
          <View
            style={{
              maxHeight: "70%",
              padding: 20,
              backgroundColor: textStyle.codeBlockBackgroundColor,
            }}
          >
            <Text style={{ color: textStyle.strongColor, fontSize: 18, marginBottom: 12 }}>
              Code language
            </Text>
            <ScrollView>
              {CODE_LANGUAGES.map((language) => (
                <Pressable
                  key={language}
                  accessibilityRole="button"
                  accessibilityLabel={language}
                  onPress={async () => {
                    setPicker(false);
                    setSaving(true);
                    setError(null);
                    try {
                      await onCodeLanguageChange?.({
                        blockStart: block.start,
                        expectedLanguage: block.language,
                        language,
                      });
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : "Could not save code language.",
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                  style={{ paddingVertical: 12 }}
                >
                  <Text style={{ color: textStyle.color }}>{language}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPicker(false)}
              style={{ paddingVertical: 16 }}
            >
              <Text style={{ color: textStyle.linkColor }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
