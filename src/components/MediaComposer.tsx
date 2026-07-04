import { useEffect, useMemo, useState } from "react";
import { FileIcon, X, Image as ImageIcon, Video, Music, FileText, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export type ComposerMediaType = "image" | "video" | "audio" | "document";

export function detectMediaType(file: File): ComposerMediaType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TypeIcon({ kind }: { kind: ComposerMediaType }) {
  const cls = "h-4 w-4 text-muted-foreground";
  if (kind === "image") return <ImageIcon className={cls} />;
  if (kind === "video") return <Video className={cls} />;
  if (kind === "audio") return <Music className={cls} />;
  return <FileText className={cls} />;
}

type Props = {
  file: File;
  progress: number; // 0..100
  uploading: boolean;
  sending: boolean;
  onRemove: () => void;
};

export function MediaComposerPreview({ file, progress, uploading, sending, onRemove }: Props) {
  const kind = detectMediaType(file);
  const objectUrl = useMemo(() => {
    if (kind === "image" || kind === "video" || kind === "audio") {
      return URL.createObjectURL(file);
    }
    return null;
  }, [file, kind]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const busy = uploading || sending;
  const showProgress = uploading || (sending && progress > 0 && progress < 100);

  return (
    <div className="mb-2 rounded-xl border bg-muted/40 p-2">
      <div className="flex items-start gap-2.5">
        {/* Thumbnail / preview */}
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-background ring-1 ring-border">
          {kind === "image" && objectUrl ? (
            <img src={objectUrl} alt={file.name} className="h-full w-full object-cover" />
          ) : kind === "video" && objectUrl ? (
            <video src={objectUrl} className="h-full w-full object-cover" muted playsInline />
          ) : kind === "audio" ? (
            <div className="grid h-full w-full place-items-center bg-primary/10">
              <Music className="h-5 w-5 text-primary" />
            </div>
          ) : (
            <div className="grid h-full w-full place-items-center bg-primary/10">
              <FileIcon className="h-5 w-5 text-primary" />
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TypeIcon kind={kind} />
            <span className="truncate text-xs font-medium">{file.name}</span>
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {file.type || "unknown"} · {formatSize(file.size)}
          </p>

          {kind === "audio" && objectUrl && !busy && (
            <audio src={objectUrl} controls className="mt-1.5 h-7 w-full" />
          )}

          {showProgress && (
            <div className="mt-1.5 space-y-0.5">
              <Progress value={progress} className="h-1" />
              <p className="text-[10px] text-muted-foreground">
                {uploading ? `Uploading… ${Math.round(progress)}%` : `Sending… ${Math.round(progress)}%`}
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
          aria-label="Remove attachment"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * PUT the file directly to the Supabase signed upload URL so we can observe
 * upload progress via XHR (fetch has no upload progress API).
 */
export function uploadWithProgress(opts: {
  supabaseUrl: string;
  bucket: string;
  path: string;
  token: string;
  file: File;
  onProgress: (pct: number) => void;
}): Promise<void> {
  const { supabaseUrl, bucket, path, token, file, onProgress } = opts;
  const url = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/upload/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(file);
  });
}
