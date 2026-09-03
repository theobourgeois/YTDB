"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyStudioConfig,
  downloadStudioConfig,
  hasStudioConfigToReplace,
  parseStudioConfig,
  type StudioConfig,
} from "@/lib/studio-config";

export function StudioConfigActions() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<StudioConfig | null>(null);

  function apply(config: StudioConfig) {
    applyStudioConfig(config);
    setPending(null);
    setError(null);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const config = parseStudioConfig(await file.text());
      if (hasStudioConfigToReplace()) {
        setError(null);
        setPending(config);
        return;
      }
      apply(config);
    } catch (caught) {
      setPending(null);
      setError(caught instanceof Error ? caught.message : "Couldn’t import that file.");
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => downloadStudioConfig()}>
        <DownloadIcon data-icon="inline-start" />
        Export
      </Button>
      <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
        <UploadIcon data-icon="inline-start" />
        Import
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={onFile}
      />

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace current config?</DialogTitle>
            <DialogDescription>
              This replaces connections, table layout, and theme. The file includes
              connection URLs, so treat it like a secret.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button onClick={() => pending && apply(pending)}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={error !== null} onOpenChange={(open) => !open && setError(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Couldn’t import</DialogTitle>
            <DialogDescription>{error}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setError(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
