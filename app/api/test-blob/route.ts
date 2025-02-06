import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import ffmpeg from "fluent-ffmpeg";
import { existsSync } from "fs";
import { PlatformPreset, PLATFORM_PRESETS } from "@/app/types/quality";
import ffmpegStatic from "ffmpeg-static";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import os from "os";
import { Readable } from "stream";
import { createReadStream } from "fs";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { put } from "@vercel/blob";

// FFmpeg のパスを設定
const ffmpegPath = ffmpegStatic || "ffmpeg";
console.log(`FFmpeg Path: ${ffmpegPath}`);
ffmpeg.setFfmpegPath(ffmpegPath);

export const config = {
  api: {
    bodyParser: false,
    responseLimit: "50mb",
    externalResolver: true,
  },
  runtime: "nodejs",
};

// ---------------------------------
// 各種ヘルパー関数
// ---------------------------------

async function generateWaveform(inputPath: string, outputPath: string, startTime: number = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .inputOptions([`-ss ${startTime}`, `-t 3`])
      .outputOptions([
        "-filter_complex",
        [
          "showwavespic=s=1920x240:colors=#1f77b4",
          "scale=1920:240",
          "drawgrid=width=2:height=0:x=384:y=0:color=white@0.2",
        ].join(","),
        "-frames:v", "1",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

async function extractAudioWaveform(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .outputOptions([
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        "-ac", "2",
      ])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });
}

async function analyzeAudioSegment(audioPath: string, startTime: number, duration: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const samples: number[] = [];
    ffmpeg()
      .input(audioPath)
      .inputOptions([`-ss ${startTime}`, `-t ${duration}`])
      .outputOptions([
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        "-ac", "2",
      ])
      .on("stderr", (stderrLine) => {
        console.log("FFmpeg stderr:", stderrLine);
      })
      .pipe()
      .on("data", (chunk: Buffer) => {
        for (let i = 0; i < chunk.length; i += 4) {
          const sample = chunk.readInt16LE(i) / 32768.0;
          samples.push(sample);
        }
      })
      .on("end", () => {
        if (samples.length === 0) {
          console.log(`警告: ${startTime}秒から${duration}秒でサンプルが取得できませんでした。`);
          resolve([0]);
        } else {
          const normalizedSamples = normalizeSamples(samples, 1000);
          resolve(normalizedSamples);
        }
      })
      .on("error", (err) => {
        console.error("音声分析エラー:", err);
        resolve([0]);
      });
  });
}

function normalizeSamples(samples: number[], targetLength: number): number[] {
  const result: number[] = new Array(targetLength);
  const step = samples.length / targetLength;
  for (let i = 0; i < targetLength; i++) {
    const pos = Math.floor(i * step);
    result[i] = samples[pos];
  }
  return result;
}

function findBestOffset(videoSamples: number[], audioSamples: number[]): number {
  const maxOffset = Math.floor(48000 * 0.5);
  let bestOffset = 0;
  let bestCorrelation = -Infinity;
  for (let offset = -maxOffset; offset <= maxOffset; offset++) {
    let correlation = 0;
    let count = 0;
    for (let i = 0; i < videoSamples.length; i++) {
      const j = i + offset;
      if (j >= 0 && j < audioSamples.length) {
        correlation += videoSamples[i] * audioSamples[j];
        count++;
      }
    }
    if (count > 0) {
      correlation /= count;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }
  }
  const offsetSeconds = bestOffset / 48000;
  console.log(`最適なオフセット: ${offsetSeconds}秒 (相関: ${bestCorrelation})`);
  return offsetSeconds;
}

// Web の ReadableStream を Node.js の Readable に変換する
function webStreamToNodeStream(webStream: ReadableStream<Uint8Array>): Readable {
  const reader = webStream.getReader();
  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        this.push(Buffer.from(value));
      } catch (error) {
        this.destroy(error as Error);
      }
    },
  });
}

/**
 * Vercel Blob へのアップロード用ヘルパー関数
 */
async function uploadToVercelBlob(stream: Readable, fileName: string, maxRetries = 3): Promise<string> {
  try {
    const blob = await put(fileName, stream, {
      access: "public",
      addRandomSuffix: true,
    });
    return blob.url;
  } catch (error) {
    console.error("Blob upload error:", error);
    throw new Error(`Blob へのアップロードに失敗: ${(error as Error).message}`);
  }
}

// URL から波形画像（PNG）を生成する
async function generateWaveformFromUrl(inputUrl: string, startTime: number = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const data: Buffer[] = [];
    ffmpeg()
      .input(inputUrl)
      .inputOptions([`-ss ${startTime}`, `-t 3`])
      .outputOptions([
        "-filter_complex",
        [
          "showwavespic=s=1920x240:colors=#1f77b4",
          "scale=1920:240",
          "drawgrid=width=2:height=0:x=384:y=0:color=white@0.2",
        ].join(","),
        "-frames:v", "1",
        "-f", "image2",
        "-c:v", "png",
      ])
      .toFormat("image2pipe")
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        reject(err);
      })
      .on("end", () => {
        resolve(Buffer.concat(data));
      })
      .pipe()
      .on("data", (chunk: Buffer) => data.push(chunk));
  });
}

// URL から音声を PCM 化して Buffer で返す
async function extractAudioToPCM(inputUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const data: Buffer[] = [];
    ffmpeg()
      .input(inputUrl)
      .outputOptions([
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        "-ac", "2",
      ])
      .format("wav")
      .on("error", (err) => reject(err))
      .on("end", () => {
        resolve(Buffer.concat(data));
      })
      .pipe()
      .on("data", (chunk: Buffer) => data.push(chunk));
  });
}

// ---------------------------------
// API エンドポイント (POST)
// ---------------------------------

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const video = formData.get("video") as Blob;
    const audio = formData.get("audio") as Blob;
    const mode = formData.get("mode") as string;
    const audioStartTime = parseFloat((formData.get("audioStartTime") as string) || "0");
    const platform = (formData.get("platform") as PlatformPreset) || "youtube";
    const platformSettings = PLATFORM_PRESETS[platform];

    if (!video || !audio) {
      return NextResponse.json({ error: "動画と音声ファイルが必要です" }, { status: 400 });
    }

    // (1) ローカル一時ファイル保存はせず、Vercel Blob へアップロード
    const videoNodeStream = webStreamToNodeStream(video.stream());
    const audioNodeStream = webStreamToNodeStream(audio.stream());
    const timestamp = Date.now();
    const videoUrl = await uploadToVercelBlob(videoNodeStream, `input_${timestamp}.mp4`);
    const audioUrl = await uploadToVercelBlob(audioNodeStream, `input_${timestamp}.wav`);

    // (2) mode が "analyze" の場合
    if (mode === "analyze") {
      try {
        console.log("Generating waveforms from URLs:", { videoUrl, audioUrl });
        const [videoWaveform, audioWaveform] = await Promise.all([
          generateWaveformFromUrl(videoUrl, 0),
          generateWaveformFromUrl(audioUrl, audioStartTime),
        ]);
        console.log("Waveforms generated successfully");
        console.log("Video waveform size:", videoWaveform.length);
        console.log("Audio waveform size:", audioWaveform.length);

        // PCM 取得（例として）
        const [videoPCM, audioPCM] = await Promise.all([
          extractAudioToPCM(videoUrl),
          extractAudioToPCM(audioUrl),
        ]);
        // 本来は analyzeAudioSegment や findBestOffset を用いる
        const segmentOffset = 0.1;

        return NextResponse.json({
          videoWaveform: videoWaveform.toString("base64"),
          audioWaveform: audioWaveform.toString("base64"),
          suggestedOffset: segmentOffset,
        });
      } catch (error) {
        console.error("Detailed analyze error:", error);
        throw error;
      }
    }

    // (3) mode が "process" の場合（動画生成）
    if (mode === "process") {
      try {
        const suggestedOffset = parseFloat((formData.get("offset") as string) || "0");
        const additionalOffset = -0.01;
        const finalOffset = suggestedOffset + additionalOffset;
        const outputBuffers: Buffer[] = [];

        await new Promise((resolve, reject) => {
          let command = ffmpeg();
          // 入力: videoUrl と audioUrl
          command.input(videoUrl).input(audioUrl);
          // ※ 音声の開始タイムスタンプはフィルターで調整するので、ここでは不要とする

          // フィルター設定（シンプルに音声のタイミング調整のみ）
          if (finalOffset >= 0) {
            // 正のオフセット：音声に無音を付加して遅延させる
            const delayMs = Math.round(finalOffset * 1000);
            command.complexFilter([
              `[1:a]adelay=${delayMs}|${delayMs},asetpts=PTS-STARTPTS[outa]`
            ]);
          } else {
            // 負のオフセット：音声の先頭部分をトリムする
            command.complexFilter([
              `[1:a]atrim=start=${Math.abs(finalOffset)},asetpts=PTS-STARTPTS[outa]`
            ]);
          }

          // 映像はそのまま、音声はフィルター出力 [outa] を使用
          command
            .outputOptions([
              "-map", "0:v",
              "-map", "[outa]",
              "-c:v", "h264",
              "-preset", platformSettings.videoSettings.preset,
              "-profile:v", platformSettings.videoSettings.profile,
              "-crf", platformSettings.videoSettings.crf.toString(),
              "-pix_fmt", "yuv420p",
              "-c:a", "aac",
              "-b:v", `${platformSettings.videoSettings.bitrate}k`,
              "-maxrate", `${platformSettings.videoSettings.maxrate}k`,
              "-bufsize", `${platformSettings.videoSettings.bufsize}k`,
              "-b:a", `${platformSettings.audioSettings.bitrate}k`,
              "-ar", "48000",
              "-ac", "2",
              "-movflags", "frag_keyframe+empty_moov",
              "-f", "mp4",
              "-y",
            ])
            .on("stderr", (line) => {
              console.log("FFmpeg stderr:", line);
            })
            .on("error", (err) => {
              console.error("FFmpeg error:", err);
              reject(err);
            })
            .on("end", () => {
              resolve(true);
            })
            .pipe()
            .on("data", (chunk: Buffer) => {
              outputBuffers.push(chunk);
            });
        });

        // 処理済み動画を結合して Blob にアップロード
        const processedVideo = Buffer.concat(outputBuffers);
        const outputBlob = await put(`output_${timestamp}.mp4`, processedVideo, {
          access: "public",
          addRandomSuffix: true,
        });

        return NextResponse.json({
          success: true,
          url: outputBlob.url,
          message: "動画の処理が完了しました",
        });
      } catch (error) {
        console.error("Processing error:", error);
        return NextResponse.json(
          {
            error: "動画の処理中にエラーが発生しました。",
            details: error instanceof Error ? error.message : "Unknown error",
            stack: error instanceof Error ? error.stack : undefined,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ error: "無効なモードです" }, { status: 400 });
  } catch (error) {
    console.error("Processing error:", error);
    return NextResponse.json(
      {
        error: "動画の処理中にエラーが発生しました。",
        details: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
