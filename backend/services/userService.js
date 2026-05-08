import {
  STSClient,
  AssumeRoleCommand,
} from "@aws-sdk/client-sts";

import {
  IAMClient,
  ListAttachedUserPoliciesCommand,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam";

import {
  EC2Client,
  DescribeInstancesCommand,
} from "@aws-sdk/client-ec2";

import {
  S3Client,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";

import {
  LambdaClient,
  ListFunctionsCommand,
} from "@aws-sdk/client-lambda";

import {
  CloudTrailClient,
  LookupEventsCommand,
} from "@aws-sdk/client-cloudtrail";

export const getUserResources =
  async (req, res) => {

  try {

    const { roleArn, userName } =
      req.body;

    // Assume Role
    const stsClient = new STSClient({
      region: process.env.AWS_REGION,

      credentials: {
        accessKeyId:
          process.env
            .AWS_ACCESS_KEY_ID,

        secretAccessKey:
          process.env
            .AWS_SECRET_ACCESS_KEY,
      },
    });

    const assumedRole =
      await stsClient.send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          RoleSessionName:
            "AWSScannerSession",
        })
      );

    const credentials = {
      accessKeyId:
        assumedRole.Credentials
          .AccessKeyId,

      secretAccessKey:
        assumedRole.Credentials
          .SecretAccessKey,

      sessionToken:
        assumedRole.Credentials
          .SessionToken,
    };

    // IAM
    const iamClient =
      new IAMClient({
        region:
          process.env.AWS_REGION,
        credentials,
      });

    // USER POLICIES
    const policies =
      await iamClient.send(
        new ListAttachedUserPoliciesCommand({
          UserName: userName,
        })
      );

    // ACCESS KEYS
    const accessKeys =
      await iamClient.send(
        new ListAccessKeysCommand({
          UserName: userName,
        })
      );

    // EC2
    const ec2Client =
      new EC2Client({
        region:
          process.env.AWS_REGION,
        credentials,
      });

    const ec2 =
      await ec2Client.send(
        new DescribeInstancesCommand({})
      );

    // S3
    const s3Client =
      new S3Client({
        region:
          process.env.AWS_REGION,
        credentials,
      });

    const s3 =
      await s3Client.send(
        new ListBucketsCommand({})
      );

    // Lambda
    const lambdaClient =
      new LambdaClient({
        region:
          process.env.AWS_REGION,
        credentials,
      });

    const lambdas =
      await lambdaClient.send(
        new ListFunctionsCommand({})
      );
      
      // CLOUDTRAIL
const cloudTrailClient =
  new CloudTrailClient({
    region:
      process.env.AWS_REGION,
    credentials,
  });
  const cloudTrailEvents =
  await cloudTrailClient.send(
    new LookupEventsCommand({
      LookupAttributes: [
        {
          AttributeKey: "Username",
          AttributeValue: userName,
        },
      ],
      MaxResults: 50,
    })
  );

  const createdResources =
  cloudTrailEvents.Events.map(
    (event) => ({

      eventName: event.EventName,

      eventTime: event.EventTime,

      resource:
        event.Resources?.[0]
          ?.ResourceName || "N/A",

      resourceType:
        event.Resources?.[0]
          ?.ResourceType || "N/A",

      username: userName,
    })
  );

    return res.json({
      success: true,

      user: userName,

      policies:
        policies.AttachedPolicies,

      accessKeys:
        accessKeys.AccessKeyMetadata,

      ec2:
        ec2.Reservations,

      s3:
        s3.Buckets,

      lambda:
        lambdas.Functions,
      activity:
        createdResources,  
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};