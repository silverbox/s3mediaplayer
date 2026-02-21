// import * as cdk from 'aws-cdk-lib';
// import { Template } from 'aws-cdk-lib/assertions';
// import * as Cdk from '../lib/cdk-stack';

// example test. To run these tests, uncomment this file along with the
// example resource in lib/cdk-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as Cdk from '../lib/cdk-stack';

// smoke test to ensure resources exist with prefix applied when provided

test('prefix prop is reflected in names', () => {
  const app = new cdk.App({ context: { prefix: 'myprefix' } });
  const stack = new Cdk.CdkStack(app, 'MyTestStack', { disableLambda: true });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketName: 'myprefix-media-bucket',
  });

  template.hasResourceProperties('AWS::Cognito::UserPool', {
    UserPoolName: 'myprefix-user-pool',
  });

  template.hasResourceProperties('AWS::Cognito::IdentityPool', {
    IdentityPoolName: 'myprefix-identity-pool',
  });
});
