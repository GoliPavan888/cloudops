import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { IAMClient, ListUsersCommand, ListRolesCommand } from "@aws-sdk/client-iam";
import { S3Client, ListBucketsCommand, GetBucketLocationCommand, GetBucketTaggingCommand } from "@aws-sdk/client-s3";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, ListQueuesCommand } from "@aws-sdk/client-sqs";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { SecurityHubClient, GetFindingsCommand } from "@aws-sdk/client-securityhub";

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

    try {
      let nextToken;
      do {
        const ec2 = await ec2Client.send(new DescribeInstancesCommand({ NextToken: nextToken }));
        (ec2.Reservations || []).forEach((r) => {
          (r.Instances || []).forEach((i) => {
            const tags = i.Tags || [];
            const name = tags.find((t) => t.Key === "Name")?.Value || i.InstanceId;
            resources.push({
              resource: name,
              type: "EC2 Instance",
              service: "EC2",
              region: i.Placement?.AvailabilityZone || scanRegion,
              arn: i.InstanceId,
              tags,
              owner: findOwnerFromTags(tags),
              status: i.State?.Name || "unknown",
            });
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