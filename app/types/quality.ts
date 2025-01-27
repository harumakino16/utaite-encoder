export type PlatformPreset = 'youtube' | 'niconico' | 'bilibili';

interface EncodingSettings {
  videoSettings: {
    preset: string;
    profile: string;
    crf: number;
    bitrate: number;
    maxrate: number;
    bufsize: number;
  };
  audioSettings: {
    bitrate: number;
  };
}

export const PLATFORM_PRESETS: Record<PlatformPreset, EncodingSettings> = {
  youtube: {
    videoSettings: {
      preset: "slow",
      profile: "high",
      crf: 18,
      bitrate: 8000,
      maxrate: 16000,
      bufsize: 32000
    },
    audioSettings: {
      bitrate: 384
    }
  },
  niconico: {
    videoSettings: {
      preset: "medium",
      profile: "high",
      crf: 23,
      bitrate: 3000,
      maxrate: 4000,
      bufsize: 8000
    },
    audioSettings: {
      bitrate: 192
    }
  },
  bilibili: {
    videoSettings: {
      preset: "slow",
      profile: "high",
      crf: 18,
      bitrate: 8000,
      maxrate: 16000,
      bufsize: 32000
    },
    audioSettings: {
      bitrate: 320
    }
  }
}; 