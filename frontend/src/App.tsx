import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

type HealthResponse = {
  status: string;
  message: string;
};

function App() {
  const [backendStatus, setBackendStatus] = useState<string>("正在连接后端...");

  useEffect(() => {
    axios
      .get<HealthResponse>("http://localhost:3001/api/health")
      .then((res) => {
        setBackendStatus(res.data.message);
      })
      .catch(() => {
        setBackendStatus("后端连接失败");
      });
  }, []);

  return (
    <div className="app">
      <h1>隐私保护协同编辑器</h1>
      <p>底层 CRDT 引擎：Yjs</p>
      <p>系统目标：一致性 + 隐私视图 + 权限隔离</p>
      <div className="card">
        <h2>后端状态</h2>
        <p>{backendStatus}</p>
      </div>
    </div>
  );
}

export default App;
