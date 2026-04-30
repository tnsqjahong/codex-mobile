import { CodexRpc } from "./codex-rpc.js";

const rpc = new CodexRpc();
await rpc.start();

const list = await rpc.request("thread/list", {
  archived: false,
  limit: 5,
  sortKey: "updated_at",
  sortDirection: "desc",
});

console.log(JSON.stringify(list.data?.map((thread) => ({
  id: thread.id,
  title: thread.name || thread.title || thread.preview,
  cwd: thread.cwd,
  updatedAt: thread.updatedAt,
})) || [], null, 2));

rpc.stop();
process.exit(0);
