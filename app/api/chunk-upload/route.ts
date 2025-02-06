import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(request: Request) {
  try {
    // チャンク送信用に、フォームデータとして送られてきたblobを取得
    // フロント側で `FormData.append("file", chunk);` の形で送信すると想定
    const formData = await request.formData();
    const file = formData.get("file") as Blob | null;
    if (!file) {
      return NextResponse.json({ error: "No file chunk provided" }, { status: 400 });
    }

    // たとえばクエリパラメータやFormDataで、どのファイルのチャンクかを識別するID等を受け取る
    // const fileId = formData.get("fileId");

    // Vercel Blob にアップロード
    // put() の第2引数には Blob, ArrayBuffer, Buffer, string などを渡せます
    // ここではそのまま file を渡してアップロード
    const { url } = await put(`chunks/${Date.now()}-${Math.random()}`, file, {
      access: "private", // 例: privateにする
    });

    // アップロードされたURLを返す
    return NextResponse.json({ success: true, url });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
} 