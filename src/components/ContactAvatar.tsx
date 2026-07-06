import { cn } from "@/lib/utils";

type Props = {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
};

// Deterministic soft background derived from the name so different contacts
// get distinguishable initials avatars without extra config.
function hueFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function ContactAvatar({ name, avatarUrl, size = 40, className }: Props) {
  const initials = (name?.trim()?.[0] ?? "?").toUpperCase();
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) };
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={style}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-border", className)}
        loading="lazy"
      />
    );
  }
  const hue = hueFor(name || "?");
  return (
    <div
      style={{ ...style, backgroundColor: `hsl(${hue} 65% 88%)`, color: `hsl(${hue} 55% 28%)` }}
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold", className)}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
