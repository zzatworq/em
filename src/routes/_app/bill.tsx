import { createFileRoute } from "@tanstack/react-router";
import { BillView } from "@/components/monitor/bill-view";

export const Route = createFileRoute("/_app/bill")({ component: BillView });
