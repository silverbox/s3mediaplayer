import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class CdkStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket to hold media files
    this.bucket = new s3.Bucket(this, 'MediaBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Cognito user pool for authentication
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('web-client', {
      authFlows: {
        userPassword: true,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    // Cognito Identity Pool (federated identities) so that we can issue temporary AWS credentials
    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
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
      assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
      }, 'sts:AssumeRoleWithWebIdentity'),
    });

    // Policy to allow object operations only within the user's folder
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [this.bucket.bucketArn + '/${cognito-identity.amazonaws.com:sub}/*'],
    }));

    // attach the role to the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // Example lambda for listing files (placeholder)
    const listLambda = new lambda.Function(this, 'ListHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/list'),
      environment: {
        BUCKET: this.bucket.bucketName,
      },
    });

    // Grant lambda read access to bucket
    this.bucket.grantRead(listLambda);

    // API Gateway fronting the lambda
    const api = new apigateway.RestApi(this, 'MediaApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });
    const listIntegration = new apigateway.LambdaIntegration(listLambda);
    api.root.addMethod('GET', listIntegration);

    // Outputs for front-end configuration
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'BucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref });
  }
}
