import {describe,it,expect,vi} from "vitest";
import {receivingInstanceId} from "./receiving-instance-id";
describe("sandbox-compatible receiving identity",()=>{
 it("uses the available random provider without requiring randomUUID",()=>{
  const provider={getRandomValues:vi.fn((bytes:Uint8Array)=>{bytes.fill(17);return bytes})} as unknown as Crypto;
  const first=receivingInstanceId(provider);expect(first).toMatch(/^worldbend-[0-9a-f]+$/);
  provider.getRandomValues=vi.fn((bytes:Uint8Array)=>{bytes.fill(34);return bytes}) as Crypto["getRandomValues"];
  expect(receivingInstanceId(provider)).not.toBe(first);
 });
 it("reports unavailable host support before attachment reserves an owner",()=>{
  expect(()=>receivingInstanceId({} as Crypto)).toThrow("supported browser");
 });
});
