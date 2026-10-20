import { expect, it, vi } from "vitest";
import { beginNativeTemporarySession, cancelNativeTemporarySessions } from "./native-temporary-session";

it("cleans only exact owned nodes, stops late callbacks and permits a fresh session", () => {
  const source={removed:false,remove:vi.fn()},unrelated={removed:false,remove:vi.fn()};
  const node={removed:false,remove(){this.removed=true;}},session=beginNativeTemporarySession();
  session.track(node);cancelNativeTemporarySessions();
  expect(node.removed).toBe(true);expect(source.remove).not.toHaveBeenCalled();expect(unrelated.remove).not.toHaveBeenCalled();
  expect(()=>session.assertActive()).toThrow("session closed");
  const late={removed:false,remove(){this.removed=true;}};
  expect(()=>session.track(late)).toThrow("session closed");expect(late.removed).toBe(true);
  session.dispose();const fresh=beginNativeTemporarySession();expect(()=>fresh.assertActive()).not.toThrow();fresh.dispose();
});

it("attempts every owned cleanup after SDK failure and exposes incomplete cleanup for a retry", () => {
  let refuse=true;
  const broken={removed:false,remove(){if(refuse){refuse=false;throw undefined;}this.removed=true;}},other={removed:false,remove(){this.removed=true;}};
  const first=beginNativeTemporarySession(),second=beginNativeTemporarySession();first.track(broken);second.track(other);
  let failed=false;try{cancelNativeTemporarySessions();}catch{failed=true;}
  expect(failed).toBe(true);expect(other.removed).toBe(true);expect(broken.removed).toBe(false);
  // Simulate the paused caller's finally after close. Ownership must survive
  // that disposal until the SDK removal can genuinely complete.
  first.dispose();second.dispose();
  cancelNativeTemporarySessions();expect(broken.removed).toBe(true);first.dispose();second.dispose();
});
