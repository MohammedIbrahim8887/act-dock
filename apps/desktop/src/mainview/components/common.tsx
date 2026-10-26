import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleCheck,
  CircleX,
  CircleDashed,
  LoaderCircle,
  Clock3,
  Ban,
  TriangleAlert,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RunState } from "../../shared/contracts";
export function Status({ state }: { state: RunState }) {
  const Icon =
    {
      queued: Clock3,
      running: LoaderCircle,
      cancelling: LoaderCircle,
      succeeded: CircleCheck,
      failed: CircleX,
      cancelled: Ban,
      interrupted: TriangleAlert,
    }[state] || CircleDashed;
  return (
    <Badge variant="outline" data-run-state={state} className="gap-1.5 font-normal capitalize">
      <Icon
        className={`size-3.5 ${state === "running" || state === "cancelling" ? "animate-spin" : ""}`}
      />
      {state}
    </Badge>
  );
}
export function RunningBorder() {
  const ref = useRef<SVGSVGElement>(null);
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    let visible = false;
    const update = () => setAnimating(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    if (ref.current) observer.observe(ref.current);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <svg ref={ref} className="workflow-running-border" aria-hidden="true" data-animating={animating}>
      <rect pathLength="100" />
    </svg>
  );
}
export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          variant="ghost"
          size="icon"
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export function Empty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {icon || <Terminal className="size-6" />}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function duration(start?: string, end?: string) {
  if (!start) return "—";
  const seconds = Math.max(
    0,
    Math.floor(
      ((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000,
    ),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export const fail = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
