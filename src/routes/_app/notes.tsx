import { createFileRoute } from "@tanstack/react-router";
import { NotesView } from "@/components/monitor/notes-view";

export const Route = createFileRoute("/_app/notes")({ component: NotesView });
