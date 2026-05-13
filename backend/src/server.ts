import express from "express";
import cors from "cors";

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "Privacy CRDT backend is running"
  });
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});