"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Info } from "lucide-react";

export function EncodingDetails() {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button className="ml-2 text-muted-foreground hover:text-foreground">
          <Info className="h-4 w-4" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="space-y-4">
          <h4 className="text-sm font-semibold">エンコード設定の詳細</h4>
          <div className="text-sm">
            <h5 className="font-medium mb-1">YouTube</h5>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>解像度: 1080p</li>
              <li>フレームレート: 60fps</li>
              <li>動画コーデック: H.264</li>
              <li>音声コーデック: AAC 320kbps</li>
            </ul>
          </div>
          <div className="text-sm">
            <h5 className="font-medium mb-1">ニコニコ動画</h5>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>解像度: 720p</li>
              <li>フレームレート: 60fps</li>
              <li>動画コーデック: H.264</li>
              <li>音声コーデック: AAC 192kbps</li>
            </ul>
          </div>
          <div className="text-sm">
            <h5 className="font-medium mb-1">bilibili</h5>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>解像度: 1080p</li>
              <li>フレームレート: 60fps</li>
              <li>動画コーデック: H.264</li>
              <li>音声コーデック: AAC 320kbps</li>
            </ul>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
} 