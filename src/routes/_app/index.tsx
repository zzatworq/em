import { createFileRoute } from "@tanstack/react-router";
import { SummaryView } from "@/components/monitor/summary-view";

export const Route = createFileRoute("/_app/")({ component: SummaryView });
