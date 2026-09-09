import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useMonitor } from "@/store/monitor";

export function NotesView() {
  const notes = useMonitor((s) => s.notes);
  const addNote = useMonitor((s) => s.addNote);
  const deleteNote = useMonitor((s) => s.deleteNote);
  const [text, setText] = useState("");

  return (
    <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
      <h2 className="font-display text-2xl font-medium">Operational notes</h2>
      <p className="mt-1 text-sm text-muted">Meter changes, maintenance, unusual load, tariff updates.</p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a note"
          className="flex-1"
        />
        <Button
          className="self-end"
          onClick={() => {
            if (!text.trim()) return;
            addNote(text.trim());
            setText("");
          }}
        >
          Add note
        </Button>
      </div>
      <ul className="mt-6 space-y-3">
        {notes.length === 0 ? (
          <li className="py-8 text-center text-sm text-muted">No notes yet.</li>
        ) : (
          notes.map((n) => (
            <li key={n.id} className="rounded-xl border border-border p-4">
              <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed">{n.text}</p>
              <div className="mt-3 flex items-center justify-between text-xs text-subtle">
                <span>{new Date(n.timestamp).toLocaleString()}</span>
                <Button variant="ghost" size="sm" onClick={() => deleteNote(n.id)}>
                  Remove
                </Button>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
