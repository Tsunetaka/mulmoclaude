// HTTP routes for the remote-host runner (phase 1).
//
//   POST /api/remote-host/connect     { idToken }  → { status }
//   POST /api/remote-host/disconnect               → { status }
//   GET  /api/remote-host/status                   → { status }
//
// connect signs in to Firebase as the user with the browser-minted Google ID
// token and starts the host runner (command loop + presence heartbeat);
// disconnect stops it and signs out. Bearer-guarded like every other /api route
// (the browser's apiPost attaches the token); the idToken is a secret carried
// in the POST body over the loopback listener only — never logged.
import { Router, Request, Response } from "express";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { connect, disconnect, status, type RemoteHostStatus } from "../../remoteHost/index.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";

const PREFIX = "remote-host";
const router = Router();

interface StatusResponse {
  status: RemoteHostStatus;
}

router.post(API_ROUTES.remoteHost.connect, async (req: Request, res: Response<StatusResponse>) => {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "";
  if (!idToken) {
    badRequest(res, "Request body must be { idToken: string }");
    return;
  }
  try {
    res.json({ status: await connect(idToken) });
  } catch (err) {
    // Never include idToken in the message.
    log.warn(PREFIX, "connect failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err, "remote-host connect failed"));
  }
});

router.post(API_ROUTES.remoteHost.disconnect, async (_req: Request, res: Response<StatusResponse>) => {
  try {
    res.json({ status: await disconnect() });
  } catch (err) {
    log.warn(PREFIX, "disconnect failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err, "remote-host disconnect failed"));
  }
});

router.get(API_ROUTES.remoteHost.status, (_req: Request, res: Response<StatusResponse>) => {
  res.json({ status: status() });
});

export default router;
