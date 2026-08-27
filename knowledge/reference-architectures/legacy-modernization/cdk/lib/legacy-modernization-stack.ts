import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as msk from 'aws-cdk-lib/aws-msk';
import * as logs from 'aws-cdk-lib/aws-logs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';

/**
 * Legacy Modernization (Strangler Fig) reference architecture — infrastructure.
 *
 * A routing facade (Spring Cloud Gateway) sits in front of the legacy core and, per capability,
 * routes traffic to the legacy system or to a newly-extracted service behind an anti-corruption
 * layer. A CDC bridge (Debezium → MSK/Kafka) keeps the extracted service's read model consistent
 * during the coexistence window, so cutover is a feature-flag flip rather than a data-migration
 * outage. Mirrors the components in ../reference.yaml.
 *
 * This is a reference skeleton: representative L2/L3 constructs with production-shaped defaults
 * (isolated DB subnets, encryption, right-sized log retention). Wire real container images, the
 * legacy connectivity (Direct Connect / VPN to the mainframe or IBM i), and secrets before deploying.
 */
export class LegacyModernizationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ── Network: public ALB tier, private app tier, isolated data tier ──────────────
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // ── Extracted-service store: Aurora PostgreSQL (writer + reader for its CQRS read side) ──
    const db = new rds.DatabaseCluster(this, 'ExtractedServiceStore', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      writer: rds.ClusterInstance.provisioned('writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.LARGE),
      }),
      readers: [rds.ClusterInstance.provisioned('reader', { promotionTier: 1 })],
      storageEncrypted: true,
      defaultDatabaseName: 'extracted',
    });

    // ── Event + CDC backbone: MSK (Kafka) — domain events and Debezium change streams ──
    const kafka = new msk.CfnCluster(this, 'EventBackbone', {
      clusterName: 'modernization-events',
      kafkaVersion: '3.6.0',
      numberOfBrokerNodes: 3,
      brokerNodeGroupInfo: {
        instanceType: 'kafka.m5.large',
        clientSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
        storageInfo: { ebsStorageInfo: { volumeSize: 100 } },
      },
      encryptionInfo: { encryptionInTransit: { clientBroker: 'TLS', inCluster: true } },
    });

    // ── Shared ECS cluster ───────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsights: true });
    const logRetention = logs.RetentionDays.ONE_MONTH;

    // ── Routing facade (the strangler seam): public entry point, per-route cutover flags ──
    const facade = new ApplicationLoadBalancedFargateService(this, 'RoutingFacade', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 2,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/nginx:stable'),
        containerPort: 8080,
        environment: {
          // Per-capability routing: LEGACY sends the capability to the legacy core; NEW sends it to
          // the extracted service. Flip a flag to cut a capability over — or roll it straight back.
          ROUTE_POLICY_CUSTOMER: 'NEW',
          ROUTE_POLICY_BILLING: 'LEGACY',
          LEGACY_UPSTREAM_URL: 'http://legacy-core.internal:9000',
        },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'facade', logRetention }),
      },
      publicLoadBalancer: true,
    });
    facade.targetGroup.configureHealthCheck({ path: '/actuator/health', interval: Duration.seconds(30) });

    // ── Extracted domain service (behind an anti-corruption layer) ─────────────────────
    const service = new ApplicationLoadBalancedFargateService(this, 'ExtractedService', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 2,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/eclipse-temurin:21-jre'),
        containerPort: 8080,
        environment: {
          SPRING_PROFILES_ACTIVE: 'aws',
          KAFKA_BOOTSTRAP: kafka.attrArn, // resolve to bootstrap brokers via a custom resource in a real deploy
        },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'extracted-service', logRetention }),
      },
      publicLoadBalancer: false,
    });
    service.targetGroup.configureHealthCheck({ path: '/actuator/health', interval: Duration.seconds(30) });
    db.connections.allowDefaultPortFrom(service.service, 'extracted service → Aurora');
  }
}
