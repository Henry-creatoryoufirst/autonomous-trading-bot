# MEDIC REPORT — Routine Blocked by Egress Policy

**Timestamp:** 2026-06-21T03:04 UTC  
**Run type:** Scheduled hourly (Medic + Scout + Auditor)  
**Branch:** claude/cool-sagan-6xnizi  
**Outcome:** ALL THREE JOBS BLOCKED — routine did not execute

---

## Root Cause

The Claude Code remote execution environment's **egress network policy** blocks all outbound HTTP/HTTPS to external hosts that are not in the allowlist.

Every external call returned:
```
HTTP/2 403
x-deny-reason: host_not_allowed
Host not in allowlist: <hostname>. Add this host to your network egress settings to allow access.
```

The issuing CA on the TLS intercept: `O=Anthropic; CN=Egress Gateway SDS Issuing CA (production)`

---

## Blocked Hosts (confirmed)

| Host | Job that needs it | Status |
|------|------------------|--------|
| `autonomous-trading-bot-production.up.railway.app` | Medic (errors, balances), Auditor (trades, portfolio, patterns) | 403 host_not_allowed |
| `api.geckoterminal.com` | Scout (trending/new pools) | 403 host_not_allowed |
| `api.telegram.org` | General alerting | 403 host_not_allowed |
| `www.google.com` | WebSearch (Auditor research) | 403 host_not_allowed |

Only the **GitHub MCP server** (authenticated via a separate tunnel) was reachable.

---

## Impact

- **Medic:** Could not fetch `/api/errors` or `/api/balances` — bot health unknown for this run cycle
- **Scout:** Could not fetch GeckoTerminal trending/new pools — last scout was 2026-05-16 (>48h ago, scout is overdue)
- **Auditor:** Could not fetch trades, portfolio, patterns, or adaptive data — no audit possible
- **Telegram alerts:** Blocked, so no in-app notification reached the bot either

---

## Action Required (Henry)

You need to add the following hosts to the **network egress allowlist** for this Claude Code remote session/environment.

Docs: https://code.claude.com/docs/en/claude-code-on-the-web

Hosts to allowlist:
```
autonomous-trading-bot-production.up.railway.app
api.geckoterminal.com
api.telegram.org
```

Once added, the next scheduled run should execute normally.

---

## What Was Not Affected

- The **bot itself on Railway** — this failure is only in the agent runner; the bot's trading cycles are independent
- **GitHub access** — commits, pushes, and issue creation via GitHub MCP still work
- **Bot code in repo** — unchanged, nothing was deployed

---

## End of Run Status

```
🏥 Medic: BLOCKED — bot API unreachable (egress policy: host_not_allowed)
🔍 Scout: BLOCKED — GeckoTerminal unreachable (egress policy: host_not_allowed)
📊 Auditor: BLOCKED — bot API unreachable (egress policy: host_not_allowed)
```
