import { createFileRoute } from "@tanstack/react-router";
import { HistoryView } from "@/components/monitor/history-view";

export const Route = createFileRoute("/_app/history")({ component: HistoryView });
