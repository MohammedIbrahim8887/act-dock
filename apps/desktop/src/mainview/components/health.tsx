import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDashed,
  Copy,
  FolderOpen,
  Info,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDesktop, revealPath } from "@/lib/api";
import type {
  CheckStatus,
  HealthCheck,
  HealthReport,
} from "../../shared/contracts";

export type HealthActionHandler = (check: HealthCheck) => void;
const groups = [
  { id: "required", title: "Required to run pipelines", hint: "Pipelines can’t start until these pass." },
  { id: "recommended", title: "Recommended", hint: "Runs work without these, but they make them faster and smoother." },
  { id: "environment", title: "Your setup", hint: "For reference when something behaves differently than on GitHub." },
] as const;
const counted = (c: HealthCheck) => c.status !== "skipped" && c.status !== "info";
const blocking = (r: HealthReport) =>
  r.checks.filter((c) => c.group === "required" && (c.status === "error" || c.status === "pending"));
const issues = (r: HealthReport) =>
  r.checks.filter((c) => c.status === "error" || c.status === "warning" || c.status === "pending");

/** The single most useful thing to say about the machine right now. */
export function healthHeadline(report: HealthReport | null) {
  if (!report) return { title: "Checking your setup…", description: "This takes a few seconds." };
  const block = blocking(report);
  if (block.length) {
    const first = block[0];
    const more = block.length - 1;
    return {
      title: first.summary,
      description:
        first.status === "pending"
          ? "Pipelines start as soon as it’s ready. Act Dock keeps checking."
          : `Pipelines can’t start until this is fixed.${more ? ` ${more} more blocking issue${more === 1 ? "" : "s"} below.` : ""}`,
      check: first,
    };
  }
  const open = issues(report);
  if (open.length)
    return {
      title: "Ready to run pipelines",
      description: `${open.length} suggestion${open.length === 1 ? "" : "s"} to make runs smoother.`,
      check: open.find((c) => c.action),
    };
  return { title: "Everything’s ready", description: "Docker, the act engine, and your job image are all set." };
}

export function healthIssueCount(report: HealthReport | null) {
  return report ? issues(report).length : 0;
}

function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}
function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

export function StatusEmblem({ status, size = "md" }: { status: CheckStatus; size?: "sm" | "md" }) {
  const icon = {
    ok: <Check />,
    warning: <TriangleAlert />,
    error: <X />,
    pending: <LoaderCircle className="animate-spin" />,
    info: <Info />,
    skipped: <CircleDashed />,
  }[status];
  const label = { ok: "Passing", warning: "Needs attention", error: "Blocking", pending: "In progress", info: "Information", skipped: "Not checked yet" }[status];
  return (
    <span className="health-emblem" data-status={status} data-size={size} role="img" aria-label={label}>
      {icon}
    </span>
  );
}

/** One arc per counted check: solid when passing, faint when it needs attention, a gap when blocking. */
function ReadinessRing({ report }: { report: HealthReport | null }) {
  const checks = report?.checks.filter(counted) ?? [];
  const passing = checks.filter((c) => c.status === "ok").length;
  const r = 40, c = 2 * Math.PI * r, gap = checks.length > 1 ? 5 : 0;
  const seg = checks.length ? c / checks.length : c;
  return (
    <div className="health-ring" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle className="health-ring-track" cx="50" cy="50" r={r} />
        {checks.map((check, i) => (
          <circle
            key={check.id}
            className="health-ring-segment"
            data-status={check.status}
            cx="50" cy="50" r={r}
            strokeDasharray={`${Math.max(seg - gap, 1)} ${c}`}
            strokeDashoffset={-i * seg}
            style={{ animationDelay: `${i * 45}ms` }}
          />
        ))}
      </svg>
      <div className="health-ring-label">
        {report ? (
          <>
            <strong>{passing}<span>/{checks.length}</span></strong>
            <small>passing</small>
          </>
        ) : (
          <LoaderCircle className="size-5 animate-spin" />
        )}
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="health-icon-button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check /> : <Copy />}
    </button>
  );
}

function ActionButton({ check, onAction, busy, primary }: { check: HealthCheck; onAction: HealthActionHandler; busy: boolean; primary?: boolean }) {
  if (!check.action) return null;
  const external = check.action.kind === "link";
  return (
    <Button
      size="sm"
      variant={primary ? "default" : check.status === "error" ? "default" : "outline"}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onAction(check);
      }}
    >
      {busy && <LoaderCircle className="size-3.5 animate-spin" />}
      {check.action.label}
      {external && <ArrowUpRight className="size-3.5" />}
    </Button>
  );
}

function CheckRow({ check, onAction, busy }: { check: HealthCheck; onAction: HealthActionHandler; busy: boolean }) {
  const expandable = !!(check.detail || check.facts.length || check.command);
  const [open, setOpen] = useState(check.status === "error");
  useEffect(() => {
    if (check.status === "error") setOpen(true);
  }, [check.status]);
  const id = `health-${check.id}`;
  return (
    <li className="health-row" data-status={check.status} data-open={open || undefined}>
      <div className="health-row-main">
        <StatusEmblem status={check.status} />
        <button
          type="button"
          className="health-row-text"
          aria-expanded={expandable ? open : undefined}
          aria-controls={expandable ? id : undefined}
          disabled={!expandable}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="health-row-title">{check.title}</span>
          <span className="health-row-summary">{check.summary}</span>
        </button>
        <div className="health-row-actions">
          <ActionButton check={check} onAction={onAction} busy={busy} />
          {expandable && (
            <button
              type="button"
              className="health-icon-button health-toggle"
              aria-label={open ? `Hide ${check.title} details` : `Show ${check.title} details`}
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronDown />
            </button>
          )}
        </div>
      </div>
      {check.progress && (
        <div className="health-progress" role="progressbar" aria-label={check.progress.label}
          aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={check.progress.fraction === undefined ? undefined : Math.round(check.progress.fraction * 100)}>
          <div className="health-progress-track">
            <div
              className="health-progress-fill"
              data-indeterminate={check.progress.fraction === undefined || undefined}
              style={check.progress.fraction === undefined ? undefined : { width: `${Math.max(4, check.progress.fraction * 100)}%` }}
            />
          </div>
          <span>{check.progress.label}</span>
        </div>
      )}
      {expandable && open && (
        <div className="health-details" id={id}>
          {check.detail && <p>{check.detail}</p>}
          {check.command && (
            <div className="health-command">
              <code>{check.command}</code>
              <CopyButton value={check.command} label="Copy command" />
            </div>
          )}
          {check.facts.length > 0 && (
            <dl className="health-facts">
              {check.facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd className={f.mono ? "mono" : undefined}>
                    <span title={f.value}>{f.value}</span>
                    {f.mono && <CopyButton value={f.value} label={`Copy ${f.label.toLowerCase()}`} />}
                    {f.mono && isDesktop() && /folder/i.test(f.label) && (
                      <button type="button" className="health-icon-button" aria-label={`Show ${f.label.toLowerCase()}`} title="Show in folder"
                        onClick={() => void revealPath(f.value)}>
                        <FolderOpen />
                      </button>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

export function HealthView({
  report,
  checking,
  busy,
  onCheck,
  onAction,
}: {
  report: HealthReport | null;
  checking: boolean;
  busy: string | null;
  onCheck: () => void;
  onAction: HealthActionHandler;
}) {
  const now = useNow();
  const headline = healthHeadline(report);
  const state = report?.overall ?? "checking";
  const counts = report
    ? {
        ok: report.checks.filter((c) => c.status === "ok").length,
        attention: report.checks.filter((c) => c.status === "warning").length,
        blocking: blocking(report).length,
      }
    : null;
  return (
    <div className="page-content health-page">
      <section className="health-hero" data-state={state} aria-live="polite">
        <ReadinessRing report={report} />
        <div className="health-hero-copy">
          <span className="health-eyebrow"><Activity className="size-3.5" />System health</span>
          <h1>{headline.title}</h1>
          <p>{headline.description}</p>
          <div className="health-hero-actions">
            {headline.check?.action && (
              <ActionButton check={headline.check} onAction={onAction} busy={busy === headline.check.id} primary />
            )}
            <Button size="sm" variant="ghost" onClick={onCheck} disabled={checking}>
              <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} />
              {checking ? "Checking…" : "Check again"}
            </Button>
            {report && <span className="health-checked">Checked {ago(report.checkedAt, now)}</span>}
          </div>
        </div>
        {counts && (
          <dl className="health-counts">
            <div><dt>Passing</dt><dd>{counts.ok}</dd></div>
            <div><dt>Suggestions</dt><dd>{counts.attention}</dd></div>
            <div><dt>Blocking</dt><dd>{counts.blocking}</dd></div>
          </dl>
        )}
      </section>
      {report ? (
        groups.map((group) => {
          const checks = report.checks.filter((c) => c.group === group.id);
          if (!checks.length) return null;
          return (
            <section className="health-group" key={group.id} aria-labelledby={`group-${group.id}`}>
              <header>
                <h2 id={`group-${group.id}`}>{group.title}</h2>
                <p>{group.hint}</p>
              </header>
              <ul className="health-list">
                {checks.map((c) => (
                  <CheckRow key={c.id} check={c} onAction={onAction} busy={busy === c.id} />
                ))}
              </ul>
            </section>
          );
        })
      ) : (
        <div className="health-group">
          <ul className="health-list">
            {[0, 1, 2, 3].map((i) => <li key={i} className="health-row health-row-skeleton" />)}
          </ul>
        </div>
      )}
      <p className="health-footnote">
        Act Dock rechecks automatically and before every run. Agents can run the same check with the <code>check_health</code> MCP tool, and scripts with <code>act-dock doctor</code>.
      </p>
    </div>
  );
}

/** App-wide strip shown while pipelines are blocked. */
export function HealthBanner({ report, busy, onAction, onOpen }: { report: HealthReport | null; busy: string | null; onAction: HealthActionHandler; onOpen: () => void }) {
  if (!report || report.overall !== "blocked") return null;
  const first = blocking(report)[0];
  if (!first) return null;
  const pending = first.status === "pending";
  return (
    <div className="health-banner" data-pending={pending || undefined} role="status">
      <StatusEmblem status={first.status} size="sm" />
      <span>
        <strong>{first.summary}</strong>
        <span>{pending ? "Pipelines will start once it’s ready." : "Pipelines can’t start until it’s fixed."}</span>
      </span>
      {!pending && first.action && <ActionButton check={first} onAction={onAction} busy={busy === first.id} primary />}
      <Button size="sm" variant="ghost" onClick={onOpen}>View health</Button>
    </div>
  );
}

export function HealthStatusText({ report }: { report: HealthReport | null }): ReactNode {
  if (!report) return "Checking setup…";
  if (report.overall === "blocked") return blocking(report)[0]?.summary || "Setup needs attention";
  const n = issues(report).length;
  return n ? `Ready · ${n} suggestion${n === 1 ? "" : "s"}` : "All systems ready";
}
