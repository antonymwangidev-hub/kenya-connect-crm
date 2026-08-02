import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileIcon, Play } from "lucide-react";
import { getChatMediaSignedUrl } from "@/lib/media.functions";
import type { InboxMessage } from "./inbox-types";

export function MediaBubble({
  m,
  onOpenLightbox,
}: {
  m: InboxMessage;
  onOpenLightbox: (path: string, kind: "image" | "video", filename: string | null) => void;
}) {
  const signFn = useServerFn(getChatMediaSignedUrl);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!m.media_url) return;
    let cancelled = false;
    signFn({ data: { path: m.media_url } })
      .then((r) => { if (!cancelled) setUrl(r.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [m.media_url, signFn]);

  if (!m.media_url) return null;
  const kind = m.media_type ?? "document";

  const downloadBtn = url ? (
    <a
      href={url}
      download={m.media_filename ?? true}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white opacity-100 backdrop-blur transition sm:opacity-0 sm:group-hover:opacity-100"
      title="Download"
      aria-label="Download"
    >
      <Download className="h-3.5 w-3.5" />
    </a>
  ) : null;

  if (kind === "image") {
    return (
      <div className="group relative mb-1 overflow-hidden rounded-lg">
        {url ? (
          <button type="button" onClick={() => onOpenLightbox(m.media_url!, "image", m.media_filename)} className="block">
            <img src={url} alt={m.media_filename ?? "Shared image"} className="max-h-72 w-auto max-w-full object-cover" loading="lazy" />
          </button>
        ) : (
          <div className="h-40 w-48 animate-pulse bg-black/10 sm:w-56" />
        )}
        {downloadBtn}
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="group relative mb-1 overflow-hidden rounded-lg">
        {url ? (
          <video src={url} controls className="max-h-72 w-full max-w-full rounded-lg" preload="metadata" playsInline />
        ) : (
          <div className="grid h-40 w-48 place-items-center bg-black/10 sm:w-56"><Play className="h-6 w-6 opacity-60" /></div>
        )}
        {downloadBtn}
      </div>
    );
  }

  if (kind === "audio") {
    return url ? (
      <div className="mb-1 flex items-center gap-2">
        <audio src={url} controls className="w-full min-w-[160px] max-w-[240px]" />
        <a href={url} download={m.media_filename ?? true} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/10 hover:bg-black/20" title="Download">
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    ) : (
      <div className="mb-1 h-10 w-48 animate-pulse rounded bg-black/10" />
    );
  }

  return (
    <a
      href={url ?? "#"}
      download={m.media_filename ?? true}
      className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-2.5 py-2 text-xs hover:bg-black/10"
    >
      <FileIcon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{m.media_filename ?? "Attachment"}</span>
      <Download className="h-3.5 w-3.5 opacity-60" />
    </a>
  );
}
