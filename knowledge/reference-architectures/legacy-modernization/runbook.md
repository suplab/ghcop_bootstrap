# Legacy Modernization — Runbook

Operational guidance for running the strangler-fig seam in production during the coexistence window.

## Cutover a capability (LEGACY → NEW)

1. Confirm the extracted service is healthy and CDC lag is ~0 (read model current).
2. Flip the capability's route flag (`ROUTE_POLICY_<CAPABILITY>`) from `LEGACY` to `NEW` — a config
   change on the routing facade, no redeploy of the legacy core.
3. Watch the golden signals for that capability (error rate, latency, and business-level correctness
   checks / reconciliation against the legacy path) through the bake period.
4. If healthy at the end of the bake, mark the slice cut over and schedule retirement of the legacy
   path. If not, **roll back** (below).

## Rollback (NEW → LEGACY)

1. Flip the capability's route flag back to `LEGACY`. Traffic returns to the legacy core immediately.
2. The legacy core never stopped serving during coexistence, so there is no data to restore — the ACL
   and CDC keep the two paths consistent. Capture the failure, fix forward, retry the cutover.

## CDC / coexistence health

- **Symptom:** stale reads on the new service. **Check:** Debezium connector status + Kafka consumer
  lag. **Action:** restart the connector; if lag persists, hold the capability on `LEGACY` until the
  read model catches up. Never cut over with non-trivial CDC lag.
- **Symptom:** ACL translation errors. **Check:** ACL logs for unmapped legacy fields (new copybook
  version?). **Action:** extend the ACL mapping; unknown legacy shapes must fail closed, never pass an
  untranslated legacy concept into the domain.

## Retiring a legacy capability

Only after a slice has carried production traffic on `NEW` through the bake with no reconciliation
drift: remove the `LEGACY` route, decommission the legacy program/module, and delete its ACL + CDC
wiring. Keep an audit record of the retirement (what was migrated, when, by whom).

## Reconciliation

Throughout coexistence, run a periodic reconciliation job comparing legacy and new outputs for
migrated capabilities. A non-zero drift is a cutover blocker (before) or a rollback trigger (after).
