import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { IAMClient, ListUsersCommand, ListRolesCommand } from "@aws-sdk/client-iam";
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
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, ListQueuesCommand } from "@aws-sdk/client-sqs";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
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
    ec2Client: new EC2Client({ region, credentials }),
    s3Client: new S3Client({ region, credentials }),
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