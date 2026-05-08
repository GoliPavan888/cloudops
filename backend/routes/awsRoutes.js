import express from "express";
import {
	connectAWS,
	listEC2,
	getEC2Detail,
	getEC2Metrics,
	getEC2Activity,
	getEC2Security,
	listS3,
	getS3Detail,
	getS3Metrics,
	getS3Activity,
	getS3Security,
	listRDS,
	getRDSDetail,
	getRDSMetrics,
	getRDSActivity,
	getRDSSecurity,
	listLambda,
	getLambdaDetail,
	getLambdaMetrics,
	getLambdaActivity,
	getLambdaSecurity,
	listIAM,
	getIAMUserDetail,
	getIAMUserMetrics,
	getIAMUserActivity,
	getIAMUserSecurity,
} from "../services/awsService.js";

const router = express.Router();

// initial connect scan
router.post("/connect", connectAWS);

// EC2 APIs (accepts { roleArn, region? } in body)
router.post("/ec2", listEC2);
router.post("/ec2/:id", getEC2Detail);
router.post("/ec2/:id/metrics", getEC2Metrics);
router.post("/ec2/:id/activity", getEC2Activity);
router.post("/ec2/:id/security", getEC2Security);

// S3 APIs
router.post("/s3", listS3);
router.post("/s3/:name", getS3Detail);
router.post("/s3/:name/metrics", getS3Metrics);
router.post("/s3/:name/activity", getS3Activity);
router.post("/s3/:name/security", getS3Security);

// RDS APIs
router.post("/rds", listRDS);
router.post("/rds/:id", getRDSDetail);
router.post("/rds/:id/metrics", getRDSMetrics);
router.post("/rds/:id/activity", getRDSActivity);
router.post("/rds/:id/security", getRDSSecurity);

// Lambda APIs
router.post("/lambda", listLambda);
router.post("/lambda/:name", getLambdaDetail);
router.post("/lambda/:name/metrics", getLambdaMetrics);
router.post("/lambda/:name/activity", getLambdaActivity);
router.post("/lambda/:name/security", getLambdaSecurity);

// IAM APIs
router.post("/iam", listIAM);
router.post("/iam/:userName", getIAMUserDetail);
router.post("/iam/:userName/metrics", getIAMUserMetrics);
router.post("/iam/:userName/activity", getIAMUserActivity);
router.post("/iam/:userName/security", getIAMUserSecurity);

export default router;