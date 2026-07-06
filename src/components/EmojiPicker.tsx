import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Smile } from "lucide-react";
import { useState } from "react";

const CATEGORIES: Record<string, string[]> = {
  Smileys: ["😀","😃","😄","😁","😆","😅","😂","🤣","🥲","☺️","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥸","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪"],
  Gestures: ["👍","👎","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👋","🤚","🖐️","✋","🖖","👏","🙌","👐","🤲","🙏","🤝","💪","🦾","✍️","🫶","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️"],
  Objects: ["🔥","✨","⭐","🌟","💫","💥","💯","✅","❌","⚠️","🚀","🎉","🎊","🎁","🎂","🍰","🍕","🍔","🍟","☕","🍺","🍷","🥂","🍾","💰","💵","💳","📱","💻","⌚","📷","🎥","🎵","🎶","📢","🔔","🔒","🔑","🛒","📦","📝","📌","📎","📅","⏰","🕐"],
};

export function EmojiPicker({ onPick, size = "icon" }: { onPick: (emoji: string) => void; size?: "icon" | "sm" }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<keyof typeof CATEGORIES>("Smileys");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`grid shrink-0 place-items-center rounded-md border bg-background text-muted-foreground hover:bg-muted ${size === "icon" ? "h-10 w-10" : "h-7 w-7"}`}
          title="Insert emoji"
          aria-label="Insert emoji"
        >
          <Smile className={size === "icon" ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="mb-1.5 flex gap-1">
          {Object.keys(CATEGORIES).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setTab(c as keyof typeof CATEGORIES)}
              className={`flex-1 rounded-md px-2 py-1 text-xs ${tab === c ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
          {CATEGORIES[tab].map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              onClick={() => { onPick(e); setOpen(false); }}
              className="grid h-8 w-8 place-items-center rounded hover:bg-muted"
            >
              <span className="text-lg leading-none">{e}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
