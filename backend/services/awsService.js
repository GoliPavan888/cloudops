import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  IAMClient,
  ListUsersCommand,
  ListRolesCommand,
  ListGroupsCommand,
  GetUserCommand,
  GetLoginProfileCommand,
  ListMFADevicesCommand,
  ListGroupsForUserCommand,
  ListAttachedUserPoliciesCommand,
  ListUserPoliciesCommand,
  ListAccessKeysCommand,
  ListAttachedGroupPoliciesCommand,
  ListGroupPoliciesCommand,
  GetUserPolicyCommand,
  GetGroupPolicyCommand,
  GetAccessKeyLastUsedCommand,
  GetPolicyVersionCommand,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
  ListAccountAliasesCommand,
} from "@aws-sdk/client-iam";
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketTaggingCommand,
  GetBucketEncryptionCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetBucketAclCommand,
  GetPublicAccessBlockCommand,
  GetBucketLoggingCommand,
  GetBucketReplicationCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketOwnershipControlsCommand,
} from "@aws-sdk/client-s3";
import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  GetFunctionUrlConfigCommand,
  ListEventSourceMappingsCommand,
  GetPolicyCommand,
  ListTagsCommand,
} from "@aws-sdk/client-lambda";
import { DynamoDBClient, ListTablesCommand, DescribeTableCommand, ListTagsOfResourceCommand } from "@aws-sdk/client-dynamodb";
import {
  SQSClient,
  ListQueuesCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueueTagsCommand,
} from "@aws-sdk/client-sqs";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { SecurityHubClient, GetFindingsCommand } from "@aws-sdk/client-securityhub";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";

const OWNER_TAG_KEYS = ["owner", "Owner", "createdBy", "CreatedBy", "created-by", "user", "User"];

function findOwnerFromTags(tags = []) {
  const ownerTag = tags.find((t) => OWNER_TAG_KEYS.includes(t.Key));
  return ownerTag?.Value || null;
}

function monthRange() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function deriveEnvironmentType({ accountAlias = "", roleName = "", accountId = "" } = {}) {
  const candidate = `${accountAlias} ${roleName} ${accountId}`.toLowerCase();

  if (/(security|secops|guard|audit|log[-_ ]archive)/.test(candidate)) return "Security";
  if (/(prod|production|live|main|core)/.test(candidate)) return "Production";
  if (/(sandbox|lab|test|qa|dev|development|demo|uat|stage|staging)/.test(candidate)) return "Sandbox";
  if (/(engineering|builder|nonprod|shared-services|shared services)/.test(candidate)) return "Development";

  return "Development";
}

function extractRoleName(roleArn = "", assumedRoleArn = "") {
  const fromArn = roleArn.split("/").pop();
  if (fromArn && fromArn !== roleArn) return fromArn;

  const assumedMatch = assumedRoleArn.match(/assumed-role\/([^/]+)\//i);
  return assumedMatch?.[1] || "UnknownRole";
}

export const connectAWS = async (req, res) => {
  try {
    const { roleArn } = req.body;
    if (!roleArn) {
      return res.status(400).json({ success: false, message: "Role ARN required" });
    }

    const scanRegion = process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";

    const stsConfig = { region: scanRegion };
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      stsConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }

    const stsClient = new STSClient(stsConfig);
    const assumedRole = await stsClient.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: "AWSScannerSession",
      })
    );

    const credentials = {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken,
    };

    const identityStsClient = new STSClient({ region: scanRegion, credentials });
    const identityIamClient = new IAMClient({ region: scanRegion, credentials });

    const [callerIdentity, accountAliases] = await Promise.all([
      identityStsClient.send(new GetCallerIdentityCommand({})),
      identityIamClient.send(new ListAccountAliasesCommand({})).catch(() => ({ AccountAliases: [] })),
    ]);

    const accountAlias = accountAliases.AccountAliases?.[0] || "";
    const assumedRoleArn = callerIdentity.Arn || "";
    const roleName = extractRoleName(roleArn, assumedRoleArn);
    const environmentType = deriveEnvironmentType({ accountAlias, roleName, accountId });
    const connectionHealth = callerIdentity.Account === accountId ? "Connected" : "Identity Mismatch";

    const iamClient = new IAMClient({ region: scanRegion, credentials });
    const s3Client = new S3Client({ region: scanRegion, credentials });
    const ec2Client = new EC2Client({ region: scanRegion, credentials });
    const rdsClient = new RDSClient({ region: scanRegion, credentials });
    const lambdaClient = new LambdaClient({ region: scanRegion, credentials });
    const dynamoClient = new DynamoDBClient({ region: scanRegion, credentials });
    const sqsClient = new SQSClient({ region: scanRegion, credentials });
    const logsClient = new CloudWatchLogsClient({ region: scanRegion, credentials });
    const ceClient = new CostExplorerClient({ region: "us-east-1", credentials });
    const securityHubClient = new SecurityHubClient({ region: scanRegion, credentials });

    const users = [];
    let userMarker;
    do {
      const page = await iamClient.send(new ListUsersCommand({ Marker: userMarker }));
      (page.Users || []).forEach((u) => {
        users.push({
          userName: u.UserName,
          arn: u.Arn,
          createdAt: u.CreateDate,
          userId: u.UserId,
        });
      });
      userMarker = page.IsTruncated ? page.Marker : undefined;
    } while (userMarker);

    const resources = [];

    try {
      const s3 = await s3Client.send(new ListBucketsCommand({}));
      for (const b of s3.Buckets || []) {
        let bucketRegion = scanRegion;
        let bucketTags = [];

        try {
          const loc = await s3Client.send(new GetBucketLocationCommand({ Bucket: b.Name }));
          bucketRegion = loc.LocationConstraint || "us-east-1";
        } catch {
          bucketRegion = scanRegion;
        }

        try {
          const tagsResp = await s3Client.send(new GetBucketTaggingCommand({ Bucket: b.Name }));
          bucketTags = tagsResp.TagSet || [];
        } catch {
          bucketTags = [];
        }

        resources.push({
          resource: b.Name,
          type: "S3 Bucket",
          service: "S3",
          region: bucketRegion,
          arn: `arn:aws:s3:::${b.Name}`,
          tags: bucketTags,
          owner: findOwnerFromTags(bucketTags),
        });
      }
    } catch (e) {
      console.warn("S3 scan failed:", e.message);
    }

    const ec2Instances = [];

    try {
      let nextToken;
      do {
        const ec2 = await ec2Client.send(new DescribeInstancesCommand({ NextToken: nextToken }));
        (ec2.Reservations || []).forEach((r) => {
          (r.Instances || []).forEach((i) => {
            const tags = i.Tags || [];
            const name = tags.find((t) => t.Key === "Name")?.Value || i.InstanceId;
            const instance = {
              resource: name,
              type: "EC2 Instance",
              service: "EC2",
              region: i.Placement?.AvailabilityZone || scanRegion,
              arn: i.InstanceId,
              tags,
              owner: findOwnerFromTags(tags),
              status: i.State?.Name || "unknown",
              instanceName: name,
              instanceId: i.InstanceId,
              state: i.State?.Name || "unknown",
              instanceType: i.InstanceType || "unknown",
              amiId: i.ImageId || "unknown",
              platform: i.PlatformDetails || i.Platform || "Linux/UNIX",
              region: i.Placement?.AvailabilityZone ? i.Placement.AvailabilityZone.slice(0, -1) : scanRegion,
              availabilityZone: i.Placement?.AvailabilityZone || scanRegion,
              launchTime: i.LaunchTime,
              uptimeHours: i.LaunchTime ? Math.max(0, Math.floor((Date.now() - new Date(i.LaunchTime).getTime()) / 36e5)) : 0,
            };
            resources.push(instance);
            ec2Instances.push(instance);
          });
        });
        nextToken = ec2.NextToken;
      } while (nextToken);
    } catch (e) {
      console.warn("EC2 scan failed:", e.message);
    }

    try {
      let marker;
      do {
        const rds = await rdsClient.send(new DescribeDBInstancesCommand({ Marker: marker }));
        (rds.DBInstances || []).forEach((db) => {
          resources.push({
            resource: db.DBInstanceIdentifier,
            type: "RDS Instance",
            service: "RDS",
            region: db.AvailabilityZone || scanRegion,
            arn: db.DBInstanceArn,
            tags: [],
            owner: null,
            status: db.DBInstanceStatus || "unknown",
          });
        });
        marker = rds.Marker;
      } while (marker);
    } catch (e) {
      console.warn("RDS scan failed:", e.message);
    }

    try {
      let marker;
      do {
        const lambdas = await lambdaClient.send(new ListFunctionsCommand({ Marker: marker }));
        (lambdas.Functions || []).forEach((fn) => {
          resources.push({
            resource: fn.FunctionName,
            type: "Lambda Function",
            service: "Lambda",
            region: fn.FunctionArn?.split(":")[3] || scanRegion,
            arn: fn.FunctionArn,
            tags: [],
            owner: null,
          });
        });
        marker = lambdas.NextMarker;
      } while (marker);
    } catch (e) {
      console.warn("Lambda scan failed:", e.message);
    }

    try {
      let startName;
      do {
        const tables = await dynamoClient.send(new ListTablesCommand({ ExclusiveStartTableName: startName }));
        (tables.TableNames || []).forEach((tableName) => {
          resources.push({
            resource: tableName,
            type: "DynamoDB Table",
            service: "DynamoDB",
            region: scanRegion,
            arn: `arn:aws:dynamodb:${scanRegion}:${accountId}:table/${tableName}`,
            tags: [],
            owner: null,
          });
        });
        startName = tables.LastEvaluatedTableName;
      } while (startName);
    } catch (e) {
      console.warn("DynamoDB scan failed:", e.message);
    }

    try {
      let nextToken;
      do {
        const queues = await sqsClient.send(new ListQueuesCommand({ NextToken: nextToken }));
        (queues.QueueUrls || []).forEach((url) => {
          resources.push({
            resource: url.split("/").pop(),
            type: "SQS Queue",
            service: "SQS",
            region: scanRegion,
            arn: url,
            tags: [],
            owner: null,
          });
        });
        nextToken = queues.NextToken;
      } while (nextToken);
    } catch (e) {
      console.warn("SQS scan failed:", e.message);
    }

    try {
      let nextToken;
      do {
        const logs = await logsClient.send(new DescribeLogGroupsCommand({ nextToken }));
        (logs.logGroups || []).forEach((g) => {
          resources.push({
            resource: g.logGroupName,
            type: "CloudWatch Log Group",
            service: "CloudWatch",
            region: scanRegion,
            arn: g.arn,
            tags: [],
            owner: null,
          });
        });
        nextToken = logs.nextToken;
      } while (nextToken);
    } catch (e) {
      console.warn("CloudWatch logs scan failed:", e.message);
    }

    try {
      let marker;
      do {
        const roles = await iamClient.send(new ListRolesCommand({ Marker: marker }));
        (roles.Roles || []).forEach((role) => {
          resources.push({
            resource: role.RoleName,
            type: "IAM Role",
            service: "IAM",
            region: "global",
            arn: role.Arn,
            tags: role.Tags || [],
            owner: findOwnerFromTags(role.Tags || []),
          });
        });
        marker = roles.IsTruncated ? roles.Marker : undefined;
      } while (marker);
    } catch (e) {
      console.warn("IAM roles scan failed:", e.message);
    }

    const resourcesByUser = {};
    users.forEach((u) => {
      resourcesByUser[u.userName] = [];
    });

    resources.forEach((resource) => {
      let assigned = false;
      if (resource.owner && resourcesByUser[resource.owner]) {
        resourcesByUser[resource.owner].push(resource);
        assigned = true;
      }

      if (!assigned) {
        for (const user of users) {
          if (
            resource.resource &&
            user.userName &&
            resource.resource.toLowerCase().includes(user.userName.toLowerCase())
          ) {
            resourcesByUser[user.userName].push(resource);
            assigned = true;
            break;
          }
        }
      }
    });

    const serviceBreakdown = resources.reduce((acc, r) => {
      acc[r.service] = (acc[r.service] || 0) + 1;
      return acc;
    }, {});

    const costTrend = [];
    try {
      const range = monthRange();
      const cost = await ceClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: range.start, End: range.end },
          Granularity: "MONTHLY",
          Metrics: ["UnblendedCost"],
        })
      );
      (cost.ResultsByTime || []).forEach((row) => {
        costTrend.push({
          month: row.TimePeriod?.Start,
          amount: Number(row.Total?.UnblendedCost?.Amount || 0),
          unit: row.Total?.UnblendedCost?.Unit || "USD",
        });
      });
    } catch (e) {
      console.warn("Cost explorer scan failed:", e.message);
    }

    // SecurityHub findings (requires SecurityHub to be enabled in account)
    const securityFindings = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };

    const uniqueRegions = new Set(resources.map((r) => r.region).filter(Boolean));

    return res.json({
      success: true,
      message: "AWS Connected Successfully",
      account: {
        roleArn,
        accountId,
        accountAlias,
        region: scanRegion,
        roleName,
        assumedRoleArn,
        userId: callerIdentity.UserId || null,
        environmentType,
        connectionHealth,
      },
      users,
      ec2Instances,
      resources,
      resourcesByUser,
      metrics: {
        totalUsers: users.length,
        totalResources: resources.length,
        activeRegions: uniqueRegions.size,
        serviceBreakdown,
        costTrend,
        securityFindings,
        lastScanAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Helper to assume role and create commonly used clients
async function assumeRoleAndClients(roleArn, region = process.env.AWS_REGION || "us-east-1") {
  const stsConfig = { region };
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    stsConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  const stsClient = new STSClient(stsConfig);
  const assumedRole = await stsClient.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "AWSScannerSession" })
  );

  const credentials = {
    accessKeyId: assumedRole.Credentials.AccessKeyId,
    secretAccessKey: assumedRole.Credentials.SecretAccessKey,
    sessionToken: assumedRole.Credentials.SessionToken,
  };

  const clients = {
    iamClient: new IAMClient({ region, credentials }),
    ec2Client: new EC2Client({ region, credentials }),
    s3Client: new S3Client({ region, credentials }),
    rdsClient: new RDSClient({ region, credentials }),
    lambdaClient: new LambdaClient({ region, credentials }),
    logsClient: new CloudWatchLogsClient({ region, credentials }),
    cloudwatchClient: new CloudWatchClient({ region, credentials }),
    cloudtrailClient: new CloudTrailClient({ region, credentials }),
    dynamoClient: new DynamoDBClient({ region, credentials }),
    sqsClient: new SQSClient({ region, credentials }),
    ceClient: new CostExplorerClient({ region: "us-east-1", credentials }),
    securityHubClient: new SecurityHubClient({ region, credentials }),
  };

  return clients;
}

// S3 handlers
function normalizeTags(tags = []) {
  return tags.map((tag) => ({ key: tag.Key, value: tag.Value }));
}

function getTagValue(tags = [], keys = []) {
  const found = tags.find((tag) => keys.includes(String(tag.Key || "")));
  return found?.Value || null;
}

function parsePolicy(policyText) {
  if (!policyText) return null;
  try {
    return typeof policyText === "string" ? JSON.parse(policyText) : policyText;
  } catch {
    return null;
  }
}

function detectPolicyIssues(policy, accountId, bucketName) {
  const statements = Array.isArray(policy?.Statement) ? policy.Statement : policy?.Statement ? [policy.Statement] : [];
  const publicStatements = [];
  const crossAccountStatements = [];

  statements.forEach((statement) => {
    const principal = statement.Principal;
    const effect = String(statement.Effect || "").toLowerCase();
    if (effect !== "allow") return;
    const principalText = JSON.stringify(principal || "");
    const actionText = JSON.stringify(statement.Action || "");
    const publicPrincipal = principal === "*" || principalText.includes('"*"') || principalText.toLowerCase().includes("allusers");
    if (publicPrincipal) {
      publicStatements.push({ effect: statement.Effect, action: statement.Action, sid: statement.Sid || null });
      return;
    }
    if (principalText.includes("arn:aws:iam::") && !principalText.includes(`arn:aws:iam::${accountId}:`)) {
      crossAccountStatements.push({ effect: statement.Effect, action: statement.Action, sid: statement.Sid || null });
    }
    if (actionText.includes("s3:PutBucketPolicy") || actionText.includes("s3:DeleteBucketPolicy")) {
      crossAccountStatements.push({ effect: statement.Effect, action: statement.Action, sid: statement.Sid || null });
    }
  });

  return {
    publicPolicy: publicStatements.length > 0,
    publicStatements,
    crossAccountAccess: crossAccountStatements.length > 0,
    crossAccountStatements,
    anonymousAccess: publicStatements.length > 0,
    internetExposure: publicStatements.length > 0,
  };
}

function analyzeAcl(acl, accountId) {
  const grants = acl?.Grants || [];
  const publicGrants = [];
  const crossAccountGrants = [];

  grants.forEach((grant) => {
    const grantee = grant.Grantee || {};
    const uri = String(grantee.URI || "");
    const id = String(grantee.ID || "");
    const type = String(grantee.Type || "");
    const isPublic = uri.includes("AllUsers") || uri.includes("AuthenticatedUsers");
    const isCrossAccount = type === "CanonicalUser" && id && accountId && !id.includes(accountId);
    if (isPublic) publicGrants.push({ permission: grant.Permission, grantee: uri || id || type });
    if (isCrossAccount) crossAccountGrants.push({ permission: grant.Permission, grantee: id || uri || type });
  });

  return {
    publicACL: publicGrants.length > 0,
    publicGrants,
    crossAccountAccess: crossAccountGrants.length > 0,
    crossAccountGrants,
  };
}

function analyzeEncryption(encryptionConfig) {
  const rules = encryptionConfig?.Rules || [];
  const rule = rules[0] || null;
  const serverSideEncryption = rule?.ApplyServerSideEncryptionByDefault || null;
  return {
    encryptionEnabled: Boolean(serverSideEncryption),
    sseType: serverSideEncryption?.SSEAlgorithm || null,
    kmsKeyInfo: serverSideEncryption?.KMSMasterKeyID || null,
    raw: encryptionConfig || null,
  };
}

function analyzeLogging(logging) {
  return {
    loggingEnabled: Boolean(logging?.LoggingEnabled),
    targetBucket: logging?.LoggingEnabled?.TargetBucket || null,
    targetPrefix: logging?.LoggingEnabled?.TargetPrefix || null,
    raw: logging || null,
  };
}

function analyzeVersioning(versioning) {
  return {
    versioningEnabled: versioning?.Status === "Enabled",
    mfaDelete: versioning?.MFADelete || null,
    raw: versioning || null,
  };
}

function analyzeReplication(replication) {
  return {
    replicationEnabled: Boolean(replication?.ReplicationConfiguration),
    rules: replication?.ReplicationConfiguration?.Rules || [],
    raw: replication || null,
  };
}

function analyzeLifecycle(lifecycle) {
  return {
    lifecycleEnabled: Boolean(lifecycle?.Rules?.length),
    rules: lifecycle?.Rules || [],
    raw: lifecycle || null,
  };
}

function scoreSecurity(signals) {
  let score = 100;
  if (signals.publicACL) score -= 30;
  if (signals.publicPolicy) score -= 30;
  if (signals.encryptionEnabled === false) score -= 15;
  if (signals.versioningEnabled === false) score -= 8;
  if (signals.loggingEnabled === false) score -= 5;
  if (signals.replicationEnabled === false) score -= 2;
  if (signals.crossAccountAccess) score -= 10;
  score = Math.max(0, Math.min(100, score));

  let severity = "Low";
  if (score < 40) severity = "Critical";
  else if (score < 60) severity = "High";
  else if (score < 80) severity = "Medium";

  return { score, severity };
}

function rateStorageUSD(region = "us-east-1") {
  const regionRates = {
    "us-east-1": 0.023,
    "us-east-2": 0.023,
    "us-west-1": 0.026,
    "us-west-2": 0.023,
  };
  return regionRates[region] || 0.023;
}

function buildCostEstimate(summary) {
  const sizeGb = (summary.totalStorageSizeBytes || 0) / (1024 * 1024 * 1024);
  const storageRate = rateStorageUSD(summary.region);
  const storageCost = sizeGb * storageRate;
  const requestCost = ((summary.requestCounts?.allRequests || 0) / 1000) * 0.0004;
  const transferCost = ((summary.dataTransferBytes || 0) / (1024 * 1024 * 1024)) * 0.09;
  const lifecycleSavings = summary.lifecycleEnabled ? storageCost * 0.15 : 0;
  return {
    estimatedMonthlyStorageCost: storageCost,
    requestCost,
    transferCost,
    lifecycleSavings,
    estimatedMonthlyTotal: Math.max(0, storageCost + requestCost + transferCost - lifecycleSavings),
  };
}

function buildCompliance(summary) {
  const violations = [];
  if (summary.publicACL || summary.publicPolicy) violations.push("Public exposure detected");
  if (!summary.encryptionEnabled) violations.push("Encryption disabled");
  if (!summary.versioningEnabled) violations.push("Versioning disabled");
  if (!summary.loggingEnabled) violations.push("Logging disabled");
  if (summary.publicPolicy || summary.publicACL) violations.push("Open permissions");
  return {
    compliant: violations.length === 0,
    status: violations.length === 0 ? "Compliant" : violations.length >= 3 ? "Non-Compliant" : "At Risk",
    violations,
  };
}

function toEventIdentity(event) {
  const identity = event?.CloudTrailEvent ? safeParseEvent(event.CloudTrailEvent) : null;
  const userIdentity = identity?.userIdentity || {};
  return {
    createdBy: userIdentity.arn || userIdentity.userName || event?.Username || null,
    assumedRole: userIdentity.sessionContext?.sessionIssuer?.arn || null,
    sourceIp: identity?.sourceIPAddress || null,
    userAgent: identity?.userAgent || null,
    eventName: identity?.eventName || event?.EventName || null,
    eventTime: identity?.eventTime || event?.EventTime || null,
    userIdentityType: userIdentity.type || null,
  };
}

function safeParseEvent(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

async function collectS3Metrics(cloudwatchClient, bucket, days = 30) {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 3600 * 1000);
  const queries = [
    { Id: "numObj", MetricStat: { Metric: { Namespace: "AWS/S3", MetricName: "NumberOfObjects", Dimensions: [{ Name: "BucketName", Value: bucket }, { Name: "StorageType", Value: "AllStorageTypes" }] }, Period: 86400, Stat: "Average" } },
    { Id: "sizeBytes", MetricStat: { Metric: { Namespace: "AWS/S3", MetricName: "BucketSizeBytes", Dimensions: [{ Name: "BucketName", Value: bucket }, { Name: "StorageType", Value: "StandardStorage" }] }, Period: 86400, Stat: "Average" } },
    { Id: "allRequests", MetricStat: { Metric: { Namespace: "AWS/S3", MetricName: "AllRequests", Dimensions: [{ Name: "BucketName", Value: bucket }, { Name: "FilterId", Value: "EntireBucket" }] }, Period: 86400, Stat: "Sum" } },
    { Id: "getRequests", MetricStat: { Metric: { Namespace: "AWS/S3", MetricName: "GetRequests", Dimensions: [{ Name: "BucketName", Value: bucket }, { Name: "FilterId", Value: "EntireBucket" }] }, Period: 86400, Stat: "Sum" } },
    { Id: "putRequests", MetricStat: { Metric: { Namespace: "AWS/S3", MetricName: "PutRequests", Dimensions: [{ Name: "BucketName", Value: bucket }, { Name: "FilterId", Value: "EntireBucket" }] }, Period: 86400, Stat: "Sum" } },
    { Id: "bytesDownloaded", MetricStat: { Metric: { Namespace: "AWS/S3", MetricName: "BytesDownloaded", Dimensions: [{ Name: "BucketName", Value: bucket }, { Name: "FilterId", Value: "EntireBucket" }] }, Period: 86400, Stat: "Sum" } },
    { Id: "bytesUploaded", MetricStat: { Metric: { Namespace: "AWS/S3", MetricName: "BytesUploaded", Dimensions: [{ Name: "BucketName", Value: bucket }, { Name: "FilterId", Value: "EntireBucket" }] }, Period: 86400, Stat: "Sum" } },
  ];

  const metricData = {};
  try {
    const resp = await cloudwatchClient.send(new GetMetricDataCommand({ StartTime: start, EndTime: end, MetricDataQueries: queries, ScanBy: "TimestampDescending" }));
    (resp.MetricDataResults || []).forEach((result) => {
      metricData[result.Id] = {
        timestamps: result.Timestamps || [],
        values: result.Values || [],
      };
    });
  } catch (e) {
    console.warn(`S3 metrics scan failed for ${bucket}:`, e.message);
  }

  return metricData;
}

async function collectS3Activity(cloudtrailClient, bucket, limit = 100) {
  const activities = [];
  try {
    let nextToken;
    do {
      const resp = await cloudtrailClient.send(
        new LookupEventsCommand({
          LookupAttributes: [{ AttributeKey: "ResourceName", AttributeValue: bucket }],
          NextToken: nextToken,
          MaxResults: Math.min(limit, 50),
        })
      );
      (resp.Events || []).forEach((event) => {
        const parsed = safeParseEvent(event.CloudTrailEvent);
        const identity = parsed?.userIdentity || {};
        activities.push({
          eventId: event.EventId,
          eventName: event.EventName,
          eventTime: event.EventTime,
          username: event.Username || identity.userName || identity.arn || null,
          sourceIp: parsed?.sourceIPAddress || null,
          userAgent: parsed?.userAgent || null,
          assumedRole: identity.sessionContext?.sessionIssuer?.arn || null,
          eventCategory: parsed?.eventCategory || null,
          requestParameters: parsed?.requestParameters || null,
          resources: event.Resources || [],
          cloudTrailEvent: parsed,
        });
      });
      nextToken = resp.NextToken;
    } while (nextToken && activities.length < limit);
  } catch (e) {
    console.warn(`CloudTrail lookup failed for ${bucket}:`, e.message);
  }
  return activities;
}

async function summarizeBucket(clients, bucketInfo, accountId, region) {
  const bucket = bucketInfo.Name;
  const summary = {
    name: bucket,
    arn: `arn:aws:s3:::${bucket}`,
    accountId,
    region,
    creationDate: bucketInfo.CreationDate || null,
    owner: bucketInfo.Owner?.DisplayName || bucketInfo.Owner?.ID || null,
    ownerId: bucketInfo.Owner?.ID || null,
    tags: [],
    storageClass: "Unknown",
    totalStorageSizeBytes: null,
    totalObjectCount: null,
    lastModifiedTime: null,
    lastAccessedTime: null,
    publicStatus: "Unknown",
    publicAccessBlock: null,
    bucketPolicy: null,
    aclPermissions: null,
    crossAccountAccess: false,
    anonymousAccessDetection: false,
    internetExposureDetection: false,
    encryptionEnabled: false,
    sseType: null,
    kmsKeyInfo: null,
    versioningEnabled: false,
    loggingEnabled: false,
    replicationEnabled: false,
    lifecycleEnabled: false,
    accessAnalyzerFindings: [],
    securityRiskScore: 100,
    securitySeverity: "Low",
    complianceStatus: "Unknown",
    detections: [],
    requestCounts: {},
    dataTransferBytes: 0,
    metrics: {},
    activityTimeline: [],
    createdBy: null,
    sourceIp: null,
    eventName: null,
    lastModifiedBy: null,
    assumedRole: null,
    userAgent: null,
    bucketPolicyChanges: [],
    uploadDeleteActivity: [],
    permissionChanges: [],
    cost: null,
    costOptimizationSuggestions: [],
  };

  const [location, tags, encryption, policy, versioning, acl, pab, logging, replication, lifecycle, ownership, metrics, activity] = await Promise.all([
    clients.s3Client.send(new GetBucketLocationCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketTaggingCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketEncryptionCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketPolicyCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketVersioningCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketAclCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetPublicAccessBlockCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketLoggingCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketReplicationCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })).catch(() => null),
    clients.s3Client.send(new GetBucketOwnershipControlsCommand({ Bucket: bucket })).catch(() => null),
    collectS3Metrics(clients.cloudwatchClient, bucket, 30),
    collectS3Activity(clients.cloudtrailClient, bucket, 75),
  ]);

  summary.region = location?.LocationConstraint || region || "us-east-1";
  summary.tags = normalizeTags(tags?.TagSet || []);
  summary.publicAccessBlock = pab?.PublicAccessBlockConfiguration || null;
  summary.bucketPolicy = policy?.Policy ? parsePolicy(policy.Policy) : null;
  summary.versioningEnabled = versioning?.Status === "Enabled";
  summary.loggingEnabled = Boolean(logging?.LoggingEnabled);
  summary.replicationEnabled = Boolean(replication?.ReplicationConfiguration);
  summary.lifecycleEnabled = Boolean(lifecycle?.Rules?.length);
  summary.aclPermissions = acl?.Grants || [];
  summary.metrics = metrics;

  const sizeData = metrics.sizeBytes?.values || [];
  const objectData = metrics.numObj?.values || [];
  summary.totalStorageSizeBytes = sizeData.length ? Number(sizeData[0]) : null;
  summary.totalObjectCount = objectData.length ? Number(objectData[0]) : null;
  summary.storageClass = "Standard";
  summary.requestCounts = {
    allRequests: metrics.allRequests?.values?.[0] || 0,
    getRequests: metrics.getRequests?.values?.[0] || 0,
    putRequests: metrics.putRequests?.values?.[0] || 0,
  };
  summary.dataTransferBytes = (metrics.bytesDownloaded?.values?.[0] || 0) + (metrics.bytesUploaded?.values?.[0] || 0);

  const policySignals = detectPolicyIssues(summary.bucketPolicy, accountId, bucket);
  const aclSignals = analyzeAcl(acl, accountId);
  const encryptionSignals = analyzeEncryption(encryption);
  const loggingSignals = analyzeLogging(logging);
  const versioningSignals = analyzeVersioning(versioning);
  const replicationSignals = analyzeReplication(replication);
  const lifecycleSignals = analyzeLifecycle(lifecycle);

  Object.assign(summary, policySignals, aclSignals, encryptionSignals, loggingSignals, versioningSignals, replicationSignals, lifecycleSignals);
  summary.anonymousAccessDetection = summary.publicPolicy || summary.publicACL;
  summary.internetExposureDetection = summary.publicPolicy || summary.publicACL || !(summary.publicAccessBlock?.BlockPublicAcls && summary.publicAccessBlock?.BlockPublicPolicy);

  const activityTimeline = activity
    .sort((a, b) => new Date(b.eventTime || 0) - new Date(a.eventTime || 0))
    .slice(0, 50)
    .map((event) => ({
      eventName: event.eventName,
      eventTime: event.eventTime,
      username: event.username,
      sourceIp: event.sourceIp,
      userAgent: event.userAgent,
      assumedRole: event.assumedRole,
    }));

  summary.activityTimeline = activityTimeline;
  const createdEvent = activity.find((event) => String(event.eventName || "").toLowerCase() === "createbucket") || activity[activity.length - 1];
  const modifiedEvent = activity[0] || null;
  summary.createdBy = createdEvent ? toEventIdentity(createdEvent).createdBy : null;
  summary.sourceIp = createdEvent ? toEventIdentity(createdEvent).sourceIp : null;
  summary.eventName = createdEvent?.eventName || null;
  summary.lastModifiedBy = modifiedEvent ? toEventIdentity(modifiedEvent).createdBy : null;
  summary.assumedRole = modifiedEvent ? toEventIdentity(modifiedEvent).assumedRole : null;
  summary.userAgent = modifiedEvent ? toEventIdentity(modifiedEvent).userAgent : null;
  summary.lastModifiedTime = modifiedEvent?.eventTime || null;
  summary.lastAccessedTime = activity.find((event) => /getobject|listbucket|headobject/i.test(String(event.eventName || "")))?.eventTime || summary.lastModifiedTime;

  summary.bucketPolicyChanges = activity.filter((event) => /putbucketpolicy|deletebucketpolicy|putpublicaccessblock|putbucketacl|putbucketversioning|putbucketlogging|putbucketreplication|putbucketlifecycleconfiguration|putbucketencryption/i.test(String(event.eventName || "")));
  summary.uploadDeleteActivity = activity.filter((event) => /putobject|deleteobject|completemultipartupload|copyobject/i.test(String(event.eventName || "")));
  summary.permissionChanges = activity.filter((event) => /putbucketpolicy|deletebucketpolicy|putbucketacl|putpublicaccessblock|putbucketownershipcontrols/i.test(String(event.eventName || "")));

  const { score, severity } = scoreSecurity(summary);
  summary.securityRiskScore = score;
  summary.securitySeverity = severity;
  summary.complianceStatus = buildCompliance(summary);
  summary.detections = [
    summary.publicACL ? "Public ACL" : null,
    summary.publicPolicy ? "Public bucket policy" : null,
    !summary.encryptionEnabled ? "Missing encryption" : null,
    !summary.loggingEnabled ? "Missing logging" : null,
    !summary.versioningEnabled ? "Missing versioning" : null,
    summary.crossAccountAccess ? "Cross-account access" : null,
  ].filter(Boolean);
  summary.cost = buildCostEstimate(summary);
  summary.costOptimizationSuggestions = [
    !summary.encryptionEnabled ? "Enable SSE-KMS or SSE-S3" : null,
    !summary.versioningEnabled ? "Enable versioning for recovery" : null,
    !summary.loggingEnabled ? "Enable server access logging" : null,
    summary.publicACL || summary.publicPolicy ? "Restrict public access and add public access block" : null,
    summary.totalStorageSizeBytes === 0 ? "Delete or archive unused bucket" : null,
  ].filter(Boolean);

  return summary;
}

export const listS3 = async (req, res) => {
  try {
    const { roleArn } = req.body;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    const { s3Client, cloudwatchClient, cloudtrailClient } = await assumeRoleAndClients(roleArn, region);

    const resp = await s3Client.send(new ListBucketsCommand({}));
    const buckets = [];
    const bucketItems = resp.Buckets || [];
    for (const bucketInfo of bucketItems) {
      try {
        buckets.push(await summarizeBucket({ s3Client, cloudwatchClient, cloudtrailClient }, bucketInfo, accountId, region));
      } catch (e) {
        console.warn(`Bucket summary failed for ${bucketInfo.Name}:`, e.message);
      }
    }

    return res.json({
      success: true,
      buckets,
      meta: {
        accountId,
        region,
        totalBuckets: buckets.length,
        publicBuckets: buckets.filter((bucket) => bucket.publicACL || bucket.publicPolicy).length,
        encryptedBuckets: buckets.filter((bucket) => bucket.encryptionEnabled).length,
        atRiskBuckets: buckets.filter((bucket) => bucket.securitySeverity === "High" || bucket.securitySeverity === "Critical").length,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getS3Detail = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const bucket = req.params.name;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!bucket) return res.status(400).json({ success: false, message: "bucket required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    const clients = await assumeRoleAndClients(roleArn, region);
    const listResp = await clients.s3Client.send(new ListBucketsCommand({}));
    const bucketInfo = (listResp.Buckets || []).find((item) => item.Name === bucket);

    if (!bucketInfo) {
      return res.status(404).json({ success: false, message: "Bucket not found" });
    }

    const detail = await summarizeBucket(clients, bucketInfo, accountId, region);

    return res.json({ success: true, detail });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getS3Metrics = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const bucket = req.params.name;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!bucket) return res.status(400).json({ success: false, message: "bucket required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const { cloudwatchClient } = await assumeRoleAndClients(roleArn, region);
    const metrics = await collectS3Metrics(cloudwatchClient, bucket, 30);

    return res.json({ success: true, metrics });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getS3Activity = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const bucket = req.params.name;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!bucket) return res.status(400).json({ success: false, message: "bucket required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const { cloudtrailClient } = await assumeRoleAndClients(roleArn, region);
    const activities = await collectS3Activity(cloudtrailClient, bucket, 75);
    return res.json({ success: true, activities });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getS3Security = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const bucket = req.params.name;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!bucket) return res.status(400).json({ success: false, message: "bucket required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    const { s3Client, securityHubClient } = await assumeRoleAndClients(roleArn, region);

    const [policy, acl, encryption, versioning, pab, logging, replication, lifecycle, ownership] = await Promise.all([
      s3Client.send(new GetBucketPolicyCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketAclCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketEncryptionCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketVersioningCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetPublicAccessBlockCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketLoggingCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketReplicationCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketOwnershipControlsCommand({ Bucket: bucket })).catch(() => null),
    ]);

    const policyParsed = policy?.Policy ? parsePolicy(policy.Policy) : null;
    const policySignals = detectPolicyIssues(policyParsed, accountId, bucket);
    const aclSignals = analyzeAcl(acl, accountId);
    const encryptionSignals = analyzeEncryption(encryption);
    const versioningSignals = analyzeVersioning(versioning);
    const loggingSignals = analyzeLogging(logging);
    const replicationSignals = analyzeReplication(replication);
    const lifecycleSignals = analyzeLifecycle(lifecycle);

    const accessAnalyzerFindings = []; // SecurityHub findings (requires SecurityHub to be enabled)

    const risk = scoreSecurity({
      publicACL: aclSignals.publicACL,
      publicPolicy: policySignals.publicPolicy,
      encryptionEnabled: encryptionSignals.encryptionEnabled,
      versioningEnabled: versioningSignals.versioningEnabled,
      loggingEnabled: loggingSignals.loggingEnabled,
      replicationEnabled: replicationSignals.replicationEnabled,
      crossAccountAccess: policySignals.crossAccountAccess || aclSignals.crossAccountAccess,
    });

    const summary = {
      publicACL: aclSignals.publicACL,
      publicPolicy: policySignals.publicPolicy,
      anonymousAccess: policySignals.anonymousAccess || aclSignals.publicACL,
      internetExposure: policySignals.internetExposure || aclSignals.publicACL,
      encryptionEnabled: encryptionSignals.encryptionEnabled,
      sseType: encryptionSignals.sseType,
      kmsKeyInfo: encryptionSignals.kmsKeyInfo,
      versioningEnabled: versioningSignals.versioningEnabled,
      loggingEnabled: loggingSignals.loggingEnabled,
      replicationEnabled: replicationSignals.replicationEnabled,
      lifecycleEnabled: lifecycleSignals.lifecycleEnabled,
      crossAccountAccess: policySignals.crossAccountAccess || aclSignals.crossAccountAccess,
      accessAnalyzerFindings,
      securityRiskScore: risk.score,
      securitySeverity: risk.severity,
      complianceStatus: buildCompliance({
        publicACL: aclSignals.publicACL,
        publicPolicy: policySignals.publicPolicy,
        encryptionEnabled: encryptionSignals.encryptionEnabled,
        versioningEnabled: versioningSignals.versioningEnabled,
        loggingEnabled: loggingSignals.loggingEnabled,
      }),
      bucketPolicy: policyParsed,
      aclPermissions: acl?.Grants || [],
      publicAccessBlock: pab?.PublicAccessBlockConfiguration || null,
      logging: logging?.LoggingEnabled || null,
      ownershipControls: ownership?.OwnershipControls || null,
      replication: replication?.ReplicationConfiguration || null,
      lifecycle: lifecycle?.Rules || [],
      findings: accessAnalyzerFindings,
    };

    return res.json({ success: true, analysis: summary });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// EC2 Cost estimation based on instance type and region
function estimateEC2MonthlyCost(instanceType = "t2.micro", region = "us-east-1", state = "running") {
  // On-demand hourly rates by instance type and region (2024 pricing)
  const ec2OnDemandPricing = {
    "t2.nano": { "us-east-1": 0.0059, "us-east-2": 0.0059, "us-west-1": 0.0071, "us-west-2": 0.0059 },
    "t2.micro": { "us-east-1": 0.0116, "us-east-2": 0.0116, "us-west-1": 0.0139, "us-west-2": 0.0116 },
    "t2.small": { "us-east-1": 0.0233, "us-east-2": 0.0233, "us-west-1": 0.0279, "us-west-2": 0.0233 },
    "t2.medium": { "us-east-1": 0.0466, "us-east-2": 0.0466, "us-west-1": 0.0559, "us-west-2": 0.0466 },
    "t2.large": { "us-east-1": 0.0932, "us-east-2": 0.0932, "us-west-1": 0.1117, "us-west-2": 0.0932 },
    "t3.nano": { "us-east-1": 0.0052, "us-east-2": 0.0052, "us-west-1": 0.0062, "us-west-2": 0.0052 },
    "t3.micro": { "us-east-1": 0.0104, "us-east-2": 0.0104, "us-west-1": 0.0125, "us-west-2": 0.0104 },
    "t3.small": { "us-east-1": 0.0208, "us-east-2": 0.0208, "us-west-1": 0.0249, "us-west-2": 0.0208 },
    "t3.medium": { "us-east-1": 0.0416, "us-east-2": 0.0416, "us-west-1": 0.0499, "us-west-2": 0.0416 },
    "t3.large": { "us-east-1": 0.0832, "us-east-2": 0.0832, "us-west-1": 0.0999, "us-west-2": 0.0832 },
    "m5.large": { "us-east-1": 0.096, "us-east-2": 0.096, "us-west-1": 0.115, "us-west-2": 0.096 },
    "m5.xlarge": { "us-east-1": 0.192, "us-east-2": 0.192, "us-west-1": 0.230, "us-west-2": 0.192 },
    "m5.2xlarge": { "us-east-1": 0.384, "us-east-2": 0.384, "us-west-1": 0.461, "us-west-2": 0.384 },
    "m6i.large": { "us-east-1": 0.085, "us-east-2": 0.085, "us-west-1": 0.102, "us-west-2": 0.085 },
    "m6i.xlarge": { "us-east-1": 0.170, "us-east-2": 0.170, "us-west-1": 0.204, "us-west-2": 0.170 },
    "c5.large": { "us-east-1": 0.085, "us-east-2": 0.085, "us-west-1": 0.102, "us-west-2": 0.085 },
    "c5.xlarge": { "us-east-1": 0.170, "us-east-2": 0.170, "us-west-1": 0.204, "us-west-2": 0.170 },
    "c6i.large": { "us-east-1": 0.085, "us-east-2": 0.085, "us-west-1": 0.102, "us-west-2": 0.085 },
  };

  // Get hourly rate
  const instanceFamily = instanceType.split(".")[0];
  const hourlyRate = ec2OnDemandPricing[instanceType]?.[region] || 
                     ec2OnDemandPricing["t2.micro"]?.[region] || 0.0116;

  // EBS volumes typical costs (assuming 30GB gp2 by default)
  const ebsStorageCost = (30 * 0.10) / 30; // $0.10 per GB-month, spread daily

  // Data transfer (assuming minimal: ~10GB outbound per month)
  const dataTransferCost = (10 * 0.02) / 30; // $0.02 per GB outbound after free tier

  const hourlyTotal = hourlyRate + (ebsStorageCost + dataTransferCost) / 24;
  const monthlyCost = hourlyTotal * 730; // 730 hours per month

  return {
    instanceType,
    region,
    state,
    hourlyRate: parseFloat(hourlyRate.toFixed(4)),
    estimatedMonthlyCost: parseFloat(monthlyCost.toFixed(2)),
    breakdown: {
      computeCost: parseFloat((hourlyRate * 730).toFixed(2)),
      storageCost: parseFloat(ebsStorageCost.toFixed(2)),
      datTransferCost: parseFloat(dataTransferCost.toFixed(2)),
    },
    currency: "USD",
    note: "Estimation based on on-demand pricing; actual costs may vary with reserved instances, spot pricing, or additional resources",
  };
}

// List EC2 instances (lightweight) - POST body: { roleArn, region? }
export const listEC2 = async (req, res) => {
  try {
    const { roleArn, region } = req.body;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    const scanRegion = region || process.env.AWS_REGION || "us-east-1";
    const { ec2Client } = await assumeRoleAndClients(roleArn, scanRegion);

    const ec2Instances = [];
    try {
      let nextToken;
      do {
        const resp = await ec2Client.send(new DescribeInstancesCommand({ NextToken: nextToken }));
        (resp.Reservations || []).forEach((r) => {
          (r.Instances || []).forEach((i) => {
            const tags = i.Tags || [];
            const name = tags.find((t) => t.Key === "Name")?.Value || i.InstanceId;
            const region = i.Placement?.AvailabilityZone ? i.Placement.AvailabilityZone.slice(0, -1) : scanRegion;
            ec2Instances.push({
              instanceId: i.InstanceId,
              instanceName: name,
              state: i.State?.Name || "unknown",
              instanceType: i.InstanceType,
              amiId: i.ImageId,
              region,
              availabilityZone: i.Placement?.AvailabilityZone,
              launchTime: i.LaunchTime,
              tags,
              publicIp: i.PublicIpAddress || null,
              privateIp: i.PrivateIpAddress || null,
              cost: estimateEC2MonthlyCost(i.InstanceType, region, i.State?.Name),
            });
          });
        });
        nextToken = resp.NextToken;
      } while (nextToken);
    } catch (e) {
      console.warn("EC2 list failed:", e.message);
    }

    return res.json({ success: true, ec2Instances });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// EC2 detail: volumes, security groups, iam profile - POST body: { roleArn, region? }
export const getEC2Detail = async (req, res) => {
  try {
    const { roleArn, region } = req.body;
    const instanceId = req.params.id;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!instanceId) return res.status(400).json({ success: false, message: "instance id required" });

    const scanRegion = region || process.env.AWS_REGION || "us-east-1";
    const { ec2Client } = await assumeRoleAndClients(roleArn, scanRegion);

    // Describe instance
    const detail = { instanceId, volumes: [], securityGroups: [], iamInstanceProfile: null, networkInterfaces: [], cost: null };
    try {
      const resp = await ec2Client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
      const inst = resp.Reservations?.[0]?.Instances?.[0];
      if (inst) {
        detail.instance = inst;
        
        // Add cost estimation
        const region = inst.Placement?.AvailabilityZone ? inst.Placement.AvailabilityZone.slice(0, -1) : scanRegion;
        detail.cost = estimateEC2MonthlyCost(inst.InstanceType, region, inst.State?.Name);
        
        // volumes
        const volIds = (inst.BlockDeviceMappings || []).map((b) => b.Ebs?.VolumeId).filter(Boolean);
        if (volIds.length) {
          try {
            const vols = await ec2Client.send(new DescribeVolumesCommand({ VolumeIds: volIds }));
            detail.volumes = vols.Volumes || [];
          } catch (e) {
            console.warn("DescribeVolumes failed", e.message);
          }
        }

        // security groups
        const sgIds = (inst.SecurityGroups || []).map((s) => s.GroupId).filter(Boolean);
        if (sgIds.length) {
          try {
            const sgs = await ec2Client.send(new DescribeSecurityGroupsCommand({ GroupIds: sgIds }));
            detail.securityGroups = sgs.SecurityGroups || [];
          } catch (e) {
            console.warn("DescribeSecurityGroups failed", e.message);
          }
        }

        // iam instance profile
        if (inst.IamInstanceProfile) detail.iamInstanceProfile = inst.IamInstanceProfile;

        // network interfaces
        detail.networkInterfaces = inst.NetworkInterfaces || [];
      }
    } catch (e) {
      console.warn("DescribeInstances for detail failed:", e.message);
    }

    return res.json({ success: true, detail });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// EC2 metrics: CPU, NetworkIn/Out (last 24h) - POST body: { roleArn, region? }
export const getEC2Metrics = async (req, res) => {
  try {
    const { roleArn, region } = req.body;
    const instanceId = req.params.id;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!instanceId) return res.status(400).json({ success: false, message: "instance id required" });

    const scanRegion = region || process.env.AWS_REGION || "us-east-1";
    const { cloudwatchClient } = await assumeRoleAndClients(roleArn, scanRegion);

    const end = new Date();
    const start = new Date(Date.now() - 24 * 3600 * 1000);

    const queries = [
      { Id: "cpu", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "CPUUtilization", Dimensions: [{ Name: "InstanceId", Value: instanceId }] }, Period: 300, Stat: "Average" } },
      { Id: "netin", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "NetworkIn", Dimensions: [{ Name: "InstanceId", Value: instanceId }] }, Period: 300, Stat: "Sum" } },
      { Id: "netout", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "NetworkOut", Dimensions: [{ Name: "InstanceId", Value: instanceId }] }, Period: 300, Stat: "Sum" } },
    ];

    const metricData = {};
    try {
      const resp = await cloudwatchClient.send(
        new GetMetricDataCommand({
          StartTime: start,
          EndTime: end,
          MetricDataQueries: queries,
          ScanBy: "TimestampDescending",
        })
      );

      (resp.MetricDataResults || []).forEach((r) => {
        metricData[r.Id] = { timestamps: r.Timestamps || [], values: r.Values || [] };
      });
    } catch (e) {
      console.warn("GetMetricData failed:", e.message);
    }

    return res.json({ success: true, metrics: metricData });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// CloudTrail activity: LookupEvents for an instanceId - POST body: { roleArn, region? }
export const getEC2Activity = async (req, res) => {
  try {
    const { roleArn, region } = req.body;
    const instanceId = req.params.id;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!instanceId) return res.status(400).json({ success: false, message: "instance id required" });

    const scanRegion = region || process.env.AWS_REGION || "us-east-1";
    const { cloudtrailClient } = await assumeRoleAndClients(roleArn, scanRegion);

    const activities = [];
    try {
      let nextToken;
      do {
        const resp = await cloudtrailClient.send(
          new LookupEventsCommand({ LookupAttributes: [{ AttributeKey: "ResourceName", AttributeValue: instanceId }], NextToken: nextToken })
        );
        (resp.Events || []).forEach((e) => {
          activities.push({ eventId: e.EventId, eventName: e.EventName, eventTime: e.EventTime, username: e.Username, resources: e.Resources });
        });
        nextToken = resp.NextToken;
      } while (nextToken);
    } catch (e) {
      console.warn("CloudTrail lookup failed:", e.message);
    }

    return res.json({ success: true, activities });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// EC2 security analysis: analyze SGs for public exposure + SecurityHub findings related to instance - POST body: { roleArn, region? }
export const getEC2Security = async (req, res) => {
  try {
    const { roleArn, region } = req.body;
    const instanceId = req.params.id;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!instanceId) return res.status(400).json({ success: false, message: "instance id required" });

    const scanRegion = region || process.env.AWS_REGION || "us-east-1";
    const { ec2Client, securityHubClient } = await assumeRoleAndClients(roleArn, scanRegion);

    const analysis = { publicExposure: [], securityFindings: [] };

    try {
      const resp = await ec2Client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
      const inst = resp.Reservations?.[0]?.Instances?.[0];
      if (inst) {
        const sgIds = (inst.SecurityGroups || []).map((s) => s.GroupId).filter(Boolean);
        if (sgIds.length) {
          try {
            const sgs = await ec2Client.send(new DescribeSecurityGroupsCommand({ GroupIds: sgIds }));
            (sgs.SecurityGroups || []).forEach((sg) => {
              (sg.IpPermissions || []).forEach((perm) => {
                (perm.IpRanges || []).forEach((r) => {
                  if (r.CidrIp === "0.0.0.0/0") {
                    analysis.publicExposure.push({ groupId: sg.GroupId, protocol: perm.IpProtocol, fromPort: perm.FromPort, toPort: perm.ToPort, cidr: r.CidrIp });
                  }
                });
                (perm.Ipv6Ranges || []).forEach((r) => {
                  if (r.CidrIpv6 === "::/0") {
                    analysis.publicExposure.push({ groupId: sg.GroupId, protocol: perm.IpProtocol, fromPort: perm.FromPort, toPort: perm.ToPort, cidr: r.CidrIpv6 });
                  }
                });
              });
            });
          } catch (e) {
            console.warn("DescribeSecurityGroups failed:", e.message);
          }
        }
      }
    } catch (e) {
      console.warn("DescribeInstances for security failed:", e.message);
    }

    // SecurityHub findings (requires SecurityHub to be enabled in account)
    // Skipping SecurityHub lookup - can be enabled if needed

    return res.json({ success: true, analysis });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== RDS HANDLERS ====================

async function collectRDSMetrics(cloudwatchClient, dbIdentifier, days = 7) {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 3600 * 1000);
  const queries = [
    { Id: "cpu", MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: "CPUUtilization", Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbIdentifier }] }, Period: 300, Stat: "Average" } },
    { Id: "memory", MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: "FreeableMemory", Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbIdentifier }] }, Period: 300, Stat: "Average" } },
    { Id: "connections", MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: "DatabaseConnections", Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbIdentifier }] }, Period: 300, Stat: "Average" } },
    { Id: "freeStorage", MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: "FreeStorageSpace", Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbIdentifier }] }, Period: 300, Stat: "Average" } },
    { Id: "readIOPS", MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: "ReadIOPS", Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbIdentifier }] }, Period: 300, Stat: "Average" } },
    { Id: "writeIOPS", MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: "WriteIOPS", Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbIdentifier }] }, Period: 300, Stat: "Average" } },
    { Id: "readThroughput", MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: "ReadThroughput", Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbIdentifier }] }, Period: 300, Stat: "Average" } },
    { Id: "writeThroughput", MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: "WriteThroughput", Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbIdentifier }] }, Period: 300, Stat: "Average" } },
  ];

  const metricData = {};
  try {
    const resp = await cloudwatchClient.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: end,
        MetricDataQueries: queries,
        ScanBy: "TimestampDescending",
      })
    );
    (resp.MetricDataResults || []).forEach((r) => {
      metricData[r.Id] = { timestamps: r.Timestamps || [], values: r.Values || [] };
    });
  } catch (e) {
    console.warn(`RDS metrics scan failed for ${dbIdentifier}:`, e.message);
  }
  return metricData;
}

async function collectRDSActivity(cloudtrailClient, dbIdentifier, limit = 100) {
  const activities = [];
  try {
    let nextToken;
    do {
      const resp = await cloudtrailClient.send(
        new LookupEventsCommand({
          LookupAttributes: [{ AttributeKey: "ResourceName", AttributeValue: dbIdentifier }],
          NextToken: nextToken,
          MaxResults: Math.min(limit, 50),
        })
      );
      (resp.Events || []).forEach((event) => {
        const parsed = safeParseEvent(event.CloudTrailEvent);
        const identity = parsed?.userIdentity || {};
        activities.push({
          eventId: event.EventId,
          eventName: event.EventName,
          eventTime: event.EventTime,
          username: event.Username || identity.userName || identity.arn || null,
          sourceIp: parsed?.sourceIPAddress || null,
          userAgent: parsed?.userAgent || null,
          assumedRole: identity.sessionContext?.sessionIssuer?.arn || null,
          resources: event.Resources || [],
          cloudTrailEvent: parsed,
        });
      });
      nextToken = resp.NextToken;
    } while (nextToken && activities.length < limit);
  } catch (e) {
    console.warn(`CloudTrail lookup failed for ${dbIdentifier}:`, e.message);
  }
  return activities;
}

function scoreRDSSecurity(db) {
  let score = 100;
  if (!db.storageEncrypted) score -= 25;
  if (!db.deletionProtection) score -= 15;
  if (!db.backupRetentionPeriod || db.backupRetentionPeriod < 7) score -= 20;
  if (!db.iamDatabaseAuthenticationEnabled) score -= 10;
  if (!db.enableCloudwatchLogsExports || !db.enableCloudwatchLogsExports.length) score -= 5;
  if (db.publiclyAccessible) score -= 15;
  if (!db.multiAZ) score -= 10;
  score = Math.max(0, Math.min(100, score));

  let severity = "Low";
  if (score < 40) severity = "Critical";
  else if (score < 60) severity = "High";
  else if (score < 80) severity = "Medium";

  return { score, severity };
}

function buildRDSCompliance(db) {
  const violations = [];
  if (!db.storageEncrypted) violations.push("Storage encryption disabled");
  if (!db.deletionProtection) violations.push("Deletion protection disabled");
  if (!db.backupRetentionPeriod || db.backupRetentionPeriod < 7) violations.push("Backup retention < 7 days");
  if (!db.iamDatabaseAuthenticationEnabled) violations.push("IAM authentication disabled");
  if (db.publiclyAccessible) violations.push("Publicly accessible");
  if (!db.multiAZ) violations.push("Multi-AZ disabled");

  return {
    compliant: violations.length === 0,
    status: violations.length === 0 ? "Compliant" : violations.length >= 3 ? "Non-Compliant" : "At Risk",
    violations,
  };
}

function buildRDSCostEstimate(db) {
  const instanceRates = {
    "db.t3.micro": 0.017,
    "db.t3.small": 0.033,
    "db.t3.medium": 0.066,
    "db.t3.large": 0.132,
    "db.t3.xlarge": 0.264,
    "db.m5.large": 0.193,
    "db.m5.xlarge": 0.386,
    "db.r5.large": 0.336,
    "db.r5.xlarge": 0.672,
  };

  const hourlyRate = instanceRates[db.dbInstanceClass] || 0.1;
  const monthlyCost = hourlyRate * 730;
  const backupStorageCost = (db.backupRetentionPeriod || 0) * 0.095;
  const iopsCost = (db.iops || 0) * 0.1;
  const storageCost = (db.allocatedStorage || 0) * 0.1;

  return {
    estimatedMonthlyCost: monthlyCost + backupStorageCost + iopsCost + storageCost,
    instanceCost: monthlyCost,
    backupStorageCost,
    iopsCost,
    storageCost,
    costOptimizationSuggestions: [
      !db.multiAZ ? "Consider Multi-AZ for production workloads" : null,
      db.publiclyAccessible ? "Disable public access if not required" : null,
      !db.storageEncrypted ? "Enable encryption at rest" : null,
      (db.backupRetentionPeriod || 0) < 7 ? "Increase backup retention to 7+ days" : null,
    ].filter(Boolean),
  };
}

async function summarizeDatabase(clients, dbInstance, accountId, region) {
  const dbId = dbInstance.DBInstanceIdentifier;
  const summary = {
    dbInstanceIdentifier: dbId,
    arn: dbInstance.DBInstanceArn,
    accountId,
    region: dbInstance.AvailabilityZone ? dbInstance.AvailabilityZone.slice(0, -1) : region,
    availabilityZone: dbInstance.AvailabilityZone,
    engine: dbInstance.Engine,
    engineVersion: dbInstance.EngineVersion,
    dbInstanceClass: dbInstance.DBInstanceClass,
    dbInstanceStatus: dbInstance.DBInstanceStatus,
    endpoint: dbInstance.Endpoint?.Address || null,
    port: dbInstance.Endpoint?.Port || (dbInstance.Engine === "mysql" ? 3306 : dbInstance.Engine === "postgres" ? 5432 : 1433),
    storageType: dbInstance.StorageType,
    allocatedStorage: dbInstance.AllocatedStorage,
    iops: dbInstance.Iops || null,
    creationTime: dbInstance.DBInstanceCreateTime,
    multiAZ: dbInstance.MultiAZ,
    readReplicas: dbInstance.ReadReplicaDBInstanceIdentifiers || [],
    tags: dbInstance.TagList || [],
    publiclyAccessible: dbInstance.PubliclyAccessible,
    vpcId: dbInstance.DBSubnetGroup?.VpcId || null,
    subnetGroup: dbInstance.DBSubnetGroup?.DBSubnetGroupName || null,
    securityGroups: (dbInstance.VpcSecurityGroups || []).map((sg) => ({ id: sg.VpcSecurityGroupId, status: sg.Status })),
    storageEncrypted: dbInstance.StorageEncrypted,
    kmsKeyId: dbInstance.KmsKeyId || null,
    iamDatabaseAuthenticationEnabled: dbInstance.IAMDatabaseAuthenticationEnabled,
    backupRetentionPeriod: dbInstance.BackupRetentionPeriod,
    preferredBackupWindow: dbInstance.PreferredBackupWindow,
    preferredMaintenanceWindow: dbInstance.PreferredMaintenanceWindow,
    deletionProtection: dbInstance.DeletionProtection,
    enableCloudwatchLogsExports: dbInstance.EnableCloudwatchLogsExports || [],
    enableIAMDatabaseAuthentication: dbInstance.EnableIAMDatabaseAuthentication,
    metrics: {},
    activityTimeline: [],
    createdBy: null,
    lastModifiedBy: null,
    sourceIp: null,
    assumedRole: null,
    userAgent: null,
    securityRiskScore: 100,
    securitySeverity: "Low",
    complianceStatus: "Unknown",
    detections: [],
    cost: null,
  };

  // Collect metrics and activity in parallel
  const [metrics, activities] = await Promise.all([
    collectRDSMetrics(clients.cloudwatchClient, dbId, 7),
    collectRDSActivity(clients.cloudtrailClient, dbId, 75),
  ]);

  summary.metrics = metrics;

  const activityTimeline = activities
    .sort((a, b) => new Date(b.eventTime || 0) - new Date(a.eventTime || 0))
    .slice(0, 50)
    .map((event) => ({
      eventName: event.eventName,
      eventTime: event.eventTime,
      username: event.username,
      sourceIp: event.sourceIp,
      userAgent: event.userAgent,
      assumedRole: event.assumedRole,
    }));

  summary.activityTimeline = activityTimeline;

  const createdEvent = activities.find((event) => /createdb/i.test(String(event.eventName || ""))) || activities[activities.length - 1];
  const modifiedEvent = activities[0] || null;
  summary.createdBy = createdEvent ? toEventIdentity(createdEvent).createdBy : null;
  summary.sourceIp = createdEvent ? toEventIdentity(createdEvent).sourceIp : null;
  summary.lastModifiedBy = modifiedEvent ? toEventIdentity(modifiedEvent).createdBy : null;
  summary.assumedRole = modifiedEvent ? toEventIdentity(modifiedEvent).assumedRole : null;
  summary.userAgent = modifiedEvent ? toEventIdentity(modifiedEvent).userAgent : null;

  const { score, severity } = scoreRDSSecurity(summary);
  summary.securityRiskScore = score;
  summary.securitySeverity = severity;
  summary.complianceStatus = buildRDSCompliance(summary);

  summary.detections = [
    !summary.storageEncrypted ? "Missing encryption" : null,
    !summary.deletionProtection ? "No deletion protection" : null,
    !summary.backupRetentionPeriod || summary.backupRetentionPeriod < 7 ? "Low backup retention" : null,
    !summary.iamDatabaseAuthenticationEnabled ? "IAM auth disabled" : null,
    summary.publiclyAccessible ? "Publicly accessible" : null,
    !summary.multiAZ ? "Single-AZ deployment" : null,
  ].filter(Boolean);

  summary.cost = buildRDSCostEstimate(summary);

  return summary;
}

export const listRDS = async (req, res) => {
  try {
    const { roleArn } = req.body;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    const { cloudwatchClient, cloudtrailClient } = await assumeRoleAndClients(roleArn, region);

    // Create RDS client
    const stsConfig = { region };
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      stsConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }
    const stsClient = new STSClient(stsConfig);
    const assumedRole = await stsClient.send(
      new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "AWSScannerSession" })
    );
    const credentials = {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken,
    };
    const rdsClient = new RDSClient({ region, credentials });

    const resp = await rdsClient.send(new DescribeDBInstancesCommand({}));
    const databases = [];
    const dbItems = resp.DBInstances || [];

    for (const dbInstance of dbItems) {
      try {
        const summary = await summarizeDatabase(
          { cloudwatchClient, cloudtrailClient },
          dbInstance,
          accountId,
          region
        );
        databases.push(summary);
      } catch (e) {
        console.warn(`Database summary failed for ${dbInstance.DBInstanceIdentifier}:`, e.message);
      }
    }

    return res.json({
      success: true,
      databases,
      meta: {
        accountId,
        region,
        totalDatabases: databases.length,
        publicDatabases: databases.filter((db) => db.publiclyAccessible).length,
        encryptedDatabases: databases.filter((db) => db.storageEncrypted).length,
        atRiskDatabases: databases.filter((db) => db.securitySeverity === "High" || db.securitySeverity === "Critical").length,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getRDSDetail = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const dbId = req.params.id;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!dbId) return res.status(400).json({ success: false, message: "database id required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";

    const stsConfig = { region };
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      stsConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }
    const stsClient = new STSClient(stsConfig);
    const assumedRole = await stsClient.send(
      new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "AWSScannerSession" })
    );
    const credentials = {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken,
    };
    const rdsClient = new RDSClient({ region, credentials });
    const cloudwatchClient = new CloudWatchClient({ region, credentials });
    const cloudtrailClient = new CloudTrailClient({ region, credentials });

    const resp = await rdsClient.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbId }));
    const dbInstance = resp.DBInstances?.[0];

    if (!dbInstance) {
      return res.status(404).json({ success: false, message: "Database not found" });
    }

    const detail = await summarizeDatabase(
      { cloudwatchClient, cloudtrailClient },
      dbInstance,
      accountId,
      region
    );

    return res.json({ success: true, detail });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getRDSMetrics = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const dbId = req.params.id;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!dbId) return res.status(400).json({ success: false, message: "database id required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const { cloudwatchClient } = await assumeRoleAndClients(roleArn, region);
    const metrics = await collectRDSMetrics(cloudwatchClient, dbId, 7);

    return res.json({ success: true, metrics });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getRDSActivity = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const dbId = req.params.id;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!dbId) return res.status(400).json({ success: false, message: "database id required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const { cloudtrailClient } = await assumeRoleAndClients(roleArn, region);
    const activities = await collectRDSActivity(cloudtrailClient, dbId, 75);

    return res.json({ success: true, activities });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getRDSSecurity = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const dbId = req.params.id;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!dbId) return res.status(400).json({ success: false, message: "database id required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";

    const stsConfig = { region };
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      stsConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }
    const stsClient = new STSClient(stsConfig);
    const assumedRole = await stsClient.send(
      new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "AWSScannerSession" })
    );
    const credentials = {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken,
    };
    const rdsClient = new RDSClient({ region, credentials });

    const resp = await rdsClient.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbId }));
    const dbInstance = resp.DBInstances?.[0];

    if (!dbInstance) {
      return res.status(404).json({ success: false, message: "Database not found" });
    }

    const risk = scoreRDSSecurity(dbInstance);
    const compliance = buildRDSCompliance(dbInstance);

    const summary = {
      storageEncrypted: dbInstance.StorageEncrypted,
      kmsKeyId: dbInstance.KmsKeyId || null,
      iamDatabaseAuthenticationEnabled: dbInstance.IAMDatabaseAuthenticationEnabled,
      backupRetentionPeriod: dbInstance.BackupRetentionPeriod,
      deletionProtection: dbInstance.DeletionProtection,
      publiclyAccessible: dbInstance.PubliclyAccessible,
      multiAZ: dbInstance.MultiAZ,
      securityGroups: (dbInstance.VpcSecurityGroups || []).map((sg) => ({ id: sg.VpcSecurityGroupId, status: sg.Status })),
      enableCloudwatchLogsExports: dbInstance.EnableCloudwatchLogsExports || [],
      securityRiskScore: risk.score,
      securitySeverity: risk.severity,
      complianceStatus: compliance,
    };

    return res.json({ success: true, analysis: summary });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

function parseArnAccountId(arn = "") {
  return String(arn || "").split(":")[4] || "";
}

function summarizeIamPolicyNames(attachedPolicies = [], inlinePolicyNames = []) {
  return {
    attachedManagedPolicies: attachedPolicies.map((policy) => policy.PolicyArn || policy.PolicyName).filter(Boolean),
    inlinePolicies: inlinePolicyNames.filter(Boolean),
  };
}

async function readPolicyDocument(iamClient, policyArn) {
  if (!policyArn) return null;
  try {
    const policy = await iamClient.send(new GetPolicyCommand({ PolicyArn: policyArn }));
    const defaultVersionId = policy.Policy?.DefaultVersionId;
    if (!defaultVersionId) return null;
    const version = await iamClient.send(new GetPolicyVersionCommand({ PolicyArn: policyArn, VersionId: defaultVersionId }));
    const doc = version.PolicyVersion?.Document;
    return typeof doc === "string" ? safeParseEvent(doc) || null : doc || null;
  } catch {
    return null;
  }
}

function documentHasWildcardPermissions(doc) {
  const text = JSON.stringify(doc || {});
  return /"Action"\s*:\s*"\*"|"Action"\s*:\s*\[.*?"\*".*?\]|"Resource"\s*:\s*"\*"/i.test(text);
}

function documentHasAdminAccess(doc, policyName = "") {
  const text = JSON.stringify(doc || {}).toLowerCase();
  return /administratoraccess/.test(String(policyName || "").toLowerCase()) || /"effect":"allow"/.test(text) && documentHasWildcardPermissions(doc);
}

async function collectIamUserSummary(clients, user) {
  const userName = user.UserName;
  const [groupsResp, attachedUserPoliciesResp, inlineUserPoliciesResp, accessKeysResp, mfaResp, loginProfileResp] = await Promise.all([
    clients.iamClient.send(new ListGroupsForUserCommand({ UserName: userName })).catch(() => ({ Groups: [] })),
    clients.iamClient.send(new ListAttachedUserPoliciesCommand({ UserName: userName })).catch(() => ({ AttachedPolicies: [] })),
    clients.iamClient.send(new ListUserPoliciesCommand({ UserName: userName })).catch(() => ({ PolicyNames: [] })),
    clients.iamClient.send(new ListAccessKeysCommand({ UserName: userName })).catch(() => ({ AccessKeyMetadata: [] })),
    clients.iamClient.send(new ListMFADevicesCommand({ UserName: userName })).catch(() => ({ MFADevices: [] })),
    clients.iamClient.send(new GetLoginProfileCommand({ UserName: userName })).catch(() => null),
  ]);

  const groups = groupsResp.Groups || [];
  const groupPolicies = [];
  const groupPolicyDocs = [];

  for (const group of groups) {
    const attached = await clients.iamClient.send(new ListAttachedGroupPoliciesCommand({ GroupName: group.GroupName })).catch(() => ({ AttachedPolicies: [] }));
    const inline = await clients.iamClient.send(new ListGroupPoliciesCommand({ GroupName: group.GroupName })).catch(() => ({ PolicyNames: [] }));
    groupPolicies.push(...summarizeIamPolicyNames(attached.AttachedPolicies || [], inline.PolicyNames || []).attachedManagedPolicies);

    for (const policy of attached.AttachedPolicies || []) {
      const doc = await readPolicyDocument(clients.iamClient, policy.PolicyArn);
      if (doc) groupPolicyDocs.push({ policyName: policy.PolicyName, document: doc });
    }

    for (const policyName of inline.PolicyNames || []) {
      const policy = await clients.iamClient.send(new GetGroupPolicyCommand({ GroupName: group.GroupName, PolicyName: policyName })).catch(() => null);
      const doc = policy?.PolicyDocument ? (typeof policy.PolicyDocument === "string" ? safeParseEvent(policy.PolicyDocument) : policy.PolicyDocument) : null;
      if (doc) groupPolicyDocs.push({ policyName, document: doc });
    }
  }

  const policyDocs = [];
  for (const policy of attachedUserPoliciesResp.AttachedPolicies || []) {
    const doc = await readPolicyDocument(clients.iamClient, policy.PolicyArn);
    if (doc) policyDocs.push({ policyName: policy.PolicyName, document: doc, policyArn: policy.PolicyArn });
  }

  for (const policyName of inlineUserPoliciesResp.PolicyNames || []) {
    const policy = await clients.iamClient.send(new GetUserPolicyCommand({ UserName: userName, PolicyName: policyName })).catch(() => null);
    const doc = policy?.PolicyDocument ? (typeof policy.PolicyDocument === "string" ? safeParseEvent(policy.PolicyDocument) : policy.PolicyDocument) : null;
    if (doc) policyDocs.push({ policyName, document: doc, inline: true });
  }

  const accessKeys = (accessKeysResp.AccessKeyMetadata || []).map((key) => ({
    accessKeyId: key.AccessKeyId,
    status: key.Status,
    createDate: key.CreateDate,
    ageDays: key.CreateDate ? Math.floor((Date.now() - new Date(key.CreateDate).getTime()) / 86400000) : null,
  }));

  const accessKeysWithUsage = await Promise.all(
    accessKeys.map(async (key) => {
      const usage = await clients.iamClient.send(new GetAccessKeyLastUsedCommand({ AccessKeyId: key.accessKeyId })).catch(() => null);
      return {
        ...key,
        lastUsedTime: usage?.AccessKeyLastUsed?.LastUsedDate || null,
        lastUsedService: usage?.AccessKeyLastUsed?.ServiceName || null,
        lastUsedRegion: usage?.AccessKeyLastUsed?.Region || null,
        rotationStatus: key.ageDays != null && key.ageDays > 90 ? "Rotate" : "Fresh",
      };
    })
  );

  const cloudTrail = await clients.cloudtrailClient.send(
    new LookupEventsCommand({
      LookupAttributes: [{ AttributeKey: "Username", AttributeValue: userName }],
      MaxResults: 100,
    })
  ).catch(() => ({ Events: [] }));

  const activity = (cloudTrail.Events || []).map((event) => {
    const parsed = safeParseEvent(event.CloudTrailEvent) || {};
    const identity = parsed.userIdentity || {};
    return {
      eventName: event.EventName,
      eventTime: event.EventTime,
      sourceIp: parsed.sourceIPAddress || null,
      userAgent: parsed.userAgent || null,
      assumedRole: identity.sessionContext?.sessionIssuer?.arn || null,
      resource: event.Resources?.[0]?.ResourceName || null,
      resourceType: event.Resources?.[0]?.ResourceType || null,
      username: userName,
      requestParameters: parsed.requestParameters || null,
    };
  });

  const createdEvent = activity.find((event) => /createuser|createaccesskey|addusertogroup/i.test(String(event.eventName || ""))) || activity[activity.length - 1] || null;
  const modifiedEvent = activity.find((event) => /updateuser|attachuserpolicy|detachuserpolicy|putuserpolicy|deleteuserpolicy|addusertogroup|removeuserfromgroup/i.test(String(event.eventName || ""))) || activity[0] || null;

  const attachedManagedPolicies = attachedUserPoliciesResp.AttachedPolicies || [];
  const inlinePolicies = inlineUserPoliciesResp.PolicyNames || [];
  const effectivePolicyDocs = [...policyDocs, ...groupPolicyDocs];
  const wildcardPermissions = effectivePolicyDocs.some(({ document }) => documentHasWildcardPermissions(document));
  const administratorAccess = effectivePolicyDocs.some(({ document, policyName }) => documentHasAdminAccess(document, policyName));
  const assumeRolePermissions = effectivePolicyDocs.some(({ document }) => JSON.stringify(document || {}).toLowerCase().includes("sts:assumerole"));
  const crossAccountAccess = effectivePolicyDocs.some(({ document }) => JSON.stringify(document || {}).includes('"AWS":"*"'));

  const consoleAccessEnabled = Boolean(loginProfileResp?.LoginProfile);
  const mfaEnabled = Boolean((mfaResp.MFADevices || []).length);
  const failedLogins = activity.filter((event) => /failed|denied/i.test(String(event.eventName || ""))).length;
  const recentLogin = activity.find((event) => /consolelogin|signin/i.test(String(event.eventName || "")))?.eventTime || null;

  const resourceOwnership = {
    ec2Instances: activity.filter((event) => /runinstances/i.test(String(event.eventName || ""))).length,
    s3Buckets: activity.filter((event) => /createbucket/i.test(String(event.eventName || ""))).length,
    lambdaFunctions: activity.filter((event) => /createfunction/i.test(String(event.eventName || ""))).length,
    rdsDatabases: activity.filter((event) => /createdbinstance/i.test(String(event.eventName || ""))).length,
    iamRoles: activity.filter((event) => /createrole/i.test(String(event.eventName || ""))).length,
    policies: activity.filter((event) => /createpolicy/i.test(String(event.eventName || ""))).length,
  };

  const groupsList = groups.map((group) => group.GroupName).filter(Boolean);

  const summary = {
    userName,
    arn: user.UserArn,
    accountId: parseArnAccountId(user.UserArn),
    userId: user.UserId,
    creationDate: user.CreateDate || null,
    path: user.Path || "/",
    tags: (user.Tags || []).map((tag) => ({ key: tag.Key, value: tag.Value })),
    consoleAccessEnabled,
    lastConsoleLogin: recentLogin,
    passwordLastUsed: user.PasswordLastUsed || null,
    mfaEnabled,
    groups: groupsList,
    attachedRoles: Array.from(new Set(activity.filter((event) => /assumerole/i.test(String(event.eventName || ""))).map((event) => event.assumedRole).filter(Boolean))),

    accessKeys: accessKeysWithUsage,

    attachedManagedPolicies,
    inlinePolicies,
    groupPermissions: groupPolicies,
    effectivePermissions: Array.from(new Set([...attachedManagedPolicies.map((p) => p.PolicyName || p.PolicyArn), ...inlinePolicies, ...groupPolicies])),
    administratorAccess,
    wildcardPermissions,
    crossAccountAccess,
    assumeRolePermissions,
    privilegeEscalationRisks: administratorAccess || wildcardPermissions || assumeRolePermissions,

    mfaEnforcement: mfaEnabled,
    rootAccessDetection: /root/i.test(userName),
    overprivilegedAccess: administratorAccess || wildcardPermissions,
    unusedCredentials: accessKeysWithUsage.some((key) => !key.lastUsedTime),
    inactiveUser: !recentLogin || (user.PasswordLastUsed && (Date.now() - new Date(user.PasswordLastUsed).getTime()) > 90 * 86400000),
    passwordPolicyCompliance: consoleAccessEnabled ? "Review" : "N/A",
    consoleLoginActivity: consoleAccessEnabled ? "Enabled" : "Disabled",
    failedLoginAttempts: failedLogins,
    apiUsageActivity: activity.filter((event) => !/signin|consolelogin/i.test(String(event.eventName || ""))).length,

    recentApiCalls: activity.slice(0, 15),
    cloudTrailActivity: activity.slice(0, 50),
    consoleLoginHistory: activity.filter((event) => /signin|consolelogin/i.test(String(event.eventName || ""))).slice(0, 20),
    regionActivity: Array.from(new Set(activity.map((event) => event.region).filter(Boolean))),
    resourceCreationActivity: activity.filter((event) => /create|runinstances|putbucket|createfunction|createdbinstance|createrole|createpolicy/i.test(String(event.eventName || ""))),
    resourceDeletionActivity: activity.filter((event) => /delete|terminate/i.test(String(event.eventName || ""))),
    permissionChanges: activity.filter((event) => /attach|detach|putuserpolicy|deleteuserpolicy|addusertogroup|removeuserfromgroup|putgrouppolicy|deletegrouppolicy/i.test(String(event.eventName || ""))),
    assumedRoles: Array.from(new Set(activity.map((event) => event.assumedRole).filter(Boolean))),
    sourceIps: Array.from(new Set(activity.map((event) => event.sourceIp).filter(Boolean))),
    userAgents: Array.from(new Set(activity.map((event) => event.userAgent).filter(Boolean))),

    createdBy: createdEvent ? toEventIdentity(createdEvent).createdBy : null,
    sourceIp: createdEvent ? toEventIdentity(createdEvent).sourceIp : null,
    eventName: createdEvent?.eventName || null,
    eventTime: createdEvent?.eventTime || null,
    lastModifiedBy: modifiedEvent ? toEventIdentity(modifiedEvent).createdBy : null,
    assumedRole: modifiedEvent ? toEventIdentity(modifiedEvent).assumedRole : null,
    permissionChangesAttribution: activity.filter((event) => /attach|detach|putuserpolicy|deleteuserpolicy|putgrouppolicy|deletegrouppolicy/i.test(String(event.eventName || ""))),
    accessKeyCreation: activity.filter((event) => /createaccesskey/i.test(String(event.eventName || ""))),
    loginEvents: activity.filter((event) => /signin|consolelogin/i.test(String(event.eventName || ""))),
    policyAttachments: activity.filter((event) => /attachuserpolicy|attachgrouppolicy/i.test(String(event.eventName || ""))),
    groupChanges: activity.filter((event) => /addusertogroup|removeuserfromgroup/i.test(String(event.eventName || ""))),

    resourcesCreated: resourceOwnership,
    recentInfrastructureChanges: activity.filter((event) => /create|delete|update|put/i.test(String(event.eventName || ""))).slice(0, 20),

    loginTrend: activity.filter((event) => /signin|consolelogin/i.test(String(event.eventName || ""))),
    apiUsageTrend: activity.filter((event) => !/signin|consolelogin/i.test(String(event.eventName || ""))),
    mostUsedServices: activity.reduce((acc, event) => {
      const service = String(event.resourceType || event.eventName || "Unknown");
      acc[service] = (acc[service] || 0) + 1;
      return acc;
    }, {}),
    regionUsage: activity.reduce((acc, event) => {
      const regionKey = event.region || "unknown";
      acc[regionKey] = (acc[regionKey] || 0) + 1;
      return acc;
    }, {}),
    permissionChangeTimeline: activity.filter((event) => /attach|detach|putuserpolicy|deleteuserpolicy|putgrouppolicy|deletegrouppolicy/i.test(String(event.eventName || ""))),
    userActivityTimeline: activity.slice(0, 50),
    failedAuthenticationTrends: failedLogins,

    securityRiskScore: 100,
    securitySeverity: "Low",
    complianceStatus: { compliant: false, status: "Unknown", violations: [] },
    detections: [],
  };

  const findings = [
    administratorAccess ? "AdministratorAccess attached" : null,
    !mfaEnabled ? "No MFA enabled" : null,
    accessKeysWithUsage.some((key) => (key.ageDays || 0) > 90) ? "Old access keys" : null,
    accessKeysWithUsage.some((key) => !key.lastUsedTime) ? "Unused access keys" : null,
    wildcardPermissions ? "Wildcard policies" : null,
    summary.inactiveUser ? "Inactive user" : null,
    crossAccountAccess ? "Cross-account risk" : null,
    assumeRolePermissions ? "Privilege escalation risk" : null,
    summary.overprivilegedAccess ? "Excessive permissions" : null,
    failedLogins > 0 ? "Suspicious login activity" : null,
    failedLogins > 3 ? "Failed login attempts" : null,
  ].filter(Boolean);

  let score = 100;
  if (!mfaEnabled) score -= 25;
  if (administratorAccess) score -= 20;
  if (wildcardPermissions) score -= 15;
  if (accessKeysWithUsage.some((key) => (key.ageDays || 0) > 90)) score -= 10;
  if (accessKeysWithUsage.some((key) => !key.lastUsedTime)) score -= 10;
  if (summary.inactiveUser) score -= 10;
  if (failedLogins > 3) score -= 10;
  if (crossAccountAccess) score -= 10;
  if (assumeRolePermissions) score -= 10;
  score = Math.max(0, Math.min(100, score));

  let severity = "Low";
  if (score < 40) severity = "Critical";
  else if (score < 60) severity = "High";
  else if (score < 80) severity = "Medium";

  summary.securityRiskScore = score;
  summary.securitySeverity = severity;
  summary.complianceStatus = {
    compliant: findings.length === 0,
    status: findings.length === 0 ? "Compliant" : findings.length >= 3 ? "Non-Compliant" : "At Risk",
    violations: findings,
  };
  summary.detections = findings;

  return summary;
}

export const listIAM = async (req, res) => {
  try {
    const { roleArn } = req.body;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = parseArnAccountId(roleArn);
    const clients = await assumeRoleAndClients(roleArn, region);

    const [usersResp, groupsResp, rolesResp] = await Promise.all([
      clients.iamClient.send(new ListUsersCommand({})),
      clients.iamClient.send(new ListGroupsCommand({})).catch(() => ({ Groups: [] })),
      clients.iamClient.send(new ListRolesCommand({})),
    ]);

    const users = [];
    for (const user of usersResp.Users || []) {
      try {
        users.push(await collectIamUserSummary(clients, user));
      } catch (error) {
        console.warn(`IAM user summary failed for ${user.UserName}:`, error.message);
      }
    }

    const groups = (groupsResp.Groups || []).map((group) => ({
      type: "Group",
      name: group.GroupName,
      arn: group.Arn,
      path: group.Path,
      createDate: group.CreateDate,
      userCount: 0,
      risk: "Low",
    }));

    const roles = (rolesResp.Roles || []).map((role) => ({
      type: "Role",
      name: role.RoleName,
      arn: role.Arn,
      path: role.Path,
      createDate: role.CreateDate,
      description: role.Description,
      risk: role.RoleName === "AdministratorAccess" ? "Critical" : "Low",
    }));

    return res.json({
      success: true,
      users,
      groups,
      roles,
      meta: {
        accountId,
        region,
        totalUsers: users.length,
        totalGroups: groups.length,
        totalRoles: roles.length,
        mfaUsers: users.filter((user) => user.mfaEnabled).length,
        adminUsers: users.filter((user) => user.administratorAccess).length,
        highRiskUsers: users.filter((user) => user.securitySeverity === "High" || user.securitySeverity === "Critical").length,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getIAMUserDetail = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const userName = req.params.userName;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!userName) return res.status(400).json({ success: false, message: "userName required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const clients = await assumeRoleAndClients(roleArn, region);
    const userResp = await clients.iamClient.send(new GetUserCommand({ UserName: userName }));
    const user = userResp.User;
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const detail = await collectIamUserSummary(clients, user);
    return res.json({ success: true, detail });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getIAMUserMetrics = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const userName = req.params.userName;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!userName) return res.status(400).json({ success: false, message: "userName required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const clients = await assumeRoleAndClients(roleArn, region);
    const user = await clients.iamClient.send(new GetUserCommand({ UserName: userName }));
    const detail = user.User ? await collectIamUserSummary(clients, user.User) : null;

    const activity = detail?.cloudTrailActivity || [];
    const loginTrend = activity.filter((event) => /signin|consolelogin/i.test(String(event.eventName || ""))).slice(0, 12).map((event, index) => ({ index, value: 1 }));
    const apiUsageTrend = activity.filter((event) => !/signin|consolelogin/i.test(String(event.eventName || ""))).slice(0, 12).map((event, index) => ({ index, value: 1 }));

    return res.json({
      success: true,
      metrics: {
        loginTrend,
        apiUsageTrend,
        failedAuthenticationTrends: detail?.failedAuthenticationTrends || 0,
        regionUsage: detail?.regionUsage || {},
        mostUsedServices: detail?.mostUsedServices || {},
        permissionChangeTimeline: detail?.permissionChangeTimeline || [],
        userActivityTimeline: detail?.userActivityTimeline || [],
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getIAMUserActivity = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const userName = req.params.userName;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!userName) return res.status(400).json({ success: false, message: "userName required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const clients = await assumeRoleAndClients(roleArn, region);
    const cloudTrail = await clients.cloudtrailClient.send(
      new LookupEventsCommand({
        LookupAttributes: [{ AttributeKey: "Username", AttributeValue: userName }],
        MaxResults: 100,
      })
    ).catch(() => ({ Events: [] }));

    const activities = (cloudTrail.Events || []).map((event) => ({
      eventId: event.EventId,
      eventName: event.EventName,
      eventTime: event.EventTime,
      username: event.Username,
      resource: event.Resources?.[0]?.ResourceName || null,
      resourceType: event.Resources?.[0]?.ResourceType || null,
      cloudTrailEvent: event.CloudTrailEvent,
    }));

    return res.json({ success: true, activities });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getIAMUserSecurity = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const userName = req.params.userName;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!userName) return res.status(400).json({ success: false, message: "userName required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const clients = await assumeRoleAndClients(roleArn, region);
    const userResp = await clients.iamClient.send(new GetUserCommand({ UserName: userName }));
    const detail = userResp.User ? await collectIamUserSummary(clients, userResp.User) : null;

    if (!detail) return res.status(404).json({ success: false, message: "User not found" });

    return res.json({
      success: true,
      analysis: {
        securityRiskScore: detail.securityRiskScore,
        securitySeverity: detail.securitySeverity,
        complianceStatus: detail.complianceStatus,
        findings: detail.detections,
        administratorAccess: detail.administratorAccess,
        wildcardPermissions: detail.wildcardPermissions,
        crossAccountAccess: detail.crossAccountAccess,
        mfaEnabled: detail.mfaEnabled,
        consoleAccessEnabled: detail.consoleAccessEnabled,
        accessKeys: detail.accessKeys,
        mfaEnforcement: detail.mfaEnforcement,
        rootAccessDetection: detail.rootAccessDetection,
        overprivilegedAccess: detail.overprivilegedAccess,
        unusedCredentials: detail.unusedCredentials,
        inactiveUser: detail.inactiveUser,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== CLOUDWATCH LOGS ====================

function estimateLogGroupMonthlyCost(logGroupData) {
  // CloudWatch Logs pricing (2024): $0.50 per GB ingested, $0.03 per GB stored
  const ingestedGb = (logGroupData.ingestedBytes || 0) / (1024 * 1024 * 1024);
  const storedGb = (logGroupData.storedBytes || 0) / (1024 * 1024 * 1024);
  const queryGb = (logGroupData.queriedBytes || 0) / (1024 * 1024 * 1024);

  const ingestionCost = ingestedGb * 0.5;
  const storageCost = storedGb * 0.03;
  const queryCost = queryGb * 0.01; // CloudWatch Logs Insights: $0.01 per GB scanned

  return {
    ingestionCost: parseFloat(ingestionCost.toFixed(2)),
    storageCost: parseFloat(storageCost.toFixed(2)),
    queryCost: parseFloat(queryCost.toFixed(2)),
    totalMonthlyCost: parseFloat((ingestionCost + storageCost + queryCost).toFixed(2)),
    breakdown: {
      ingestedGb: parseFloat(ingestedGb.toFixed(2)),
      storedGb: parseFloat(storedGb.toFixed(2)),
      queriedGb: parseFloat(queryGb.toFixed(2)),
    },
  };
}

function detectSecurityRisks(logGroup) {
  const risks = [];
  if (!logGroup.kmsKeyId) risks.push("No KMS encryption");
  if (logGroup.retentionInDays === undefined) risks.push("No retention policy");
  if (logGroup.retentionInDays > 365) risks.push("Excessive retention");
  if (logGroup.publicAccess) risks.push("Public access enabled");
  if (logGroup.suspiciousActivity) risks.push("Suspicious activity detected");

  let score = 100;
  score -= !logGroup.kmsKeyId ? 20 : 0;
  score -= !logGroup.retentionInDays ? 15 : 0;
  score -= logGroup.retentionInDays > 365 ? 10 : 0;
  score -= logGroup.publicAccess ? 25 : 0;
  score -= logGroup.suspiciousActivity ? 20 : 0;

  const severity = score < 40 ? "Critical" : score < 60 ? "High" : score < 80 ? "Medium" : "Low";

  return { risks, score, severity };
}

async function analyzeLogGroupLogs(logsClient, logGroupName, limit = 100) {
  const analysis = {
    totalLogEvents: 0,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    debugCount: 0,
    errorPatterns: [],
    failedAuthAttempts: 0,
    unauthorizedAccess: 0,
    apiFailures: 0,
    lambdaErrors: 0,
    ec2Errors: 0,
    suspiciousPatterns: [],
    lastEventTime: null,
    recentEvents: [],
  };

  try {
    let nextToken;
    const streams = [];
    do {
      const streamsResp = await logsClient.send(
        new DescribeLogStreamsCommand({
          logGroupName,
          limit: 50,
          nextToken,
          orderBy: "LastEventTime",
          descending: true,
        })
      );
      streams.push(...(streamsResp.logStreams || []).slice(0, 3)); // Top 3 streams
      nextToken = streamsResp.nextToken;
      if (streams.length >= 3) break;
    } while (nextToken);

    for (const stream of streams) {
      try {
        const eventsResp = await logsClient.send(
          new GetLogEventsCommand({
            logGroupName,
            logStreamName: stream.logStreamName,
            limit: 50,
          })
        );

        (eventsResp.events || []).forEach((event) => {
          const msg = (event.message || "").toLowerCase();
          analysis.totalLogEvents++;
          analysis.lastEventTime = Math.max(analysis.lastEventTime || 0, event.timestamp);

          if (msg.includes("error") || msg.includes("exception") || msg.includes("failed")) {
            analysis.errorCount++;
            analysis.recentEvents.push({
              timestamp: event.timestamp,
              message: event.message,
              severity: "ERROR",
              stream: stream.logStreamName,
            });
          } else if (msg.includes("warn")) {
            analysis.warningCount++;
          } else if (msg.includes("info")) {
            analysis.infoCount++;
          } else {
            analysis.debugCount++;
          }

          if (msg.includes("authentication failed") || msg.includes("invalid credentials")) {
            analysis.failedAuthAttempts++;
          }
          if (msg.includes("unauthorized") || msg.includes("access denied")) {
            analysis.unauthorizedAccess++;
          }
          if (msg.includes("api") && (msg.includes("error") || msg.includes("failed"))) {
            analysis.apiFailures++;
          }
          if (msg.includes("lambda") && msg.includes("error")) {
            analysis.lambdaErrors++;
          }
          if (msg.includes("ec2") && msg.includes("error")) {
            analysis.ec2Errors++;
          }
        });
      } catch (e) {
        // Stream might be empty
      }
    }

    // Detect error patterns
    const errorRegex = /error|exception|failed|fatal/gi;
    if (analysis.errorCount > analysis.totalLogEvents * 0.1) {
      analysis.errorPatterns.push("High error rate (>10%)");
    }
    if (analysis.failedAuthAttempts > 5) {
      analysis.suspiciousPatterns.push("Multiple failed authentication attempts");
    }
    if (analysis.unauthorizedAccess > 3) {
      analysis.suspiciousPatterns.push("Multiple unauthorized access attempts");
    }
  } catch (e) {
    console.warn(`Log analysis failed for ${logGroupName}:`, e.message);
  }

  return analysis;
}

async function summarizeLogGroup(logsClient, logGroup, accountId, region) {
  const summary = {
    logGroupName: logGroup.logGroupName,
    arn: logGroup.arn,
    accountId,
    region,
    creationTime: logGroup.creationTime ? new Date(logGroup.creationTime).toISOString() : null,
    retentionInDays: logGroup.retentionInDays || "Never",
    storedBytes: logGroup.storedBytes || 0,
    tags: logGroup.tags || {},
    kmsKeyId: logGroup.kmsKeyId || null,
    logStreamCount: 0,
    lastEventTime: null,
    lastIngestionTime: null,
    ingestedBytes: 0,
    analysis: {},
    security: {},
    cost: {},
    findings: [],
  };

  try {
    // Get log streams count and details
    const streamsResp = await logsClient.send(
      new DescribeLogStreamsCommand({
        logGroupName: logGroup.logGroupName,
        limit: 50,
      })
    );

    const streams = streamsResp.logStreams || [];
    summary.logStreamCount = streams.length;
    summary.lastEventTime = Math.max(...streams.map((s) => s.lastEventTimestamp || 0));
    summary.lastIngestionTime = Math.max(...streams.map((s) => s.lastIngestionTime || 0));

    // Detect source/service
    const logGroupNameLower = logGroup.logGroupName.toLowerCase();
    if (logGroupNameLower.includes("lambda")) summary.source = "Lambda";
    else if (logGroupNameLower.includes("ec2")) summary.source = "EC2";
    else if (logGroupNameLower.includes("ecs")) summary.source = "ECS";
    else if (logGroupNameLower.includes("api-gateway")) summary.source = "API Gateway";
    else if (logGroupNameLower.includes("cloudtrail")) summary.source = "CloudTrail";
    else if (logGroupNameLower.includes("rds")) summary.source = "RDS";
    else if (logGroupNameLower.includes("vpc")) summary.source = "VPC Flow Logs";
    else if (logGroupNameLower.includes("route53")) summary.source = "Route53";
    else summary.source = "Custom Application";

    // Analyze logs
    summary.analysis = await analyzeLogGroupLogs(logsClient, logGroup.logGroupName);

    // Security assessment
    const securityRisks = detectSecurityRisks({
      kmsKeyId: logGroup.kmsKeyId,
      retentionInDays: logGroup.retentionInDays,
      publicAccess: false,
      suspiciousActivity: summary.analysis.suspiciousPatterns.length > 0,
    });
    summary.security = securityRisks;

    // Cost estimation
    summary.cost = estimateLogGroupMonthlyCost({
      storedBytes: logGroup.storedBytes || 0,
      ingestedBytes: summary.analysis.totalLogEvents * 100, // Rough estimate
      queriedBytes: 0,
    });

    // Build findings
    summary.findings = [
      !logGroup.kmsKeyId ? "No KMS encryption configured" : null,
      !logGroup.retentionInDays ? "No log retention policy" : null,
      logGroup.retentionInDays > 365 ? "Excessive retention (>1 year)" : null,
      summary.analysis.errorCount > summary.analysis.totalLogEvents * 0.1 ? "High error rate detected" : null,
      summary.analysis.failedAuthAttempts > 5 ? "Multiple failed auth attempts" : null,
      summary.analysis.unauthorizedAccess > 3 ? "Unauthorized access detected" : null,
    ].filter(Boolean);
  } catch (e) {
    console.warn(`Log group summary failed for ${logGroup.logGroupName}:`, e.message);
  }

  return summary;
}

export const listCloudWatchLogs = async (req, res) => {
  try {
    const { roleArn } = req.body;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    
    console.log("[CloudWatch Logs] Initializing clients with region:", region);
    const clients = await assumeRoleAndClients(roleArn, region);
    const { logsClient } = clients;
    
    if (!logsClient) {
      console.error("[CloudWatch Logs] ERROR: logsClient is undefined");
      return res.status(500).json({ success: false, message: "Failed to initialize CloudWatch Logs client" });
    }

    const logGroups = [];
    try {
      let nextToken;
      do {
        console.log("[CloudWatch Logs] Fetching log groups with nextToken:", nextToken || "none");
        const resp = await logsClient.send(
          new DescribeLogGroupsCommand({ limit: 50, nextToken })
        );

        const groups = resp.logGroups || [];
        console.log("[CloudWatch Logs] Found", groups.length, "log groups");

        for (const lg of groups) {
          try {
            const summary = await summarizeLogGroup(logsClient, lg, accountId, region);
            logGroups.push(summary);
          } catch (e) {
            console.warn(`[CloudWatch Logs] Failed to summarize log group ${lg.logGroupName}:`, e.message);
          }
        }

        nextToken = resp.nextToken;
      } while (nextToken);
    } catch (e) {
      console.warn("[CloudWatch Logs] List failed:", e.message);
    }

    console.log("[CloudWatch Logs] Processing complete. Total log groups:", logGroups.length);

    const stats = {
      totalLogGroups: logGroups.length,
      withEncryption: logGroups.filter((lg) => lg.kmsKeyId).length,
      withRetention: logGroups.filter((lg) => lg.retentionInDays !== "Never").length,
      highRisk: logGroups.filter((lg) => lg.security?.severity === "Critical" || lg.security?.severity === "High").length,
      estimatedMonthlyCost: parseFloat(
        logGroups.reduce((sum, lg) => sum + (lg.cost?.totalMonthlyCost || 0), 0).toFixed(2)
      ),
    };

    // Handle empty log groups gracefully
    if (logGroups.length === 0) {
      console.log("[CloudWatch Logs] No log groups found");
      return res.json({ 
        success: true, 
        logGroups: [], 
        stats,
        message: "No CloudWatch Log Groups found in this account",
      });
    }

    return res.json({ success: true, logGroups, stats });
  } catch (error) {
    console.error("[CloudWatch Logs] Error in listCloudWatchLogs:", error.message, error.stack);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCloudWatchLogDetail = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const logGroupName = req.params.logGroupName;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!logGroupName) return res.status(400).json({ success: false, message: "logGroupName required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    
    console.log("[CloudWatch Log Detail] Initializing clients for log group:", logGroupName);
    const clients = await assumeRoleAndClients(roleArn, region);
    const { logsClient } = clients;
    
    if (!logsClient) {
      console.error("[CloudWatch Log Detail] ERROR: logsClient is undefined");
      return res.status(500).json({ success: false, message: "Failed to initialize CloudWatch Logs client" });
    }

    const resp = await logsClient.send(
      new DescribeLogGroupsCommand({
        logGroupNamePrefix: logGroupName,
      })
    );

    const logGroup = (resp.logGroups || []).find((lg) => lg.logGroupName === logGroupName);
    if (!logGroup) {
      return res.status(404).json({ success: false, message: "Log group not found" });
    }

    const detail = await summarizeLogGroup(logsClient, logGroup, accountId, region);

    return res.json({ success: true, detail });
  } catch (error) {
    console.error("[CloudWatch Log Detail] Error:", error.message, error.stack);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== COST & BILLING ====================

export const getCost = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const days = req.body.days || 30; // Get last N days of costs
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    const { ceClient } = await assumeRoleAndClients(roleArn, "us-east-1"); // Cost Explorer is us-east-1 only

    const now = new Date();
    const startDate = new Date(Date.now() - days * 24 * 3600 * 1000);

    const start = startDate.toISOString().split("T")[0];
    const end = now.toISOString().split("T")[0];

    const costData = {
      period: { start, end },
      daysRequested: days,
      currentDate: now.toISOString(),
      historicalCosts: [],
      estimatedMonthlyTotal: 0,
      byService: {},
      byLinkedAccount: {},
      topCostDrivers: [],
    };

    try {
      // Get historical costs by day
      const historicalResp = await ceClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: start, End: end },
          Granularity: "DAILY",
          Metrics: ["UnblendedCost"],
          GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
        })
      );

      (historicalResp.ResultsByTime || []).forEach((row) => {
        const dailyTotal = (row.Groups || []).reduce(
          (sum, group) => sum + Number(group.Metrics?.UnblendedCost?.Amount || 0),
          0
        );
        costData.historicalCosts.push({
          date: row.TimePeriod?.Start,
          total: parseFloat(dailyTotal.toFixed(2)),
          unit: row.Groups?.[0]?.Metrics?.UnblendedCost?.Unit || "USD",
          byService: (row.Groups || []).reduce((acc, group) => {
            acc[group.Keys?.[0] || "Unknown"] = {
              cost: parseFloat(Number(group.Metrics?.UnblendedCost?.Amount || 0).toFixed(2)),
              unit: group.Metrics?.UnblendedCost?.Unit || "USD",
            };
            return acc;
          }, {}),
        });

        // Aggregate by service
        (row.Groups || []).forEach((group) => {
          const service = group.Keys?.[0] || "Unknown";
          const cost = Number(group.Metrics?.UnblendedCost?.Amount || 0);
          costData.byService[service] = (costData.byService[service] || 0) + cost;
        });
      });

      // Get current month estimate
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      const thisMonthResp = await ceClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: thisMonthStart, End: end },
          Granularity: "MONTHLY",
          Metrics: ["UnblendedCost"],
        })
      );

      const thisMonthCost = Number(
        thisMonthResp.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount || 0
      );
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const daysSoFar = now.getDate();
      const estimatedFullMonth = (thisMonthCost / daysSoFar) * daysInMonth;

      costData.estimatedMonthlyTotal = parseFloat(estimatedFullMonth.toFixed(2));
      costData.thisMonthActual = parseFloat(thisMonthCost.toFixed(2));
      costData.averageDailyCost = parseFloat(
        (costData.historicalCosts.reduce((sum, day) => sum + day.total, 0) /
          Math.max(1, costData.historicalCosts.length)).toFixed(2)
      );

      // Get top cost drivers
      costData.topCostDrivers = Object.entries(costData.byService)
        .map(([service, cost]) => ({ service, cost: parseFloat(cost.toFixed(2)) }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10);

      costData.summary = {
        accountId,
        region,
        totalHistoricalCost: parseFloat(
          costData.historicalCosts.reduce((sum, day) => sum + day.total, 0).toFixed(2)
        ),
        averageDailyCost: costData.averageDailyCost,
        estimatedMonthlyTotal: costData.estimatedMonthlyTotal,
        thisMonthActual: costData.thisMonthActual,
        daysIntoMonth: daysSoFar,
        projectedMonthTotal: estimatedFullMonth,
      };
    } catch (e) {
      console.warn("Cost Explorer request failed:", e.message);
      // Return empty costs if API fails
      costData.error = e.message;
      costData.historicalCosts = [];
      costData.estimatedMonthlyTotal = 0;
    }

    return res.json({ success: true, costs: costData });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

function parseRoleName(roleArn = "") {
  const value = String(roleArn || "");
  const index = value.lastIndexOf("/");
  return index >= 0 ? value.slice(index + 1) : value;
}

function evaluateLambdaSecurity(lambda) {
  let score = 100;
  if (!lambda.kmsEncrypted) score -= 15;
  if (!lambda.codeSigningEnabled) score -= 5;
  if (lambda.publicFunctionUrl) score -= 20;
  if (lambda.crossAccountAccess) score -= 20;
  if (lambda.secretsExposureDetection) score -= 15;
  if (lambda.excessiveIamPermissions) score -= 10;
  if (!lambda.deadLetterQueueConfigured) score -= 10;
  if (lambda.timeout > 120) score -= 5;
  score = Math.max(0, Math.min(100, score));

  let severity = "Low";
  if (score < 40) severity = "Critical";
  else if (score < 60) severity = "High";
  else if (score < 80) severity = "Medium";

  return { score, severity };
}

function buildLambdaCompliance(lambda) {
  const violations = [];
  if (!lambda.kmsEncrypted) violations.push("KMS encryption not configured for environment variables");
  if (lambda.publicFunctionUrl) violations.push("Function URL is publicly accessible");
  if (lambda.crossAccountAccess) violations.push("Cross-account invoke permissions detected");
  if (lambda.secretsExposureDetection) violations.push("Potential secrets in environment variables");
  if (!lambda.deadLetterQueueConfigured) violations.push("No dead letter queue configured");
  if (lambda.oldRuntimeVersion) violations.push("Function uses an old runtime version");

  return {
    compliant: violations.length === 0,
    status: violations.length === 0 ? "Compliant" : violations.length >= 3 ? "Non-Compliant" : "At Risk",
    violations,
  };
}

function buildLambdaCostEstimate(lambda) {
  const monthlyInvocations = Number(lambda.invocationCount || 0);
  const avgDurationMs = Number(lambda.avgDurationMs || 0);
  const memoryGb = Math.max(0.125, Number(lambda.memorySize || 128) / 1024);

  const requestCost = (monthlyInvocations / 1000000) * 0.2;
  const durationGbSeconds = monthlyInvocations * (avgDurationMs / 1000) * memoryGb;
  const durationCost = durationGbSeconds * 0.0000166667;
  const provisionedConcurrencyCost = lambda.provisionedConcurrency > 0 ? lambda.provisionedConcurrency * 730 * 0.0000041667 : 0;

  return {
    estimatedMonthlyCost: requestCost + durationCost + provisionedConcurrencyCost,
    invocationCost: requestCost,
    durationCost,
    requestCost,
    provisionedConcurrencyCost,
    costOptimizationSuggestions: [
      lambda.timeout > 120 ? "Reduce timeout to lower billed duration risk" : null,
      lambda.idleFunctionDetection ? "Consider disabling or removing idle function" : null,
      lambda.memorySize >= 2048 ? "Validate if memory can be right-sized" : null,
      !lambda.deadLetterQueueConfigured ? "Configure DLQ to avoid repeated failure cost" : null,
    ].filter(Boolean),
  };
}

function inferConnectedService(arn = "") {
  const value = String(arn || "").toLowerCase();
  if (value.includes(":sqs:")) return "SQS";
  if (value.includes(":kinesis:")) return "Kinesis";
  if (value.includes(":dynamodb:")) return "DynamoDB Streams";
  if (value.includes(":mq:")) return "Amazon MQ";
  if (value.includes(":kafka:")) return "MSK";
  if (value.includes(":s3:")) return "S3";
  return "Unknown";
}

async function collectLambdaMetrics(cloudwatchClient, functionName, days = 7) {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 3600 * 1000);
  const dimensions = [{ Name: "FunctionName", Value: functionName }];

  const queries = [
    { Id: "invocations", MetricStat: { Metric: { Namespace: "AWS/Lambda", MetricName: "Invocations", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "errors", MetricStat: { Metric: { Namespace: "AWS/Lambda", MetricName: "Errors", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "duration", MetricStat: { Metric: { Namespace: "AWS/Lambda", MetricName: "Duration", Dimensions: dimensions }, Period: 3600, Stat: "Average" } },
    { Id: "throttles", MetricStat: { Metric: { Namespace: "AWS/Lambda", MetricName: "Throttles", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "concurrent", MetricStat: { Metric: { Namespace: "AWS/Lambda", MetricName: "ConcurrentExecutions", Dimensions: dimensions }, Period: 3600, Stat: "Maximum" } },
  ];

  const metrics = {};
  try {
    const resp = await cloudwatchClient.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: end,
        MetricDataQueries: queries,
        ScanBy: "TimestampAscending",
      })
    );

    (resp.MetricDataResults || []).forEach((row) => {
      metrics[row.Id] = {
        label: row.Label,
        timestamps: (row.Timestamps || []).map((t) => new Date(t).toISOString()),
        values: row.Values || [],
      };
    });
  } catch (error) {
    console.warn(`Lambda metrics failed for ${functionName}:`, error.message);
  }

  const inv = (metrics.invocations?.values || []).reduce((sum, value) => sum + Number(value || 0), 0);
  const err = (metrics.errors?.values || []).reduce((sum, value) => sum + Number(value || 0), 0);
  const throttles = (metrics.throttles?.values || []).reduce((sum, value) => sum + Number(value || 0), 0);
  const avgDurationMs = (metrics.duration?.values || []).length
    ? (metrics.duration.values.reduce((sum, value) => sum + Number(value || 0), 0) / metrics.duration.values.length)
    : 0;

  return {
    ...metrics,
    invocationCount: inv,
    errorCount: err,
    throttlesCount: throttles,
    avgDurationMs,
    successRate: inv > 0 ? ((inv - err) / inv) * 100 : 100,
    retryAttempts: err,
    coldStarts: Math.round(inv * 0.04),
  };
}

async function collectLambdaActivity(cloudtrailClient, functionName, limit = 100) {
  const events = [];
  try {
    let nextToken;
    do {
      const resp = await cloudtrailClient.send(
        new LookupEventsCommand({
          LookupAttributes: [{ AttributeKey: "ResourceName", AttributeValue: functionName }],
          NextToken: nextToken,
          MaxResults: Math.min(50, limit),
        })
      );
      (resp.Events || []).forEach((event) => {
        const parsed = safeParseEvent(event.CloudTrailEvent);
        const identity = parsed?.userIdentity || {};
        events.push({
          eventId: event.EventId,
          eventName: event.EventName,
          eventTime: event.EventTime,
          username: event.Username || identity.userName || identity.arn || null,
          sourceIp: parsed?.sourceIPAddress || null,
          userAgent: parsed?.userAgent || null,
          assumedRole: identity.sessionContext?.sessionIssuer?.arn || null,
          requestParameters: parsed?.requestParameters || null,
        });
      });
      nextToken = resp.NextToken;
    } while (nextToken && events.length < limit);
  } catch (error) {
    console.warn(`Lambda activity failed for ${functionName}:`, error.message);
  }

  return events.sort((a, b) => new Date(b.eventTime || 0) - new Date(a.eventTime || 0));
}

async function collectLambdaLogs(logsClient, functionName) {
  const logGroupName = `/aws/lambda/${functionName}`;
  const output = {
    logGroupName,
    recentStreams: [],
    recentEvents: [],
  };

  try {
    const streams = await logsClient.send(
      new DescribeLogStreamsCommand({
        logGroupName,
        orderBy: "LastEventTime",
        descending: true,
        limit: 5,
      })
    );

    const streamItems = streams.logStreams || [];
    output.recentStreams = streamItems.map((stream) => ({
      logStreamName: stream.logStreamName,
      lastEventTimestamp: stream.lastEventTimestamp,
      lastIngestionTime: stream.lastIngestionTime,
    }));

    if (streamItems[0]?.logStreamName) {
      const events = await logsClient.send(
        new GetLogEventsCommand({
          logGroupName,
          logStreamName: streamItems[0].logStreamName,
          limit: 40,
          startFromHead: false,
        })
      );
      output.recentEvents = (events.events || []).map((event) => ({
        timestamp: event.timestamp,
        message: event.message,
      }));
    }
  } catch {
    // Missing log permissions is acceptable in read-only mode.
  }

  return output;
}

async function collectRolePermissions(iamClient, roleArn) {
  const roleName = parseRoleName(roleArn);
  if (!roleName) return { managedPolicies: [], inlinePolicies: [] };

  try {
    const [managed, inline] = await Promise.all([
      iamClient.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName })).catch(() => ({ AttachedPolicies: [] })),
      iamClient.send(new ListRolePoliciesCommand({ RoleName: roleName })).catch(() => ({ PolicyNames: [] })),
    ]);

    return {
      managedPolicies: (managed.AttachedPolicies || []).map((policy) => policy.PolicyArn || policy.PolicyName),
      inlinePolicies: inline.PolicyNames || [],
    };
  } catch {
    return { managedPolicies: [], inlinePolicies: [] };
  }
}

function checkSecretsExposure(envVars = {}) {
  const keys = Object.keys(envVars || {});
  const suspicious = keys.filter((key) => /(secret|password|token|key|credential)/i.test(key));
  return {
    detected: suspicious.length > 0,
    keys: suspicious,
  };
}

function isOldRuntime(runtime = "") {
  const value = String(runtime || "").toLowerCase();
  const oldRuntimePatterns = ["nodejs12", "nodejs14", "python3.7", "python3.8", "java8", "dotnetcore2.1"];
  return oldRuntimePatterns.some((pattern) => value.includes(pattern));
}

async function summarizeLambdaFunction(clients, fn, accountId, region) {
  const functionName = fn.FunctionName;
  const full = await clients.lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
  const config = full.Configuration || fn;

  const [tagsResp, functionUrlResp, policyResp, eventSourcesResp, metrics, activity, logs, permissions] = await Promise.all([
    clients.lambdaClient.send(new ListTagsCommand({ Resource: config.FunctionArn })).catch(() => ({ Tags: {} })),
    clients.lambdaClient.send(new GetFunctionUrlConfigCommand({ FunctionName: functionName })).catch(() => null),
    clients.lambdaClient.send(new GetPolicyCommand({ FunctionName: functionName })).catch(() => null),
    clients.lambdaClient.send(new ListEventSourceMappingsCommand({ FunctionName: functionName, MaxItems: 100 })).catch(() => ({ EventSourceMappings: [] })),
    collectLambdaMetrics(clients.cloudwatchClient, functionName, 7),
    collectLambdaActivity(clients.cloudtrailClient, functionName, 100),
    collectLambdaLogs(clients.logsClient, functionName),
    collectRolePermissions(clients.iamClient, config.Role || ""),
  ]);

  const tags = tagsResp.Tags || {};
  const envVars = config.Environment?.Variables || {};
  const secrets = checkSecretsExposure(envVars);
  const policyDoc = policyResp?.Policy ? safeParseEvent(policyResp.Policy) : null;
  const policyText = JSON.stringify(policyDoc || {});
  const crossAccountAccess = /\"AWS\"\s*:\s*\"arn:aws:iam::(?!\d{12}:role\/|\d{12}:user\/)/i.test(policyText) ||
    /\"AWS\"\s*:\s*\"\*\"/i.test(policyText) ||
    /\"Principal\"\s*:\s*\"\*\"/i.test(policyText);

  const eventSources = (eventSourcesResp.EventSourceMappings || []).map((mapping) => ({
    uuid: mapping.UUID,
    state: mapping.State,
    eventSourceArn: mapping.EventSourceArn,
    batchSize: mapping.BatchSize,
    lastModified: mapping.LastModified,
    sourceType: inferConnectedService(mapping.EventSourceArn),
  }));
  const connectedServices = Array.from(new Set(eventSources.map((source) => source.sourceType).filter(Boolean)));

  const createdEvent = activity.find((event) => /createfunction/i.test(String(event.eventName || ""))) || activity[activity.length - 1] || null;
  const modifiedEvent = activity.find((event) => /updatefunction|updatefunctionconfiguration|updatefunctioncode/i.test(String(event.eventName || ""))) || activity[0] || null;

  const summary = {
    functionName,
    arn: config.FunctionArn,
    awsAccountId: accountId,
    region: config.FunctionArn?.split(":")[3] || region,
    runtime: config.Runtime || "Unknown",
    runtimeVersion: config.RuntimeVersionConfig?.RuntimeVersionArn || config.Runtime || "Unknown",
    handler: config.Handler || "-",
    description: config.Description || "-",
    architecture: (config.Architectures || ["x86_64"])[0],
    memorySize: config.MemorySize || 128,
    timeout: config.Timeout || 3,
    ephemeralStorage: config.EphemeralStorage?.Size || 512,
    lastModifiedTime: config.LastModified || null,
    creationTime: createdEvent?.eventTime || config.LastModified || null,
    tags: Object.entries(tags).map(([key, value]) => ({ key, value })),
    functionUrl: functionUrlResp?.FunctionUrl || null,

    vpcConfiguration: config.VpcConfig || null,
    subnets: config.VpcConfig?.SubnetIds || [],
    securityGroups: config.VpcConfig?.SecurityGroupIds || [],
    internetAccess: config.VpcConfig?.SubnetIds?.length ? "Private via VPC" : "Managed Lambda networking",
    privatePublicAccess: functionUrlResp?.AuthType === "NONE" ? "Public" : "Private",
    apiGatewayIntegration: activity.some((event) => /apigateway/i.test(JSON.stringify(event.requestParameters || {}))),
    eventSources,
    triggers: eventSources.map((source) => source.sourceType),
    connectedServices,

    executionIamRole: config.Role || null,
    attachedPermissions: permissions,
    environmentVariables: envVars,
    kmsEncryption: config.KMSKeyArn || null,
    kmsEncrypted: Boolean(config.KMSKeyArn),
    codeSigningStatus: config.SigningProfileVersionArn ? "Enabled" : "Disabled",
    codeSigningEnabled: Boolean(config.SigningProfileVersionArn),
    publicFunctionUrl: functionUrlResp?.AuthType === "NONE",
    crossAccountAccess,
    secretsExposureDetection: secrets.detected,
    exposedSecretKeys: secrets.keys,

    invocationCount: metrics.invocationCount || 0,
    errorCount: metrics.errorCount || 0,
    duration: metrics.duration?.values || [],
    avgDurationMs: metrics.avgDurationMs || 0,
    concurrentExecutions: Math.max(...(metrics.concurrent?.values || [0])),
    throttles: metrics.throttlesCount || 0,
    coldStarts: metrics.coldStarts || 0,
    successRate: metrics.successRate || 100,
    retryAttempts: metrics.retryAttempts || 0,
    deadLetterQueueStatus: config.DeadLetterConfig?.TargetArn ? "Configured" : "Not Configured",
    deadLetterQueueConfigured: Boolean(config.DeadLetterConfig?.TargetArn),
    cloudWatchMetrics: metrics,
    cloudWatchLogs: logs,
    performanceTrends: {
      invocations: metrics.invocations?.values || [],
      errors: metrics.errors?.values || [],
      duration: metrics.duration?.values || [],
      throttles: metrics.throttles?.values || [],
    },
    recentChanges: activity.slice(0, 10),

    createdBy: createdEvent ? toEventIdentity(createdEvent).createdBy : null,
    sourceIp: createdEvent ? toEventIdentity(createdEvent).sourceIp : null,
    eventName: createdEvent?.eventName || null,
    eventTime: createdEvent?.eventTime || null,
    lastModifiedBy: modifiedEvent ? toEventIdentity(modifiedEvent).createdBy : null,
    assumedRole: modifiedEvent ? toEventIdentity(modifiedEvent).assumedRole : null,
    userAgent: modifiedEvent ? toEventIdentity(modifiedEvent).userAgent : null,
    deploymentActivity: activity.filter((event) => /updatefunctioncode|createfunction|publishversion/i.test(String(event.eventName || ""))),
    permissionChanges: activity.filter((event) => /addpermission|removepermission|putpolicy|deletepolicy/i.test(String(event.eventName || ""))),
    triggerChanges: activity.filter((event) => /createeventsourcemapping|updateeventsourcemapping|deleteeventsourcemapping/i.test(String(event.eventName || ""))),
    configurationUpdates: activity.filter((event) => /updatefunctionconfiguration/i.test(String(event.eventName || ""))),
  };

  summary.excessiveIamPermissions = summary.attachedPermissions.managedPolicies.length > 5;
  summary.highErrorRates = summary.errorCount > 0 && (summary.errorCount / Math.max(1, summary.invocationCount)) > 0.05;
  summary.excessiveTimeout = summary.timeout > 120;
  summary.highThrottling = summary.throttles > 0;
  summary.unusedFunctions = summary.invocationCount === 0;
  summary.idleFunctionDetection = summary.invocationCount < 20;
  summary.oldRuntimeVersion = isOldRuntime(summary.runtime);
  summary.missingEncryption = !summary.kmsEncrypted;

  const risk = evaluateLambdaSecurity(summary);
  summary.securityRiskScore = risk.score;
  summary.securitySeverity = risk.severity;
  summary.complianceStatus = buildLambdaCompliance(summary);
  summary.cost = buildLambdaCostEstimate(summary);

  summary.findings = [
    summary.excessiveIamPermissions ? "Excessive IAM permissions" : null,
    summary.publicFunctionUrl ? "Public Function URL exposure" : null,
    summary.secretsExposureDetection ? "Secrets in environment variables" : null,
    summary.missingEncryption ? "Missing encryption" : null,
    summary.highErrorRates ? "High error rates" : null,
    summary.excessiveTimeout ? "Excessive timeout" : null,
    summary.highThrottling ? "High throttling" : null,
    !summary.deadLetterQueueConfigured ? "No DLQ configured" : null,
    summary.unusedFunctions ? "Unused function" : null,
    summary.oldRuntimeVersion ? "Old runtime version" : null,
  ].filter(Boolean);

  return summary;
}

export const listLambda = async (req, res) => {
  try {
    const { roleArn } = req.body;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    const clients = await assumeRoleAndClients(roleArn, region);

    const resp = await clients.lambdaClient.send(new ListFunctionsCommand({ MaxItems: 1000 }));
    const functions = [];

    for (const fn of resp.Functions || []) {
      try {
        const summary = await summarizeLambdaFunction(clients, fn, accountId, region);
        functions.push(summary);
      } catch (error) {
        console.warn(`Lambda summary failed for ${fn.FunctionName}:`, error.message);
      }
    }

    return res.json({
      success: true,
      functions,
      meta: {
        accountId,
        region,
        totalFunctions: functions.length,
        publicFunctions: functions.filter((fn) => fn.publicFunctionUrl).length,
        highRiskFunctions: functions.filter((fn) => fn.securitySeverity === "High" || fn.securitySeverity === "Critical").length,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getLambdaDetail = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const functionName = req.params.name;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!functionName) return res.status(400).json({ success: false, message: "function name required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    const clients = await assumeRoleAndClients(roleArn, region);

    const response = await clients.lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
    if (!response?.Configuration) {
      return res.status(404).json({ success: false, message: "Function not found" });
    }

    const detail = await summarizeLambdaFunction(clients, response.Configuration, accountId, region);
    return res.json({ success: true, detail });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getLambdaMetrics = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const functionName = req.params.name;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!functionName) return res.status(400).json({ success: false, message: "function name required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const { cloudwatchClient } = await assumeRoleAndClients(roleArn, region);
    const metrics = await collectLambdaMetrics(cloudwatchClient, functionName, 7);

    return res.json({ success: true, metrics });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getLambdaActivity = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const functionName = req.params.name;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!functionName) return res.status(400).json({ success: false, message: "function name required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const { cloudtrailClient } = await assumeRoleAndClients(roleArn, region);
    const activities = await collectLambdaActivity(cloudtrailClient, functionName, 100);

    return res.json({ success: true, activities });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getLambdaSecurity = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const functionName = req.params.name;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!functionName) return res.status(400).json({ success: false, message: "function name required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    const clients = await assumeRoleAndClients(roleArn, region);
    const resp = await clients.lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));

    if (!resp?.Configuration) {
      return res.status(404).json({ success: false, message: "Function not found" });
    }

    const detail = await summarizeLambdaFunction(clients, resp.Configuration, accountId, region);
    return res.json({
      success: true,
      analysis: {
        executionIamRole: detail.executionIamRole,
        attachedPermissions: detail.attachedPermissions,
        environmentVariables: detail.environmentVariables,
        kmsEncryption: detail.kmsEncryption,
        codeSigningStatus: detail.codeSigningStatus,
        publicFunctionUrl: detail.publicFunctionUrl,
        crossAccountAccess: detail.crossAccountAccess,
        secretsExposureDetection: detail.secretsExposureDetection,
        exposedSecretKeys: detail.exposedSecretKeys,
        securityRiskScore: detail.securityRiskScore,
        securitySeverity: detail.securitySeverity,
        complianceStatus: detail.complianceStatus,
        findings: detail.findings,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DynamoDB Service Functions ====================

function estimateDynamoDBTableCost(table) {
  // DynamoDB pricing (approximate, per hour)
  const onDemandWrite = 1.25 / 1000000; // per write unit
  const onDemandRead = 0.25 / 1000000; // per read unit
  const provisionedWrite = 1.25 / 1000000;
  const provisionedRead = 0.25 / 1000000;
  const storagePerGb = 0.25; // per GB per month

  let writeCost = 0;
  let readCost = 0;
  let storageCost = 0;

  if (table.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST") {
    // Estimate based on usage
    const estimatedWrites = 1000 * 24 * 30; // 1000/day
    const estimatedReads = 5000 * 24 * 30; // 5000/day
    writeCost = estimatedWrites * onDemandWrite;
    readCost = estimatedReads * onDemandRead;
  } else {
    writeCost = (table.BillingModeSummary?.LastUpdateToPayPerRequestDateTime
      ? 0
      : (table.ProvisionedThroughput?.WriteCapacityUnits || 0) * provisionedWrite * 730);
    readCost = (table.BillingModeSummary?.LastUpdateToPayPerRequestDateTime
      ? 0
      : (table.ProvisionedThroughput?.ReadCapacityUnits || 0) * provisionedRead * 730);
  }

  const storageSizeGb = (table.TableSizeBytes || 0) / (1024 * 1024 * 1024);
  storageCost = storageSizeGb * storagePerGb;

  // Add index costs
  let indexCost = 0;
  if (table.GlobalSecondaryIndexes) {
    table.GlobalSecondaryIndexes.forEach((gsi) => {
      if (gsi.BillingModeSummary?.BillingMode === "PROVISIONED") {
        indexCost += (gsi.ProvisionedThroughput?.ReadCapacityUnits || 0) * provisionedRead * 730;
        indexCost += (gsi.ProvisionedThroughput?.WriteCapacityUnits || 0) * provisionedWrite * 730;
      }
      const indexSize = (gsi.IndexSizeBytes || 0) / (1024 * 1024 * 1024);
      indexCost += indexSize * storagePerGb;
    });
  }

  const backupCost = 0.1; // Simplified estimate
  const totalMonthlyCost = writeCost + readCost + storageCost + indexCost + backupCost;

  return {
    writeCost: parseFloat(writeCost.toFixed(2)),
    readCost: parseFloat(readCost.toFixed(2)),
    storageCost: parseFloat(storageCost.toFixed(2)),
    indexCost: parseFloat(indexCost.toFixed(2)),
    backupCost,
    totalMonthlyCost: parseFloat(totalMonthlyCost.toFixed(2)),
  };
}

function analyzeDynamoDBSecurity(table, tags = []) {
  const risks = [];
  const findings = [];

  if (!table.SSEDescription?.Enabled) {
    risks.push("Encryption disabled");
    findings.push("Table is not encrypted at rest");
  } else if (!table.SSEDescription?.KMSMasterKeyArn?.includes("arn:aws:kms:")) {
    findings.push("Using default AWS managed encryption");
  }

  if (!table.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus) {
    risks.push("No PITR enabled");
    findings.push("Point-in-Time Recovery is not enabled - data loss recovery not possible");
  }

  if (table.DeletionProtectionEnabled === false) {
    findings.push("Deletion protection not enabled - table can be accidentally deleted");
  }

  // Check for public access
  if (table.Tags?.some((t) => t.Key === "public" && t.Value === "true")) {
    risks.push("Public access enabled");
    findings.push("Table is marked as publicly accessible");
  }

  // Check billing mode
  if (table.BillingModeSummary?.BillingMode === "PROVISIONED") {
    if ((table.ProvisionedThroughput?.ReadCapacityUnits || 0) === 0) {
      findings.push("Read capacity is 0 - table may be throttling");
    }
    if ((table.ProvisionedThroughput?.WriteCapacityUnits || 0) === 0) {
      findings.push("Write capacity is 0 - table may be throttling");
    }
  }

  let score = 100;
  score -= !table.SSEDescription?.Enabled ? 25 : 0;
  score -= !table.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus ? 20 : 0;
  score -= table.DeletionProtectionEnabled === false ? 15 : 0;
  score -= risks.length * 10;

  const severity = score < 40 ? "Critical" : score < 60 ? "High" : score < 80 ? "Medium" : "Low";

  return { risks, findings, score, severity };
}

async function collectDynamoDBMetrics(cloudwatchClient, tableName, days = 7) {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 3600 * 1000);
  const dimensions = [{ Name: "TableName", Value: tableName }];

  const queries = [
    { Id: "readThroughput", MetricStat: { Metric: { Namespace: "AWS/DynamoDB", MetricName: "ReadThrottleEvents", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "writeThroughput", MetricStat: { Metric: { Namespace: "AWS/DynamoDB", MetricName: "WriteThrottleEvents", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "consumedRead", MetricStat: { Metric: { Namespace: "AWS/DynamoDB", MetricName: "ConsumedReadCapacityUnits", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "consumedWrite", MetricStat: { Metric: { Namespace: "AWS/DynamoDB", MetricName: "ConsumedWriteCapacityUnits", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "userErrors", MetricStat: { Metric: { Namespace: "AWS/DynamoDB", MetricName: "UserErrors", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "systemErrors", MetricStat: { Metric: { Namespace: "AWS/DynamoDB", MetricName: "SystemErrors", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
  ];

  const metrics = {};
  try {
    const resp = await cloudwatchClient.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: end,
        MetricDataQueries: queries,
        ScanBy: "TimestampAscending",
      })
    );

    (resp.MetricDataResults || []).forEach((row) => {
      metrics[row.Id] = {
        label: row.Label,
        timestamps: (row.Timestamps || []).map((t) => new Date(t).toISOString()),
        values: row.Values || [],
      };
    });
  } catch (error) {
    console.warn(`DynamoDB metrics failed for ${tableName}:`, error.message);
  }

  const readThrottles = (metrics.readThroughput?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const writeThrottles = (metrics.writeThroughput?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const consumedRead = (metrics.consumedRead?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const consumedWrite = (metrics.consumedWrite?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const userErrors = (metrics.userErrors?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const systemErrors = (metrics.systemErrors?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);

  return {
    ...metrics,
    readThrottles,
    writeThrottles,
    consumedReadCapacity: consumedRead,
    consumedWriteCapacity: consumedWrite,
    userErrorCount: userErrors,
    systemErrorCount: systemErrors,
    totalErrors: userErrors + systemErrors,
  };
}

async function collectDynamoDBActivity(cloudtrailClient, tableName, limit = 100) {
  const events = [];
  try {
    let nextToken;
    do {
      const resp = await cloudtrailClient.send(
        new LookupEventsCommand({
          LookupAttributes: [{ AttributeKey: "ResourceName", AttributeValue: tableName }],
          NextToken: nextToken,
          MaxResults: Math.min(50, limit),
        })
      );
      (resp.Events || []).forEach((event) => {
        const parsed = safeParseEvent(event.CloudTrailEvent);
        const identity = parsed?.userIdentity || {};
        events.push({
          eventId: event.EventId,
          eventName: event.EventName,
          eventTime: event.EventTime,
          username: event.Username || identity.userName || identity.arn || null,
          sourceIp: parsed?.sourceIPAddress || null,
          userAgent: parsed?.userAgent || null,
          assumedRole: identity.sessionContext?.sessionIssuer?.arn || null,
          requestParameters: parsed?.requestParameters || null,
        });
      });
      nextToken = resp.NextToken;
    } while (nextToken && events.length < limit);
  } catch (error) {
    console.warn(`DynamoDB activity failed for ${tableName}:`, error.message);
  }

  return events.sort((a, b) => new Date(b.eventTime || 0) - new Date(a.eventTime || 0));
}

export const listDynamoDB = async (req, res) => {
  try {
    const { roleArn } = req.body;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    
    console.log("[DynamoDB] Initializing clients with region:", region);
    const clients = await assumeRoleAndClients(roleArn, region);
    const { dynamoClient, cloudwatchClient } = clients;
    
    if (!dynamoClient) {
      console.error("[DynamoDB] ERROR: dynamoClient is undefined");
      return res.status(500).json({ success: false, message: "Failed to initialize DynamoDB client" });
    }

    const tables = [];
    let startName;
    do {
      console.log("[DynamoDB] Fetching table list");
      const resp = await dynamoClient.send(new ListTablesCommand({ ExclusiveStartTableName: startName }));
      const tableNames = resp.TableNames || [];
      console.log("[DynamoDB] Found", tableNames.length, "tables");
      
      for (const tableName of tableNames) {
        try {
          console.log("[DynamoDB] Processing table:", tableName);
          const tableResp = await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
          const table = tableResp.Table;
          const tags = [];
          try {
            const tagsResp = await dynamoClient.send(new ListTagsOfResourceCommand({ ResourceArn: table.TableArn }));
            tags.push(...(tagsResp.Tags || []));
          } catch (e) {
            console.warn(`[DynamoDB] Failed to get tags for ${tableName}:`, e.message);
          }

          const metrics = await collectDynamoDBMetrics(cloudwatchClient, tableName, 7);
          const security = analyzeDynamoDBSecurity(table, tags);
          
          let cost = null;
          try {
            cost = estimateDynamoDBTableCost(table);
          } catch (costErr) {
            console.warn(`[DynamoDB] Failed to estimate cost for ${tableName}:`, costErr.message);
            cost = { totalMonthlyCost: 0, breakdown: {} };
          }

          tables.push({
            tableName: table.TableName,
            arn: table.TableArn,
            accountId,
            region,
            status: table.TableStatus,
            creationTime: table.CreationDateTime,
            itemCount: table.ItemCount || 0,
            tableSize: table.TableSizeBytes || 0,
            billingMode: table.BillingModeSummary?.BillingMode || "PROVISIONED",
            readCapacity: table.ProvisionedThroughput?.ReadCapacityUnits || 0,
            writeCapacity: table.ProvisionedThroughput?.WriteCapacityUnits || 0,
            gsiCount: (table.GlobalSecondaryIndexes || []).length,
            lsiCount: (table.LocalSecondaryIndexes || []).length,
            encrypted: table.SSEDescription?.Enabled || false,
            pitrEnabled: table.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus === "ENABLED",
            deletionProtected: table.DeletionProtectionEnabled || false,
            streamStatus: table.StreamSpecification?.StreamViewType || "DISABLED",
            metrics: {
              readThrottles: metrics.readThrottles,
              writeThrottles: metrics.writeThrottles,
              consumedReadCapacity: metrics.consumedReadCapacity,
              consumedWriteCapacity: metrics.consumedWriteCapacity,
              totalErrors: metrics.totalErrors,
            },
            security,
            cost,
            tags,
          });
        } catch (e) {
          console.warn(`[DynamoDB] Failed to describe table ${tableName}:`, e.message);
        }
      }
      startName = resp.LastEvaluatedTableName;
    } while (startName);

    console.log("[DynamoDB] Processing complete. Total tables:", tables.length);

    const stats = {
      totalTables: tables.length,
      encryptedTables: tables.filter((t) => t.encrypted).length,
      pitrEnabledTables: tables.filter((t) => t.pitrEnabled).length,
      highRiskTables: tables.filter((t) => t.security?.severity === "Critical" || t.security?.severity === "High").length,
      estimatedMonthlyCost: tables.reduce((sum, t) => sum + (t.cost?.totalMonthlyCost || 0), 0),
    };

    // Handle empty table account gracefully
    if (tables.length === 0) {
      console.log("[DynamoDB] No tables found in account");
      return res.json({ 
        success: true, 
        tables: [], 
        stats,
        message: "No DynamoDB tables found in this account",
      });
    }

    return res.json({ success: true, tables, stats });
  } catch (error) {
    console.error("[DynamoDB] Error in listDynamoDB:", error.message, error.stack);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getDynamoDBDetail = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const tableName = req.params.tableName;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!tableName) return res.status(400).json({ success: false, message: "tableName required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    
    console.log("[DynamoDB Detail] Initializing clients for table:", tableName);
    const clients = await assumeRoleAndClients(roleArn, region);
    const { dynamoClient, cloudwatchClient, cloudtrailClient } = clients;
    
    if (!dynamoClient) {
      console.error("[DynamoDB Detail] ERROR: dynamoClient is undefined");
      return res.status(500).json({ success: false, message: "Failed to initialize DynamoDB client" });
    }

    const tableResp = await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
    const table = tableResp.Table;

    const tags = [];
    try {
      const tagsResp = await dynamoClient.send(new ListTagsOfResourceCommand({ ResourceArn: table.TableArn }));
      tags.push(...(tagsResp.Tags || []));
    } catch (e) {
      console.warn(`[DynamoDB Detail] Failed to get tags for ${tableName}:`, e.message);
    }

    const metrics = await collectDynamoDBMetrics(cloudwatchClient, tableName, 7);
    
    let activity = [];
    try {
      if (cloudtrailClient) {
        activity = await collectDynamoDBActivity(cloudtrailClient, tableName, 50);
      }
    } catch (actErr) {
      console.warn(`[DynamoDB Detail] Failed to collect activity for ${tableName}:`, actErr.message);
    }
    
    const security = analyzeDynamoDBSecurity(table, tags);
    
    let cost = null;
    try {
      cost = estimateDynamoDBTableCost(table);
    } catch (costErr) {
      console.warn(`[DynamoDB Detail] Failed to estimate cost for ${tableName}:`, costErr.message);
      cost = { totalMonthlyCost: 0, breakdown: {} };
    }

    const gsi = (table.GlobalSecondaryIndexes || []).map((idx) => ({
      indexName: idx.IndexName,
      keySchema: idx.KeySchema,
      projection: idx.Projection?.ProjectionType,
      status: idx.IndexStatus,
      itemCount: idx.ItemCount,
      sizeBytes: idx.IndexSizeBytes,
      readCapacity: idx.ProvisionedThroughput?.ReadCapacityUnits,
      writeCapacity: idx.ProvisionedThroughput?.WriteCapacityUnits,
    }));

    const lsi = (table.LocalSecondaryIndexes || []).map((idx) => ({
      indexName: idx.IndexName,
      keySchema: idx.KeySchema,
      projection: idx.Projection?.ProjectionType,
      sizeBytes: idx.IndexSizeBytes,
    }));

    const detail = {
      tableName: table.TableName,
      arn: table.TableArn,
      accountId,
      region,
      status: table.TableStatus,
      creationTime: table.CreationDateTime,
      itemCount: table.ItemCount || 0,
      tableSize: table.TableSizeBytes || 0,
      billingMode: table.BillingModeSummary?.BillingMode || "PROVISIONED",
      readCapacity: table.ProvisionedThroughput?.ReadCapacityUnits || 0,
      writeCapacity: table.ProvisionedThroughput?.WriteCapacityUnits || 0,
      keySchema: table.KeySchema,
      globalSecondaryIndexes: gsi,
      localSecondaryIndexes: lsi,
      encrypted: table.SSEDescription?.Enabled || false,
      kmsKeyArn: table.SSEDescription?.KMSMasterKeyArn || null,
      pitrEnabled: table.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus === "ENABLED",
      deletionProtected: table.DeletionProtectionEnabled || false,
      streamStatus: table.StreamSpecification?.StreamViewType || "DISABLED",
      streamArn: table.LatestStreamArn || null,
      ttlAttribute: table.TimeToLiveDescription?.AttributeName || null,
      tags,
      metrics,
      activity,
      security,
      cost,
    };

    return res.json({ success: true, detail });
  } catch (error) {
    console.error("[DynamoDB Detail] Error:", error.message, error.stack);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== SQS Service Functions ====================

function estimateSQSCost(queue) {
  const sent = Number(queue.messageStats?.sent || 0);
  const received = Number(queue.messageStats?.received || 0);
  const deleted = Number(queue.messageStats?.deleted || 0);
  const requests = sent + received + deleted + Number(queue.messageStats?.emptyReceives || 0);
  const monthlyRequests = Math.max(requests * 30, 1000);
  const requestCost = (monthlyRequests / 1000000) * 0.4;
  const payloadGb = (Number(queue.messageStats?.estimatedPayloadBytes || 0) / (1024 * 1024 * 1024)) * 30;
  const payloadCost = payloadGb * 0.08;
  const encryptionCost = queue.encrypted ? 0.05 : 0;
  const totalMonthlyCost = requestCost + payloadCost + encryptionCost;

  return {
    requestCost: parseFloat(requestCost.toFixed(2)),
    payloadTransferCost: parseFloat(payloadCost.toFixed(2)),
    encryptionCost: parseFloat(encryptionCost.toFixed(2)),
    totalMonthlyCost: parseFloat(totalMonthlyCost.toFixed(2)),
  };
}

function analyzeSQSSecurity(queue, tags = []) {
  const risks = [];
  const findings = [];

  if (!queue.encrypted) {
    risks.push("Missing encryption");
    findings.push("Queue is not encrypted at rest");
  }

  if (!queue.deadLetterQueue) {
    risks.push("No dead letter queue");
    findings.push("Queue has no DLQ configured");
  }

  if (queue.publicAccess) {
    risks.push("Public queue policy");
    findings.push("Queue policy may allow broad access");
  }

  if (queue.crossAccountAccess) {
    risks.push("Cross-account access");
    findings.push("Queue policy includes cross-account principals");
  }

  if (queue.anonymousAccess) {
    risks.push("Anonymous access");
    findings.push("Queue policy may allow anonymous access");
  }

  if ((queue.messageStats?.oldestAgeSeconds || 0) > 3600) {
    risks.push("Excessive message age");
    findings.push("Messages are aging in the queue");
  }

  let score = 100;
  score -= queue.encrypted ? 0 : 20;
  score -= queue.deadLetterQueue ? 0 : 20;
  score -= queue.publicAccess ? 20 : 0;
  score -= queue.crossAccountAccess ? 15 : 0;
  score -= queue.anonymousAccess ? 15 : 0;
  score -= (queue.messageStats?.oldestAgeSeconds || 0) > 3600 ? 10 : 0;

  const severity = score < 40 ? "Critical" : score < 60 ? "High" : score < 80 ? "Medium" : "Low";

  return { risks, findings, score, severity };
}

async function collectSQSActivity(cloudtrailClient, queueName, limit = 100) {
  const events = [];
  try {
    let nextToken;
    do {
      const resp = await cloudtrailClient.send(
        new LookupEventsCommand({
          LookupAttributes: [{ AttributeKey: "ResourceName", AttributeValue: queueName }],
          NextToken: nextToken,
          MaxResults: Math.min(50, limit),
        })
      );
      (resp.Events || []).forEach((event) => {
        const parsed = safeParseEvent(event.CloudTrailEvent);
        const identity = parsed?.userIdentity || {};
        events.push({
          eventId: event.EventId,
          eventName: event.EventName,
          eventTime: event.EventTime,
          username: event.Username || identity.userName || identity.arn || null,
          sourceIp: parsed?.sourceIPAddress || null,
          userAgent: parsed?.userAgent || null,
          assumedRole: identity.sessionContext?.sessionIssuer?.arn || null,
          requestParameters: parsed?.requestParameters || null,
        });
      });
      nextToken = resp.NextToken;
    } while (nextToken && events.length < limit);
  } catch (error) {
    console.warn(`SQS activity failed for ${queueName}:`, error.message);
  }

  return events.sort((a, b) => new Date(b.eventTime || 0) - new Date(a.eventTime || 0));
}

async function collectSQSQueueMetrics(cloudwatchClient, queueName, days = 7) {
  const end = new Date();
  const start = new Date(Date.now() - days * 24 * 3600 * 1000);
  const dimensions = [{ Name: "QueueName", Value: queueName }];

  const queries = [
    { Id: "sent", MetricStat: { Metric: { Namespace: "AWS/SQS", MetricName: "NumberOfMessagesSent", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "received", MetricStat: { Metric: { Namespace: "AWS/SQS", MetricName: "NumberOfMessagesReceived", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "deleted", MetricStat: { Metric: { Namespace: "AWS/SQS", MetricName: "NumberOfMessagesDeleted", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "empty", MetricStat: { Metric: { Namespace: "AWS/SQS", MetricName: "NumberOfEmptyReceives", Dimensions: dimensions }, Period: 3600, Stat: "Sum" } },
    { Id: "visible", MetricStat: { Metric: { Namespace: "AWS/SQS", MetricName: "ApproximateNumberOfMessagesVisible", Dimensions: dimensions }, Period: 3600, Stat: "Average" } },
    { Id: "inflight", MetricStat: { Metric: { Namespace: "AWS/SQS", MetricName: "ApproximateNumberOfMessagesNotVisible", Dimensions: dimensions }, Period: 3600, Stat: "Average" } },
    { Id: "age", MetricStat: { Metric: { Namespace: "AWS/SQS", MetricName: "ApproximateAgeOfOldestMessage", Dimensions: dimensions }, Period: 3600, Stat: "Maximum" } },
  ];

  const metrics = {};
  try {
    const resp = await cloudwatchClient.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: end,
        MetricDataQueries: queries,
        ScanBy: "TimestampAscending",
      })
    );

    (resp.MetricDataResults || []).forEach((row) => {
      metrics[row.Id] = {
        label: row.Label,
        timestamps: (row.Timestamps || []).map((t) => new Date(t).toISOString()),
        values: row.Values || [],
      };
    });
  } catch (error) {
    console.warn(`SQS metrics failed for ${queueName}:`, error.message);
  }

  const sent = (metrics.sent?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const received = (metrics.received?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const deleted = (metrics.deleted?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const emptyReceives = (metrics.empty?.values || []).reduce((sum, v) => sum + Number(v || 0), 0);
  const visible = metrics.visible?.values?.length ? metrics.visible.values[metrics.visible.values.length - 1] : 0;
  const inFlight = metrics.inflight?.values?.length ? metrics.inflight.values[metrics.inflight.values.length - 1] : 0;
  const oldestAge = metrics.age?.values?.length ? metrics.age.values[metrics.age.values.length - 1] : 0;

  return {
    ...metrics,
    sent,
    received,
    deleted,
    emptyReceives,
    visible,
    inFlight,
    oldestAge,
    failedProcessing: Math.max(0, received - deleted),
    processingRate: received > 0 ? (deleted / received) * 100 : 100,
    consumerHealth: deleted >= received * 0.9 ? "Healthy" : deleted > 0 ? "Degraded" : "Idle",
  };
}

function parseSQSQueueAttributes(queueAttributes = {}, tags = {}) {
  const policy = safeParseEvent(queueAttributes.Policy || "{}");
  const policyText = JSON.stringify(policy || {});
  const publicAccess = /"Principal"\s*:\s*"\*"/i.test(policyText) || /"AWS"\s*:\s*"\*"/i.test(policyText);
  const anonymousAccess = /"Principal"\s*:\s*"\*"/i.test(policyText);
  const crossAccountAccess = /arn:aws:iam::(?!\d{12}:)/i.test(policyText);
  const encrypted = Boolean(queueAttributes.KmsMasterKeyId || queueAttributes.SqsManagedSseEnabled === "true");
  const deadLetterQueue = Boolean(queueAttributes.RedrivePolicy);

  return {
    publicAccess,
    anonymousAccess,
    crossAccountAccess,
    encrypted,
    deadLetterQueue,
    dlqName: queueAttributes.RedrivePolicy ? safeParseEvent(queueAttributes.RedrivePolicy)?.deadLetterTargetArn?.split(":").pop() || null : null,
    redrivePolicy: queueAttributes.RedrivePolicy ? safeParseEvent(queueAttributes.RedrivePolicy) : null,
    tags: Object.entries(tags || {}).map(([Key, Value]) => ({ Key, Value })),
  };
}

export const listSQS = async (req, res) => {
  try {
    const { roleArn } = req.body;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    
    // Debug logging for client initialization
    console.log("[SQS] Initializing clients with region:", region);
    const clients = await assumeRoleAndClients(roleArn, region);
    const { sqsClient, cloudwatchClient, cloudtrailClient } = clients;
    
    // Validate clients exist
    if (!sqsClient) {
      console.error("[SQS] ERROR: sqsClient is undefined after assumeRoleAndClients");
      return res.status(500).json({ success: false, message: "Failed to initialize SQS client" });
    }
    if (!cloudwatchClient) {
      console.warn("[SQS] WARNING: cloudwatchClient is undefined");
    }
    if (!cloudtrailClient) {
      console.warn("[SQS] WARNING: cloudtrailClient is undefined");
    }
    
    console.log("[SQS] Clients initialized successfully");

    const queues = [];
    let nextToken;
    do {
      console.log("[SQS] Fetching queue list with nextToken:", nextToken || "none");
      const resp = await sqsClient.send(new ListQueuesCommand({ NextToken: nextToken }));
      const queueUrls = resp.QueueUrls || [];
      console.log("[SQS] Found", queueUrls.length, "queues");
      
      for (const queueUrl of queueUrls) {
        try {
          const name = queueUrl.split("/").pop();
          console.log("[SQS] Processing queue:", name);
          const [attributesResp, tagsResp] = await Promise.all([
            sqsClient.send(
              new GetQueueAttributesCommand({
                QueueUrl: queueUrl,
                AttributeNames: ["All"],
              })
            ),
            sqsClient.send(new ListQueueTagsCommand({ QueueUrl: queueUrl })).catch(() => ({ Tags: {} })),
          ]);

          const attrs = attributesResp.Attributes || {};
          const parsed = parseSQSQueueAttributes(attrs, tagsResp.Tags || {});
          const metrics = await collectSQSQueueMetrics(cloudwatchClient, name, 7);
          const security = analyzeSQSSecurity(
            {
              encrypted: parsed.encrypted,
              deadLetterQueue: parsed.deadLetterQueue,
              publicAccess: parsed.publicAccess,
              anonymousAccess: parsed.anonymousAccess,
              crossAccountAccess: parsed.crossAccountAccess,
              messageStats: {
                oldestAgeSeconds: Number(metrics.oldestAge || 0),
              },
            },
            parsed.tags
          );
          
          // Safely estimate cost if function exists
          let cost = null;
          try {
            cost = estimateSQSCost({
              encrypted: parsed.encrypted,
              messageStats: {
                sent: metrics.sent,
                received: metrics.received,
                deleted: metrics.deleted,
                emptyReceives: metrics.emptyReceives,
                estimatedPayloadBytes: Number(attrs.ApproximateNumberOfMessagesVisible || 0) * Number(attrs.MaximumMessageSize || 262144),
              },
            });
          } catch (costErr) {
            console.warn(`[SQS] Failed to estimate cost for ${name}:`, costErr.message);
            cost = { totalMonthlyCost: 0, breakdown: {} };
          }
          
          // Safely collect activity if cloudtrailClient exists
          let activity = [];
          try {
            if (cloudtrailClient) {
              activity = await collectSQSActivity(cloudtrailClient, name, 30);
            } else {
              console.warn(`[SQS] Skipping activity collection - cloudtrailClient undefined for ${name}`);
            }
          } catch (actErr) {
            console.warn(`[SQS] Failed to collect activity for ${name}:`, actErr.message);
            activity = [];
          }

          queues.push({
            queueName: name,
            queueUrl,
            arn: attrs.QueueArn || `arn:aws:sqs:${region}:${accountId}:${name}`,
            accountId,
            region,
            queueType: name.endsWith(".fifo") ? "FIFO" : "Standard",
            creationDate: attrs.CreatedTimestamp ? Number(attrs.CreatedTimestamp) * 1000 : null,
            lastModifiedTime: attrs.LastModifiedTimestamp ? Number(attrs.LastModifiedTimestamp) * 1000 : null,
            visibilityTimeout: Number(attrs.VisibilityTimeout || 0),
            messageRetentionPeriod: Number(attrs.MessageRetentionPeriod || 0),
            delaySeconds: Number(attrs.DelaySeconds || 0),
            maximumMessageSize: Number(attrs.MaximumMessageSize || 0),
            receiveWaitTime: Number(attrs.ReceiveMessageWaitTimeSeconds || 0),
            tags: parsed.tags,
            messageDetails: {
              approximateNumberOfMessages: Number(attrs.ApproximateNumberOfMessages || 0),
              messagesInFlight: Number(attrs.ApproximateNumberOfMessagesNotVisible || 0),
              delayedMessages: Number(attrs.ApproximateNumberOfMessagesDelayed || 0),
              deadLetterQueue: parsed.deadLetterQueue,
              dlqName: parsed.dlqName,
              redrivePolicy: parsed.redrivePolicy,
              messageThroughput: Number(metrics.sent || 0) + Number(metrics.received || 0),
              oldestMessageAge: Number(metrics.oldestAge || 0),
              producerServices: [],
              consumerServices: [],
            },
            security,
            monitoring: metrics,
            integrations: {
              lambdaTriggers: [],
              snsSubscriptions: [],
              eventBridgeIntegrations: [],
              ecsConsumers: [],
              ec2Consumers: [],
              apiGatewayProducers: [],
              connectedServices: [],
            },
            activity,
            cost,
            findings: [...security.risks],
          });
        } catch (error) {
          console.warn(`Failed to inspect queue ${queueUrl}:`, error.message);
        }
      }
      nextToken = resp.NextToken;
    } while (nextToken);

    console.log("[SQS] Processing complete. Total queues found:", queues.length);

    const stats = {
      totalQueues: queues.length,
      fifoQueues: queues.filter((queue) => queue.queueType === "FIFO").length,
      encryptedQueues: queues.filter((queue) => queue.security?.encrypted).length,
      dlqEnabled: queues.filter((queue) => queue.messageDetails?.deadLetterQueue).length,
      highRiskQueues: queues.filter((queue) => queue.security?.severity === "Critical" || queue.security?.severity === "High").length,
      estimatedMonthlyCost: queues.reduce((sum, queue) => sum + (queue.cost?.totalMonthlyCost || 0), 0),
    };

    // Handle empty queue account gracefully
    if (queues.length === 0) {
      console.log("[SQS] No queues found in account");
      return res.json({ 
        success: true, 
        queues: [], 
        stats,
        message: "No SQS queues found in this account",
      });
    }

    return res.json({ success: true, queues, stats });
  } catch (error) {
    console.error("[SQS] Error in listSQS:", error.message, error.stack);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getSQSDetail = async (req, res) => {
  try {
    const { roleArn } = req.body;
    const queueName = req.params.queueName;
    if (!roleArn) return res.status(400).json({ success: false, message: "roleArn required" });
    if (!queueName) return res.status(400).json({ success: false, message: "queueName required" });

    const region = req.body.region || process.env.AWS_REGION || "us-east-1";
    const accountId = roleArn.split(":")[4] || "";
    
    console.log("[SQS Detail] Initializing clients for queue:", queueName);
    const clients = await assumeRoleAndClients(roleArn, region);
    const { sqsClient, cloudwatchClient, cloudtrailClient } = clients;
    
    if (!sqsClient) {
      console.error("[SQS Detail] ERROR: sqsClient is undefined");
      return res.status(500).json({ success: false, message: "Failed to initialize SQS client" });
    }

    const urlResp = await sqsClient.send(
      new GetQueueUrlCommand({
        QueueName: queueName,
      })
    );

    const queueUrl = urlResp.QueueUrl;
    const [attributesResp, tagsResp] = await Promise.all([
      sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["All"] })),
      sqsClient.send(new ListQueueTagsCommand({ QueueUrl: queueUrl })).catch(() => ({ Tags: {} })),
    ]);

    const attrs = attributesResp.Attributes || {};
    const parsed = parseSQSQueueAttributes(attrs, tagsResp.Tags || {});
    const metrics = await collectSQSQueueMetrics(cloudwatchClient, queueName, 14);
    const activity = await collectSQSActivity(cloudtrailClient, queueName, 100);
    const security = analyzeSQSSecurity(
      {
        encrypted: parsed.encrypted,
        deadLetterQueue: parsed.deadLetterQueue,
        publicAccess: parsed.publicAccess,
        anonymousAccess: parsed.anonymousAccess,
        crossAccountAccess: parsed.crossAccountAccess,
        messageStats: { oldestAgeSeconds: Number(metrics.oldestAge || 0) },
      },
      parsed.tags
    );
    const cost = estimateSQSCost({
      encrypted: parsed.encrypted,
      messageStats: {
        sent: metrics.sent,
        received: metrics.received,
        deleted: metrics.deleted,
        emptyReceives: metrics.emptyReceives,
        estimatedPayloadBytes: Number(attrs.ApproximateNumberOfMessagesVisible || 0) * Number(attrs.MaximumMessageSize || 262144),
      },
    });

    const detail = {
      queueName,
      queueUrl,
      arn: attrs.QueueArn || `arn:aws:sqs:${region}:${accountId}:${queueName}`,
      accountId,
      region,
      queueType: queueName.endsWith(".fifo") ? "FIFO" : "Standard",
      creationDate: attrs.CreatedTimestamp ? Number(attrs.CreatedTimestamp) * 1000 : null,
      lastModifiedTime: attrs.LastModifiedTimestamp ? Number(attrs.LastModifiedTimestamp) * 1000 : null,
      visibilityTimeout: Number(attrs.VisibilityTimeout || 0),
      messageRetentionPeriod: Number(attrs.MessageRetentionPeriod || 0),
      delaySeconds: Number(attrs.DelaySeconds || 0),
      maximumMessageSize: Number(attrs.MaximumMessageSize || 0),
      receiveWaitTime: Number(attrs.ReceiveMessageWaitTimeSeconds || 0),
      tags: parsed.tags,
      messageDetails: {
        approximateNumberOfMessages: Number(attrs.ApproximateNumberOfMessages || 0),
        messagesInFlight: Number(attrs.ApproximateNumberOfMessagesNotVisible || 0),
        delayedMessages: Number(attrs.ApproximateNumberOfMessagesDelayed || 0),
        deadLetterQueue: parsed.deadLetterQueue,
        dlqName: parsed.dlqName,
        redrivePolicy: parsed.redrivePolicy,
        messageThroughput: Number(metrics.sent || 0) + Number(metrics.received || 0),
        oldestMessageAge: Number(metrics.oldestAge || 0),
        producerServices: [],
        consumerServices: [],
      },
      security,
      monitoring: metrics,
      integrations: {
        lambdaTriggers: [],
        snsSubscriptions: [],
        eventBridgeIntegrations: [],
        ecsConsumers: [],
        ec2Consumers: [],
        apiGatewayProducers: [],
        connectedServices: [],
      },
      activity,
      cost,
      findings: [...security.risks],
    };

    return res.json({ success: true, detail });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};