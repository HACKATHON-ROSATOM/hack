import debug from "debug";
import http from "node:http";

import { createApp } from "./app.ts";
import { environmentSchema } from "./config.ts";
import { createDatabase } from "./database.ts";
import { createAuthService } from "./modules/auth/service.ts";
import { Iec104Client } from "./modules/monitoring/iec104.ts";
import { MonitoringService } from "./modules/monitoring/service.ts";

const result = environmentSchema.safeParse(process.env);
if (!result.success) {
  const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
  console.error(`Invalid environment fields: ${fields.join(", ")}`);
  process.exit(1);
}

const config = result.data;
if (Boolean(config.IEC104_HOST) !== Boolean(config.IEC104_PORT)) {
  console.error("IEC104_HOST and IEC104_PORT must be configured together.");
  process.exit(1);
}
const log = debug("express-app:server");
const db = createDatabase(config.DATABASE_URL);

try {
  // The pg adapter creates its pool lazily; $connect alone does not probe PostgreSQL.
  await db.$queryRaw`SELECT 1`;
} catch {
  console.error("Database connection failed. Check DATABASE_URL and PostgreSQL availability.");
  await db.$disconnect();
  process.exit(1);
}

const auth = createAuthService(db);
try {
  await auth.restoreSessions();
} catch {
  console.error("Unable to restore sessions. Check database migrations and availability.");
  await db.$disconnect();
  process.exit(1);
}

const monitoring = new MonitoringService(db);
const iecClient =
  config.IEC104_HOST && config.IEC104_PORT
    ? new Iec104Client({
        host: config.IEC104_HOST,
        port: config.IEC104_PORT,
        onConnection: (connected) => monitoring.setConnected(connected),
        onObservation: (observation) => {
          void monitoring.receive(observation).catch((error: unknown) => {
            console.error("Telemetry persistence failed:", error);
          });
        },
      })
    : undefined;
const app = createApp(db, auth, monitoring);
monitoring.startProcessing();
iecClient?.start();

app.set("port", config.PORT);
app.set("env", config.NODE_ENV);

const server = http.createServer(app);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.syscall !== "listen") {
    throw error;
  }

  const bind = `Port ${config.PORT}`;

  switch (error.code) {
    case "EACCES":
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
    case "EADDRINUSE":
      console.error(`${bind} is already in use`);
      process.exit(1);
    default:
      throw error;
  }
});

server.on("listening", () => {
  const address = server.address();
  if (address === null) {
    return;
  }

  if (typeof address !== "string") {
    log(`Listening on port ${address.port}`);
  }
});

server.listen(config.PORT);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  iecClient?.stop();
  shuttingDown = true;
  server.close(() => {
    void monitoring
      .stopProcessing()
      .then(() => db.$disconnect())
      .catch((error: unknown) => {
        console.error("Database shutdown failed:", error);
        process.exitCode = 1;
      });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
