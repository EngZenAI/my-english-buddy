export default function AppShell({ children }) {
  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background md:flex-row">
      {children}
    </div>
  );
}
