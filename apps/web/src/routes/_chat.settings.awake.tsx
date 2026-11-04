import { createFileRoute } from "@tanstack/react-router";
import { AwakeSettings } from "../components/settings/AwakeSettings";

export const Route = createFileRoute("/_chat/settings/awake")({ component: AwakeSettings });
