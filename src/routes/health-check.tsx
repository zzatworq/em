import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { checkDbHealth } from "@/lib/health";

export const Route = createFileRoute("/health-check")({ component: HealthCheck });

function HealthCheck() {
  const [status, setStatus] = useState<string>("Checking...");

  useEffect(() => {
    checkDbHealth()
      .then((result) => {
        setStatus(`DB reachable: ${result.ok} (took ${result.tookMs}ms)`);
      })
      .catch((err) => {
        setStatus(`DB check failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>Database Health Check</h1>
      <p>{status}</p>
    </div>
  );
}
