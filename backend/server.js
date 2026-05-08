import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import awsRoutes from "./routes/awsRoutes.js";
import userRoutes from "./routes/userRoutes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/aws", awsRoutes);
app.use("/api/users", userRoutes);

const PORT = 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});