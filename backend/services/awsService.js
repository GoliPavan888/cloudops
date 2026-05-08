import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
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
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, ListQueuesCommand } from "@aws-sdk/client-sqs";
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

    const securityFindings = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
    try {
      const findings = await securityHubClient.send(new GetFindingsCommand({ MaxResults: 100 }));
      (findings.Findings || []).forEach((f) => {
        const sev = String(f.Severity?.Label || "").toUpperCase();
        if (sev === "CRITICAL") securityFindings.critical += 1;
        else if (sev === "HIGH") securityFindings.high += 1;
        else if (sev === "MEDIUM") securityFindings.medium += 1;
        else if (sev === "LOW") securityFindings.low += 1;
        else securityFindings.informational += 1;
      });
    } catch (e) {
      console.warn("SecurityHub scan failed:", e.message);
    }

    const uniqueRegions = new Set(resources.map((r) => r.region).filter(Boolean));

    return res.json({
      success: true,
      message: "AWS Connected Successfully",
      account: {
        roleArn,
        accountId,
        region: scanRegion,
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
    lambdaClient: new LambdaClient({ region, credentials }),
    logsClient: new CloudWatchLogsClient({ region, credentials }),
    cloudwatchClient: new CloudWatchClient({ region, credentials }),
    cloudtrailClient: new CloudTrailClient({ region, credentials }),
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

    const [policy, acl, encryption, versioning, pab, logging, replication, lifecycle, ownership, findings] = await Promise.all([
      s3Client.send(new GetBucketPolicyCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketAclCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketEncryptionCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketVersioningCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetPublicAccessBlockCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketLoggingCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketReplicationCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })).catch(() => null),
      s3Client.send(new GetBucketOwnershipControlsCommand({ Bucket: bucket })).catch(() => null),
      securityHubClient.send(new GetFindingsCommand({ MaxResults: 100 })).catch(() => null),
    ]);

    const policyParsed = policy?.Policy ? parsePolicy(policy.Policy) : null;
    const policySignals = detectPolicyIssues(policyParsed, accountId, bucket);
    const aclSignals = analyzeAcl(acl, accountId);
    const encryptionSignals = analyzeEncryption(encryption);
    const versioningSignals = analyzeVersioning(versioning);
    const loggingSignals = analyzeLogging(logging);
    const replicationSignals = analyzeReplication(replication);
    const lifecycleSignals = analyzeLifecycle(lifecycle);

    const accessAnalyzerFindings = (findings?.Findings || []).filter((item) => (item.Resources || []).some((resource) => String(resource.Id || "").includes(bucket))).map((item) => ({ id: item.Id, title: item.Title, severity: item.Severity }));

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
            ec2Instances.push({
              instanceId: i.InstanceId,
              instanceName: name,
              state: i.State?.Name || "unknown",
              instanceType: i.InstanceType,
              amiId: i.ImageId,
              region: i.Placement?.AvailabilityZone ? i.Placement.AvailabilityZone.slice(0, -1) : scanRegion,
              availabilityZone: i.Placement?.AvailabilityZone,
              launchTime: i.LaunchTime,
              tags,
              publicIp: i.PublicIpAddress || null,
              privateIp: i.PrivateIpAddress || null,
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
    const detail = { instanceId, volumes: [], securityGroups: [], iamInstanceProfile: null, networkInterfaces: [] };
    try {
      const resp = await ec2Client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
      const inst = resp.Reservations?.[0]?.Instances?.[0];
      if (inst) {
        detail.instance = inst;
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

    // Try SecurityHub findings referencing the instance (best-effort)
    try {
      const findings = await securityHubClient.send(new GetFindingsCommand({ MaxResults: 50 }));
      (findings.Findings || []).forEach((f) => {
        const related = (f.Resources || []).some((r) => String(r.Id || "").includes(instanceId));
        if (related) analysis.securityFindings.push({ id: f.Id, title: f.Title, severity: f.Severity, remediation: f.Remediation });
      });
    } catch (e) {
      console.warn("SecurityHub findings lookup failed:", e.message);
    }

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