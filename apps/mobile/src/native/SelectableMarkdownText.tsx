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
  const [candidates, setCandidates] = useState<readonly number[]>([]);
  const closeCode = () => {
    setSelected(null);
    setCandidates([]);
  };
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
          // Native press events omit source positions; let the user choose an occurrence.
          setCandidates([]);
          if (matches.length === 1) setSelected(matches[0]!.index);
          else if (matches.length > 1) setCandidates(matches.map(({ index }) => index));
          else props.onCodeBlockPress?.(block);
        }}
      />
      <Modal
        visible={selectedBlock !== undefined || candidates.length > 0}
        transparent
        animationType="slide"
        onRequestClose={closeCode}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}>
          <Pressable
            accessibilityLabel="Close code block"
            style={{ flex: 1 }}
            onPress={closeCode}
          />
          <ScrollView
            style={{ maxHeight: "80%", backgroundColor: textStyle.codeBlockBackgroundColor }}
          >
            {candidates.length > 0 && (
              <View style={{ padding: 16, gap: 12 }}>
                <Text style={{ color: textStyle.color }}>
                  Choose which matching code block to edit
                </Text>
                {candidates.map((index) => {
                  const block = nestedBlocks[index]!;
                  const line = props.markdown.slice(0, block.start).split("\n").length;
                  return (
                    <Pressable
                      key={block.start}
                      accessibilityRole="button"
                      onPress={() => {
                        setSelected(index);
                        setCandidates([]);
                      }}
                      style={{ paddingVertical: 12 }}
                    >
                      <Text style={{ color: textStyle.linkColor }}>Code block on line {line}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
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
            <Pressable accessibilityRole="button" onPress={closeCode} style={{ padding: 16 }}>
              <Text style={{ color: textStyle.linkColor }}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
