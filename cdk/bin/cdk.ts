#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';

const app = new cdk.App();

// read an optional prefix from context (-c prefix=foo)
const prefix = app.node.tryGetContext('prefix') as string | 's3mediaplayer';
const lambdaVersionKey = app.node.tryGetContext('lambdaVersionKey') as string | 'v1';
const domainName = app.node.tryGetContext('domainName') as string | undefined;
const certificateArn = app.node.tryGetContext('certificateArn') as string | undefined;

// compute a physical stack name that includes the prefix (defaulting to the
// prefix value itself). the CdkStack class will also synthesize this for
// cases where the stack is instantiated directly (such as in unit tests), but
// we provide it here for clarity when the CLI is used.
const stackName = `${prefix}-stack`;

new CdkStack(app, 'CdkStack', {
  prefix: prefix,
  stackName: stackName,
  lambdaVersionKey: lambdaVersionKey,
  domainName: domainName,
  certificateArn: certificateArn,
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});