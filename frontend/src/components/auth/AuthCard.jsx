import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AuthCard({ title, description, children, footer, eyebrow }) {
  return (
    <div className="py-8 sm:py-10">
      <Card className="mx-auto max-w-md overflow-hidden border-slate-200 shadow-sm">
        <div className="h-1 bg-brand-600" />
        <CardHeader className="space-y-2">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase text-brand-600">
              {eyebrow}
            </p>
          )}
          <CardTitle className="text-2xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer && <CardFooter className="border-t bg-muted/30">{footer}</CardFooter>}
      </Card>
    </div>
  );
}
