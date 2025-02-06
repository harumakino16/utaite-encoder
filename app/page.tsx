"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Music4, Video, Waves } from "lucide-react";
import { PlatformPreset } from "@/app/types/quality";
import { PlatformSelector } from "@/components/platform-selector";
import { EncodingDetails } from "@/components/encoding-details";

export default function EncodePage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoWaveform, setVideoWaveform] = useState<string>("");
  const [audioWaveform, setAudioWaveform] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioStartTime, setAudioStartTime] = useState(0);
  const debouncedAudioStartTime = useDebounce(audioStartTime, 100);
  const [suggestedOffset, setSuggestedOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [outputFileName, setOutputFileName] = useState("");
  const [platform, setPlatform] = useState<PlatformPreset>("youtube");

  // audioFileが変更されたら、出力ファイル名の初期値を設定
  useEffect(() => {
    if (audioFile) {
      const baseName = audioFile.name.replace(/\.[^/.]+$/, "");
      setOutputFileName(baseName);
    }
  }, [audioFile]);

  // audioStartTimeが変更されたら自動的に波形を更新（既に波形がある場合）
  useEffect(() => {
    if (videoFile && audioFile && (videoWaveform || audioWaveform)) {
      analyzeWaveforms();
    }
  }, [debouncedAudioStartTime]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleFileUpload = async (files: File[]) => {
    setIsUploading(true);
    setUploadProgress(0);

    for (const file of files) {
      if (file.type === "video/mp4") {
        setVideoFile(file);
      } else if (file.type === "audio/wav") {
        setAudioFile(file);
      }
      // 進捗のシミュレーション
      for (let i = 0; i <= 100; i += 10) {
        setUploadProgress(i);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    setIsUploading(false);
    setUploadProgress(0);

    const updatedFiles = files.reduce(
      (acc, file) => {
        if (file.type === "video/mp4") acc.video = file;
        if (file.type === "audio/wav") acc.audio = file;
        return acc;
      },
      { video: videoFile, audio: audioFile }
    );

    if (updatedFiles.video && updatedFiles.audio) {
      const formData = new FormData();
      formData.append("video", updatedFiles.video);
      formData.append("audio", updatedFiles.audio);
      formData.append("mode", "analyze");
      formData.append("startTime", "0");
      formData.append("audioStartTime", audioStartTime.toString());

      setIsAnalyzing(true);
      try {
        const response = await fetch("/api/encode/process", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          throw new Error("波形分析に失敗しました");
        }
        const data = await response.json();
        setVideoWaveform(data.videoWaveform);
        setAudioWaveform(data.audioWaveform);
        setSuggestedOffset(data.suggestedOffset);
      } catch (error) {
        toast({
          title: "エラー",
          description: error instanceof Error ? error.message : "波形分析に失敗しました",
          variant: "destructive",
        });
      } finally {
        setIsAnalyzing(false);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(Array.from(e.dataTransfer.files));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileUpload(Array.from(e.target.files || []));
  };

  const handleSliderChange = (values: number[]) => {
    const value = values[0];
    setAudioStartTime(value);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= -3 && value <= 3) {
      setAudioStartTime(value);
    }
  };

  const analyzeWaveforms = async () => {
    if (!videoFile || !audioFile) {
      toast({
        title: "エラー",
        description: "動画と音声ファイルを選択してください",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    const formData = new FormData();
    formData.append("video", videoFile);
    formData.append("audio", audioFile);
    formData.append("mode", "analyze");
    formData.append("startTime", "0");
    formData.append("audioStartTime", audioStartTime.toString());

    try {
      const response = await fetch("/api/encode/process", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error("波形分析に失敗しました");
      }
      const data = await response.json();
      setVideoWaveform(data.videoWaveform);
      setAudioWaveform(data.audioWaveform);
      setSuggestedOffset(data.suggestedOffset);
    } catch (error) {
      toast({
        title: "エラー",
        description: error instanceof Error ? error.message : "波形分析に失敗しました",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const processVideo = async () => {
    if (!videoFile || !audioFile) {
      toast({
        title: "エラー",
        description: "動画と音声ファイルを選択してください",
        variant: "destructive",
      });
      return;
    }
    if (!outputFileName.trim()) {
      toast({
        title: "エラー",
        description: "出力ファイル名を入力してください",
        variant: "destructive",
      });
      return;
    }
    setIsProcessing(true);
    const formData = new FormData();
    formData.append("video", videoFile);
    formData.append("audio", audioFile);
    formData.append("mode", "process");
    formData.append("audioStartTime", audioStartTime.toString());
    formData.append("offset", suggestedOffset.toString());
    formData.append("platform", platform);

    try {
      const response = await fetch("/api/encode/process", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error("動画処理に失敗しました");
      }
      const result = await response.json();
      if (result.success) {
        // 自動ダウンロード：result.url のファイルを fetch で Blob 化し、オブジェクトURLからダウンロードを実施
        const fileResponse = await fetch(result.url);
        const blob = await fileResponse.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${outputFileName.trim()}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast({
          title: "成功",
          description: "動画の処理が完了し、ダウンロードが開始されました",
        });
      } else {
        throw new Error(result.error || "不明なエラーが発生しました");
      }
    } catch (error) {
      toast({
        title: "エラー",
        description: error instanceof Error ? error.message : "動画処理に失敗しました",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="container mx-auto py-8 space-y-8 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">歌ってみた動画エンコーダー</h1>
        {(videoFile || audioFile) && (
          <Button
            variant="outline"
            onClick={() => {
              setVideoFile(null);
              setAudioFile(null);
              setVideoWaveform("");
              setAudioWaveform("");
              setSuggestedOffset(0);
              setAudioStartTime(0);
            }}
          >
            最初からやり直す
          </Button>
        )}
      </div>
      <Card>
        <CardContent className={cn("p-8 transition-all duration-300", !videoFile || !audioFile ? "min-h-[300px]" : "")}>
          {isUploading ? (
            <div className="space-y-4">
              <div className="text-center text-lg font-medium">ファイルをアップロード中...</div>
              <Progress value={uploadProgress} className="w-full" />
            </div>
          ) : !videoFile || !audioFile ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                isDragging ? "border-primary bg-primary/10" : "border-border",
                "cursor-pointer"
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="space-y-4">
                <div className="flex justify-center">
                  <Upload className="h-12 w-12 text-muted-foreground" />
                </div>
                <div className="text-lg font-medium">
                  ファイルをドラッグ＆ドロップ
                  <br />または
                </div>
                <label className="inline-block">
                  <input type="file" accept=".mp4,.wav" multiple onChange={handleFileChange} className="hidden" />
                  <Button variant="outline" type="button">ファイルを選択</Button>
                </label>
                <div className="text-sm text-muted-foreground">
                  必要なファイル:
                  <div className="flex justify-center gap-4 mt-2">
                    <Badge variant={videoFile ? "default" : "secondary"} className="gap-2">
                      <Video className="h-4 w-4" /> 本家動画 (.mp4)
                    </Badge>
                    <Badge variant={audioFile ? "default" : "secondary"} className="gap-2">
                      <Music4 className="h-4 w-4" /> Mix音源 (.wav)
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="space-y-6 bg-muted/50 rounded-lg p-6">
                <div className="flex flex-col gap-4">
                  <div className="h-6">
                    {isAnalyzing && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> <span>波形を分析中...</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">Mix音源の開始位置</span>
                        {videoWaveform && audioWaveform && (
                          <p className="text-sm text-muted-foreground mt-1">
                            スライダーを動かして2つの波形の山が重なるように調整してください
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="number" value={audioStartTime} onChange={handleInputChange} step="0.01" min="-3" max="3" className="w-24 text-right font-mono" />
                        <span className="text-sm font-mono">秒</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">-3.00</span>
                      <Slider value={[audioStartTime]} onValueChange={handleSliderChange} min={-3} max={3} step={0.01} className="flex-grow" />
                      <span className="text-sm font-mono">+3.00</span>
                    </div>
                  </div>
                </div>
                {videoWaveform && audioWaveform && (
                  <div className="space-y-4">
                    <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg space-y-2">
                      <h3 className="font-medium flex items-center gap-2">
                        <Waves className="h-4 w-4" /> 波形の位置合わせ
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        1. 上の波形（本家動画）と下の波形（Mix音源）の山が重なるように調整します
                        <br />2. 赤い線を基準に、Mix音源の開始位置を調整してください
                        <br />3. 波形が合ったら、下の「動画を生成」ボタンをクリックしてください
                      </p>
                    </div>
                    <div className="relative group">
                      <Image src={`data:image/png;base64,${videoWaveform}`} alt="動画の波形" width={1920} height={240} className="w-full rounded-lg" />
                      <div className="absolute top-0 left-1/2 h-full w-0.5 bg-red-500" />
                      <div className="absolute top-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        本家動画の波形
                      </div>
                    </div>
                    <div className="relative group">
                      <Image src={`data:image/png;base64,${audioWaveform}`} alt="音声の波形" width={1920} height={240} className="w-full rounded-lg" />
                      <div className="absolute top-0 left-1/2 h-full w-0.5 bg-red-500" />
                      <div className="absolute top-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        Mix音源の波形
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-6">
                      <div className="w-full">
                        <div className="mb-4">
                          <div className="flex items-center">
                            <h3 className="text-lg font-semibold mb-1">出力設定</h3>
                            <EncodingDetails />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            アップロード先に合わせて最適な設定を選択してください
                          </p>
                        </div>
                        <PlatformSelector value={platform} onChange={setPlatform} />
                      </div>
                      <div className="flex items-center gap-2 w-full max-w-md">
                        <Input
                          value={outputFileName}
                          onChange={(e) => setOutputFileName(e.target.value)}
                          placeholder="出力ファイル名"
                          className="flex-grow font-mono"
                        />
                        <span className="text-sm font-mono text-muted-foreground">.mp4</span>
                      </div>
                      <Button onClick={processVideo} disabled={isProcessing} size="lg" className="w-64 h-16 text-lg">
                        {isProcessing ? (
                          <>
                            <Loader2 className="mr-3 h-6 w-6 animate-spin" /> 処理中...
                          </>
                        ) : (
                          "動画を生成"
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
