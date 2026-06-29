import Spinner from "@/components/common/Spinner";

export default function LoadingPanel({ message }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Spinner className="h-8 w-8 border-4" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
