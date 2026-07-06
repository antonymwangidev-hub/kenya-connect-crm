import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { X, Download } from "lucide-react";
import { getChatMediaSignedUrl } from "@/lib/media.functions";

type Props = {
  path: string | null;
  kind: "image" | "video";
  filename?: string | null;
  onClose: () => void;
};

export function MediaLightbox({ path, kind, filename, onClose }: Props) {
  const signFn = useServerFn(getChatMediaSignedUrl);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let cancelled = false;
    signFn({ data: { path } }).then((r) => { if (!cancelled) setUrl(r.url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [path, signFn]);

  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, onClose]);

  if (!path) return null;
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between p-3 text-white">
        <p className="truncate text-sm">{filename ?? ""}</p>
        <div className="flex items-center gap-1">
          {url && (
            <a
              href={url}
              download={filename ?? true}
              onClick={(e) => e.stopPropagation()}
              className="rounded-md p-2 hover:bg-white/10"
              aria-label="Download"
            >
              <Download className="h-5 w-5" />
            </a>
          )}
          <button onClick={onClose} className="rounded-md p-2 hover:bg-white/10" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        {url ? (
          kind === "image" ? (
            <img src={url} alt={filename ?? ""} className="max-h-full max-w-full object-contain" />
          ) : (
            <video src={url} controls autoPlay className="max-h-full max-w-full" />
          )
        ) : (
          <div className="text-white/70">Loading…</div>
        )}
      </div>
    </div>
  );
}
