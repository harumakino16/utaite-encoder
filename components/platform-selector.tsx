"use client";

import { PlatformPreset } from "@/app/types/quality";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PlatformSelectorProps {
  value: PlatformPreset;
  onChange: (value: PlatformPreset) => void;
}

const platforms: { id: PlatformPreset; name: string; description: string }[] = [
  {
    id: "youtube",
    name: "YouTube",
    description: "1080p 60fps, H.264, AAC",
  },
  {
    id: "niconico",
    name: "ニコニコ動画",
    description: "720p 60fps, H.264, AAC",
  },
  {
    id: "bilibili",
    name: "bilibili",
    description: "1080p 60fps, H.264, AAC",
  },
];

export function PlatformSelector({ value, onChange }: PlatformSelectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {platforms.map((platform) => (
        <Button
          key={platform.id}
          variant={value === platform.id ? "default" : "outline"}
          className={cn(
            "h-auto flex flex-col items-start p-4 space-y-2",
            value === platform.id && "border-primary"
          )}
          onClick={() => onChange(platform.id)}
        >
          <div className="font-semibold">{platform.name}</div>
          <div className="text-sm text-muted-foreground">{platform.description}</div>
        </Button>
      ))}
    </div>
  );
} 