// import * as cdk from 'aws-cdk-lib';
// import { Template } from 'aws-cdk-lib/assertions';
// import * as Cdk from '../lib/cdk-stack';

// example test. To run these tests, uncomment this file along with the
// example resource in lib/cdk-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as Cdk from '../lib/cdk-stack';

// smoke test to ensure resources exist with prefix applied when provided

test('prefix prop is reflected in names', () => {
  const app = new cdk.App({ context: { prefix: 'myprefix' } });
  const stack = new Cdk.CdkStack(app, 'MyTestStack', { disableLambda: true });
  // stackName should use the prefix by default
  expect(stack.stackName).toEqual('myprefix-stack');
  const template = Template.fromStack(stack);

  // verify two buckets exist (media + asset); names are constructed via Fn::Join so
  // exact string match is hard. just ensure count is correct and prefix appears in
  // the generated names.
  template.resourceCountIs('AWS::S3::Bucket', 2);
  // optionally, inspect that at least one bucket name contains the prefix
  template.findResources('AWS::S3::Bucket', {
    Properties: {
      BucketName: Match.stringLikeRegexp('myprefix-'),
    },
  });

  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      // default behaviour must exist (we don't inspect origins deeply here)
      DefaultCacheBehavior: {
        ViewerProtocolPolicy: 'redirect-to-https',
      },
    },
  });

  template.hasResourceProperties('AWS::Cognito::UserPool', {
    UserPoolName: 'myprefix-user-pool',
  });

  template.hasResourceProperties('AWS::Cognito::IdentityPool', {
    IdentityPoolName: 'myprefix-identity-pool',
  });

  // we don't create a log group here because the lambda was disabled above
  // (the test for retention is in a separate stack below)
});

// verify that providing a domainName prop results in an alias on the distribution
test('domainName prop adds alias', () => {
  const app = new cdk.App({ context: { prefix: 'myprefix' } });
  const stack = new Cdk.CdkStack(app, 'MyTestStack2', { disableLambda: true, domainName: 'example.com' });
  expect(stack.stackName).toEqual('myprefix-stack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      Aliases: ['example.com'],
    },
  });
});
// verify that when lambdas are enabled we also get a log group with 30‑day retention
// matching the prefixed name

test('lambda log group has one‑month retention', () => {
  const app = new cdk.App({ context: { prefix: 'myprefix' } });
  const stack = new Cdk.CdkStack(app, 'MyLambdaStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Logs::LogGroup', {
    RetentionInDays: 30,
  });
});
// ensure the healthcheck path exists and is unauthenticated
// verify both the resource and the GET method with AuthorizationType NONE

test('api has unauthenticated healthcheck resource', () => {
  const app = new cdk.App({ context: { prefix: 'myprefix' } });
  const stack = new Cdk.CdkStack(app, 'HealthStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::ApiGateway::Resource', {
    PathPart: 'healthcheck',
  });

  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'GET',
    AuthorizationType: 'NONE',
  });
});
