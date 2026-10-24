import { useAtom } from "@effect/atom-react";
import { filesSearchOptionsAtom } from "@t3tools/client-runtime/state/files-search-options";
import { View } from "react-native";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { SymbolView } from "../../components/AppSymbol";
import type { FilesSearchOptions } from "@t3tools/contracts";

export function useFileSearchOptions(chatKey: string) {
  const [options, setOptions] = useAtom(filesSearchOptionsAtom(chatKey));
  const toggle = (key: keyof FilesSearchOptions) =>
    setOptions({ ...options, [key]: !options[key] });
  const items = [
    {
      id: "ignored",
      title: "Include ignored files",
      selected: options.includeIgnored,
      onPress: () => toggle("includeIgnored"),
    },
    {
      id: "tests",
      title: "Include test files",
      selected: options.includeTests,
      onPress: () => toggle("includeTests"),
    },
    {
      id: "dependencies",
      title: "node_modules is always excluded",
      disabled: true,
      onPress: () => {},
    },
  ];
  return { options, items, active: options.includeIgnored || options.includeTests };
}

export function FileSearchOptionsButton({
  settings,
}: {
  settings: ReturnType<typeof useFileSearchOptions>;
}) {
  return (
    <ControlPillMenu
      title="File search options"
      accessibilityLabel={settings.active ? "File search options, enabled" : "File search options"}
      accessibilityRole="button"
      actions={settings.items.map((item) => ({
        id: item.id,
        title: item.title,
        state: item.selected ? "on" : "off",
        attributes: { disabled: item.disabled === true },
      }))}
      onPressAction={({ nativeEvent }) =>
        settings.items.find((item) => item.id === nativeEvent.event)?.onPress()
      }
    >
      <View className="h-11 w-11 items-center justify-center">
        <SymbolView
          name="slider.horizontal.3"
          size={18}
          tintColorClassName={settings.active ? "accent-primary" : "accent-icon-muted"}
          type="monochrome"
        />
      </View>
    </ControlPillMenu>
  );
}
