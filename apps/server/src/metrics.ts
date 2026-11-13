export const metrics = {
  startedAt: Date.now(),
  roomsCreated: 0,
  matchesFinished: 0,
  bytesIn: 0,
  bytesOut: 0,
  tickMsMax: 0,
  tickOverruns: 0,
  reports: 0,
  errors: 0,
};

/** Set when the process received SIGTERM: no new rooms or joins, running matches finish. */
export const state = { draining: false };
