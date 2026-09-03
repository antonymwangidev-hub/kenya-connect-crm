import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateContact, createContactAvatarUploadUrl } from "@/lib/contacts.functions";
import { uploadWithProgress } from "@/components/MediaComposer";
import { ContactAvatar } from "@/components/ContactAvatar";
import { Switch } from "@/components/ui/switch";
import { saveContactConsent } from "@/lib/gateway.functions";

export type EditableContact = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  avatar_url?: string | null;
  opt_in?: boolean | null;
  opt_in_source?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact: EditableContact | null;
  onSaved?: (c: EditableContact) => void;
};

export function EditContactDialog({ open, onOpenChange, contact, onSaved }: Props) {
  const update = useServerFn(updateContact);
  const uploadUrl = useServerFn(createContactAvatarUploadUrl);
  const saveConsent = useServerFn(saveContactConsent);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [optInSource, setOptInSource] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!contact) return;
    setName(contact.name ?? "");
    setPhone(contact.phone ?? "");
    setEmail(contact.email ?? "");
    setNotes(contact.notes ?? "");
    setAvatarUrl(contact.avatar_url ?? null);
    setOptIn(Boolean(contact.opt_in));
    setOptInSource(contact.opt_in_source ?? "");
  }, [contact]);

  const onPickAvatar = async (file: File) => {
    if (!contact) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Avatar must be under 5MB"); return; }
    setUploading(true);
    try {
      const { path, token, publicUrl } = await uploadUrl({ data: { contactId: contact.id, filename: file.name } });
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      await uploadWithProgress({ supabaseUrl, bucket: "business-assets", path, token, file, onProgress: () => {} });
      setAvatarUrl(publicUrl);
      toast.success("Photo uploaded — click Save to keep it.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact) return;
    setSaving(true);
    try {
      const updated = await update({ data: { id: contact.id, name, phone, email, notes, avatar_url: avatarUrl ?? "" } });
      const consentChanged =
        optIn !== Boolean(contact.opt_in) || (optInSource ?? "") !== (contact.opt_in_source ?? "");
      if (consentChanged) {
        try {
          await saveConsent({ data: { contactId: contact.id, optIn, optInSource } });
        } catch (err) {
          toast.warning(err instanceof Error ? err.message : "Consent could not be saved");
        }
      }
      toast.success("Contact updated");
      onSaved?.({ ...(updated as EditableContact), opt_in: optIn, opt_in_source: optInSource || null });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit contact</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center gap-3">
            <ContactAvatar name={name || "?"} avatarUrl={avatarUrl} size={64} />
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickAvatar(f); }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Camera className="mr-1 h-3.5 w-3.5" />}
                {avatarUrl ? "Change photo" : "Upload photo"}
              </Button>
              {avatarUrl && (
                <Button type="button" variant="ghost" size="sm" className="ml-1 text-destructive" onClick={() => setAvatarUrl(null)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="c-name">Name</Label><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="grid gap-1.5"><Label htmlFor="c-phone">Phone</Label><Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} required /></div>
          <div className="grid gap-1.5"><Label htmlFor="c-email">Email</Label><Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" /></div>
          <div className="grid gap-1.5"><Label htmlFor="c-notes">Notes</Label><Textarea id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything worth remembering about this contact" /></div>
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Messaging consent (opt-in)</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Required before the Nexus gateway will deliver messages to this contact.
                </p>
              </div>
              <Switch checked={optIn} onCheckedChange={setOptIn} />
            </div>
            {optIn && (
              <Input
                value={optInSource}
                onChange={(e) => setOptInSource(e.target.value)}
                placeholder="How was consent obtained? e.g. Website form, WhatsApp reply"
              />
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
