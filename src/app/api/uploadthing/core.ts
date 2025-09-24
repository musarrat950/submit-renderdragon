import { createUploadthing, type FileRouter } from "uploadthing/next";

// Initialize UploadThing builder
const f = createUploadthing();

// Define your file routes
// Adjust file types and sizes as needed
export const ourFileRouter = {
  // Endpoint key is used on the client as `endpoint="fileUploader"`
  fileUploader: f({
    image: { maxFileSize: "256MB" },
    pdf: { maxFileSize: "128MB" },
    video: { maxFileSize: "1024MB" },
  })
    // Middleware can validate public API key and pass metadata like description
    .middleware(async ({ req }) => {
      const PUBLIC_API_KEY = "HDBFGIDGJKFDBGIJFDJGBUHDFGOFNJLDOGHF";

      const apiKey = req.headers.get("x-api-key");
      const descriptionRaw = req.headers.get("x-description") ?? "";
      // Keep description within Discord limits and reasonable size
      const description = descriptionRaw.slice(0, 1024);

      if (apiKey && apiKey !== PUBLIC_API_KEY) {
        throw new Error("Invalid API key");
      }

      // If no apiKey is provided, we still allow internal app uploads.
      return { description } as const;
    })
    // Runs on your server after the file is uploaded
    .onUploadComplete(async ({ file, metadata }) => {
      // You can persist `file.url` or other info to your DB here
      console.log("Upload complete:", { url: file.url, name: file.name, metadata });

      // After successful upload, send a Discord webhook notification (non-blocking best-effort)
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) {
        console.warn("DISCORD_WEBHOOK_URL is not set; skipping Discord notification.");
      } else {
        try {
          const ext = (() => {
            const match = /\.([a-zA-Z0-9]+)$/.exec(file.name || "");
            return match ? match[1].toLowerCase() : "unknown";
          })();
          const sizeKB = Math.max(1, Math.round((file.size ?? 0) / 1024));
          const timestamp = new Date().toISOString();
          const deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          const deleteAtUnix = Math.floor(deleteAt.getTime() / 1000);

          const embed = {
            title: "New file uploaded",
            description: `[Open file](${file.url})`,
            color: 0x5865f2, // Discord blurple
            timestamp,
            fields: [
              { name: "Filename", value: file.name ?? "unknown", inline: true },
              { name: "Extension", value: ext, inline: true },
              { name: "Size", value: `${sizeKB} KB`, inline: true },
              { name: "Will delete", value: `<t:${deleteAtUnix}:F> (in <t:${deleteAtUnix}:R>)`, inline: false },
              ...(metadata?.description
                ? [{ name: "Description", value: metadata.description, inline: false }]
                : []),
            ],
            url: file.url,
            image: { url: file.url }, // Discord will preview for supported image types
            footer: { text: "UploadThing" },
          } as const;

          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: "Upload Bot",
              embeds: [embed],
            }),
          });
        } catch (err) {
          console.error("Failed to send Discord webhook:", err);
        }
      }

      return { url: file.url } as const;
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;

