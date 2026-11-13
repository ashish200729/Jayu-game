# Protocol (PROTOCOL_VERSION = 3)

All messages are byte arrays: `u8 type` + payload. JSON payloads are `uvarint length + UTF-8 JSON`.
Integers use little-endian fixed widths or LEB128 varints (`uv`) / zig-zag varints (`sv`).
Clients with a different `PROTOCOL_VERSION` receive `Reject {reason:'version'}` → "Update required" screen.

| Type | Dir | Name | Payload | Reliability |
|---|---|---|---|---|
| 1 | C→H | Hello | JSON `{v,name,look[6],token,platform,code?}` (resend every 700 ms until Welcome) | reliable |
| 2 | C→H | Inputs | `uv ackSnapshotTick, u8 n, uv baseSeq`, n × input | lossy (redundant) |
| 3 | C→H | Lobby | JSON `LobbyAction` (ready, team, settings*, start*, kick*, look, rematch*) — *host only | reliable |
| 4 | C→H | Ping | `f64 clientTime, uv rtt` | lossy |
| 5 | C→H | SyncReq | JSON `{what: roster|start|results|lobby}` | reliable |
| 6 | C→H | Leave | — | reliable |
| 20 | H→C | Welcome | JSON `{playerId, token, protocol, hostKind, snapshotRate}` | reliable |
| 21 | H→C | Reject | JSON `{reason: version|full|kicked|in-progress|bad-request|closed}` | reliable |
| 22 | H→C | LobbyState | JSON lobby (sent on change + every 1 s) | reliable |
| 23 | H→C | Start | JSON `{matchId, config (MatchConfig), playerId, tick, snapshotRate}` | reliable |
| 24 | H→C | Snapshot | binary, see below | lossy |
| 25 | H→C | End | JSON `{matchId, results}` | reliable |
| 26 | H→C | Pong | `f64 clientTime, uv hostTick` | lossy |
| 27 | H→C | Roster | JSON `{version, players[{id,name,look,isBot,platform}]}` | reliable |
| 28 | H→C | Kick | — | reliable |

## Input (11–14 bytes each)
`uv seq-baseSeq, i8 moveX, i8 moveY, u16 aim (binary angle), u8 buttons (fire|jet|crouch|zoom),
3 bytes actions (4-bit rolling counters: throw, swap, reload, melee, signal), u8 throwPower, u8 signal,
uv viewTick`. Clients send the last 5 inputs every 2 ticks (30 packets/s) so one lost packet loses nothing.
The host consumes one input per tick from a ≤6-deep queue; on underflow it repeats the last input without
advancing the ack. Action counters make one-shot actions immune to loss/duplication.

## Snapshot
```
u8 24, uv matchId, uv tick, uv baseTick (0 = full), uv ackInputSeq, u8 inputBufferDepth, uv rosterVersion
mode: u8 phase, uv phaseT, sv timeLeft, uv score0, uv score1, uv scoreLimit,
      u8 nFlags × (u8 state, sv x, sv y, sv carrier), zone (u8 index, i8 owner, uv t, sv x, sv y, uv w, uv h),
      uv bombT, uv wave, uv waveTotal, uv waveSpawned, sv leader0, sv leader1, sv winner, sv winnerTeam
players: u8 n × (uv id, uv maskLo22, uv maskHi22, sv delta per set bit)   — 44 integer fields (snapshot.ts PF)
projectiles: uv n × (uv id, u8 weapon, uv owner, sv x*8, sv y*8, sv vx, sv vy)
grenades:    uv n × (uv id, u8 kind, uv owner, sv x*8, sv y*8, sv stuck, u8 armed, uv fuse)
clouds:      uv n × (uv id, u8 kind, sv x, sv y, uv r, uv life)
dropped:     uv n × (uv id, u8 weapon, sv x, sv y)
spawners:    uv n, availability bitmask, then i8 item per available spawner
events:      uv n × (uv id, u8 type, uv tick, u8 count, sv data…)
```
Player fields are deltas against the snapshot the client last acknowledged (in its Inputs message);
the host keeps 40 baselines per client. Positions are quantised to 1/8 px *inside the sim*, so decoded
snapshots are bit-exact (verified by tests/netcode: 85k+ field comparisons, 0 mismatches at 2 % loss).
Important events (kills, flags, waves, pickups…) are repeated in the next 3 snapshots and de-duplicated by
id on the client; cosmetic events (shots, hits, explosions) are sent once and filtered to ±1700 px.

Event data layouts: see `EventType` in packages/sim/src/types.ts (Shot `[player, weapon, x0,y0,x1,y1, hit]`,
Explode `[x,y,r,kind]`, Hit `[victim, attacker, dmg, head, x, y]`, Kill `[victim, killer, code, head]`, …).

## LAN framing (UDP)
`u8 kind (0 unreliable, 1 reliable, 2 ack, 3 keepalive) [u16 seq] payload`. Reliable frames are resent
every 150 ms (max 40 tries) and delivered in order; peers time out after 10 s of silence. Only a reliable
Hello can open a new peer on the host. Discovery TXT record: `code, hostName, mode, map, max, v`.

## Budgets (measured by `npm run bench`)
12 players, 150 ms RTT, 2 % loss: ~10.2 KB/s down, ~2.1 KB/s up per client (budget 12 / 4 KB/s).
