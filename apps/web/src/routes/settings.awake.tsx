import { createFileRoute } from "@tanstack/react-router";
import { AwakeSettings } from "../components/settings/AwakeSettings";

export const Route = createFileRoute("/settings/awake")({ component: AwakeSettings });
