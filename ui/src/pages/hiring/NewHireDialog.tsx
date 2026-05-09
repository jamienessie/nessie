import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hiresApi, type RoleTemplate } from "@/api/hires";

interface NewHireDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

export function NewHireDialog({ open, onOpenChange, companyId }: NewHireDialogProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tier, setTier] = useState<"T1" | "T2" | "T3" | "">("");
  const [templateKey, setTemplateKey] = useState("");

  const { data: templatesData } = useQuery({
    queryKey: ["role-templates"],
    queryFn: () => hiresApi.listRoleTemplates(),
  });
  const templates: RoleTemplate[] = templatesData?.templates ?? [];

  const create = useMutation({
    mutationFn: () =>
      hiresApi.create(companyId, {
        title: title.trim(),
        description: description.trim() || null,
        requestedTier: tier || undefined,
        requestedRoleTemplateKey: templateKey || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hires", companyId] });
      onOpenChange(false);
    },
  });

  // Reset on open change.
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setTier("");
      setTemplateKey("");
    }
  }, [open]);

  // When a template is picked, prefill title + tier from the template.
  useEffect(() => {
    if (!templateKey) return;
    const tmpl = templates.find((t) => t.key === templateKey);
    if (!tmpl) return;
    if (!title) setTitle(tmpl.title);
    if (!tier && tmpl.defaultTier) setTier(tmpl.defaultTier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey]);

  const canSubmit = title.trim().length > 0 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a new hire</DialogTitle>
          <DialogDescription>
            Lena Park will source candidates from your brief once you advance the hire to Sourcing.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="hire-template">Role template</Label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger id="hire-template" className="w-full">
                <SelectValue placeholder="Pick a starting template (optional)" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.title}
                    {t.defaultTier ? ` · ${t.defaultTier}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hire-title">Title</Label>
            <Input
              id="hire-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior backend engineer"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hire-description">Brief for Lena (what kind of person?)</Label>
            <Textarea
              id="hire-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Backend specialist who writes careful Postgres + Drizzle migrations, low-ego, opinionated about correctness."
              rows={4}
            />
            <p className="text-[11px] text-muted-foreground">
              The more specific you are, the better the candidate personas Lena generates.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hire-tier">Tier</Label>
            <Select
              value={tier}
              onValueChange={(v) => setTier(v as "T1" | "T2" | "T3")}
            >
              <SelectTrigger id="hire-tier" className="w-full">
                <SelectValue placeholder="Pick a tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="T1">T1 — top tier</SelectItem>
                <SelectItem value="T2">T2 — workhorse</SelectItem>
                <SelectItem value="T3">T3 — light/cheap</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {create.error && (
            <p className="text-xs text-destructive">
              {create.error instanceof Error ? create.error.message : "Failed to create hire"}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending ? "Creating…" : "Open hire"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
