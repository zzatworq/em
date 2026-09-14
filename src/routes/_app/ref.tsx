import { createFileRoute } from "@tanstack/react-router";
import { RefView } from "@/components/monitor/ref-view";

export const Route = createFileRoute("/_app/ref")({ component: RefView });
