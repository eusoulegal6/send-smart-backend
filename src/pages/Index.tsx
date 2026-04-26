import { useAuthReady } from "@/hooks/useAuthReady";
import { Navigate } from "react-router-dom";
import { usePageviewTracking } from "@/hooks/usePageviewTracking";

const Index = () => {
  const { user, isReady } = useAuthReady();
  usePageviewTracking("apps-backend");

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-6 max-w-2xl px-4">
        <h1 className="text-4xl font-bold text-foreground">Apps Backend</h1>
        <p className="text-lg text-muted-foreground">
          A shared backend powering multiple products — authentication, settings,
          usage, and AI-assisted features in one place.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 text-left pt-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-card-foreground">Send Smart</h2>
            <p className="text-sm text-muted-foreground mt-1">
              AI-powered email reply drafting for Gmail, with review and auto-send modes.
            </p>
          </div>
          <a href="#" className="rounded-lg border border-border bg-card p-4 hover:border-primary transition-colors">
            <h2 className="font-semibold text-card-foreground">WhatsReply</h2>
            <p className="text-sm text-muted-foreground mt-1">
              AI-assisted replies for WhatsApp conversations, with the same account and dashboard.
            </p>
          </a>
          <div className="rounded-lg border border-border bg-card p-4 opacity-70">
            <h2 className="font-semibold text-card-foreground">More coming soon</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Additional products will plug into the same account and dashboard.
            </p>
          </div>
        </div>

        <div className="pt-2">
          <a
            href="/auth"
            className="inline-block rounded-md bg-primary text-primary-foreground px-6 py-2.5 text-sm font-medium hover:opacity-90"
          >
            Sign in / Sign up
          </a>
        </div>
      </div>
    </div>
  );
};

export default Index;
