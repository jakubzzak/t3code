import { View } from "react-native";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

export function SettingsFeaturesRouteScreen() {
  return (
    <SettingsScreen title="Features">
      <View className="gap-6 px-5 pt-4">
        <SettingsSection>
          <SettingsSwitchRow
            icon="circle"
            label="Linear view"
            subtitle="Available in the desktop app"
            disabled
            value={false}
            onValueChange={() => {}}
          />
        </SettingsSection>
      </View>
    </SettingsScreen>
  );
}
