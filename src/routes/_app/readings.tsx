import { createFileRoute } from "@tanstack/react-router";
import { ReadingsView } from "@/components/monitor/readings-view";

export const Route = createFileRoute("/_app/readings")({ component: ReadingsView });
