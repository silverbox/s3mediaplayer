import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
// import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
// import * as logs from 'aws-cdk-lib/aws-logs';

export class ApplicationStack extends cdk.Stack {
  public readonly mediaBucket: s3.IBucket;
  public readonly assetBucket: s3.IBucket;
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClientId: string;
  public readonly identityPoolId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    const prefix = scope.node.tryGetContext('prefix') || '';
    const stackName = `${prefix}-application-stack`;
    super(scope, id, { ...props, stackName });

    // parameters for persistent resources and optional prefix
    const mediaBucketNameParam = new cdk.CfnParameter(this, 'MediaBucketName', {
      type: 'String',
      description: 'Name of the media bucket from PersistentStack',
    });
    const assetBucketNameParam = new cdk.CfnParameter(this, 'AssetBucketName', {
      type: 'String',
      description: 'Name of the asset bucket from PersistentStack',
    });
    const userPoolIdParam = new cdk.CfnParameter(this, 'UserPoolId', {
      type: 'String',
      description: 'ID of the Cognito User Pool from PersistentStack',
    });
    const identityPoolIdParam = new cdk.CfnParameter(this, 'IdentityPoolId', {
      type: 'String',
      description: 'ID of the Cognito Identity Pool from PersistentStack',
    });
    const apiKeyParam = new cdk.CfnParameter(this, 'ApiKey', {
      type: 'String',
      default: '',
      description: 'API key for Media API (optional)',
    });
    const lambdaVersionKeyParam = new cdk.CfnParameter(this, 'LambdaVersionKey', {
      type: 'String',
      default: 'v1',
      description: 'Version key to force lambda redeploys',
    });
    const domainNameParam = new cdk.CfnParameter(this, 'DomainName', {
      type: 'String',
      default: '',
      description: 'Optional alternate domain for CloudFront',
    });
    const certificateArnParam = new cdk.CfnParameter(this, 'CertificateArn', {
      type: 'String',
      default: '',
      description: 'ACM certificate ARN when supplying domainName',
    });

    const mediaBucketName = mediaBucketNameParam.valueAsString;
    const assetBucketName = assetBucketNameParam.valueAsString;
    const userPoolId = userPoolIdParam.valueAsString;
    const identityPoolId = identityPoolIdParam.valueAsString;
    const apiKeyVal = apiKeyParam.valueAsString || 'test-api-key';
    const lambdaVersionKey = lambdaVersionKeyParam.valueAsString;
    const domainName = domainNameParam.valueAsString || undefined;
    const certificateArn = certificateArnParam.valueAsString || undefined;

    const withPrefix = (name: string) => (prefix ? `${prefix}-${name}` : name);

    // import resources
    this.mediaBucket = s3.Bucket.fromBucketName(this, 'MediaBucket', mediaBucketName);
    this.assetBucket = s3.Bucket.fromBucketName(this, 'AssetBucket', assetBucketName);
    this.userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', userPoolId);
    this.identityPoolId = identityPoolId;

    let api: apigateway.RestApi | undefined;
    // rest of the stack is same as original CdkStack but replacing references accordingly
    const awsSdkLayer = new lambda.LayerVersion(this, 'AwsSdkLayer', {
      layerVersionName: withPrefix('lambda-layer'),
      code: lambda.Code.fromAsset('lambda/layers/aws-sdk-layer'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      description: 'Optional AWS SDK v2 layer for functions that rely on require("aws-sdk")',
    });

    const listLambda = new lambda.Function(this, 'ListHandler', {
      functionName: withPrefix('list-handler'),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/list'),
      environment: {
        BUCKET: this.mediaBucket.bucketName,
        IDENTITY_POOL_ID: this.identityPoolId,
        USER_POOL_ID: userPoolId,
        VID: lambdaVersionKey,
      },
      layers: [awsSdkLayer],
    });

    this.mediaBucket.grantRead(listLambda);

    api = new apigateway.RestApi(this, 'MediaApi', {
      restApiName: withPrefix('media-api'),
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
    });

    const apiKey = new apigateway.ApiKey(this, 'GwApiKey', {
      apiKeyName: withPrefix('api-key'),
      value: apiKeyVal,
    });
    const usagePlan = api.addUsagePlan('UsagePlan', { name: withPrefix('usage-plan') });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [this.userPool],
    });

    const listIntegration = new apigateway.LambdaIntegration(listLambda);
    const apiResource = api.root.addResource('api');

    const listPathResource = apiResource.addResource('list');
    listPathResource.addMethod('GET', listIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
      apiKeyRequired: true,
    });

    const health = apiResource.addResource('healthcheck');
    health.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{ statusCode: '200' }],
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), {
      methodResponses: [{ statusCode: '200' }],
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    let additionalBehaviors: Record<string, cloudfront.BehaviorOptions> | undefined;
    if (api) {
      const apiOrigin = new origins.RestApiOrigin(api, {
        customHeaders: { 'x-api-key': apiKeyVal },
      });
      const commonBehavior: Partial<cloudfront.BehaviorOptions> = {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
      };
      additionalBehaviors = {
        'api/*': { origin: apiOrigin, ...commonBehavior },
      };
    }

    const distributionProps: cloudfront.DistributionProps = {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.assetBucket as s3.Bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors,
      domainNames: domainName ? [domainName] : undefined,
      certificate: certificateArn ? acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn) : undefined,
      defaultRootObject: 'index.html',
    };

    const distribution = new cloudfront.Distribution(this, 'Distribution', distributionProps);
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.domainName });
  }
}
