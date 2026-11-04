import { useAtom } from "@effect/atom-react";
import { filesSearchOptionsAtom } from "@t3tools/client-runtime/state/files-search-options";
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
