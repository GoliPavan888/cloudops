import express from "express";
import { connectAWS } from "../services/awsService.js";

const router = express.Router();

router.post("/connect", connectAWS);

export default router;