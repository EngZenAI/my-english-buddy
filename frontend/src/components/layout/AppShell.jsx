export default function AppShell({ children }) {
  return (
    <div className="relative flex min-h-screen w-full flex-col bg-background md:flex-row overflow-hidden">
      {children}
    </div>
  );
}
