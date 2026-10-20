import { useEffect, useState } from "react";
import { formatSeason, type AdminTest } from "@listening/shared";
import {
  adminDeleteTest,
  adminListTests,
  adminSetArchived,
  adminSetPublished,
} from "../lib/api";
import { getAdminToken, setAdminToken } from "../lib/storage";
import { formatDate } from "../lib/format";
import { ErrorPanel, LevelBadge, LoadingPanel, Spinner } from "../components/ui";
import { ShieldIcon } from "../components/icons";

export default function Admin() {
  const [token, setToken] = useState(getAdminToken());
  const [tests, setTests] = useState<AdminTest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (!token.trim()) {
      setError(new Error("Enter the admin token configured for this deployment."));
      return;
    }
    setAdminToken(token.trim());
    setLoading(true);
    setError(null);
    try {
      const data = await adminListTests();
      setTests(data.tests);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (getAdminToken()) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(test: AdminTest) {
    setBusy(test.id);
    try {
      await adminSetPublished(test.id, test.status !== "published");
      setTests((previous) =>
        previous.map((entry) =>
          entry.id === test.id
            ? { ...entry, status: entry.status === "published" ? "draft" : "published" }
            : entry,
        ),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function toggleArchive(test: AdminTest) {
    const archived = Boolean(test.archivedAt);
    if (!archived && !window.confirm(`Archive “${test.title}”? It will leave the learner rotation but stay in history.`)) {
      return;
    }
    setBusy(test.id);
    try {
      await adminSetArchived(test.id, !archived);
      setTests((previous) =>
        previous.map((entry) =>
          entry.id === test.id
            ? { ...entry, archivedAt: archived ? null : new Date().toISOString() }
            : entry,
        ),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function remove(test: AdminTest) {
    if (!window.confirm(`Delete “${test.title}” and its audio? This cannot be undone.`)) return;
    setBusy(test.id);
    try {
      await adminDeleteTest(test.id);
      setTests((previous) => previous.filter((entry) => entry.id !== test.id));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  const published = tests.filter((test) => test.status === "published" && !test.archivedAt).length;
  const drafts = tests.filter((test) => test.status === "draft" && !test.archivedAt).length;
  const archived = tests.filter((test) => test.archivedAt).length;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="label text-accent">Operator</p>
          <h1 className="mt-2 text-4xl sm:text-5xl">Content library</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            Publish reviewed papers, archive old seasons, and check that the bank is stocked.
            Imports happen through the offline content factory, not this page.
          </p>
        </div>
        <span className="pill">
          <ShieldIcon className="h-3.5 w-3.5" />
          Token stays in this tab
        </span>
      </div>

      <div className="card mt-8 p-5 sm:p-6">
        <label htmlFor="admin-token" className="label">
          Admin token
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="admin-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="input"
            placeholder="ADMIN_TOKEN from apps/api/.dev.vars or wrangler secret"
            autoComplete="off"
          />
          <button type="button" className="btn-primary shrink-0" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : null}
            Load library
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Set it once with <code className="border border-line bg-paper px-1.5 py-0.5">wrangler secret put ADMIN_TOKEN</code>.
        </p>
      </div>

      {error ? (
        <div className="mt-6">
          <ErrorPanel error={error} title="Admin request failed" onRetry={() => void load()} />
        </div>
      ) : null}

      {loading && <LoadingPanel label="Loading the item bank" />}

      {!loading && tests.length > 0 && (
        <div className="mt-8">
          <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
            <LibraryStat label="Published" value={published} />
            <LibraryStat label="Drafts" value={drafts} />
            <LibraryStat label="Archived" value={archived} />
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 border-b border-line pb-3">
            <p className="label">{tests.length} papers in the library</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted">
              Archived papers leave the rotation
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {tests.map((test) => {
              const isArchived = Boolean(test.archivedAt);
              return (
                <article key={test.id} className="card-flat border-l-2 border-l-accent p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg">{test.title}</h2>
                        <LevelBadge level={test.level} />
                        <span
                          className={`px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${
                            isArchived
                              ? "bg-paper-deep text-muted"
                              : test.status === "published"
                                ? "bg-ok-soft text-ok"
                                : "bg-gold-soft text-ink-soft"
                          }`}
                        >
                          {isArchived ? "Archived" : test.status}
                        </span>
                        {test.reviewStatus && (
                          <span
                            className={`px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${
                              test.reviewStatus === "approved"
                                ? "bg-accent-soft text-accent-ink"
                                : "bg-danger-soft text-danger"
                            }`}
                          >
                            {test.reviewStatus}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {formatDate(test.createdAt)} · {formatSeason(test.season)} ·{" "}
                        {test.accent.toUpperCase()} · {test.passages} sections · {test.questions}{" "}
                        questions · {test.attempts} attempts
                        {typeof test.reviewScore === "number" ? ` · review ${Math.round(test.reviewScore)}/100` : ""}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted/70">{test.id}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary px-4 py-2"
                        onClick={() => void toggle(test)}
                        disabled={busy === test.id}
                      >
                        {busy === test.id ? <Spinner /> : null}
                        {test.status === "published" ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-4 py-2"
                        onClick={() => void toggleArchive(test)}
                        disabled={busy === test.id}
                      >
                        {isArchived ? "Restore" : "Archive"}
                      </button>
                      <button
                        type="button"
                        className="btn-danger px-4 py-2"
                        onClick={() => void remove(test)}
                        disabled={busy === test.id || test.attempts > 0}
                        title={test.attempts > 0 ? "Papers with attempts cannot be deleted" : undefined}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && tests.length === 0 && (
        <div className="card mt-8 border-t-2 border-t-accent p-8 text-center">
          <h2 className="text-2xl">The library is empty.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            Generate a pack offline, run the editorial review, then import it. The factory validates
            every question and uploads the audio in the same request.
          </p>
          <pre className="mx-auto mt-5 max-w-lg overflow-x-auto border border-line bg-paper px-4 py-3 text-left text-xs text-ink-soft">
{`cd pipeline
uv run listening generate --level B1
uv run listening review out/<id>
uv run listening publish out/<id> --require-review --api https://your-worker.workers.dev`}
          </pre>
        </div>
      )}
    </div>
  );
}

function LibraryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white p-4">
      <p className="label">{label}</p>
      <p className="mt-1 font-serif text-2xl">{value}</p>
    </div>
  );
}
