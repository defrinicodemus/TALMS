import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  icon,
  action,
  rounded = "default",
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  action?: React.ReactNode;
  rounded?: "default" | "blunt";
}) {
  return (
    <Card
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 border-0 gradient-soft p-6 shadow-soft md:p-8",
        rounded === "blunt" ? "rounded-md" : "rounded-none",
      )}
    >
      <div className="flex items-center gap-4">
        {icon && (
          <div
            className={cn(
              "grid h-14 w-14 place-items-center bg-card text-3xl shadow-soft",
              rounded === "blunt" ? "rounded-md" : "rounded-md",
            )}
          >
            {icon}
          </div>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action}
    </Card>
  );
}
