import { useUser } from "@clerk/react";
import { LinearLoginSteps, type LinearLoginStepsProps } from "../linear/LinearLoginAssist";

export default function LinearAccountEmail(props: Omit<LinearLoginStepsProps, "email">) {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return null;
  return <LinearLoginSteps {...props} email={user?.primaryEmailAddress?.emailAddress ?? ""} />;
}
