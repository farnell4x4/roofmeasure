import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card style={{ textAlign: "center", padding: 28 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ color: "var(--muted)", marginBottom: actionLabel ? 18 : 0 }}>{description}</p>
      {actionLabel && onAction ? <Button onClick={onAction}>{actionLabel}</Button> : null}
    </Card>
  );
}
