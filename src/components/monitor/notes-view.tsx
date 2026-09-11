import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useMonitor } from "@/store/monitor";

export function NotesView() {
  const notes = useMonitor((s) => s.notes);
  const addNote = useMonitor((s) => s.addNote);
  const deleteNote = useMonitor((s) => s.deleteNote);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  function save() {
    if (!text.trim()) return;
    addNote(text.trim());
    setText("");
    setOpen(false);
  }

  return (
    <section className="rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="font-display text-2xl font-medium">Operational notes</h2><p className="mt-1 text-sm text-muted">Meter swaps, maintenance, unusual load, tariff updates.</p></div>
        <Button onClick={() => setOpen(true)}>Add note</Button>
      </div>

      {open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-xl rounded-2xl bg-elevated p-5 shadow-border sm:p-6">
          <div className="flex items-center justify-between gap-3"><h3 className="font-display text-xl font-medium">Add operational note</h3><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button></div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note" className="mt-4 min-h-32" autoFocus />
          <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save note</Button></div>
        </div>
      </div> : null}

      <ul className="mt-6 space-y-3">
        {notes.length === 0 ? <li className="py-8 text-center text-sm text-muted">No notes yet.</li> : notes.map((n) => (
          <li key={n.id} className="rounded-xl border border-border p-4">
            <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed">{n.text}</p>
            <div className="mt-3 flex items-center justify-between text-xs text-subtle"><span>{new Date(n.timestamp).toLocaleString()}</span><Button variant="ghost" size="sm" onClick={() => deleteNote(n.id)}>Remove</Button></div>
          </li>
        ))}
      </ul>
    </section>
  );
}