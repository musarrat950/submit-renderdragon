import { NextResponse } from "next/server";
import { UTApi } from "uploadthing/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-description",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Content-Type must be multipart/form-data with a 'file' field" },
        { status: 400, headers: corsHeaders }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const description = (form.get("description") as string | null) ?? req.headers.get("x-description") ?? "";

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'file' in multipart form data" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Upload to UploadThing via server-side UTApi
    const utapi = new UTApi();
    const result = await utapi.uploadFiles(file);

    if (!result || !result.data) {
      return NextResponse.json(
        { error: "Upload failed" },
        { status: 500, headers: corsHeaders }
      );
    }

    const { url, key, name, size } = result.data;

    // Fire Discord webhook (best-effort)
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl && url) {
      try {
        const extMatch = /\.([a-zA-Z0-9]+)$/.exec(name || "");
        const ext = extMatch ? extMatch[1].toLowerCase() : "unknown";
        const sizeKB = Math.max(1, Math.round((Number(size) || 0) / 1024));
        const timestamp = new Date().toISOString();
        const deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const deleteAtUnix = Math.floor(deleteAt.getTime() / 1000);

        const embed = {
          title: "New file uploaded",
          description: `[Open file](${url})`,
          color: 0x5865f2,
          timestamp,
          fields: [
            { name: "Filename", value: name ?? "unknown", inline: true },
            { name: "Extension", value: ext, inline: true },
            { name: "Size", value: `${sizeKB} KB`, inline: true },
            { name: "Will delete", value: `<t:${deleteAtUnix}:F> (in <t:${deleteAtUnix}:R>)`, inline: false },
            ...(description ? [{ name: "Description", value: String(description).slice(0, 1024), inline: false }] : []),
          ],
          url,
          image: { url },
          footer: { text: "UploadThing" },
        } as const;

        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "Upload Bot", embeds: [embed] }),
        });
      } catch (err) {
        console.error("Failed to send Discord webhook (public-upload):", err);
      }
    }

    return NextResponse.json({ url, key, name, size }, { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error("/api/public-upload error:", err);
    return NextResponse.json(
      { error: "Unexpected error", details: String(err?.message || err) },
      { status: 500, headers: corsHeaders }
    );
  }
}
