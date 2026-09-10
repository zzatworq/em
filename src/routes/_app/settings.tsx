import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "@/components/monitor/settings-view";

export const Route = createFileRoute("/_app/settings")({ component: SettingsView });
