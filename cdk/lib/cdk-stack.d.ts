import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
export interface CdkStackProps extends cdk.StackProps {
    stackName?: string;
    /** optional prefix applied to names of resources */
    prefix?: string;
    /** when true the example lambda and API are not created (useful for unit tests) */
    disableLambda?: boolean;
    lambdaVersionKey?: string;
    /** optional alternate domain for the CloudFront distribution */
    domainName?: string;
    /** if providing a domain name, you can optionally pass an ACM certificate ARN */
    certificateArn?: string;
}
export declare class CdkStack extends cdk.Stack {
    readonly userPool: cognito.UserPool;
    readonly userPoolClient: cognito.UserPoolClient;
    readonly bucket: s3.Bucket;
    constructor(scope: Construct, id: string, props?: CdkStackProps);
}
