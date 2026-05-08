import express from "express";
import { getUserResources }
  from "../services/userService.js";

const router = express.Router();

router.post(
  "/resources",
  getUserResources
);

export default router;