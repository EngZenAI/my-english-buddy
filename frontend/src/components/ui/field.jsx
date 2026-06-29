import { cn } from "@/lib/utils";

function Field({ className = "", ...props }) {
  return <div className={cn("grid gap-2", className)} {...props} />;
}

function FieldLabel({ className = "", ...props }) {
  return (
    <label
      className={cn("text-sm font-medium leading-none text-foreground", className)}
      {...props}
    />
  );
}

function FieldDescription({ className = "", ...props }) {
  return (
    <p
      className={cn("text-sm leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldLabel };
