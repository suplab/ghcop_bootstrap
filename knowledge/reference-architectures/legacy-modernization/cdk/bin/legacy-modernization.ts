#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { LegacyModernizationStack } from '../lib/legacy-modernization-stack';

const app = new App();
new LegacyModernizationStack(app, 'LegacyModernization', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1' },
  description: 'Legacy Modernization (Strangler Fig) reference architecture (EEIK knowledge/reference-architectures)',
});
