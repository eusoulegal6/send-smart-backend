import { useAuthReady } from "@/hooks/useAuthReady";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ConnectExtension from "@/components/ConnectExtension";
import TrafficAnalytics from "@/components/TrafficAnalytics";
import { usePageviewTracking } from "@/hooks/usePageviewTracking";

const Dashboard = () => {
  const { user } = useAuthReady();
  const navigate = useNavigate();
  usePageviewTracking("apps-backend");

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Apps Backend</h1>
            <p className="text-sm text-muted-foreground">Dashboard</p>
          </div>
          <button
            onClick={handleSignOut}
            className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground text-sm hover:opacity-90"
          >
            Sign out
          </button>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-card-foreground">
            Welcome{user?.email ? `, ${user.email}` : ""}! You are signed in.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Send Smart</h2>
          <ConnectExtension />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">WhatsReply</h2>
          <div className="rounded-lg border border-border bg-card p-6 flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              No WhatsReply activity yet. Connect WhatsReply to start tracking replies and usage here.
            </p>
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
            >
              Connect WhatsReply
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Analytics</h2>
          <TrafficAnalytics />
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
