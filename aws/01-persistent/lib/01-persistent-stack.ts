import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';

export class PersistentStack extends cdk.Stack {
  public readonly mediaBucket: s3.Bucket;
  public readonly assetBucket: s3.Bucket;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly authenticatedRole: iam.Role;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    const prefix = scope.node.tryGetContext('prefix') || '';
    const stackName = `${prefix}-persistent-stack`;

    super(scope, id, { ...props, stackName });

    // allow prefix to be supplied via CFN parameter or context
    const accountId = this.account;
    const withPrefix = (name: string) => (prefix ? `${prefix}-${name}` : name);
    const withAccountId = (name: string) => (prefix ? `${prefix}-${name}-${accountId}` : `${name}-${accountId}`);

    // S3 bucket to hold media files
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: withAccountId('media-bucket'),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // front-end asset bucket (served via CloudFront)
    this.assetBucket = new s3.Bucket(this, 'AssetBucket', {
      bucketName: withAccountId('asset-bucket'),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Cognito user pool for authentication
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: withPrefix('user-pool'),
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient('web-client', {
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: withPrefix('identity-pool'),
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    this.authenticatedRole = new iam.Role(this, 'CognitoDefaultAuthenticatedRole', {
      roleName: withPrefix('authenticated-role'),
      assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        StringEquals: { 'cognito-identity.amazonaws.com:aud': this.identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
      }, 'sts:AssumeRoleWithWebIdentity'),
    });

    this.authenticatedRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:List*', 's3:GetBucketLocation'],
      resources: [
        this.mediaBucket.bucketArn + '/${cognito-identity.amazonaws.com:sub}',
        this.mediaBucket.bucketArn + '/${cognito-identity.amazonaws.com:sub}/*',
      ],
    }));

    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
      identityPoolId: this.identityPool.ref,
      roles: { authenticated: this.authenticatedRole.roleArn },
    });

    // Outputs so parameters can be provided to other stacks
    new cdk.CfnOutput(this, 'MediaBucketName', { value: this.mediaBucket.bucketName });
    new cdk.CfnOutput(this, 'AssetBucketName', { value: this.assetBucket.bucketName });
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'UserPoolProviderName', { value: this.userPool.userPoolProviderName });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: this.identityPool.ref });
    new cdk.CfnOutput(this, 'AuthenticatedRoleArn', { value: this.authenticatedRole.roleArn });
    new cdk.CfnOutput(this, 'ResourcePrefix', { value: prefix });
  }
}
