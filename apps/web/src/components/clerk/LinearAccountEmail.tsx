import { useUser } from "@clerk/react";
import { LinearLoginSteps } from "../linear/LinearLoginAssist";

export default function LinearAccountEmail(props: {
  runtimeTabId: string;
  url: string | null;
  loading: boolean;
}) {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return null;
  return <LinearLoginSteps {...props} email={user?.primaryEmailAddress?.emailAddress ?? ""} />;
}
