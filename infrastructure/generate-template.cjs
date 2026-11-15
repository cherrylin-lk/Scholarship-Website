// Produces a reviewable AWS SAM template. This script creates files, not AWS resources.
const fs = require('node:fs');
const path = require('node:path');
const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const arn = name => ({ 'Fn::GetAtt': [name, 'Arn'] });
const resources = {};
function table(name, keys, indexes = []) {
  resources[name] = {
    Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
    Properties: {
      BillingMode: 'PAY_PER_REQUEST', SSESpecification: { SSEEnabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      AttributeDefinitions: [...new Set([...keys, ...indexes.map(i => i[1])])].map(AttributeName => ({ AttributeName, AttributeType: 'S' })),
      KeySchema: keys.map((AttributeName, index) => ({ AttributeName, KeyType: index ? 'RANGE' : 'HASH' })),
      ...(indexes.length ? { GlobalSecondaryIndexes: indexes.map(([IndexName, key]) => ({ IndexName,
        KeySchema: [{ AttributeName: key, KeyType: 'HASH' }, { AttributeName: 'id', KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } })) } : {}),
    },
  };
}
table('UsersTable', ['userId']);
table('ScholarshipsTable', ['id'], [['StatusIndex', 'approvalStatus'], ['OwnerIndex', 'ownerId']]);
table('ActivityTable', ['userId', 'recordKey']);
table('NotificationsTable', ['userId', 'id']);
table('DocumentsTable', ['id']);
resources.DocumentBucket = {
  Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
  Properties: {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
    BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
    VersioningConfiguration: { Status: 'Enabled' },
    CorsConfiguration: { CorsRules: [{ AllowedOrigins: [ref('FrontendOrigin')], AllowedMethods: ['GET', 'POST'], AllowedHeaders: ['Content-Type'], MaxAge: 300 }] },
  },
};
resources.DocumentBucketPolicy = { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: ref('DocumentBucket'), PolicyDocument: { Version: '2012-10-17', Statement: [
  { Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [arn('DocumentBucket'), sub('${DocumentBucket.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
] } } };
for (const [id, suffix] of [['ApiLogs', 'api'], ['ProvisionLogs', 'provision']]) resources[id] = {
  Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: sub(`/aws/lambda/\${AWS::StackName}-${suffix}`), RetentionInDays: 14 },
};
resources.AccessLogs = { Type: 'AWS::Logs::LogGroup', Properties: { RetentionInDays: 14 } };
const assume = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] };
const statement = (Action, Resource) => ({ Effect: 'Allow', Action, Resource });
const logStatement = suffix => statement(['logs:CreateLogStream', 'logs:PutLogEvents'], sub(`arn:\${AWS::Partition}:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:/aws/lambda/\${AWS::StackName}-${suffix}:*`));
resources.ApiRole = { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: assume, Policies: [{ PolicyName: 'ApplicationData', PolicyDocument: { Version: '2012-10-17', Statement: [
  logStatement('api'),
  statement(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan'], [arn('UsersTable')]),
  statement(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan'], [arn('ScholarshipsTable')]),
  statement(['dynamodb:Query'], [sub('${ScholarshipsTable.Arn}/index/StatusIndex'), sub('${ScholarshipsTable.Arn}/index/OwnerIndex')]),
  statement(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:Query'], [arn('ActivityTable')]),
  statement(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'], [arn('NotificationsTable')]),
  statement(['dynamodb:GetItem', 'dynamodb:PutItem'], [arn('DocumentsTable')]),
  statement(['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion'], [sub('${DocumentBucket.Arn}/universities/*')]),
] } }] } };
resources.ProvisionRole = { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: assume, Policies: [{ PolicyName: 'StudentProvisioningOnly', PolicyDocument: { Version: '2012-10-17', Statement: [logStatement('provision'), statement(['dynamodb:PutItem'], [arn('UsersTable')])] } }] } };
resources.ProvisionFunction = {
  Type: 'AWS::Serverless::Function', DependsOn: 'ProvisionLogs', Properties: {
    FunctionName: sub('${AWS::StackName}-provision'), CodeUri: '../backend/', Handler: 'scholarrise.provision.lambda_handler', Role: arn('ProvisionRole'),
    Environment: { Variables: { USERS_TABLE: ref('UsersTable') } },
  },
};
// Permission belongs to the new Lambda only. Attaching it to the existing pool
// is a separate, later console action; this stack never updates Cognito.
resources.ProvisionPermission = { Type: 'AWS::Lambda::Permission', Properties: {
  Action: 'lambda:InvokeFunction', FunctionName: ref('ProvisionFunction'), Principal: 'cognito-idp.amazonaws.com',
  SourceArn: sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/${ExistingUserPoolId}'),
  SourceAccount: ref('AWS::AccountId'),
} };
resources.HttpApi = { Type: 'AWS::Serverless::HttpApi', Properties: {
  StageName: '$default', CorsConfiguration: { AllowOrigins: [ref('FrontendOrigin')], AllowHeaders: ['authorization', 'content-type'], AllowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], MaxAge: 300 },
  DefaultRouteSettings: { ThrottlingBurstLimit: 20, ThrottlingRateLimit: 10 },
  AccessLogSettings: { DestinationArn: arn('AccessLogs'), Format: '{"requestId":"$context.requestId","routeKey":"$context.routeKey","status":"$context.status","responseLength":"$context.responseLength"}' },
  Auth: { DefaultAuthorizer: 'CognitoJwt', Authorizers: { CognitoJwt: { IdentitySource: '$request.header.Authorization',
    JwtConfiguration: { issuer: sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${ExistingUserPoolId}'), audience: [ref('ExistingUserPoolClientId')] },
    // Scope confirms the managed-login access-token flow; it grants no staff role.
    AuthorizationScopes: ['openid'],
  } } },
} };
const apiEvent = (Path, Method, open = false) => ({ Type: 'HttpApi', Properties: { ApiId: ref('HttpApi'), Path, Method, PayloadFormatVersion: '2.0', ...(open ? { Auth: { Authorizer: 'NONE' } } : {}) } });
resources.ApiFunction = { Type: 'AWS::Serverless::Function', DependsOn: 'ApiLogs', Properties: {
  FunctionName: sub('${AWS::StackName}-api'), CodeUri: '../backend/', Handler: 'scholarrise.handler.lambda_handler', Role: arn('ApiRole'), ReservedConcurrentExecutions: 5,
  Environment: { Variables: {
    USERS_TABLE: ref('UsersTable'), SCHOLARSHIPS_TABLE: ref('ScholarshipsTable'), ACTIVITY_TABLE: ref('ActivityTable'),
    NOTIFICATIONS_TABLE: ref('NotificationsTable'), DOCUMENTS_TABLE: ref('DocumentsTable'), DOCUMENT_BUCKET: ref('DocumentBucket'),
    COGNITO_ISSUER: sub('https://cognito-idp.${AWS::Region}.amazonaws.com/${ExistingUserPoolId}'), COGNITO_CLIENT_ID: ref('ExistingUserPoolClientId'),
  } },
  Events: { Health: apiEvent('/health', 'GET', true), Search: apiEvent('/scholarships', 'GET', true), Detail: apiEvent('/scholarships/{id}', 'GET', true), Private: apiEvent('/{proxy+}', 'ANY') },
} };
resources.ApiErrorAlarm = { Type: 'AWS::CloudWatch::Alarm', Properties: {
  AlarmDescription: 'Inspect CloudWatch when Lambda errors occur. No SNS integration.', Namespace: 'AWS/Lambda', MetricName: 'Errors',
  Dimensions: [{ Name: 'FunctionName', Value: ref('ApiFunction') }], Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 1, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching',
} };
resources.ApiHttpErrorAlarm = { Type: 'AWS::CloudWatch::Alarm', Properties: {
  AlarmDescription: 'HTTP API server errors, including handled Lambda 500 responses. No SNS action.',
  Namespace: 'AWS/ApiGateway', MetricName: '5xx',
  Dimensions: [{ Name: 'ApiId', Value: ref('HttpApi') }, { Name: 'Stage', Value: '$default' }],
  Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 1,
  ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching',
} };
const output = {
  AWSTemplateFormatVersion: '2010-09-09', Transform: 'AWS::Serverless-2016-10-31',
  Description: 'ScholarRise backend foundation. Review before any deployment. No resources are created by generating this file.',
  Parameters: {
    FrontendOrigin: { Type: 'String', Default: 'https://main.d1s9suck9hx25r.amplifyapp.com',
      Description: 'Exact HTTPS Amplify origin without trailing slash; loopback allowed for local development.',
      AllowedPattern: '^https://[A-Za-z0-9.-]+$|^http://(localhost|127\\.0\\.0\\.1):5173$' },
    ExistingUserPoolId: { Type: 'String', Default: 'ap-southeast-2_ONSDhlqBo', AllowedValues: ['ap-southeast-2_ONSDhlqBo'],
      Description: 'Existing ScholarRise pool in the deployment account and ap-southeast-2. Never created or updated by this stack.' },
    ExistingUserPoolClientId: { Type: 'String', Default: '4tdlqbsg2jrr3qvbj5atjh7qig', AllowedValues: ['4tdlqbsg2jrr3qvbj5atjh7qig'],
      Description: 'Existing public SPA client. Existing managed-login settings remain unchanged.' },
  },
  Rules: { SydneyOnly: { Assertions: [{ Assert: { 'Fn::Equals': [ref('AWS::Region'), 'ap-southeast-2'] },
    AssertDescription: 'Deploy this existing-pool backend only in ap-southeast-2.' }] } },
  Globals: { Function: { Runtime: 'python3.13', Architectures: ['x86_64'], MemorySize: 256, Timeout: 20 } },
  Resources: resources,
  Outputs: { ApiUrl: { Value: sub('https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com') },
    UserPoolId: { Value: ref('ExistingUserPoolId') }, UserPoolClientId: { Value: ref('ExistingUserPoolClientId') },
    ProvisionFunctionArn: { Value: arn('ProvisionFunction'), Description: 'Optional post-confirmation trigger: attach to the existing pool only after approval.' },
    Region: { Value: ref('AWS::Region') }, DocumentBucketName: { Value: ref('DocumentBucket') },
    ...Object.fromEntries(['Users', 'Scholarships', 'Activity', 'Notifications', 'Documents'].map(n => [`${n}TableName`, { Value: ref(`${n}Table`) }])),
  },
};
fs.writeFileSync(path.join(__dirname, 'template.json'), JSON.stringify(output, null, 2) + '\n');
