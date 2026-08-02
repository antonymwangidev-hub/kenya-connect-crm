import { cn } from "@/lib/utils";
import type { TeamMember } from "./inbox-types";
import { memberLabel } from "./inbox-types";

function hueFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function AgentAvatar({
  member,
  size = 24,
  className,
}: {
  member: TeamMember | null | undefined;
  size?: number;
  className?: string;
}) {
  const label = memberLabel(member);
  const hue = hueFor(label);
  return (
    <div
      title={member ? `${label} (${member.role})` : "Unassigned"}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        backgroundColor: member ? `hsl(${hue} 60% 88%)` : "hsl(0 0% 92%)",
        color: member ? `hsl(${hue} 55% 26%)` : "hsl(0 0% 45%)",
      }}
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold uppercase", className)}
    >
      {label.slice(0, 1)}
    </div>
  );
}

export function AssignedChip({ member }: { member: TeamMember | null | undefined }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      <AgentAvatar member={member} size={16} />
      <span className="truncate">{member ? memberLabel(member) : "Unassigned"}</span>
    </span>
  );
}
