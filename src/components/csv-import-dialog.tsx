"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, FileText, CheckCircle2, AlertCircle, X } from "lucide-react";

type ImportResult = {
  created: number;
  skipped: number;
  errors: { row: number; reason: string }[];
};

type ImportState =
  | { step: "idle" }
  | { step: "preview"; file: File; preview: string }
  | { step: "uploading" }
  | { step: "done"; result: ImportResult }
  | { step: "error"; message: string };

export function CsvImportDialog({
  onImported,
}: {
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ImportState>({ step: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setState({ step: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) reset();
  }

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setState({ step: "error", message: "Please select a .csv file" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const preview = lines.slice(0, 6).join("\n");
      setState({ step: "preview", file, preview });
    };
    reader.onerror = () => {
      setState({ step: "error", message: "Failed to read file" });
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFile(e.dataTransfer.files[0]);
    },
    [handleFile]
  );

  async function handleUpload() {
    if (state.step !== "preview") return;
    const { file } = state;
    setState({ step: "uploading" });

    try {
      const text = await file.text();
      const res = await fetch("/api/customers/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setState({
          step: "error",
          message: data?.error || `Import failed (${res.status})`,
        });
        return;
      }
      const result = (await res.json()) as ImportResult;
      setState({ step: "done", result });
      if (result.created > 0) onImported();
    } catch {
      setState({ step: "error", message: "Network error" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Contacts from CSV</DialogTitle>
        </DialogHeader>

        {state.step === "idle" && (
          <div
            className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center transition-colors hover:border-muted-foreground/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <FileText className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Drag & drop a CSV file, or click to browse
            </p>
            <p className="text-xs text-muted-foreground/70">
              Required columns: <strong>name</strong>, <strong>phone</strong>.
              Optional: email, notes, language.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              Choose file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
        )}

        {state.step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{state.file.name}</p>
              <Button variant="ghost" size="icon" onClick={reset}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">
              {state.preview}
            </pre>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button onClick={handleUpload}>Import</Button>
            </div>
          </div>
        )}

        {state.step === "uploading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            <p className="text-sm text-muted-foreground">Importing...</p>
          </div>
        )}

        {state.step === "done" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              <span>
                <strong>{state.result.created}</strong> contact
                {state.result.created !== 1 ? "s" : ""} imported
              </span>
            </div>
            {state.result.skipped > 0 && (
              <p className="text-sm text-muted-foreground">
                {state.result.skipped} skipped (duplicate phone)
              </p>
            )}
            {state.result.errors.length > 0 && (
              <div className="max-h-32 overflow-auto rounded-md bg-muted p-3">
                <p className="mb-1 text-xs font-medium">Issues:</p>
                {state.result.errors.map((err, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    Row {err.row}: {err.reason}
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}

        {state.step === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>{state.message}</span>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={reset}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
