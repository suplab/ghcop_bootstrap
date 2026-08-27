# Legacy Modernization (Strangler Fig) — CDK

The architecture in `../reference.yaml` as deployable AWS infrastructure (CDK v2, TypeScript).

## What it provisions

- A 3-tier VPC (public ALB / private app / isolated data).
- **Routing facade** on ECS Fargate (public ALB) — the strangler seam, with per-capability route flags
  (`ROUTE_POLICY_*`) selecting the legacy core or the extracted service.
- **Extracted domain service** on ECS Fargate (internal) behind an anti-corruption layer.
- **Aurora PostgreSQL** (writer + reader) for the extracted service, in isolated subnets, encrypted.
- **MSK (Kafka)** as the domain-event + CDC (Debezium) backbone, TLS in transit.

This is a reference skeleton: representative constructs with production-shaped defaults. Wire real
container images, legacy connectivity (Direct Connect / VPN to the mainframe or IBM i), and secrets
before deploying.

## Use

```bash
npm install
npm run synth      # cdk synth — render CloudFormation
npm run diff       # cdk diff  — against a deployed stack
npm run deploy     # cdk deploy
```

Region defaults to `eu-west-1` (override with `CDK_DEFAULT_REGION`).
