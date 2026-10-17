import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { markdownCodeMedia } from "./markdownCodeMedia";
import { useCallback, useId, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { SelectableMarkdownTextProps } from "./SelectableMarkdownText.types";

import { MobileEnrichedMarkdownText } from "./EnrichedMarkdownText";
import { themeColorWithAlpha } from "../lib/mobileTheme";
import { useUniwindTheme } from "../lib/useUniwindTheme";

export type {
  MarkdownFileContextMenu,
  MarkdownFileContextMenuAction,
  MarkdownImageRenderer,
  MarkdownImageRequest,
  MarkdownImageSourceResolver,
  MarkdownLinkCustomization,
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "./SelectableMarkdownText.types";

export function SelectableMarkdownText(props: SelectableMarkdownTextProps) {
  const theme = useUniwindTheme();
  const selectionColor = themeColorWithAlpha(theme["--color-focus"], 0.32);
  const selectionHandleColor = theme["--color-focus"];
  const textStyle = useMemo(
    () =>
      Platform.OS === "android"
        ? { selectionColor, selectionHandleColor, ...props.textStyle }
        : props.textStyle,
    [props.textStyle, selectionColor, selectionHandleColor],
  );
  const id = useId();
  const { markdown, media, nestedBlocks } = useMemo(
    () => markdownCodeMedia(props.markdown, `blackbird-code://${encodeURIComponent(id)}/`),
    [props.markdown, id],
  );
  const renderImage = useCallback<NonNullable<SelectableMarkdownTextProps["renderImage"]>>(
    (image) => {
      const block = media.get(image.href);
      return block ? (
        <MarkdownCodeBlock
          key={`${image.href}:${block.language}`}
          block={block}
          textStyle={textStyle}
          isStreaming={props.isStreaming}
          onCodeLanguageChange={props.onCodeLanguageChange}
          renderDiagram={props.renderDiagram}
        />
      ) : (
        (props.renderImage?.(image) ?? null)
      );
    },
    [
      media,
      textStyle,
      props.isStreaming,
      props.onCodeLanguageChange,
      props.renderDiagram,
      props.renderImage,
    ],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const selectedBlock = selected === null ? undefined : nestedBlocks[selected];
  return (
    <>
      <MobileEnrichedMarkdownText
        {...props}
        markdown={markdown}
        renderImage={renderImage}
        textStyle={textStyle}
        onCodeBlockPress={(block) => {
          const matches = nestedBlocks
            .map((value, index) => ({ value, index }))
            .filter(({ value }) => value.code === block.code && value.language === block.language);
          // An identical nested block cannot be identified by the native press event.
          if (matches.length === 1) setSelected(matches[0]!.index);
          else props.onCodeBlockPress?.(block);
        }}
      />
      <Modal
        visible={selectedBlock !== undefined}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}>
          <Pressable
            accessibilityLabel="Close code block"
            style={{ flex: 1 }}
            onPress={() => setSelected(null)}
          />
          <ScrollView
            style={{ maxHeight: "80%", backgroundColor: textStyle.codeBlockBackgroundColor }}
          >
            {selectedBlock && (
              <MarkdownCodeBlock
                key={`${selected}:${selectedBlock.language}`}
                block={selectedBlock}
                textStyle={textStyle}
                isStreaming={props.isStreaming}
                onCodeLanguageChange={props.onCodeLanguageChange}
                renderDiagram={props.renderDiagram}
              />
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected(null)}
              style={{ padding: 16 }}
            >
              <Text style={{ color: textStyle.linkColor }}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
