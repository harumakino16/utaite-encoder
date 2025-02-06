import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import ffmpeg from "fluent-ffmpeg";
import { existsSync } from "fs";
import { PlatformPreset, PLATFORM_PRESETS } from "@/app/types/quality";
import ffmpegStatic from 'ffmpeg-static';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import os from 'os';
import { Readable } from 'stream';

// FFmpegのパスを設定
const ffmpegPath = ffmpegStatic || 'ffmpeg';
console.log(`FFmpeg Path: ${ffmpegPath}`); // パス確認用ログを追加
ffmpeg.setFfmpegPath(ffmpegPath);

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
    externalResolver: true,
  },
  runtime: 'nodejs'
};

async function generateWaveform(inputPath: string, outputPath: string, startTime: number = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .inputOptions([
        `-ss ${startTime}`, // 開始時間を指定
        `-t 3` // 3秒間のセグメント
      ])
      .outputOptions([
        "-filter_complex", [
          // より詳細な波形を生成
          "showwavespic=s=1920x240:colors=#1f77b4",
          "scale=1920:240",
          // グリッド線を追加（0.5秒ごと）
          "drawgrid=width=2:height=0:x=384:y=0:color=white@0.2"
        ].join(","),
        "-frames:v", "1"
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
        "-vn",                // 映像を無視
        "-acodec", "pcm_s16le", // PCM形式で出力
        "-ar", "48000",      // サンプリングレートを48kHzに統一
        "-ac", "2"           // ステレオ
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
      .inputOptions([
        `-ss ${startTime}`,
        `-t ${duration}`
      ])
      .outputOptions([
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ar", "48000",      // サンプリングレートを48kHzに統一
        "-ac", "2"           // ステレオ
      ])
      .on("stderr", (stderrLine) => {
        console.log("FFmpeg stderr:", stderrLine);
      })
      .pipe()
      .on("data", (chunk: Buffer) => {
        // ステレオの場合、左チャンネルのみを使用
        for (let i = 0; i < chunk.length; i += 4) { // 2チャンネル×2バイト = 4バイト
          const sample = chunk.readInt16LE(i) / 32768.0;
          samples.push(sample);
        }
      })
      .on("end", () => {
        if (samples.length === 0) {
          console.log(`警告: ${startTime}秒から${duration}秒の区間でサンプルが取得できませんでした。`);
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
  const maxOffset = Math.floor(48000 * 0.5); // 48kHzに合わせて調整
  let bestOffset = 0;
  let bestCorrelation = -Infinity;

  // クロスコリレーションの計算
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

  const offsetSeconds = bestOffset / 48000; // 48kHzに合わせて調整
  console.log(`最適なオフセット: ${offsetSeconds}秒 (相関: ${bestCorrelation})`);
  return offsetSeconds;
}

// ストリーム変換用のヘルパー関数を追加
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
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const video = formData.get("video") as Blob;
    const audio = formData.get("audio") as Blob;
    const mode = formData.get("mode") as string;
    const audioStartTime = parseFloat(formData.get("audioStartTime") as string || "0");
    const platform = (formData.get("platform") as PlatformPreset) || "youtube";
    const platformSettings = PLATFORM_PRESETS[platform];

    if (!video || !audio) {
      return NextResponse.json(
        { error: "動画と音声ファイルが必要です" },
        { status: 400 }
      );
    }

    // 一時ファイルのパスを設定
    const tempDir = join(os.tmpdir(), 'utaite-tmp');
    
    // tmpディレクトリが存在しない場合は作成
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }
    
    const timestamp = Date.now();
    const videoPath = join(tempDir, `input_${timestamp}.mp4`);
    const audioPath = join(tempDir, `input_${timestamp}.wav`);
    const videoAudioPath = join(tempDir, `video_audio_${timestamp}.wav`);
    const outputPath = join(tempDir, `output_${timestamp}.mp4`);
    const videoWaveformPath = join(tempDir, `video_waveform_${timestamp}.png`);
    const audioWaveformPath = join(tempDir, `audio_waveform_${timestamp}.png`);

    // 一時ファイルとして保存
    const videoWriteStream = createWriteStream(videoPath);

    // ストリーム変換処理を追加
    const videoNodeStream = webStreamToNodeStream(video.stream());
    const audioNodeStream = webStreamToNodeStream(audio.stream());

    await pipeline(
      videoNodeStream,
      videoWriteStream
    );

    // 音声ファイルの保存処理を追加
    const audioWriteStream = createWriteStream(audioPath);
    await pipeline(
      audioNodeStream,
      audioWriteStream
    );

    // ファイル保存後に存在確認を追加
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!existsSync(videoPath) || !existsSync(audioPath)) {
      throw new Error("ファイルの保存に失敗しました");
    }

    // 音声抽出後の待機処理を追加
    console.log("Extracting audio from video...");
    await extractAudioWaveform(videoPath, videoAudioPath);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!existsSync(videoAudioPath)) {
      throw new Error("音声抽出に失敗しました");
    }

    if (mode === "analyze") {
      // 波形を生成（動画は0秒から、音声は指定された開始時間から）
      console.log("Generating waveforms...");
      await Promise.all([
        generateWaveform(videoAudioPath, videoWaveformPath, 0),
        generateWaveform(audioPath, audioWaveformPath, audioStartTime)
      ]);

      // 波形画像を読み込む
      const [videoWaveform, audioWaveform] = await Promise.all([
        readFile(videoWaveformPath),
        readFile(audioWaveformPath)
      ]);

      // 同じ区間の詳細な音声分析も行う
      const [videoSamples, audioSamples] = await Promise.all([
        analyzeAudioSegment(videoAudioPath, 0, 3),
        analyzeAudioSegment(audioPath, audioStartTime, 3)
      ]);

      // この区間での最適なオフセットを計算
      const segmentOffset = findBestOffset(videoSamples, audioSamples);

      // 一時ファイルを削除
      try {
        await Promise.all([
          unlink(videoPath),
          unlink(audioPath),
          unlink(videoAudioPath),
          unlink(videoWaveformPath),
          unlink(audioWaveformPath)
        ]);
      } catch (error) {
        console.error("Error cleaning up temp files:", error);
      }

      return NextResponse.json({
        videoWaveform: Buffer.from(videoWaveform).toString('base64'),
        audioWaveform: Buffer.from(audioWaveform).toString('base64'),
        suggestedOffset: segmentOffset
      });
    }

    // 処理モードの場合は、提案されたオフセットを使用
    const suggestedOffset = parseFloat(formData.get("offset") as string || "0");
    // 波形合わせ後の追加調整値（-0.41秒）
    const additionalOffset = -0.01;
    const finalOffset = suggestedOffset + additionalOffset;
    console.log("Using audio start time:", audioStartTime);
    console.log("Using suggested offset:", suggestedOffset);
    console.log("Additional offset:", additionalOffset);
    console.log("Final offset:", finalOffset);

    // FFmpegで動画を処理
    await new Promise((resolve, reject) => {
      let command = ffmpeg();

      if (finalOffset < 0) {
        // 音声を早める必要がある場合（映像を遅らせる）
        command
          .input(videoPath)
          .input(audioPath)
          .inputOptions([
            '-ss', audioStartTime.toString() // Mix音源の開始位置を指定
          ])
          .complexFilter([
            // 音声を前にずらす（無音部分を削除）
            `[1:a]atrim=start=${Math.abs(finalOffset)},asetpts=PTS-STARTPTS[a1]`,
            // 映像と音声を結合
            `[0:v][a1]concat=n=1:v=1:a=1[outv][outa]`
          ])
          .outputOptions([
            '-map', '[outv]',
            '-map', '[outa]',
            '-c:v', 'h264',
            '-preset', platformSettings.videoSettings.preset,
            '-profile:v', platformSettings.videoSettings.profile,
            '-crf', platformSettings.videoSettings.crf.toString(),
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:v', `${platformSettings.videoSettings.bitrate}k`,
            '-maxrate', `${platformSettings.videoSettings.maxrate}k`,
            '-bufsize', `${platformSettings.videoSettings.bufsize}k`,
            '-b:a', `${platformSettings.audioSettings.bitrate}k`,
            '-ar', '48000',
            '-ac', '2',
            '-shortest'
          ]);
      } else {
        // 音声を遅らせる場合
        command
          .input(videoPath)
          .input(audioPath)
          .inputOptions([
            '-ss', audioStartTime.toString() // Mix音源の開始位置を指定
          ])
          .complexFilter([
            // 音声を遅らせる
            `aevalsrc=0:d=${finalOffset}[silence]`,
            `[1:a]asetpts=PTS-STARTPTS[a1]`,
            `[silence][a1]concat=n=2:v=0:a=1[delayed_audio]`,
            // 映像と遅延した音声を結合
            `[0:v][delayed_audio]concat=n=1:v=1:a=1[outv][outa]`
          ])
          .outputOptions([
            '-map', '[outv]',
            '-map', '[outa]',
            '-c:v', 'h264',
            '-preset', platformSettings.videoSettings.preset,
            '-profile:v', platformSettings.videoSettings.profile,
            '-crf', platformSettings.videoSettings.crf.toString(),
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:v', `${platformSettings.videoSettings.bitrate}k`,
            '-maxrate', `${platformSettings.videoSettings.maxrate}k`,
            '-bufsize', `${platformSettings.videoSettings.bufsize}k`,
            '-b:a', `${platformSettings.audioSettings.bitrate}k`,
            '-ar', '48000',
            '-ac', '2',
            '-shortest'
          ]);
      }

      command
        .on("start", (commandLine) => {
          console.log("FFmpeg command:", commandLine);
        })
        .on("stderr", (stderrLine) => {
          console.log("FFmpeg stderr:", stderrLine);
        })
        .on("progress", (progress) => {
          console.log("Processing: " + progress.percent + "% done");
        })
        .on("end", () => {
          console.log("FFmpeg processing finished");
          resolve(true);
        })
        .on("error", (err) => {
          console.error("FFmpeg error:", err);
          reject(err);
        })
        .save(outputPath);
    });

    console.log("Reading processed video...");
    const processedVideo = await readFile(outputPath);
    console.log("Video read complete. Size:", processedVideo.length);

    // 一時ファイルを削除
    try {
      await Promise.all([
        unlink(videoPath),
        unlink(audioPath),
        unlink(videoAudioPath),
        unlink(outputPath)
      ]);
      console.log("Temporary files cleaned up");
    } catch (error) {
      console.error("Error cleaning up temp files:", error);
    }

    return new NextResponse(processedVideo, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="utaite_output_${timestamp}.mp4"`,
        "Content-Length": processedVideo.length.toString()
      }
    });
  } catch (error) {
    console.error("Processing error:", error);
    return NextResponse.json(
      { 
        error: "動画の処理中にエラーが発生しました", 
        details: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
} 