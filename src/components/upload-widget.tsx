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
          onUploadBegin={() => {
            setIsUploading(true);
          }}
          onClientUploadComplete={(res) => {
            setIsUploading(false);
            const files = res?.map((f) => f.url).filter(Boolean) ?? [];
            if (files.length) {
              toast.success("Upload complete", {
                description: files.length === 1 ? files[0] : `${files.length} files uploaded`,
              });
            } else {
              toast("Upload complete");
            }
          }}
          onUploadError={(error) => {
            setIsUploading(false);
            toast.error("Upload failed", { description: error.message });
          }}
        />

        {isUploading && (
          <div className="text-sm text-muted-foreground">Uploading...</div>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Max image: 32MB • Max pdf: 128MB • Max video: 1024MB</span>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Reset</Button>
        </div>
      </CardContent>
    </Card>
  );
}
