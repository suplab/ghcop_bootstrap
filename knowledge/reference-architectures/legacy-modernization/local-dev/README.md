# Legacy Modernization (Strangler Fig) — Local Dev

Run the strangler seam end-to-end on a laptop — no AWS required.

```bash
docker compose up -d
```

Brings up:

- **routing-facade** (`:8080`) — the strangler seam; per-capability flags route to legacy or new.
- **legacy-core** (`:9000`) — an HTTP echo standing in for the mainframe / IBM i.
- **extracted-service** — placeholder for the Spring Boot 3 service (replace the image with your build).
- **postgres** (`:5432`) — stands in for Aurora (the extracted service's store).
- **kafka** (`:9092`) — the domain-event + CDC backbone.

### Try a cutover

Flip `ROUTE_POLICY_CUSTOMER` between `LEGACY` and `NEW` on the `routing-facade` service and restart it:
the *customer* capability moves from the legacy stub to the extracted service — or rolls straight back.
That flag flip is the whole point of the pattern: migrate one capability at a time, reversibly.
