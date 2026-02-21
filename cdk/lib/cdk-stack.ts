import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

// extend the stock props so we can pass a prefix through the stack
export interface CdkStackProps extends cdk.StackProps {
  /** optional prefix applied to names of resources */
  prefix?: string;
  /** when true the example lambda and API are not created (useful for unit tests) */
  disableLambda?: boolean;
  lambdaVersionKey?: string; // optional version key to force lambda updates when code changes without changing the logical ID; can also be set via cdk context (e.g. -c lambdaVersionKey=v2)
}

export class CdkStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CdkStackProps = {}) {
    super(scope, id, props);

    // determine prefix from either props or cdk context; fall back to undefined
    const prefix = props.prefix ?? this.node.tryGetContext('prefix');
    const lambdaVersionKey = props.lambdaVersionKey ?? this.node.tryGetContext('lambdaVersionKey') ?? 'v1';
    const accountId = this.account;

    // helper to build names only when a prefix is supplied
    const withPrefix = (name: string) => `${prefix}-${name}`;
    const withAccountId = (name: string) => `${prefix}-${name}-${accountId}`;

    // S3 bucket to hold media files
    this.bucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: withAccountId('media-bucket'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Cognito user pool for authentication
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: withPrefix('user-pool'),
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('web-client', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: withPrefix('identity-pool'),
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // IAM role for authenticated users to access their folder in the bucket
    const authenticatedRole = new iam.Role(this, 'CognitoDefaultAuthenticatedRole', {
      roleName: withPrefix('authenticated-role'),
      assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
      }, 'sts:AssumeRoleWithWebIdentity'),
    });

    // Policy to allow object operations only within the user's folder
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:List*', 's3:GetBucketLocation'],
      resources: [
        this.bucket.bucketArn + '/${cognito-identity.amazonaws.com:sub}',
        this.bucket.bucketArn + '/${cognito-identity.amazonaws.com:sub}/*'
      ]
    }));

    // attach the role to the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // optional example lambda + API; can be skipped during testing
    if (!props.disableLambda) {
      // create a layer containing aws-sdk (v2) so that it's available in the
      // Node runtime; newer NodeJS lambda runtimes no longer include the v2
      // SDK by default.
      const awsSdkLayer = new lambda.LayerVersion(this, 'AwsSdkLayer', {
        layerVersionName: withPrefix('lambda-layer'),
        code: lambda.Code.fromAsset('lambda/layers/aws-sdk-layer'),
        compatibleRuntimes: [
          lambda.Runtime.NODEJS_24_X
        ],
        description: 'Optional AWS SDK v2 layer for functions that rely on require("aws-sdk")',
      });

      const listLambda = new lambda.Function(this, 'ListHandler', {
        functionName: withPrefix('list-handler'),
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('lambda/list'),
        environment: {
          BUCKET: this.bucket.bucketName,
          IDENTITY_POOL_ID: identityPool.ref,
          USER_POOL_ID: this.userPool.userPoolId,
          VID: lambdaVersionKey
        },
        layers: [awsSdkLayer],
      });

      // Grant lambda read access to bucket
      this.bucket.grantRead(listLambda);

      // API Gateway fronting the lambda
      const api = new apigateway.RestApi(this, 'MediaApi', {
        restApiName: withPrefix('media-api'),
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
        },
      });

      // add a Cognito User Pools authorizer so that only authenticated
      // requests with a valid ID token are allowed; the token’s claims will
      // be passed through to the Lambda (used to extract sub/user id).
      const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
        cognitoUserPools: [this.userPool],
      });

      const listIntegration = new apigateway.LambdaIntegration(listLambda);
      api.root.addMethod('GET', listIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });
    }

    // Outputs for front-end configuration
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'BucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref });
    // optional prefix export
    if (prefix) {
      new cdk.CfnOutput(this, 'ResourcePrefix', { value: prefix });
    }
  }
}
