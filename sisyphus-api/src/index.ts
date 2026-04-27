import pino from "pino";
import { app } from "./app.js";
import { connectDb, closeDb } from "./db.js";
import { ensureSettingsIndexes } from "./admin/models/settings.js";
import { ensureAuditEventIndexes } from "./admin/models/audit-event.js";
import { ensureIndexes as ensureUploadHistoryIndexes } from "./ingest/models/upload-history.js";
import { ensureCompileIndexes } from "./papers/models/compile-history.js";
import { ensureBucket } from "./papers/storage-client.js";
import { ensureSessionIndexes } from "./runner/models/session.js";
import { ensureEventLogIndexes } from "./runner/models/event-log.js";
import {
  recoverStaleSessions,
  startVerifyCron,
  stopVerifyCron,
} from "./runner/session-manager.js";
import { initWebSocket } from "./runner/ws-server.js";
import { ensureIndexes as ensureSchemaIndexes } from "./schemas/models/schema-definition.js";
import { ensureWorkflowIndexes } from "./workflows/models/workflow-definition.js";
import { ensureConnectorIndexes } from "./workflows/models/connector-definition.js";
import { ensureCompiledArtifactIndexes } from "./workflows/models/compiled-artifact.js";

const logger = pino({ name: "api" });

const PORT = parseInt(process.env["PORT"] ?? "8080", 10);

async function start() {
  const db = await connectDb();

  await Promise.all([
    ensureSettingsIndexes(db),
    ensureAuditEventIndexes(db),
    ensureUploadHistoryIndexes(db),
    ensureCompileIndexes(db),
    ensureSessionIndexes(db),
    ensureEventLogIndexes(db),
    ensureSchemaIndexes(db),
    ensureWorkflowIndexes(db),
    ensureConnectorIndexes(db),
    ensureCompiledArtifactIndexes(db),
  ]);
  logger.info("MongoDB connected and indexes ensured");

  // Best-effort papers storage bucket
  await ensureBucket().catch((err) => {
    logger.warn({ err }, "Papers storage bucket setup failed (non-fatal)");
  });

  // Recover any sessions that were running before a crash/restart
  await recoverStaleSessions();

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, "Sisyphus API listening");
  });

  // WebSocket server shares the HTTP server (used by runner streaming)
  initWebSocket(server);

  // Verify cron — periodically promotes blue→black via verify workflow
  startVerifyCron();

  const shutdown = async () => {
    logger.info("Shutting down...");
    stopVerifyCron();
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return { app, server };
}

const { server } = await start();

export { app, server };
