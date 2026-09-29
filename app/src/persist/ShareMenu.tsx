/**
 * The editor's share menu: copy a link to the design, save it as a file, or open a file. Meant
 * for the editor header: `<ShareMenu design={design} onOpenDesign={openDesign} />`.
 *
 * Every action reports what happened through `notify`. When a link is not possible (an image kept
 * in this browser, or a design too big for a URL) the menu says why, in place, and offers the file
 * instead; when the clipboard is refused, the link is shown ready to copy by hand.
 */
import { useEffect, useRef, useState } from 'react';
import type { Design } from 'shaping';
import { downloadFile, formatBytes, readFileText } from './download';
import { hasLocalImages, persistence, type ShareResult } from './index';
import { notify } from './notify';

interface Props {
  design: Design;
  /** Called with the design a file holds, as a copy under a new id (the parent saves and opens it). */
  onOpenDesign: (design: Design) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ShareMenu({ design, onOpenDesign }: Props) {
  const [open, setOpen] = useState(false);
  const [embed, setEmbed] = useState(true);
  const [refusal, setRefusal] = useState<Extract<ShareResult, { ok: false }> | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const local = hasLocalImages(design);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    setRefusal(null);
    setManualLink(null);
  };

  async function copyLink() {
    setRefusal(null);
    setManualLink(null);
    const r = persistence.shareLink(design);
    if (!r.ok) return setRefusal(r);
    try {
      await navigator.clipboard.writeText(r.url);
      notify('success', `Link copied (${r.chars} characters). Anyone who opens it gets their own copy of this design.`);
      setOpen(false);
    } catch {
      setManualLink(r.url);
      notify('error', 'The browser did not allow copying. The link is shown in the menu: select it and copy.');
    }
  }

  async function saveFile() {
    try {
      const file = await persistence.exportDesign(design, { embedImages: embed });
      downloadFile(file);
      notify('success', `Saved ${file.filename} (${formatBytes(file.text.length)}). Open it here with Share, Open file.`);
      file.warnings.forEach((w) => notify('error', w));
      setOpen(false);
    } catch (e) {
      notify('error', `Could not save the file: ${message(e)}`);
    }
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = persistence.parseFile(await readFileText(file));
      if (parsed.kind === 'collection') return notify('error', `${file.name} holds a whole collection. Import it from the gallery (Back, then Import…).`);
      const copy = await persistence.openDesignFile(parsed);
      notify('success', `Opened "${copy.title}" as a new design.`);
      setOpen(false);
      onOpenDesign(copy);
    } catch (e) {
      notify('error', `Could not open ${file.name}: ${message(e)}`);
    }
  }

  return (
    <div ref={root} className="relative">
      <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="rounded border border-line px-2 py-1 text-sm hover:border-accent">
        Share
      </button>
      <input ref={picker} type="file" accept=".json,application/json" hidden onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 flex w-72 flex-col gap-1 rounded-lg border border-line bg-white p-2 text-sm shadow">
          <button role="menuitem" className="rounded px-2 py-1.5 text-left hover:bg-paper" onClick={() => void copyLink()}>
            Copy link
          </button>
          {refusal && (
            <div role="alert" className="rounded border border-amber-700 px-2 py-1.5 text-xs text-amber-800">
              {refusal.message}
              <button className="mt-1 block underline" onClick={() => void saveFile()}>
                Save file instead
              </button>
            </div>
          )}
          {manualLink && <input readOnly aria-label="Link to copy" className="rounded border border-line px-2 py-1 text-xs" value={manualLink} onFocus={(e) => e.target.select()} autoFocus />}
          <button role="menuitem" className="rounded px-2 py-1.5 text-left hover:bg-paper" onClick={() => void saveFile()}>
            Save file
          </button>
          {local && (
            <label className="flex items-start gap-2 px-2 pb-1 text-xs text-muted">
              <input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} className="mt-0.5" />
              Include the image kept in this browser, so the file works anywhere
            </label>
          )}
          <button role="menuitem" className="rounded px-2 py-1.5 text-left hover:bg-paper" onClick={() => picker.current?.click()}>
            Open file…
          </button>
          <p className="px-2 pt-1 text-xs text-muted">Links and files carry the design itself. Nothing is sent to a server.</p>
        </div>
      )}
    </div>
  );
}
