"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listRuleSets,
  createRuleSet,
  updateRuleSet,
  listRuleSetVersions,
  createRuleSetVersion,
  publishRuleSetVersion,
} from "@/lib/api";
import type {
  RuleSetSummary,
  RuleSetVersionSummary,
  CreateRuleSetPayload,
} from "@/lib/types";

// Monaco loaded client-side only to avoid SSR issues
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 bg-muted/30 animate-pulse rounded" />
    ),
  },
);

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

type RuleSetStatus = "active" | "coming_soon" | "archived";
type VersionStatus = "draft" | "published" | "retired";

const RULESET_STATUS_STYLES: Record<RuleSetStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-200",
  coming_soon: "bg-amber-100 text-amber-800 border-amber-200",
  archived: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

const RULESET_STATUS_LABELS: Record<RuleSetStatus, string> = {
  active: "Active",
  coming_soon: "Coming Soon",
  archived: "Archived",
};

const VERSION_STATUS_STYLES: Record<VersionStatus, string> = {
  draft: "bg-sky-100 text-sky-800 border-sky-200",
  published: "bg-emerald-100 text-emerald-800 border-emerald-200",
  retired: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: "Draft",
  published: "Published",
  retired: "Retired",
};

function StatusBadge({
  status,
  styles,
  labels,
}: {
  status: string;
  styles: Record<string, string>;
  labels: Record<string, string>;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border",
        styles[status] ?? "bg-neutral-100 text-neutral-500 border-neutral-200",
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Default rules_json template for new versions
// ---------------------------------------------------------------------------

const DEFAULT_RULES_JSON = JSON.stringify(
  {
    team_size: 9,
    team_label: "Rotation",
    salary_cap: 195_000_000,
    salary_cap_display: "$195M",
    cornerstone_rule: "1 Legend required",
    currency: "value",
    player_pool: "2025-26 Snapshot + Legends",
  },
  null,
  2,
);

// ---------------------------------------------------------------------------
// Inline create form
// ---------------------------------------------------------------------------

function CreateRuleSetForm({
  onCreated,
  onCancel,
}: {
  onCreated: (rs: RuleSetSummary) => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<RuleSetStatus>("coming_soon");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !name.trim()) return;

    setSaving(true);
    const payload: CreateRuleSetPayload = {
      slug: slug.trim().toLowerCase(),
      name: name.trim(),
      description: description.trim() || undefined,
      status,
    };

    const res = await createRuleSet(payload);
    setSaving(false);

    if (res.success && res.data) {
      toast.success(`Rule Set "${res.data.name}" created`);
      onCreated(res.data);
    } else {
      toast.error(res.error ?? "Failed to create Rule Set");
    }
  }

  return (
    <form
      id="create-ruleset-form"
      onSubmit={handleSubmit}
      className="border border-dashed border-border rounded p-3 space-y-2 bg-card"
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        New Rule Set
      </p>
      <input
        id="create-ruleset-slug"
        type="text"
        placeholder="slug (e.g. budget)"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c]"
        required
      />
      <input
        id="create-ruleset-name"
        type="text"
        placeholder="Display name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c]"
        required
      />
      <textarea
        id="create-ruleset-description"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c] resize-none"
      />
      <select
        id="create-ruleset-status"
        value={status}
        onChange={(e) => setStatus(e.target.value as RuleSetStatus)}
        className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c]"
      >
        <option value="coming_soon">Coming Soon</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
      <div className="flex gap-2 pt-1">
        <button
          id="create-ruleset-submit"
          type="submit"
          disabled={saving || !slug.trim() || !name.trim()}
          className="px-3 py-1.5 text-xs font-medium rounded bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34] disabled:opacity-40 transition-colors"
        >
          {saving ? "Creating..." : "Create"}
        </button>
        <button
          id="create-ruleset-cancel"
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Detail panel — metadata editor
// ---------------------------------------------------------------------------

function MetadataEditor({
  ruleset,
  onSaved,
}: {
  ruleset: RuleSetSummary;
  onSaved: (updated: RuleSetSummary) => void;
}) {
  const [name, setName] = useState(ruleset.name);
  const [description, setDescription] = useState(ruleset.description ?? "");
  const [status, setStatus] = useState<RuleSetStatus>(ruleset.status);
  const [displayOrder, setDisplayOrder] = useState(ruleset.display_order);
  const [saving, setSaving] = useState(false);

  // Reset form when ruleset changes
  useEffect(() => {
    setName(ruleset.name);
    setDescription(ruleset.description ?? "");
    setStatus(ruleset.status);
    setDisplayOrder(ruleset.display_order);
  }, [ruleset.id, ruleset.name, ruleset.description, ruleset.status, ruleset.display_order]);

  const isDirty =
    name !== ruleset.name ||
    description !== (ruleset.description ?? "") ||
    status !== ruleset.status ||
    displayOrder !== ruleset.display_order;

  async function handleSave() {
    setSaving(true);
    const res = await updateRuleSet(ruleset.slug, {
      name: name.trim(),
      description: description.trim() || undefined,
      status,
      display_order: displayOrder,
    });
    setSaving(false);

    if (res.success && res.data) {
      toast.success("Rule Set updated");
      onSaved(res.data);
    } else {
      toast.error(res.error ?? "Failed to update");
    }
  }

  return (
    <div id="ruleset-metadata-editor" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Metadata</h3>
        {isDirty && (
          <button
            id="ruleset-metadata-save"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-3 py-1 text-xs font-medium rounded bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34] disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="ruleset-detail-name"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Name
          </label>
          <input
            id="ruleset-detail-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c]"
          />
        </div>
        <div>
          <label
            htmlFor="ruleset-detail-slug"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Slug
          </label>
          <input
            id="ruleset-detail-slug"
            type="text"
            value={ruleset.slug}
            disabled
            className="w-full text-sm px-2 py-1.5 border border-border rounded bg-muted text-muted-foreground cursor-not-allowed"
          />
        </div>
      </div>
      <div>
        <label
          htmlFor="ruleset-detail-description"
          className="block text-xs font-medium text-muted-foreground mb-1"
        >
          Description
        </label>
        <textarea
          id="ruleset-detail-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c] resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="ruleset-detail-status"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Status
          </label>
          <select
            id="ruleset-detail-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as RuleSetStatus)}
            className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c]"
          >
            <option value="active">Active</option>
            <option value="coming_soon">Coming Soon</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="ruleset-detail-display-order"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Display Order
          </label>
          <input
            id="ruleset-detail-display-order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(Number(e.target.value))}
            className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c]"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version list + create + publish
// ---------------------------------------------------------------------------

function VersionsPanel({
  rulesetSlug,
  onPublished,
}: {
  rulesetSlug: string;
  onPublished: () => void;
}) {
  const [versions, setVersions] = useState<RuleSetVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  // New version form state
  const [versionLabel, setVersionLabel] = useState("");
  const [rulesJson, setRulesJson] = useState(DEFAULT_RULES_JSON);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [creatingVersion, setCreatingVersion] = useState(false);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    const res = await listRuleSetVersions(rulesetSlug);
    if (res.success && res.data) {
      setVersions(res.data);
    }
    setLoading(false);
  }, [rulesetSlug]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  function handleJsonChange(value: string | undefined) {
    const text = value ?? "";
    setRulesJson(text);
    try {
      JSON.parse(text);
      setJsonError(null);
    } catch (err: unknown) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  async function handleCreateVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!versionLabel.trim() || jsonError) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rulesJson);
    } catch {
      toast.error("Invalid JSON");
      return;
    }

    setCreatingVersion(true);
    const res = await createRuleSetVersion(rulesetSlug, {
      version_label: versionLabel.trim(),
      rules_json: parsed,
    });
    setCreatingVersion(false);

    if (res.success && res.data) {
      toast.success(`Version "${res.data.version_label}" created as draft`);
      setShowCreate(false);
      setVersionLabel("");
      setRulesJson(DEFAULT_RULES_JSON);
      setJsonError(null);
      loadVersions();
    } else {
      toast.error(res.error ?? "Failed to create version");
    }
  }

  async function handlePublish(versionId: string) {
    setPublishing(true);
    const res = await publishRuleSetVersion(rulesetSlug, versionId);
    setPublishing(false);
    setConfirmPublishId(null);

    if (res.success) {
      toast.success("Version published");
      loadVersions();
      onPublished();
    } else {
      toast.error(res.error ?? "Failed to publish");
    }
  }

  const publishedVersion = versions.find((v) => v.status === "published");

  return (
    <div id="ruleset-versions-panel" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Versions</h3>
        {!showCreate && (
          <button
            id="new-version-btn"
            onClick={() => setShowCreate(true)}
            className="px-3 py-1 text-xs font-medium rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            New Version
          </button>
        )}
      </div>

      {/* Create version form */}
      {showCreate && (
        <form
          id="create-version-form"
          onSubmit={handleCreateVersion}
          className="border border-dashed border-border rounded p-3 space-y-2 bg-card"
        >
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            New Version
          </p>
          <input
            id="create-version-label"
            type="text"
            placeholder="Version label (e.g. v2)"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-border rounded bg-background focus:outline-none focus:border-[#ffa05c]"
            required
          />
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              rules_json
            </label>
            {jsonError && (
              <div className="text-xs bg-red-50 border border-red-200 text-red-600 px-2 py-1 rounded mb-1">
                {jsonError}
              </div>
            )}
            <div className="border border-border rounded overflow-hidden">
              <MonacoEditor
                height="280px"
                language="json"
                value={rulesJson}
                onChange={handleJsonChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "off",
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  folding: true,
                  automaticLayout: true,
                }}
                theme="light"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              id="create-version-submit"
              type="submit"
              disabled={
                creatingVersion ||
                !versionLabel.trim() ||
                !!jsonError
              }
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#ffa05c] text-[#0e0907] hover:bg-[#fe6d34] disabled:opacity-40 transition-colors"
            >
              {creatingVersion ? "Creating..." : "Create Draft"}
            </button>
            <button
              id="create-version-cancel"
              type="button"
              onClick={() => {
                setShowCreate(false);
                setJsonError(null);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Version list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-12 bg-muted/30 animate-pulse rounded"
            />
          ))}
        </div>
      ) : versions.length === 0 ? (
        <p
          id="versions-empty"
          className="text-sm text-muted-foreground py-4 text-center"
        >
          No versions yet. Create one to define this Rule Set&apos;s rules.
        </p>
      ) : (
        <div className="space-y-1">
          {versions.map((v) => (
            <div
              key={v.id}
              id={`version-row-${v.version_label}`}
              className={cn(
                "flex items-center justify-between px-3 py-2 rounded border",
                v.status === "published"
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-mono font-medium">
                  {v.version_label}
                </span>
                <StatusBadge
                  status={v.status}
                  styles={VERSION_STATUS_STYLES}
                  labels={VERSION_STATUS_LABELS}
                />
                {v.published_at && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.published_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {v.status === "draft" && (
                  <>
                    {confirmPublishId === v.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {publishedVersion
                            ? `Retire ${publishedVersion.version_label}?`
                            : "Publish?"}
                        </span>
                        <button
                          id={`confirm-publish-${v.version_label}`}
                          onClick={() => handlePublish(v.id)}
                          disabled={publishing}
                          className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                        >
                          {publishing ? "..." : "Yes"}
                        </button>
                        <button
                          onClick={() => setConfirmPublishId(null)}
                          className="px-2 py-0.5 text-xs font-medium rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        id={`publish-version-${v.version_label}`}
                        onClick={() => setConfirmPublishId(v.id)}
                        className="px-2 py-0.5 text-xs font-medium rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors"
                      >
                        Publish
                      </button>
                    )}
                  </>
                )}
                <span
                  className="text-xs font-mono text-muted-foreground"
                  title={`Hash: ${v.rules_hash}`}
                >
                  {v.rules_hash.slice(0, 8)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminRuleSetsPage() {
  const [rulesets, setRulesets] = useState<RuleSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadRuleSets = useCallback(async () => {
    setLoading(true);
    const res = await listRuleSets();
    if (res.success && res.data) {
      setRulesets(res.data);
    } else {
      setError(res.error ?? "Failed to load Rule Sets");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRuleSets();
  }, [loadRuleSets]);

  const selected = rulesets.find((rs) => rs.slug === selectedSlug) ?? null;

  function handleCreated(rs: RuleSetSummary) {
    setRulesets((prev) => [...prev, rs]);
    setSelectedSlug(rs.slug);
    setShowCreate(false);
  }

  function handleMetadataSaved(updated: RuleSetSummary) {
    setRulesets((prev) =>
      prev.map((rs) => (rs.slug === updated.slug ? { ...rs, ...updated } : rs)),
    );
  }

  function handlePublished() {
    // Reload to get fresh current_version data
    loadRuleSets();
  }

  // --- Loading state ---
  if (loading) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="flex gap-6">
            <div className="w-72 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted rounded" />
              ))}
            </div>
            <div className="flex-1 h-64 bg-muted rounded" />
          </div>
        </div>
      </main>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <p className="text-destructive">{error}</p>
      </main>
    );
  }

  return (
    <main id="admin-rulesets-page" className="max-w-6xl mx-auto px-4 py-8">
      <Toaster position="top-right" richColors />

      {/* Page header */}
      <div id="rulesets-header" className="mb-6">
        <h1
          id="rulesets-title"
          className="text-2xl font-bold tracking-tight"
        >
          Rule Sets
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Create and manage the configurations that govern Lab sessions.
        </p>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-6 items-start">
        {/* Left panel — RuleSet list */}
        <div
          id="rulesets-list-panel"
          className="w-72 flex-shrink-0 space-y-2"
        >
          <button
            id="create-ruleset-btn"
            onClick={() => setShowCreate(true)}
            disabled={showCreate}
            className="w-full px-3 py-2 text-xs font-medium rounded border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors"
          >
            + Create Rule Set
          </button>

          {showCreate && (
            <CreateRuleSetForm
              onCreated={handleCreated}
              onCancel={() => setShowCreate(false)}
            />
          )}

          {rulesets.length === 0 && !showCreate ? (
            <p
              id="rulesets-empty"
              className="text-sm text-muted-foreground py-8 text-center"
            >
              No Rule Sets yet.
            </p>
          ) : (
            rulesets.map((rs) => (
              <button
                key={rs.slug}
                id={`ruleset-card-${rs.slug}`}
                onClick={() => setSelectedSlug(rs.slug)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded border transition-colors",
                  selectedSlug === rs.slug
                    ? "border-[#ffa05c] bg-[#ffa05c]/5"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">
                    {rs.name}
                  </span>
                  <StatusBadge
                    status={rs.status}
                    styles={RULESET_STATUS_STYLES}
                    labels={RULESET_STATUS_LABELS}
                  />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-mono text-muted-foreground">
                    {rs.slug}
                  </span>
                  {rs.current_version && (
                    <span className="text-xs text-muted-foreground">
                      {rs.current_version.version_label}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right panel — Detail editor */}
        <div id="rulesets-detail-panel" className="flex-1 min-w-0">
          {selected ? (
            <div className="space-y-6">
              {/* Metadata editor */}
              <div className="border border-border rounded p-4 bg-card">
                <MetadataEditor
                  key={selected.id}
                  ruleset={selected}
                  onSaved={handleMetadataSaved}
                />
              </div>

              {/* Versions panel */}
              <div className="border border-border rounded p-4 bg-card">
                <VersionsPanel
                  key={selected.id}
                  rulesetSlug={selected.slug}
                  onPublished={handlePublished}
                />
              </div>
            </div>
          ) : (
            <div
              id="rulesets-no-selection"
              className="flex items-center justify-center h-64 border border-dashed border-border rounded text-muted-foreground text-sm"
            >
              Select a Rule Set to view details
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
