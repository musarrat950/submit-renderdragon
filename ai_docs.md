# submit-renderdragon – File Upload API (UploadThing + Next.js + shadcn/ui)

This document explains the app’s structure, how uploads work end‑to‑end, how the public API is authenticated, how the Discord webhook messaging is generated, and how other developers can integrate with your API.

- Framework: Next.js App Router (v15)
- UI: Tailwind CSS v4 + shadcn/ui
- Uploads: UploadThing (server: `uploadthing/next`, client: `@uploadthing/react` and `@uploadthing/client`)
- Notifications: Discord webhook embeds


## App Structure Overview

```
submit-renderdragon/
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  │  └─ uploadthing/
│  │  │     ├─ core.ts        # UploadThing router, middleware (API key, x-description), webhook logic
│  │  │     └─ route.ts       # UploadThing Next.js route handler (GET/POST)
│  │  ├─ layout.tsx           # Root layout; UploadThing NextSSRPlugin + global Toaster
│  │  └─ page.tsx             # Home page rendering the UploadWidget
│  ├─ components/
│  │  ├─ upload-widget.tsx    # shadcn-styled dropzone UI using UploadDropzone
│  │  └─ ui/ ...              # shadcn/ui components
│  └─ utils/
│     └─ uploadthing.ts       # generate client UploadButton/UploadDropzone (typed)
├─ .env                       # UPLOADTHING_TOKEN, DISCORD_WEBHOOK_URL
├─ ai_docs.md                 # This document
└─ package.json
```

Key files to know:
- `src/app/api/uploadthing/core.ts`: Defines the UploadThing file router and business logic (auth, metadata, Discord webhook).
- `src/app/api/uploadthing/route.ts`: Exposes UploadThing API endpoints for Next.js App Router.
- `src/utils/uploadthing.ts`: Creates typed UploadThing React components used in the UI.
- `src/components/upload-widget.tsx`: The shadcn-based upload UI used on the homepage.


## Environment Variables

Create and set in `.env`:

```
UPLOADTHING_TOKEN=...        # your UploadThing project token
DISCORD_WEBHOOK_URL=...      # Discord webhook URL (for upload notifications)
```

Restart the dev server after editing `.env`.


## Upload Limits (current)

Defined in `src/app/api/uploadthing/core.ts` under the `fileUploader` route:
- Images: 256MB
- PDFs: 128MB
- Videos: 1024MB

Adjust the limits in the `f({ ... })` configuration if needed.


## How the Upload Flow Works

1. Client renders an UploadThing component (`UploadDropzone` or `UploadButton`).
2. The component talks to your UploadThing route at `/api/uploadthing` to initialize and complete an upload.
3. On success, `onUploadComplete` (server-side) is triggered in `core.ts` where:
   - We log file details.
   - We send a Discord webhook embed with filename, extension, size, and a computed deletion time (+24h).


## Public API – Authentication and Description

The app supports a simple public API layer via request headers. This allows third-party developers to integrate and let their users upload files directly to your storage (through UploadThing), while you remain in control.

Middleware logic (in `src/app/api/uploadthing/core.ts`):
- Header `x-api-key`: optional for internal use. If present, it must equal:
  `HDBFGIDGJKFDBGIJFDJGBUHDFGOFNJLDOGHF`.
- Header `x-description`: optional, plain text. If present, it’s passed as metadata and included in the Discord embed. Truncated to 1024 characters.

If `x-api-key` is present but incorrect, the request is rejected.
If `x-api-key` is omitted, internal uploads (your app UI) still work.


## The UploadThing Router

Path: `src/app/api/uploadthing/core.ts`

```ts
import { createUploadthing, type FileRouter } from "uploadthing/next";

const f = createUploadthing();

export const ourFileRouter = {
  fileUploader: f({
    image: { maxFileSize: "256MB" },
    pdf:   { maxFileSize: "128MB" },
    video: { maxFileSize: "1024MB" },
  })
    .middleware(async ({ req }) => {
      const PUBLIC_API_KEY = "HDBFGIDGJKFDBGIJFDJGBUHDFGOFNJLDOGHF";

      const apiKey = req.headers.get("x-api-key");
      const descriptionRaw = req.headers.get("x-description") ?? "";
      const description = descriptionRaw.slice(0, 1024);

      if (apiKey && apiKey !== PUBLIC_API_KEY) {
        throw new Error("Invalid API key");
      }

      return { description } as const;
    })
    .onUploadComplete(async ({ file, metadata }) => {
      console.log("Upload complete:", { url: file.url, name: file.name, metadata });

      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) return { url: file.url } as const;

      const extMatch = /\.([a-zA-Z0-9]+)$/.exec(file.name || "");
      const ext = extMatch ? extMatch[1].toLowerCase() : "unknown";
      const sizeKB = Math.max(1, Math.round((file.size ?? 0) / 1024));

      const timestamp = new Date().toISOString();
      const deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const deleteAtUnix = Math.floor(deleteAt.getTime() / 1000);

      const embed = {
        title: "New file uploaded",
        description: `[Open file](${file.url})`,
        color: 0x5865f2,
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
        image: { url: file.url },
        footer: { text: "UploadThing" },
      } as const;

      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "Upload Bot", embeds: [embed] }),
      });

      return { url: file.url } as const;
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
```

The route is exposed by `src/app/api/uploadthing/route.ts`:

```ts
import { createRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "@/app/api/uploadthing/core";

export const { GET, POST } = createRouteHandler({ router: ourFileRouter });
```


## Client Components

`src/utils/uploadthing.ts` generates typed components bound to your router:

```ts
"use client";
import { generateUploadButton, generateUploadDropzone } from "@uploadthing/react";
import type { OurFileRouter } from "@/app/api/uploadthing/core";

export const UploadButton = generateUploadButton<OurFileRouter>();
export const UploadDropzone = generateUploadDropzone<OurFileRouter>();
```

`src/components/upload-widget.tsx` shows a shadcn-styled dropzone:

```tsx
"use client";
import * as React from "react";
import { UploadDropzone } from "@/utils/uploadthing";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function UploadWidget() {
  const [isUploading, setIsUploading] = React.useState(false);

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Upload files</CardTitle>
        <CardDescription>
          Drag and drop, or click to select files. Images, PDFs, and videos supported.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UploadDropzone
          endpoint="fileUploader"
          onUploadBegin={() => setIsUploading(true)}
          onClientUploadComplete={(res) => {
            setIsUploading(false);
            const files = res?.map((f) => f.url).filter(Boolean) ?? [];
            if (files.length) toast.success("Upload complete", { description: files.join("\n") });
          }}
          onUploadError={(error) => {
            setIsUploading(false);
            toast.error("Upload failed", { description: error.message });
          }}
        />

        {isUploading && <div className="text-sm text-muted-foreground">Uploading...</div>}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Max image: 256MB • Max pdf: 128MB • Max video: 1024MB</span>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Reset</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```


## Styles and SSR Integration

- `src/app/globals.css` imports UploadThing’s Tailwind v4 plugin:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "uploadthing/tw/v4";
@source "../../node_modules/@uploadthing/react/dist";
```

- `src/app/layout.tsx` includes UploadThing SSR plugin (reduces loading states) and a global `Toaster`:

```tsx
import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";
import { extractRouterConfig } from "uploadthing/server";
import { ourFileRouter } from "@/app/api/uploadthing/core";
import { Toaster } from "@/components/ui/sonner";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="antialiased">
        <NextSSRPlugin routerConfig={extractRouterConfig(ourFileRouter)} />
        {children}
        <Toaster richColors />
      </body>
    </html>
  );
}
```


## How Third‑Party Developers Integrate

Use the official UploadThing client SDK, pointing it to your API and including headers.

### JavaScript / TypeScript (Browser or Node)

```ts
import { uploadFiles } from "@uploadthing/client";

async function uploadViaPublicAPI(file, description) {
  const res = await uploadFiles(
    (route) => route.fileUploader,
    { files: [file] },
    {
      url: "https://your-domain.com/api/uploadthing", // replace with your deployment URL
      headers: {
        "x-api-key": "HDBFGIDGJKFDBGIJFDJGBUHDFGOFNJLDOGHF",
        "x-description": description ?? "",
      },
    }
  );

  // res contains info about uploaded files from UploadThing
  console.log(res);
  return res;
}
```

Notes:
- The SDK handles the multipart upload flow. Pure cURL is possible but involves multiple steps (init, upload, complete). If you need a raw HTTP example, we can provide a step-by-step.
- If the `x-api-key` header is omitted, the request is treated as an internal upload (no key check). If present and incorrect, the upload is rejected.


## Discord Webhook Messages

On successful upload, the server posts an embed to your Discord webhook that includes:
- Filename, extension, size
- The file URL (with image preview for image types)
- Upload time (`timestamp`)
- Computed deletion time (+24h) rendered as Discord timestamps
- Optional description (from `x-description`)

If `DISCORD_WEBHOOK_URL` is not set, the upload still succeeds but no Discord message is sent.


## Deletion After 24 Hours (Design)

Currently, the upload embed includes the time the file is scheduled to be deleted (upload + 24 hours). To actually delete files and emit a Discord webhook when deletion occurs, you need a small scheduled job and persistence:

- Persist on upload: store `{ key, url, name, ext, uploadedAt, deleteAt }`.
- Schedule a cron (e.g., Vercel Cron) that hits an API route every 15 minutes:
  - Query rows with `deleteAt <= now`.
  - Use UploadThing’s UTApi to delete by `key`.
  - Send a Discord webhook for deletion (with url/name/ext and deletion time).
  - Mark rows as deleted.

I can implement one of these options on request:
- Vercel Cron + SQLite (better-sqlite3) – simple & efficient.
- Vercel Cron + hosted DB (Neon Postgres or Turso SQLite) – great for production.
- Local-only: node-cron + JSON (dev/testing only).


## Error Handling & Edge Cases

- Invalid API key: middleware throws, upload initialization fails.
- Missing `DISCORD_WEBHOOK_URL`: upload succeeds, webhook is skipped (warning logged).
- Oversized files: UploadThing rejects based on the configured limits.
- Hydration mismatches: `suppressHydrationWarning` on `<body>` to avoid extension-injected attribute warnings.


## Development & Testing

- Start: `npm run dev` and open `http://localhost:3000`.
- Drop files in the `UploadWidget`.
- Watch terminal logs for upload completion.
- Check your Discord channel for the embed.


## Security Considerations

- The public API key is a shared secret for basic gating. For stricter control, consider:
  - Per-partner keys stored in a DB and validated in middleware.
  - Rate limiting and origin checks.
  - Signed metadata for audit trails.
- Avoid logging sensitive headers.


## FAQ

- Can we add more file types? Yes. Update the `f({ ... })` map in `core.ts`.
- Can we make the image preview conditional? Yes. We can include `image: { url: file.url }` only if the extension is an image type.
- Can we change the embed style? Yes. Modify the `embed` object (fields, color, footer, etc.).
- How do we support multiple endpoints with different rules? Add more keys to `ourFileRouter` and use them on the client via `endpoint="yourEndpoint"`.
.